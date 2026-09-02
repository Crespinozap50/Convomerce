-- Fixes a bug found while verifying 059 against the real database:
-- app.conversations and app.bot_configurations both use the standard
-- `tenant_id = app.current_tenant_id()` RLS policy with FORCE ROW LEVEL
-- SECURITY, and neither commerce_owner (the function owner — SECURITY
-- DEFINER runs as the owner) nor commerce_runtime has BYPASSRLS. With no
-- app.tenant_id session variable set, current_tenant_id() is null, so
-- `tenant_id = null` is never true and the sweep silently touched zero rows
-- every single run — confirmed live: manually staging a 20-minutes-stale
-- human-handled conversation against a tenant configured for a 15-minute
-- timeout, close_inactive_conversations() still returned closed=0.
--
-- The fix: enumerate tenants from app.tenants (no RLS on that table — it's
-- the root entity, not itself tenant-scoped) and set_config('app.tenant_id',
-- ...) per iteration, so app.current_tenant_id() resolves correctly for
-- that tenant's own rows on each pass. This is the only reliable way to
-- read/write across tenants under this schema's RLS model — note
-- app.advance_operational_lifecycle() (040) has the exact same
-- current_tenant_id()-is-null shape and is likely equally silently
-- inert, but that is a pre-existing function this migration does not
-- touch; only close_inactive_conversations (introduced in 059, not yet
-- relied upon anywhere) is fixed here.
set role commerce_owner;

drop function app.close_inactive_conversations();

create function app.close_inactive_conversations()
returns table(closed integer)
language plpgsql security definer set search_path=pg_catalog,app as $$
declare
  total_closed integer := 0;
  affected integer;
  timeout_minutes integer;
  tenant record;
begin
  -- app.tenants carries no RLS (it's the root entity, not itself
  -- tenant-scoped), so this enumeration is safe with no context set yet.
  -- bot_configurations, in contrast, must be read only *after* setting the
  -- tenant context below — reading it beforehand would hit the same
  -- current_tenant_id()-is-null-blocks-everything issue this migration
  -- fixes.
  for tenant in select id as tenant_id from app.tenants loop
    perform set_config('app.tenant_id', tenant.tenant_id::text, true);
    select bot.conversation_timeout_minutes into timeout_minutes
      from app.bot_configurations bot where bot.tenant_id=tenant.tenant_id;
    if timeout_minutes is not null then
      update app.conversations
         set status='closed', close_reason='inactive', closed_at=now(), updated_at=now(), version=version+1
       where tenant_id=tenant.tenant_id
         and status<>'closed'
         and handling_mode='human'
         and last_message_at is not null
         and last_message_at<=now()-make_interval(mins=>timeout_minutes);
      get diagnostics affected = row_count;
      total_closed := total_closed + affected;
    end if;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return query select total_closed;
end $$;

revoke all on function app.close_inactive_conversations() from public;
grant execute on function app.close_inactive_conversations() to commerce_runtime;

reset role;
