-- Closes the one real gap left in "localización completa del contenido"
-- (docs/roadmap.md Fase 1) after D-086: `app.catalog_items.category` is a
-- free-text column, not a foreign-keyed entity, so it can't reuse D-086's
-- id-keyed sibling-table pattern (071). Mirrors instead the value-keyed
-- pattern already used by app.operational_requirement_option_localizations
-- (056) — one row per (tenant_id, category value, locale), no FK to a
-- category table because none exists. COALESCE'd against the raw
-- app.catalog_items.category value at read time, same fallback rule as
-- every other localization table.
set role commerce_owner;

create table app.catalog_category_localizations (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  category text not null,
  locale text not null,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, category, locale),
  check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$')
);

alter table app.catalog_category_localizations enable row level security;
alter table app.catalog_category_localizations force row level security;
create policy tenant_isolation on app.catalog_category_localizations
  using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
revoke all on app.catalog_category_localizations from public;
grant select,insert,update,delete on app.catalog_category_localizations to commerce_runtime;
grant select on app.catalog_category_localizations to commerce_readonly;

reset role;
