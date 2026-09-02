\set ON_ERROR_STOP on

-- database/sql/056_operational_requirements.sql backfills app.operational_requirements
-- from app.customer_data_requirements *at migration time* — but every tenant's
-- customer_data_requirements rows are only ever inserted by seeds (001, 003),
-- which run after every migration (migrate.sh then seed.sh). On a freshly
-- migrated + seeded database, 056's backfill always finds an empty source
-- table and seeds nothing. Re-running the same backfill here, idempotently,
-- after every tenant-creating seed has run, closes that gap — for every
-- tenant, not just the ones seeded so far, so this stays correct as new
-- tenants are added.
begin;
set local role commerce_owner;

alter table app.customer_data_requirements no force row level security;
alter table app.operational_requirements no force row level security;

insert into app.operational_requirements
  (id,tenant_id,operation_type,fulfillment_type,field_key,data_type,
   is_required,display_order,sensitivity,requires_confirmation,reuse_from_contact_memory,is_active)
select gen_random_uuid(),source.tenant_id,source.operation_type,'*','name','text',
  true,0,'pii',false,false,(source.operation_type='order')
from (
  select distinct tenant_id,operation_type from app.customer_data_requirements
) source
on conflict (tenant_id,operation_type,fulfillment_type,field_key) where catalog_item_id is null
do nothing;

insert into app.operational_requirements
  (id,tenant_id,operation_type,fulfillment_type,field_key,data_type,
   is_required,display_order,sensitivity,requires_confirmation,reuse_from_contact_memory,is_active)
select gen_random_uuid(),source.tenant_id,source.operation_type,source.fulfillment_type,
  'delivery_address','address',source.require_address,10,'pii',false,true,
  (source.operation_type='order')
from app.customer_data_requirements source
on conflict (tenant_id,operation_type,fulfillment_type,field_key) where catalog_item_id is null
do nothing;

alter table app.customer_data_requirements force row level security;
alter table app.operational_requirements force row level security;

commit;

\echo 'Backfill de requisitos operativos verificado para todos los tenants sembrados.'
