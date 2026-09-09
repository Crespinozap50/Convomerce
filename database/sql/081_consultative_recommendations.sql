-- D-128 (docs/decisions.md): agrega la capacidad opt-in 'consultative_
-- recommendations' (mismo patrón que D-119's pickup/on_site) y extiende
-- el propósito de uso de IA permitido en app.ai_usage_reservations para
-- que la nueva ConsultativeRecommendationService pueda reservar/liquidar
-- presupuesto bajo su propia etiqueta, compartiendo el mismo pool de
-- presupuesto por tenant que ya usa la reescritura de tono (D-092/D-047)
-- — dos propósitos, un solo gate de "¿este tenant tiene IA habilitada?".
set role commerce_owner;

alter table app.tenant_capabilities drop constraint if exists tenant_capabilities_capability_check;
alter table app.tenant_capabilities add constraint tenant_capabilities_capability_check
  check (capability in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site','consultative_recommendations'));

-- Sin backfill: a diferencia de pickup/on_site (D-119, donde el
-- comportamiento previo era "siempre mostrado" y había que preservarlo),
-- esta es una capacidad nueva cuyo default correcto es apagada — ningún
-- tenant la necesitaba antes de hoy, así que la ausencia de fila ya
-- significa "deshabilitada" sin necesidad de una fila explícita.

create or replace function app.save_tenant_capabilities(_actor uuid, _enabled text[])
returns boolean language plpgsql security definer set search_path = pg_catalog, app as $$
declare tid uuid := app.current_tenant_id(); invalid_capability text;
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message = 'Actor is not authorized to manage company capabilities';
  end if;
  select item into invalid_capability from unnest(_enabled) item
   where item not in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site','consultative_recommendations') limit 1;
  if invalid_capability is not null then raise check_violation using message = 'Invalid company capability'; end if;
  insert into app.tenant_capabilities (tenant_id, capability, enabled)
  select tid, capability.name, capability.name = any(_enabled)
  from (values ('commercial_offerings'),('inventory'),('orders'),('appointments'),('delivery'),('pickup'),('on_site'),('consultative_recommendations')) capability(name)
  on conflict (tenant_id, capability) do update set enabled = excluded.enabled, updated_at = now();
  return true;
end
$$;

alter table app.ai_usage_reservations drop constraint if exists ai_usage_reservations_purpose_check;
alter table app.ai_usage_reservations add constraint ai_usage_reservations_purpose_check
  check (purpose in ('response_rewriting','consultative_recommendation'));

reset role;
