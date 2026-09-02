-- Per-user read position for the orders and bookings inbox.
set role commerce_owner;

create table app.commercial_request_reads (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

alter table app.commercial_request_reads enable row level security;
alter table app.commercial_request_reads force row level security;
create policy tenant_isolation on app.commercial_request_reads
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

revoke all on app.commercial_request_reads from public;
grant select, insert, update on app.commercial_request_reads to commerce_runtime;
grant select on app.commercial_request_reads to commerce_readonly;

reset role;
