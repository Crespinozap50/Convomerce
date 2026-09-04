-- Fase 2: última pieza del roadmap — "comparar calidad, conversión asistida,
-- latencia y costo por tenant". Ninguna de las 4 requiere instrumentación
-- nueva: ya se recolectan como parte de otro trabajo (D-060 unresolved
-- questions, D-041 ai_usage, commercial_requests.confirmed_at) y nunca se
-- habían agregado ni expuesto juntas. Mismo patrón que
-- app.list_platform_tenants() (017): security definer, gateada por
-- app.platform_admins, nunca alcanzable por un dueño de tenant individual —
-- es, por diseño, información que solo el propietario de la plataforma debe
-- poder comparar entre tenants (igual razón por la que /internal/metrics no
-- usa tenant_id como label, ver backend/observability/README.md).
--
-- messages/conversations/commercial_requests/ai_usage tienen FORCE ROW LEVEL
-- SECURITY (D-013), así que en vez de bajar force RLS (invasivo para un
-- reporte de solo lectura), la función itera los tenants y hace
-- set_config('app.tenant_id', ...) antes de agregar cada uno — mismo
-- mecanismo ya usado en database/seeds/007_operational_requirements_backfill.sql
-- para lecturas cross-tenant.
set role commerce_owner;

create or replace function app.tenant_operational_summary(
  _actor_user_id uuid, _period_start date, _period_end date
)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  messages_total bigint,
  messages_resolved bigint,
  conversations_total bigint,
  conversations_handed_off bigint,
  commercial_requests_total bigint,
  commercial_requests_confirmed bigint,
  avg_response_latency_ms numeric,
  ai_calls_total bigint,
  ai_cost_minor bigint,
  ai_currency text,
  ai_avg_latency_ms numeric
)
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare
  tenant record;
  period_end_exclusive timestamptz := (_period_end + 1)::timestamptz;
  period_start_ts timestamptz := _period_start::timestamptz;
begin
  if not exists (
    select 1 from app.platform_admins admin
     where admin.user_id = _actor_user_id
       and admin.role = 'owner'
       and admin.status = 'active'
  ) then
    raise insufficient_privilege using message = 'Actor no autorizado para ver métricas de la plataforma';
  end if;

  for tenant in select t.id, t.slug, t.display_name from app.tenants t order by lower(t.display_name) loop
    perform set_config('app.tenant_id', tenant.id::text, true);

    return query
    select
      tenant.id,
      tenant.slug,
      tenant.display_name,
      coalesce(msg.messages_total, 0),
      coalesce(msg.messages_resolved, 0),
      coalesce(conv.conversations_total, 0),
      coalesce(conv.conversations_handed_off, 0),
      coalesce(req.commercial_requests_total, 0),
      coalesce(req.commercial_requests_confirmed, 0),
      lat.avg_response_latency_ms,
      coalesce(ai.ai_calls_total, 0),
      coalesce(ai.ai_cost_minor, 0)::bigint,
      ai.ai_currency,
      ai.ai_avg_latency_ms
    from (
      select
        count(*) filter (where m.direction = 'inbound') as messages_total,
        count(*) filter (
          where m.direction = 'outbound' and m.sender_type = 'ai'
            and not (
              m.content ->> 'intent' = 'fallback'
              and coalesce(jsonb_array_length(m.content -> 'sources'), 0) = 0
            )
        ) as messages_resolved
      from app.messages m
      where m.tenant_id = tenant.id and m.occurred_at >= period_start_ts and m.occurred_at < period_end_exclusive
    ) msg,
    (
      select
        count(*) as conversations_total,
        count(*) filter (where c.handling_mode = 'human') as conversations_handed_off
      from app.conversations c
      where c.tenant_id = tenant.id and c.opened_at >= period_start_ts and c.opened_at < period_end_exclusive
    ) conv,
    (
      select
        count(*) as commercial_requests_total,
        count(*) filter (where r.confirmed_at is not null) as commercial_requests_confirmed
      from app.commercial_requests r
      where r.tenant_id = tenant.id and r.created_at >= period_start_ts and r.created_at < period_end_exclusive
    ) req,
    (
      select avg(extract(epoch from (reply.occurred_at - inbound.occurred_at)) * 1000) as avg_response_latency_ms
      from app.messages inbound
      join lateral (
        select occurred_at from app.messages reply_candidate
         where reply_candidate.tenant_id = tenant.id
           and reply_candidate.conversation_id = inbound.conversation_id
           and reply_candidate.direction = 'outbound'
           and reply_candidate.occurred_at > inbound.occurred_at
         order by reply_candidate.occurred_at asc limit 1
      ) reply on true
      where inbound.tenant_id = tenant.id and inbound.direction = 'inbound'
        and inbound.occurred_at >= period_start_ts and inbound.occurred_at < period_end_exclusive
    ) lat,
    (
      select
        count(*) as ai_calls_total,
        sum(u.estimated_cost_minor) as ai_cost_minor,
        max(u.cost_currency)::text as ai_currency,
        avg(u.latency_ms) as ai_avg_latency_ms
      from app.ai_usage u
      where u.tenant_id = tenant.id and u.occurred_at >= period_start_ts and u.occurred_at < period_end_exclusive
    ) ai;
  end loop;
end
$$;

grant execute on function app.tenant_operational_summary(uuid, date, date) to commerce_runtime;

reset role;
