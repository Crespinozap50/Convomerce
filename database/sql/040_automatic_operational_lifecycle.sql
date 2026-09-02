-- Advance time-based appointment states without requiring an operator.
set role commerce_owner;

create function app.advance_operational_lifecycle()
returns table(activated integer,started integer,completed integer,expired integer)
language plpgsql security definer set search_path=pg_catalog,app as $$
declare activated_count integer:=0;started_count integer:=0;completed_count integer:=0;expired_count integer:=0;
begin
  update app.commercial_requests request set status='accepted',updated_at=now(),version=version+1
    from app.appointments appointment where appointment.tenant_id=request.tenant_id
    and appointment.commercial_request_id=request.id and appointment.status='confirmed' and request.status='ready';
  get diagnostics activated_count=row_count;
  update app.commercial_requests request set status='in_progress',updated_at=now(),version=version+1
    from app.appointments appointment where appointment.tenant_id=request.tenant_id
    and appointment.commercial_request_id=request.id and appointment.status='confirmed'
    and appointment.starts_at<=now() and appointment.ends_at>now() and request.status='accepted';
  get diagnostics started_count=row_count;
  with finished as (
    update app.appointments set status='completed',updated_at=now()
    where status='confirmed' and ends_at<=now() returning tenant_id,commercial_request_id
  ) update app.commercial_requests request set status='completed',updated_at=now(),version=version+1
    from finished where request.tenant_id=finished.tenant_id and request.id=finished.commercial_request_id
    and request.status in('accepted','in_progress');
  get diagnostics completed_count=row_count;
  with stale as (
    update app.appointments set status='cancelled',hold_expires_at=null,cancelled_at=now(),updated_at=now()
    where status='held' and hold_expires_at<=now() returning tenant_id,commercial_request_id
  ) update app.commercial_requests request set status='cancelled',updated_at=now(),version=version+1
    from stale where request.tenant_id=stale.tenant_id and request.id=stale.commercial_request_id
    and request.status in('draft','awaiting_confirmation');
  get diagnostics expired_count=row_count;
  return query select activated_count,started_count,completed_count,expired_count;
end $$;

revoke all on function app.advance_operational_lifecycle() from public;
grant execute on function app.advance_operational_lifecycle() to commerce_runtime;
reset role;
