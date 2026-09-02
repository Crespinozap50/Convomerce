set role commerce_owner;
create table app.business_profiles(
 tenant_id uuid primary key references app.tenants(id) on delete restrict,
 description text not null default '',address text not null default '',phone text not null default '',
 business_hours text not null default '',payment_methods text not null default '',fulfillment_options text not null default '',
 updated_by_user_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(tenant_id,updated_by_user_id) references app.tenant_users(tenant_id,user_id) on delete restrict
);
alter table app.business_profiles enable row level security;alter table app.business_profiles force row level security;
create policy tenant_isolation on app.business_profiles using(tenant_id=app.current_tenant_id()) with check(tenant_id=app.current_tenant_id());
create table app.catalog_sources(
 id uuid primary key,tenant_id uuid not null,provider text not null check(provider in('manual','shopify','magento','custom_api')),
 display_name text not null,base_url text,secret_reference text,status text not null default 'disconnected' check(status in('disconnected','connected','error','paused')),
 last_synced_at timestamptz,last_error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,provider,display_name),foreign key(tenant_id) references app.tenants(id) on delete restrict
);
alter table app.catalog_sources enable row level security;alter table app.catalog_sources force row level security;
create policy tenant_isolation on app.catalog_sources using(tenant_id=app.current_tenant_id()) with check(tenant_id=app.current_tenant_id());
alter table app.catalog_items add column source_provider text not null default 'manual' check(source_provider in('manual','shopify','magento','custom_api'));

create function app.save_business_profile(_actor uuid,_description text,_address text,_phone text,_hours text,_payments text,_fulfillment text)
returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$ declare tid uuid:=app.current_tenant_id();begin
 if tid is null or not app.can_manage_channel_connections(_actor) then raise insufficient_privilege using message='Actor is not authorized to manage business knowledge';end if;
 insert into app.business_profiles(tenant_id,description,address,phone,business_hours,payment_methods,fulfillment_options,updated_by_user_id)
 values(tid,_description,_address,_phone,_hours,_payments,_fulfillment,_actor) on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,phone=excluded.phone,business_hours=excluded.business_hours,payment_methods=excluded.payment_methods,fulfillment_options=excluded.fulfillment_options,updated_by_user_id=excluded.updated_by_user_id,updated_at=now();return true;end $$;
revoke all on app.business_profiles,app.catalog_sources from public;grant select on app.business_profiles,app.catalog_sources to commerce_runtime,commerce_readonly;
revoke all on function app.save_business_profile(uuid,text,text,text,text,text,text) from public;grant execute on function app.save_business_profile(uuid,text,text,text,text,text,text) to commerce_runtime;
reset role;
