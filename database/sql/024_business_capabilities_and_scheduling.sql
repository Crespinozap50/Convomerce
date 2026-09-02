-- Cross-industry capabilities, canonical commercial offerings, and provider-neutral scheduling.

set role commerce_owner;

create table if not exists app.tenant_capabilities (
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  capability text not null check (capability in ('commercial_offerings','inventory','orders','appointments','delivery')),
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, capability)
);
alter table app.tenant_capabilities no force row level security;
alter table app.tenant_capabilities disable row level security;
insert into app.tenant_capabilities (tenant_id, capability, enabled)
select tenant.id, capability.name, capability.name = 'commercial_offerings'
from app.tenants tenant
cross join (values ('commercial_offerings'),('inventory'),('orders'),('appointments'),('delivery')) capability(name)
on conflict (tenant_id, capability) do nothing;

alter table app.tenant_capabilities enable row level security;
alter table app.tenant_capabilities force row level security;
drop policy if exists tenant_isolation on app.tenant_capabilities;
create policy tenant_isolation on app.tenant_capabilities
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

alter table app.catalog_items
  add column if not exists offering_type text not null default 'product'
    check (offering_type in ('product','service','prepared_product','appointment','package')),
  add column if not exists duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  add column if not exists booking_required boolean not null default false;

create table if not exists app.calendar_sources (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  provider text not null check (provider in ('internal','google_calendar','microsoft_outlook','calendly','custom_api')),
  display_name text not null,
  secret_reference text,
  status text not null default 'disconnected' check (status in ('disconnected','connected','error','paused')),
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, display_name)
);
alter table app.calendar_sources enable row level security;
alter table app.calendar_sources force row level security;
drop policy if exists tenant_isolation on app.calendar_sources;
create policy tenant_isolation on app.calendar_sources
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

create table if not exists app.booking_resources (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  resource_type text not null check (resource_type in ('person','space','equipment','other')),
  name text not null,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table app.booking_resources enable row level security;
alter table app.booking_resources force row level security;
drop policy if exists tenant_isolation on app.booking_resources;
create policy tenant_isolation on app.booking_resources
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

create table if not exists app.resource_calendar_links (
  id uuid primary key,
  tenant_id uuid not null,
  resource_id uuid not null,
  calendar_source_id uuid not null,
  external_calendar_id text not null,
  status text not null default 'active' check (status in ('active','paused','disabled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, calendar_source_id, external_calendar_id),
  foreign key (tenant_id, resource_id) references app.booking_resources(tenant_id,id) on delete restrict,
  foreign key (tenant_id, calendar_source_id) references app.calendar_sources(tenant_id,id) on delete restrict
);
alter table app.resource_calendar_links enable row level security;
alter table app.resource_calendar_links force row level security;
drop policy if exists tenant_isolation on app.resource_calendar_links;
create policy tenant_isolation on app.resource_calendar_links
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

create table if not exists app.appointments (
  id uuid primary key,
  tenant_id uuid not null,
  catalog_item_id uuid not null,
  contact_id uuid not null,
  resource_id uuid,
  calendar_source_id uuid,
  external_reference text,
  idempotency_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  status text not null check (status in ('held','confirmed','cancelled','completed','no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, catalog_item_id) references app.catalog_items(tenant_id,id) on delete restrict,
  foreign key (tenant_id, contact_id) references app.contacts(tenant_id,id) on delete restrict,
  foreign key (tenant_id, resource_id) references app.booking_resources(tenant_id,id) on delete restrict,
  foreign key (tenant_id, calendar_source_id) references app.calendar_sources(tenant_id,id) on delete restrict,
  check (ends_at > starts_at)
);
create unique index if not exists appointments_external_reference_uidx
  on app.appointments (tenant_id, calendar_source_id, external_reference)
  where external_reference is not null;
alter table app.appointments enable row level security;
alter table app.appointments force row level security;
drop policy if exists tenant_isolation on app.appointments;
create policy tenant_isolation on app.appointments
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

create or replace function app.save_tenant_capabilities(_actor uuid, _enabled text[])
returns boolean language plpgsql security definer set search_path = pg_catalog, app as $$
declare tid uuid := app.current_tenant_id(); invalid_capability text;
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message = 'Actor is not authorized to manage company capabilities';
  end if;
  select item into invalid_capability from unnest(_enabled) item
   where item not in ('commercial_offerings','inventory','orders','appointments','delivery') limit 1;
  if invalid_capability is not null then raise check_violation using message = 'Invalid company capability'; end if;
  insert into app.tenant_capabilities (tenant_id, capability, enabled)
  select tid, capability.name, capability.name = any(_enabled)
  from (values ('commercial_offerings'),('inventory'),('orders'),('appointments'),('delivery')) capability(name)
  on conflict (tenant_id, capability) do update set enabled = excluded.enabled, updated_at = now();
  return true;
end
$$;

revoke all on app.tenant_capabilities, app.calendar_sources, app.booking_resources, app.resource_calendar_links, app.appointments from public;
grant select on app.tenant_capabilities, app.calendar_sources, app.booking_resources, app.resource_calendar_links, app.appointments to commerce_runtime, commerce_readonly;
revoke all on function app.save_tenant_capabilities(uuid,text[]) from public;
grant execute on function app.save_tenant_capabilities(uuid,text[]) to commerce_runtime;

reset role;
