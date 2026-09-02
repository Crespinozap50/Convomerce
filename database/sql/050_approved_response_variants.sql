set role commerce_owner;

create table app.approved_response_variants (
  id uuid primary key,
  tenant_id uuid references app.tenants(id) on delete cascade,
  scope text not null check (scope in ('global','tenant')),
  template_namespace text not null,
  template_key text not null,
  locale text not null,
  template_version integer not null default 1 check (template_version > 0),
  input_hash char(64) not null,
  deterministic_body text not null,
  variant_body text not null,
  protected_facts jsonb not null default '[]'::jsonb,
  status text not null default 'approved' check (status in ('candidate','approved','rejected')),
  source text not null check (source in ('openai','admin','system')),
  use_count bigint not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope='global' and tenant_id is null) or (scope='tenant' and tenant_id is not null)),
  check (jsonb_typeof(protected_facts)='array')
);

create unique index approved_response_variants_tenant_key_uidx
  on app.approved_response_variants(tenant_id,template_namespace,template_key,locale,template_version,input_hash)
  where scope='tenant';
create unique index approved_response_variants_global_key_uidx
  on app.approved_response_variants(template_namespace,template_key,locale,template_version,input_hash)
  where scope='global';
create index approved_response_variants_lookup_idx
  on app.approved_response_variants(template_namespace,template_key,locale,template_version,input_hash,status);

alter table app.approved_response_variants enable row level security;
alter table app.approved_response_variants force row level security;
create policy tenant_or_global_read on app.approved_response_variants
  for select using (tenant_id=app.current_tenant_id() or tenant_id is null);
create policy tenant_write on app.approved_response_variants
  for all using (tenant_id=app.current_tenant_id())
  with check (tenant_id=app.current_tenant_id() and scope='tenant');

revoke all on app.approved_response_variants from public;
grant select,insert,update on app.approved_response_variants to commerce_runtime;
grant select on app.approved_response_variants to commerce_readonly;

reset role;
