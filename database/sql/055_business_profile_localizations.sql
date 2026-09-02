set role commerce_owner;

create table app.business_profile_localizations (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  locale text not null,
  address text,
  business_hours text,
  payment_methods text,
  fulfillment_options text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, locale),
  check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$')
);

alter table app.business_profile_localizations enable row level security;
alter table app.business_profile_localizations force row level security;
create policy tenant_isolation on app.business_profile_localizations
  using (tenant_id=app.current_tenant_id())
  with check (tenant_id=app.current_tenant_id());

revoke all on app.business_profile_localizations from public;
grant select,insert,update,delete on app.business_profile_localizations to commerce_runtime;
grant select on app.business_profile_localizations to commerce_readonly;

reset role;
