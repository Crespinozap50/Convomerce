-- Per-user inbox read state. A conversation is unread when it has inbound
-- messages newer than the user's last read position.
set role commerce_owner;

create table app.conversation_reads (
  tenant_id uuid not null,
  conversation_id uuid not null,
  user_id uuid not null references app.users(id) on delete cascade,
  last_read_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, user_id),
  foreign key (tenant_id, conversation_id)
    references app.conversations(tenant_id, id) on delete cascade
);

create index conversation_reads_user_idx
  on app.conversation_reads (tenant_id, user_id, last_read_at);

alter table app.conversation_reads enable row level security;
alter table app.conversation_reads force row level security;
create policy tenant_isolation on app.conversation_reads
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

revoke all on app.conversation_reads from public;
grant select, insert, update on app.conversation_reads to commerce_runtime;
grant select on app.conversation_reads to commerce_readonly;

reset role;
