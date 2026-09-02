-- Provider-neutral conversational workflow state. The engine is shared across
-- industries; operation_type and configuration determine the required steps.
set role commerce_owner;

create table app.conversation_workflows (
  id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  contact_id uuid not null,
  commercial_request_id uuid,
  operation_type text not null check (operation_type in ('order','appointment','service','quote')),
  step text not null,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context)='object'),
  status text not null default 'active' check (status in ('active','completed','cancelled','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,conversation_id) references app.conversations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,contact_id) references app.contacts(tenant_id,id) on delete restrict,
  foreign key (tenant_id,commercial_request_id) references app.commercial_requests(tenant_id,id) on delete restrict
);
create unique index conversation_workflows_one_active_uidx
  on app.conversation_workflows(tenant_id,conversation_id) where status='active';

alter table app.conversation_workflows enable row level security;
alter table app.conversation_workflows force row level security;
create policy tenant_isolation on app.conversation_workflows
  using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
revoke all on app.conversation_workflows from public;
grant select,insert,update on app.conversation_workflows to commerce_runtime;
grant select on app.conversation_workflows to commerce_readonly;

-- Defaults demonstrate configuration, not restaurant-specific branching.
alter table app.customer_data_requirements no force row level security;
insert into app.customer_data_requirements
  (tenant_id,operation_type,fulfillment_type,require_name,require_phone,require_address)
select tenant.id,rule.operation_type,rule.fulfillment_type,true,true,rule.require_address
from app.tenants tenant cross join (values
  ('order','pickup',false),('order','delivery',true),('order','on_site',false),
  ('appointment','on_site',false),('appointment','at_home',true),
  ('service','on_site',false),('service','at_home',true)
) rule(operation_type,fulfillment_type,require_address)
on conflict(tenant_id,operation_type,fulfillment_type) do nothing;
alter table app.customer_data_requirements force row level security;

reset role;
