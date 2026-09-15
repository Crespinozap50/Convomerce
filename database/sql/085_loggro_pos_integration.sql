-- Integración Santos Tacos <-> Loggro Restobar: cuando un pedido de
-- WhatsApp se confirma, se empuja al POS real del restaurante en vez de
-- que el staff lo copie a mano (docs/decisions.md, entrada pendiente de
-- esta ronda). Capacidad opt-in apagada por defecto (mismo patrón que
-- D-128/081_consultative_recommendations.sql) — se activa explícitamente
-- solo para el tenant real de Santos Tacos, nunca por backfill.
set role commerce_owner;

alter table app.tenant_capabilities drop constraint if exists tenant_capabilities_capability_check;
alter table app.tenant_capabilities add constraint tenant_capabilities_capability_check
  check (capability in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site','consultative_recommendations','loggro_pos'));

create or replace function app.save_tenant_capabilities(_actor uuid, _enabled text[])
returns boolean language plpgsql security definer set search_path = pg_catalog, app as $$
declare tid uuid := app.current_tenant_id(); invalid_capability text;
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message = 'Actor is not authorized to manage company capabilities';
  end if;
  select item into invalid_capability from unnest(_enabled) item
   where item not in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site','consultative_recommendations','loggro_pos') limit 1;
  if invalid_capability is not null then raise check_violation using message = 'Invalid company capability'; end if;
  insert into app.tenant_capabilities (tenant_id, capability, enabled)
  select tid, capability.name, capability.name = any(_enabled)
  from (values ('commercial_offerings'),('inventory'),('orders'),('appointments'),('delivery'),('pickup'),('on_site'),('consultative_recommendations'),('loggro_pos')) capability(name)
  on conflict (tenant_id, capability) do update set enabled = excluded.enabled, updated_at = now();
  return true;
end
$$;

-- Una cuenta de Loggro por tenant (v1: Santos Tacos es el único piloto,
-- nunca necesita más de una). Mismo shape que app.calendar_sources
-- (024_business_capabilities_and_scheduling.sql) — el patrón ya
-- establecido en este proyecto para "una integración externa por tenant
-- con su propio secret_reference cifrado", más los campos runtime-only
-- que Loggro específicamente necesita: el token de sesión cacheado
-- (vida corta, se re-obtiene solo -> no amerita el mismo cuidado que el
-- email/password real, igual que google-calendar.service.ts cifra solo el
-- refresh_token de larga vida, nunca el access_token de corta vida) y la
-- mesa virtual de domicilio que el negocio ya configuró en su propia
-- cuenta de Loggro (nunca asumida automáticamente por el flag
-- isHomeDelivery — un admin la confirma a mano, ver docs/decisions.md).
create table app.pos_connections (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  provider text not null check (provider in ('loggro_restobar')),
  display_name text not null default 'Loggro Restobar',
  secret_reference text,
  cached_token text,
  cached_token_obtained_at timestamptz,
  home_delivery_table_id text,
  external_business_id text,
  status text not null default 'disconnected' check (status in ('disconnected','connected','error','paused')),
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider)
);
alter table app.pos_connections enable row level security;
alter table app.pos_connections force row level security;
create policy tenant_isolation on app.pos_connections
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

-- Nuestro item_variant no tiene ningún identificador en común con el
-- catálogo de Loggro (no hay API de "emparejar por nombre" confiable ni
-- barata por pedido) — se mapea una vez por variante, a mano, y se
-- reutiliza en cada pedido futuro.
create table app.pos_product_mappings (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  pos_connection_id uuid not null,
  item_variant_id uuid not null,
  external_product_id text not null,
  external_product_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, pos_connection_id, item_variant_id),
  foreign key (tenant_id, pos_connection_id) references app.pos_connections(tenant_id, id) on delete restrict,
  foreign key (tenant_id, item_variant_id) references app.item_variants(tenant_id, id) on delete restrict
);
alter table app.pos_product_mappings enable row level security;
alter table app.pos_product_mappings force row level security;
create policy tenant_isolation on app.pos_product_mappings
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

-- Cada integración registra su propio resultado en su propia fila — mismo
-- patrón que app.appointments.external_reference para Google Calendar; no
-- existe (ni se inventa aquí) una tabla genérica de resultados de trabajos
-- async. 'not_applicable' (default) es el estado de todo tenant sin la
-- capacidad activada, para que un pedido real nunca quede en un estado
-- ambiguo entre "no aplica" y "se perdió".
alter table app.commercial_requests
  add column pos_sync_status text not null default 'not_applicable'
    check (pos_sync_status in ('not_applicable','pending','synced','failed')),
  add column pos_external_order_id text,
  add column pos_last_error_code text,
  add column pos_synced_at timestamptz;

-- Mismo patrón de grants explícitos por tabla que el resto del proyecto
-- (003_runtime_grants.sql: "cada tabla nueva debe declarar grants
-- explícitos"). No hace falta una función SECURITY DEFINER dedicada aquí
-- (a diferencia de channel_connections, que atomiza una escritura de 2
-- tablas + evento de auditoría) — el mismo patrón de autorización en
-- código (canManage() vía app.can_manage_channel_connections, ya usado en
-- todo backend/src/knowledge/knowledge.service.ts) más un grant directo es
-- suficiente para una sola tabla de credencial.
grant select, insert, update on app.pos_connections, app.pos_product_mappings to commerce_runtime;
grant select on app.pos_connections, app.pos_product_mappings to commerce_readonly;

reset role;
