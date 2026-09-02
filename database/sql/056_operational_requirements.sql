-- Configurable, typed operational requirements per tenant/operation/offering.
-- Implements D-039 (docs/decisions.md). Replaces the fixed name/phone/address
-- code paths with data the commerce and appointment flows consult at runtime;
-- adding a field for a new industry becomes configuration, not a code change.
--
-- app.customer_data_requirements (032) is not modified or dropped: it stays as
-- historical data and keeps being seeded by database/seeds/003. This migration
-- backfills its 'order' rows into the generic model below and leaves
-- 'appointment'/'service' rows inactive, since appointment-flow.service.ts does
-- not consult any requirement today and must not gain new prompts silently.
--
-- Exception: primary keys below use gen_random_uuid() instead of the
-- application-generated UUIDv7 used elsewhere. That rule targets domain writes
-- on the hot path (temporal locality); this is a one-time historical backfill
-- of a handful of default rows during a schema migration, not a runtime write
-- path, so a documented exception is used here rather than an extra Node
-- script step that a plain `make db-migrate` could miss.
set role commerce_owner;

create table app.operational_requirements (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  operation_type text not null check (operation_type in ('order','appointment','service','quote')),
  fulfillment_type text not null,
  catalog_item_id uuid,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]*$'),
  data_type text not null check (data_type in ('text','number','select','boolean','address','phone')),
  is_required boolean not null default true,
  display_order integer not null default 0,
  validation_rule jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_rule)='object'),
  sensitivity text not null default 'none' check (sensitivity in ('none','pii','sensitive')),
  retention_days integer check (retention_days is null or retention_days>0),
  requires_confirmation boolean not null default false,
  reuse_from_contact_memory boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,catalog_item_id) references app.catalog_items(tenant_id,id) on delete restrict
);

-- catalog_item_id is null when a requirement applies to every offering under
-- the operation/fulfillment pair. A plain unique() would not catch duplicate
-- null-scoped rows, since Postgres never treats two NULLs as equal.
create unique index operational_requirements_scoped_uidx
  on app.operational_requirements(tenant_id,operation_type,fulfillment_type,catalog_item_id,field_key)
  where catalog_item_id is not null;
create unique index operational_requirements_global_uidx
  on app.operational_requirements(tenant_id,operation_type,fulfillment_type,field_key)
  where catalog_item_id is null;
create index operational_requirements_lookup_idx
  on app.operational_requirements(tenant_id,operation_type,fulfillment_type,is_active,display_order);

create table app.operational_requirement_localizations (
  requirement_id uuid not null,
  tenant_id uuid not null,
  locale text not null check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  label text not null,
  help_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requirement_id,locale),
  foreign key (tenant_id,requirement_id) references app.operational_requirements(tenant_id,id) on delete cascade
);

create table app.operational_requirement_options (
  requirement_id uuid not null,
  tenant_id uuid not null,
  option_value text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (requirement_id,option_value),
  unique (tenant_id,requirement_id,option_value),
  foreign key (tenant_id,requirement_id) references app.operational_requirements(tenant_id,id) on delete cascade
);

create table app.operational_requirement_option_localizations (
  requirement_id uuid not null,
  option_value text not null,
  tenant_id uuid not null,
  locale text not null check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  label text not null,
  primary key (requirement_id,option_value,locale),
  foreign key (tenant_id,requirement_id,option_value)
    references app.operational_requirement_options(tenant_id,requirement_id,option_value) on delete cascade
);

do $$ declare table_name text; begin
  foreach table_name in array array[
    'operational_requirements','operational_requirement_localizations',
    'operational_requirement_options','operational_requirement_option_localizations'
  ] loop
    execute format('alter table app.%I enable row level security',table_name);
    execute format('alter table app.%I force row level security',table_name);
    execute format('create policy tenant_isolation on app.%I using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id())',table_name);
    execute format('revoke all on app.%I from public',table_name);
    execute format('grant select,insert,update on app.%I to commerce_runtime',table_name);
    execute format('grant select on app.%I to commerce_readonly',table_name);
  end loop;
end $$;

-- Backfill from customer_data_requirements (032). require_phone is never read
-- anywhere in the codebase (phone identity comes from the WhatsApp channel)
-- and is intentionally not migrated.
alter table app.customer_data_requirements no force row level security;
alter table app.operational_requirements no force row level security;

-- 'name' gets a single wildcard fulfillment_type='*' row per tenant/operation
-- instead of one row per fulfillment_type: commerce/appointment flows ask for
-- it before the modality is known, so it must be resolvable when the runtime
-- lookup is called with fulfillmentType=null. It is seeded as always required
-- regardless of the source require_name value, because the pre-refactor
-- awaiting_name step ignores that column today and always asks for a name;
-- copying its real value would change behavior instead of preserving it.
insert into app.operational_requirements
  (id,tenant_id,operation_type,fulfillment_type,field_key,data_type,
   is_required,display_order,sensitivity,requires_confirmation,reuse_from_contact_memory,is_active)
select gen_random_uuid(),source.tenant_id,source.operation_type,'*','name','text',
  true,0,'pii',false,false,(source.operation_type='order')
from (
  select distinct tenant_id,operation_type from app.customer_data_requirements
) source;

-- delivery_address stays scoped per fulfillment_type: whether it is required
-- genuinely varies by modality (delivery vs. pickup vs. on_site), which is
-- already known by the time this requirement is evaluated.
insert into app.operational_requirements
  (id,tenant_id,operation_type,fulfillment_type,field_key,data_type,
   is_required,display_order,sensitivity,requires_confirmation,reuse_from_contact_memory,is_active)
select gen_random_uuid(),source.tenant_id,source.operation_type,source.fulfillment_type,
  'delivery_address','address',source.require_address,10,'pii',false,true,
  (source.operation_type='order')
from app.customer_data_requirements source;

alter table app.operational_requirements force row level security;
alter table app.customer_data_requirements force row level security;

reset role;
