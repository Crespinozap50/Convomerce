-- Fase 2: "localizaciones administrables para catálogo, variantes y entradas
-- de conocimiento usando fallback verificable" (docs/roadmap.md). Mirrors
-- app.business_profile_localizations (055) exactly — a sibling table per
-- entity, keyed by (tenant_id, entity_id, locale), nullable override
-- columns, COALESCE'd against the base row at read time so a locale with no
-- translation yet falls back to the tenant's default-language content
-- instead of showing nothing.
set role commerce_owner;

create table app.catalog_item_localizations (
  tenant_id uuid not null,
  catalog_item_id uuid not null,
  locale text not null,
  name text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, catalog_item_id, locale),
  check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  foreign key (tenant_id, catalog_item_id) references app.catalog_items(tenant_id, id) on delete cascade
);

create table app.item_variant_localizations (
  tenant_id uuid not null,
  item_variant_id uuid not null,
  locale text not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, item_variant_id, locale),
  check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  foreign key (tenant_id, item_variant_id) references app.item_variants(tenant_id, id) on delete cascade
);

create table app.knowledge_entry_localizations (
  tenant_id uuid not null,
  knowledge_entry_id uuid not null,
  locale text not null,
  title text,
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, knowledge_entry_id, locale),
  check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  foreign key (tenant_id, knowledge_entry_id) references app.knowledge_entries(tenant_id, id) on delete cascade
);

do $$ declare table_name text; begin
  foreach table_name in array array[
    'catalog_item_localizations','item_variant_localizations','knowledge_entry_localizations'
  ] loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('alter table app.%I force row level security', table_name);
    execute format(
      'create policy tenant_isolation on app.%I using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id())',
      table_name
    );
    execute format('revoke all on app.%I from public', table_name);
    execute format('grant select,insert,update,delete on app.%I to commerce_runtime', table_name);
    execute format('grant select on app.%I to commerce_readonly', table_name);
  end loop;
end $$;

reset role;
