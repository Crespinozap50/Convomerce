-- Data-hygiene audit finding: 41 app.request_lines stayed status='active'
-- under a commercial_request that was already 'cancelled' — commercial_requests
-- gets set to 'cancelled' from many separate places (the 'cancel' command,
-- appointment-flow.service.ts's several cancel paths, close_inactive_conversations()
-- since D-061, advance_operational_lifecycle() for expired holds), none of
-- which ever touched the request's own lines. No functional bug results
-- today (every query that reads request_lines already scopes by a specific,
-- known-live commercial_request_id, so a cancelled request's stale 'active'
-- lines are never surfaced) — but scattering the same companion UPDATE
-- across 8+ call sites risks missing one, in this codebase or a future
-- change. A trigger on app.commercial_requests is the single point of truth
-- instead: whenever status transitions to 'cancelled', its still-active
-- lines are marked 'removed' in the same statement's transaction,
-- regardless of which code path caused the cancellation.
set role commerce_owner;

create function app.cancel_request_lines_on_request_cancel()
returns trigger language plpgsql as $$
begin
  if new.status='cancelled' and old.status<>'cancelled' then
    update app.request_lines
       set status='removed', removed_at=now(), updated_at=now()
     where tenant_id=new.tenant_id and commercial_request_id=new.id and status='active';
  end if;
  return new;
end $$;

create trigger cancel_request_lines_on_request_cancel
after update on app.commercial_requests
for each row execute function app.cancel_request_lines_on_request_cancel();

-- One-time backfill for the 41 lines already orphaned before this trigger existed.
update app.request_lines line
   set status='removed', removed_at=now(), updated_at=now()
  from app.commercial_requests request
 where request.tenant_id=line.tenant_id and request.id=line.commercial_request_id
   and line.status='active' and request.status='cancelled';

reset role;
