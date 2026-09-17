-- D-207 (docs/decisions.md D-206): agrega la capacidad opt-in
-- 'command_recovery' (mismo patrón que D-128/081_consultative_
-- recommendations.sql) y extiende el propósito de uso de IA permitido en
-- app.ai_usage_reservations para que la nueva CommandRecoveryService
-- pueda reservar/liquidar presupuesto bajo su propia etiqueta,
-- compartiendo el mismo pool de presupuesto por tenant que ya usan
-- response_rewriting/consultative_recommendation/business_faq.
set role commerce_owner;

alter table app.tenant_capabilities drop constraint if exists tenant_capabilities_capability_check;
alter table app.tenant_capabilities add constraint tenant_capabilities_capability_check
  check (capability in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site','consultative_recommendations','loggro_pos','command_recovery'));

-- Sin backfill: mismo default correcto apagada que toda capacidad opt-in
-- nueva en este proyecto — ausencia de fila ya significa "deshabilitada".

create or replace function app.save_tenant_capabilities(_actor uuid, _enabled text[])
returns boolean language plpgsql security definer set search_path = pg_catalog, app as $$
declare tid uuid := app.current_tenant_id(); invalid_capability text;
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message = 'Actor is not authorized to manage company capabilities';
  end if;
  select item into invalid_capability from unnest(_enabled) item
   where item not in ('commercial_offerings','inventory','orders','appointments','delivery','pickup','on_site','consultative_recommendations','loggro_pos','command_recovery') limit 1;
  if invalid_capability is not null then raise check_violation using message = 'Invalid company capability'; end if;
  insert into app.tenant_capabilities (tenant_id, capability, enabled)
  select tid, capability.name, capability.name = any(_enabled)
  from (values ('commercial_offerings'),('inventory'),('orders'),('appointments'),('delivery'),('pickup'),('on_site'),('consultative_recommendations'),('loggro_pos'),('command_recovery')) capability(name)
  on conflict (tenant_id, capability) do update set enabled = excluded.enabled, updated_at = now();
  return true;
end
$$;

alter table app.ai_usage_reservations drop constraint if exists ai_usage_reservations_purpose_check;
alter table app.ai_usage_reservations add constraint ai_usage_reservations_purpose_check
  check (purpose in ('response_rewriting','consultative_recommendation','business_faq','command_recovery'));

reset role;
