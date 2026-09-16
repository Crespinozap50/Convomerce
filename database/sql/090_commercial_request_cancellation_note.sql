-- D-200 (docs/decisions.md): staff couldn't tell, from the admin panel alone,
-- whether a cancelled order was cancelled by the customer (self-service via
-- chat, D-173/D-199) or by staff themselves from the panel — both looked
-- identical, just status='cancelled'. cancellation_note is set only by the
-- customer-initiated cancel paths in commercial-flow.service.ts; the
-- admin-panel path (commercial-requests.service.ts's changeStatus) never
-- sets it, so its absence on a cancelled order means staff cancelled it.
set role commerce_owner;

alter table app.commercial_requests
  add column cancellation_note text;

reset role;
