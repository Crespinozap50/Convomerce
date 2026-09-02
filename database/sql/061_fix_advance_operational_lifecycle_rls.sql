-- Same bug as 060, confirmed live in real data: app.commercial_requests and
-- app.appointments both use the standard `tenant_id = app.current_tenant_id()`
-- RLS policy with FORCE ROW LEVEL SECURITY. 040's advance_operational_lifecycle
-- is security definer (runs as commerce_owner) with no BYPASSRLS on either
-- commerce_owner or commerce_runtime, and never sets app.tenant_id — so
-- current_tenant_id() was always null and every one of its four UPDATEs
-- silently touched zero rows on every 30-second poll since it was introduced.
--
-- Proof: a real confirmed appointment from 2026-08-07 (ends_at long past)
-- still had its commercial_request stuck at status='ready' — it should have
-- advanced through 'accepted' -> 'in_progress' -> 'completed' within
-- seconds of being confirmed. It never moved.
--
-- Fix: same as 060 — loop over app.tenants (no RLS there, the root entity)
-- and set_config('app.tenant_id', ...) per iteration so
-- current_tenant_id() resolves for that tenant's own rows on each pass.
-- The four UPDATE statements are otherwise unchanged from 040, just scoped
-- to the current loop iteration's tenant and accumulated across iterations.
set role commerce_owner;

drop function app.advance_operational_lifecycle();

create function app.advance_operational_lifecycle()
returns table(activated integer,started integer,completed integer,expired integer)
language plpgsql security definer set search_path=pg_catalog,app as $$
declare
  activated_count integer:=0;started_count integer:=0;completed_count integer:=0;expired_count integer:=0;
  batch_count integer;
  tenant record;
begin
  for tenant in select id as tenant_id from app.tenants loop
    perform set_config('app.tenant_id', tenant.tenant_id::text, true);

    update app.commercial_requests request set status='accepted',updated_at=now(),version=version+1
      from app.appointments appointment where appointment.tenant_id=request.tenant_id
      and appointment.commercial_request_id=request.id and appointment.status='confirmed'
      and request.status='ready' and request.tenant_id=tenant.tenant_id;
    get diagnostics batch_count=row_count; activated_count:=activated_count+batch_count;

    update app.commercial_requests request set status='in_progress',updated_at=now(),version=version+1
      from app.appointments appointment where appointment.tenant_id=request.tenant_id
      and appointment.commercial_request_id=request.id and appointment.status='confirmed'
      and appointment.starts_at<=now() and appointment.ends_at>now() and request.status='accepted'
      and request.tenant_id=tenant.tenant_id;
    get diagnostics batch_count=row_count; started_count:=started_count+batch_count;

    with finished as (
      update app.appointments set status='completed',updated_at=now()
      where status='confirmed' and ends_at<=now() and tenant_id=tenant.tenant_id
      returning tenant_id,commercial_request_id
    ) update app.commercial_requests request set status='completed',updated_at=now(),version=version+1
      from finished where request.tenant_id=finished.tenant_id and request.id=finished.commercial_request_id
      and request.status in('accepted','in_progress');
    get diagnostics batch_count=row_count; completed_count:=completed_count+batch_count;

    with stale as (
      update app.appointments set status='cancelled',hold_expires_at=null,cancelled_at=now(),updated_at=now()
      where status='held' and hold_expires_at<=now() and tenant_id=tenant.tenant_id
      returning tenant_id,commercial_request_id
    ) update app.commercial_requests request set status='cancelled',updated_at=now(),version=version+1
      from stale where request.tenant_id=stale.tenant_id and request.id=stale.commercial_request_id
      and request.status in('draft','awaiting_confirmation');
    get diagnostics batch_count=row_count; expired_count:=expired_count+batch_count;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return query select activated_count,started_count,completed_count,expired_count;
end $$;

revoke all on function app.advance_operational_lifecycle() from public;
grant execute on function app.advance_operational_lifecycle() to commerce_runtime;

reset role;
