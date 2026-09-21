-- Sugerencias al pedir (upsell, p. ej. "¿Te agrego Agua fresca?"): hasta ahora
-- solo se podían cambiar con SQL (app.product_recommendations, sin pantalla ni
-- endpoint). Esta migración agrega el interruptor general por empresa
-- (por defecto ENCENDIDO: conserva el comportamiento actual) y dos funciones
-- con verificación de permisos para que el panel pueda apagar todo o una
-- sugerencia puntual (el producto que se ofrece), sin tocar tablas directo.
set role commerce_owner;

alter table app.bot_configurations add column if not exists upsell_enabled boolean not null default true;

create or replace function app.set_upsell_enabled(_actor uuid, _enabled boolean)
returns boolean language plpgsql security definer set search_path = pg_catalog, app as $$
declare tid uuid := app.current_tenant_id();
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message = 'Actor is not authorized to manage suggestions';
  end if;
  insert into app.bot_configurations(tenant_id, upsell_enabled, updated_by_user_id)
  values (tid, _enabled, _actor)
  on conflict (tenant_id) do update set upsell_enabled = excluded.upsell_enabled, updated_by_user_id = _actor, updated_at = now();
  return true;
end
$$;

-- Activa/desactiva una sugerencia completa: todas las filas cuyo producto
-- ofrecido (target) es la variante dada.
create or replace function app.set_upsell_target(_actor uuid, _target_variant uuid, _enabled boolean)
returns integer language plpgsql security definer set search_path = pg_catalog, app as $$
declare tid uuid := app.current_tenant_id(); changed integer;
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message = 'Actor is not authorized to manage suggestions';
  end if;
  update app.product_recommendations
     set status = case when _enabled then 'active' else 'inactive' end, updated_at = now()
   where tenant_id = tid and target_variant_id = _target_variant;
  get diagnostics changed = row_count;
  return changed;
end
$$;

grant execute on function app.set_upsell_enabled(uuid, boolean) to commerce_runtime;
grant execute on function app.set_upsell_target(uuid, uuid, boolean) to commerce_runtime;

reset role;
