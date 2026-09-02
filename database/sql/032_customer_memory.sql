-- Tenant-owned progressive customer memory. Structured records are preferred
-- over a single free-form notes field so each fact can be confirmed and retired.
set role commerce_owner;

create table app.contact_addresses (
  id uuid primary key,
  tenant_id uuid not null,
  contact_id uuid not null,
  label text not null,
  address_line text not null,
  locality text,
  region text,
  postal_code text,
  country_code char(2),
  delivery_instructions text,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive','removed')),
  consented_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,contact_id) references app.contacts(tenant_id,id) on delete restrict
);
create unique index contact_addresses_one_default_uidx
  on app.contact_addresses(tenant_id,contact_id) where is_default and status='active';

create table app.contact_assets (
  id uuid primary key,
  tenant_id uuid not null,
  contact_id uuid not null,
  asset_type text not null,
  display_name text not null,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes)='object'),
  status text not null default 'active' check (status in ('active','inactive','removed')),
  consented_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,contact_id) references app.contacts(tenant_id,id) on delete restrict
);
create index contact_assets_contact_idx on app.contact_assets(tenant_id,contact_id,status,last_used_at desc);

create table app.contact_preferences (
  id uuid primary key,
  tenant_id uuid not null,
  contact_id uuid not null,
  preference_key text not null,
  value jsonb not null check (jsonb_typeof(value) in ('string','number','boolean','object','array')),
  source text not null check (source in ('customer_confirmed','transaction','operator')),
  confidence numeric(4,3) not null default 1 check (confidence between 0 and 1),
  confirmed_at timestamptz,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','superseded','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,contact_id) references app.contacts(tenant_id,id) on delete restrict,
  check (expires_at is null or expires_at>created_at)
);
create unique index contact_preferences_active_key_uidx
  on app.contact_preferences(tenant_id,contact_id,preference_key) where status='active';

create table app.customer_data_requirements (
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  operation_type text not null,
  fulfillment_type text not null,
  require_name boolean not null default true,
  require_phone boolean not null default true,
  require_address boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,operation_type,fulfillment_type)
);

do $$ declare table_name text; begin
  foreach table_name in array array['contact_addresses','contact_assets','contact_preferences','customer_data_requirements'] loop
    execute format('alter table app.%I enable row level security',table_name);
    execute format('alter table app.%I force row level security',table_name);
    execute format('create policy tenant_isolation on app.%I using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id())',table_name);
    execute format('revoke all on app.%I from public',table_name);
    execute format('grant select,insert,update on app.%I to commerce_runtime',table_name);
    execute format('grant select on app.%I to commerce_readonly',table_name);
  end loop;
end $$;

reset role;
