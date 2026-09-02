set role commerce_owner;

create table app.ai_response_policies (
  tenant_id uuid primary key references app.tenants(id) on delete restrict,
  enabled boolean not null default false,
  rollout_percentage integer not null default 0 check (rollout_percentage between 0 and 100),
  daily_request_limit integer not null default 100 check (daily_request_limit between 0 and 100000),
  monthly_cost_limit_minor bigint not null default 500 check (monthly_cost_limit_minor between 0 and 100000000),
  reservation_cost_minor bigint not null default 1 check (reservation_cost_minor between 1 and 1000000),
  cost_currency char(3) not null default 'USD' check (cost_currency = upper(cost_currency)),
  updated_by_user_id uuid references app.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.ai_budget_periods (
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  period_type text not null check (period_type in ('day','month')),
  period_start date not null,
  reserved_requests integer not null default 0 check (reserved_requests >= 0),
  completed_requests integer not null default 0 check (completed_requests >= 0),
  reserved_cost_minor bigint not null default 0 check (reserved_cost_minor >= 0),
  actual_cost_minor bigint not null default 0 check (actual_cost_minor >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,period_type,period_start)
);

create table app.ai_usage_reservations (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  conversation_id uuid not null,
  message_id uuid not null,
  purpose text not null check (purpose in ('response_rewriting')),
  status text not null default 'reserved' check (status in ('reserved','completed','failed')),
  reserved_cost_minor bigint not null check (reserved_cost_minor > 0),
  actual_cost_minor bigint check (actual_cost_minor is null or actual_cost_minor >= 0),
  failure_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '5 minutes'),
  settled_at timestamptz,
  unique (tenant_id,id),
  foreign key (tenant_id,conversation_id) references app.conversations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,message_id) references app.messages(tenant_id,id) on delete restrict,
  check ((status='reserved' and settled_at is null) or (status<>'reserved' and settled_at is not null))
);

create index ai_usage_reservations_status_idx on app.ai_usage_reservations(tenant_id,status,expires_at);

alter table app.ai_response_policies enable row level security;
alter table app.ai_response_policies force row level security;
create policy tenant_isolation on app.ai_response_policies using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
alter table app.ai_budget_periods enable row level security;
alter table app.ai_budget_periods force row level security;
create policy tenant_isolation on app.ai_budget_periods using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
alter table app.ai_usage_reservations enable row level security;
alter table app.ai_usage_reservations force row level security;
create policy tenant_isolation on app.ai_usage_reservations using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());

create function app.save_ai_response_policy(
  _actor_user_id uuid,
  _enabled boolean,
  _rollout_percentage integer,
  _daily_request_limit integer,
  _monthly_cost_limit_minor bigint
) returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$
declare _tenant_id uuid := app.current_tenant_id();
begin
  if _tenant_id is null or not app.can_manage_channel_connections(_actor_user_id) then
    raise insufficient_privilege using message='Actor is not authorized to configure AI response policy';
  end if;
  insert into app.ai_response_policies(tenant_id,enabled,rollout_percentage,daily_request_limit,monthly_cost_limit_minor,updated_by_user_id)
  values(_tenant_id,_enabled,_rollout_percentage,_daily_request_limit,_monthly_cost_limit_minor,_actor_user_id)
  on conflict(tenant_id) do update set enabled=excluded.enabled,rollout_percentage=excluded.rollout_percentage,
    daily_request_limit=excluded.daily_request_limit,monthly_cost_limit_minor=excluded.monthly_cost_limit_minor,
    updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
  return true;
end $$;

revoke all on app.ai_response_policies,app.ai_budget_periods,app.ai_usage_reservations from public;
grant select on app.ai_response_policies to commerce_runtime;
grant select,insert,update on app.ai_budget_periods,app.ai_usage_reservations to commerce_runtime;
grant select on app.ai_response_policies,app.ai_budget_periods,app.ai_usage_reservations to commerce_readonly;
revoke all on function app.save_ai_response_policy(uuid,boolean,integer,integer,bigint) from public;
grant execute on function app.save_ai_response_policy(uuid,boolean,integer,integer,bigint) to commerce_runtime;

reset role;
