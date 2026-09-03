-- Desglose diario de app.tenant_operational_summary() (072), pedido para el
-- drill-down por tenant en la página "Métricas". Mismo patrón de seguridad
-- exacto (security definer, gateada por app.platform_admins), pero a
-- diferencia de 072 no itera todos los tenants: se pide bajo demanda para
-- UN tenant a la vez (cuando el dueño de la plataforma hace clic en su
-- fila), así que set_config('app.tenant_id', ...) se hace una sola vez.
--
-- generate_series() sirve de columna vertebral de días para que uno sin
-- actividad aparezca con ceros en vez de desaparecer de la serie — sin esto
-- un tenant con actividad intermitente se vería con una serie de días
-- salteados, engañoso para una vista de tendencia.
set role commerce_owner;

create or replace function app.tenant_operational_daily(
  _actor_user_id uuid, _tenant_id uuid, _period_start date, _period_end date
)
returns table (
  day date,
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

  perform set_config('app.tenant_id', _tenant_id::text, true);

  return query
  select
    spine.day,
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
    select generate_series(_period_start::timestamp, _period_end::timestamp, interval '1 day')::date as day
  ) spine
  left join (
    select
      date_trunc('day', m.occurred_at)::date as day,
      count(*) filter (where m.direction = 'inbound') as messages_total,
      count(*) filter (
        where m.direction = 'outbound' and m.sender_type = 'ai'
          and not (
            m.content ->> 'intent' = 'fallback'
            and coalesce(jsonb_array_length(m.content -> 'sources'), 0) = 0
          )
      ) as messages_resolved
    from app.messages m
    where m.tenant_id = _tenant_id and m.occurred_at >= period_start_ts and m.occurred_at < period_end_exclusive
    group by 1
  ) msg on msg.day = spine.day
  left join (
    select
      date_trunc('day', c.opened_at)::date as day,
      count(*) as conversations_total,
      count(*) filter (where c.handling_mode = 'human') as conversations_handed_off
    from app.conversations c
    where c.tenant_id = _tenant_id and c.opened_at >= period_start_ts and c.opened_at < period_end_exclusive
    group by 1
  ) conv on conv.day = spine.day
  left join (
    select
      date_trunc('day', r.created_at)::date as day,
      count(*) as commercial_requests_total,
      count(*) filter (where r.confirmed_at is not null) as commercial_requests_confirmed
    from app.commercial_requests r
    where r.tenant_id = _tenant_id and r.created_at >= period_start_ts and r.created_at < period_end_exclusive
    group by 1
  ) req on req.day = spine.day
  left join (
    select
      date_trunc('day', inbound.occurred_at)::date as day,
      avg(extract(epoch from (reply.occurred_at - inbound.occurred_at)) * 1000) as avg_response_latency_ms
    from app.messages inbound
    join lateral (
      select occurred_at from app.messages reply_candidate
       where reply_candidate.tenant_id = _tenant_id
         and reply_candidate.conversation_id = inbound.conversation_id
         and reply_candidate.direction = 'outbound'
         and reply_candidate.occurred_at > inbound.occurred_at
       order by reply_candidate.occurred_at asc limit 1
    ) reply on true
    where inbound.tenant_id = _tenant_id and inbound.direction = 'inbound'
      and inbound.occurred_at >= period_start_ts and inbound.occurred_at < period_end_exclusive
    group by 1
  ) lat on lat.day = spine.day
  left join (
    select
      date_trunc('day', u.occurred_at)::date as day,
      count(*) as ai_calls_total,
      sum(u.estimated_cost_minor) as ai_cost_minor,
      max(u.cost_currency)::text as ai_currency,
      avg(u.latency_ms) as ai_avg_latency_ms
    from app.ai_usage u
    where u.tenant_id = _tenant_id and u.occurred_at >= period_start_ts and u.occurred_at < period_end_exclusive
    group by 1
  ) ai on ai.day = spine.day
  order by spine.day;
end
$$;

grant execute on function app.tenant_operational_daily(uuid, uuid, date, date) to commerce_runtime;

reset role;
