-- Tenant-scoped learning inbox. Questions are aggregated, never promoted automatically.
set role commerce_owner;
create table app.unresolved_customer_questions (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  normalized_question text not null,
  sample_question text not null,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  status text not null default 'pending' check (status in ('pending','dismissed','resolved')),
  last_conversation_id uuid,
  last_message_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tenant_id, id), unique (tenant_id, normalized_question),
  foreign key (tenant_id,last_conversation_id) references app.conversations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,last_message_id) references app.messages(tenant_id,id) on delete restrict
);
create index unresolved_customer_questions_review_idx on app.unresolved_customer_questions (tenant_id,status,occurrence_count desc,last_seen_at desc);
alter table app.unresolved_customer_questions enable row level security;
alter table app.unresolved_customer_questions force row level security;
create policy tenant_isolation on app.unresolved_customer_questions using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
revoke all on app.unresolved_customer_questions from public;
grant select,insert,update on app.unresolved_customer_questions to commerce_runtime;
grant select on app.unresolved_customer_questions to commerce_readonly;
reset role;
