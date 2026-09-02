-- Operational lifecycle for provider-neutral orders, reservations and quotes.
set role commerce_owner;

alter table app.commercial_requests
  drop constraint commercial_requests_status_check;

alter table app.commercial_requests
  add constraint commercial_requests_status_check
  check (status in (
    'draft', 'awaiting_confirmation', 'ready',
    'accepted', 'in_progress', 'completed',
    'cancelled', 'rejected', 'expired'
  ));

create index commercial_requests_operations_idx
  on app.commercial_requests (tenant_id, status, updated_at desc);

reset role;
