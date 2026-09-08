-- D-119 (hallazgo #3 de la segunda auditoría crítica de flujo,
-- docs/decisions.md): fulfillmentReply() en commercial-flow.service.ts
-- gateaba 'delivery' contra app.tenant_capabilities pero mostraba
-- 'pickup'/'on_site' incondicionalmente, sin ninguna consulta de
-- configuración real del tenant. Este migration extiende la misma tabla
-- y función ya usadas por 'delivery' (024_business_capabilities_and_
-- scheduling.sql) para que las tres modalidades se gateen igual.
--
-- Backfill con enabled=true para todo tenant ya existente al momento de
-- aplicar este migration: preserva el comportamiento actual (las tres
-- opciones siempre visibles) para cualquier instalación real, y solo un
-- toggle explícito posterior en el panel de admin las oculta.
set role commerce_owner;

alter table app.tenant_capabilities drop constraint if exists tenant_capabilities_capability_check;
alter table app.tenant_capabilities add constraint tenant_capabilities_capability_check
  check (capability in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site'));

-- Same RLS dance as the original 024 migration's own bulk backfill: this
-- inserts across every tenant in one statement, which the per-tenant
-- tenant_isolation policy would otherwise reject outright.
alter table app.tenant_capabilities no force row level security;
alter table app.tenant_capabilities disable row level security;
insert into app.tenant_capabilities (tenant_id, capability, enabled)
select tenant.id, capability.name, true
from app.tenants tenant
cross join (values ('pickup'),('on_site')) capability(name)
on conflict (tenant_id, capability) do nothing;
alter table app.tenant_capabilities enable row level security;
alter table app.tenant_capabilities force row level security;

create or replace function app.save_tenant_capabilities(_actor uuid, _enabled text[])
returns boolean language plpgsql security definer set search_path = pg_catalog, app as $$
declare tid uuid := app.current_tenant_id(); invalid_capability text;
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message = 'Actor is not authorized to manage company capabilities';
  end if;
  select item into invalid_capability from unnest(_enabled) item
   where item not in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site') limit 1;
  if invalid_capability is not null then raise check_violation using message = 'Invalid company capability'; end if;
  insert into app.tenant_capabilities (tenant_id, capability, enabled)
  select tid, capability.name, capability.name = any(_enabled)
  from (values ('commercial_offerings'),('inventory'),('orders'),('appointments'),('delivery'),('pickup'),('on_site')) capability(name)
  on conflict (tenant_id, capability) do update set enabled = excluded.enabled, updated_at = now();
  return true;
end
$$;

reset role;
