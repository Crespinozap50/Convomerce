-- Bug reported live: a customer confirmed their order (conversation_workflow
-- status went to 'completed' at that point, per the awaiting_confirmation
-- affirmative branch) and ten minutes later still got "¿Sigues ahí? Si no
-- tenemos noticias tuyas en unos minutos cerraremos esta conversación." —
-- confusing, since nothing was actually pending on them. The warning was
-- sent purely based on last_message_at, with no regard for whether there
-- was anything left to respond to.
--
-- The warning is now sent only when the conversation has an *active*
-- conversation_workflow (something genuinely mid-flow, waiting on the
-- customer's next reply — an unfinished order, a pending requirement, etc).
-- A conversation with nothing pending (order confirmed/cancelled, or no
-- order ever started) still closes for inactivity — it just does so
-- silently, straight from the full timeout, with no "still there?" message
-- that would misleadingly imply something is waiting on them.
set role commerce_owner;

drop function app.close_inactive_conversations();

create function app.close_inactive_conversations()
returns table(closed integer, warned integer)
language plpgsql security definer set search_path=pg_catalog,app as $$
declare
  total_closed integer := 0;
  total_warned integer := 0;
  affected integer;
  timeout_minutes integer;
  bot_locale text;
  warning_text text;
  warning_message_id uuid;
  candidate record;
  tenant record;
  grace_minutes constant integer := 5;
begin
  for tenant in select id as tenant_id from app.tenants loop
    perform set_config('app.tenant_id', tenant.tenant_id::text, true);
    select bot.conversation_timeout_minutes, coalesce(bot.locale,'es') into timeout_minutes, bot_locale
      from app.bot_configurations bot where bot.tenant_id=tenant.tenant_id;
    if timeout_minutes is not null then
      warning_text := case when bot_locale='en'
        then 'Still there? If we do not hear from you in a few minutes we will close this conversation. Message us again if you need anything else.'
        else '¿Sigues ahí? Si no tenemos noticias tuyas en unos minutos cerraremos esta conversación. Escríbenos de nuevo si necesitas algo más.'
      end;

      if timeout_minutes > grace_minutes then
        for candidate in
          select conv.id as conversation_id, conv.channel_id
            from app.conversations conv
           where conv.tenant_id=tenant.tenant_id
             and conv.status<>'closed'
             and conv.closing_warning_sent_at is null
             and conv.last_message_at is not null
             and conv.last_message_at<=now()-make_interval(mins=>timeout_minutes-grace_minutes)
             and exists(
               select 1 from app.conversation_workflows w
                where w.tenant_id=tenant.tenant_id and w.conversation_id=conv.id and w.status='active'
             )
        loop
          warning_message_id := gen_random_uuid();
          insert into app.messages
            (id,tenant_id,conversation_id,channel_id,direction,sender_type,message_type,content,delivery_status,occurred_at)
          values
            (warning_message_id,tenant.tenant_id,candidate.conversation_id,candidate.channel_id,
             'outbound','system','text',jsonb_build_object('body',warning_text),'queued',now());
          insert into app.outbox_events
            (id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload)
          values
            (gen_random_uuid(),tenant.tenant_id,'message.send_requested','message',warning_message_id,
             gen_random_uuid(),1,jsonb_build_object('messageId',warning_message_id::text));
          update app.conversations set closing_warning_sent_at=now(),updated_at=now()
            where id=candidate.conversation_id;
          total_warned := total_warned + 1;
        end loop;
      end if;

      with closed_conversations as (
        update app.conversations conv
           set status='closed', close_reason='inactive', closed_at=now(), updated_at=now(), version=version+1
         where conv.tenant_id=tenant.tenant_id
           and conv.status<>'closed'
           and conv.last_message_at is not null
           and (
             (timeout_minutes<=grace_minutes
              and conv.last_message_at<=now()-make_interval(mins=>timeout_minutes))
             or
             (timeout_minutes>grace_minutes
              and conv.closing_warning_sent_at is not null
              and conv.closing_warning_sent_at<=now()-make_interval(mins=>grace_minutes))
             or
             (timeout_minutes>grace_minutes
              and conv.closing_warning_sent_at is null
              and conv.last_message_at<=now()-make_interval(mins=>timeout_minutes)
              and not exists(
                select 1 from app.conversation_workflows w
                 where w.tenant_id=tenant.tenant_id and w.conversation_id=conv.id and w.status='active'
              ))
           )
        returning id
      ),
      cancelled_requests as (
        update app.commercial_requests request
           set status='cancelled', updated_at=now()
         where request.tenant_id=tenant.tenant_id
           and request.conversation_id in (select id from closed_conversations)
           and request.status in ('draft','awaiting_confirmation')
      ),
      cancelled_workflows as (
        update app.conversation_workflows workflow
           set status='cancelled', updated_at=now()
         where workflow.tenant_id=tenant.tenant_id
           and workflow.conversation_id in (select id from closed_conversations)
           and workflow.status='active'
      ),
      expired_recommendations as (
        update app.recommendation_events event
           set status='expired', responded_at=now()
         where event.tenant_id=tenant.tenant_id
           and event.conversation_id in (select id from closed_conversations)
           and event.status='shown'
      )
      select count(*) into affected from closed_conversations;
      total_closed := total_closed + affected;
    end if;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return query select total_closed, total_warned;
end $$;

revoke all on function app.close_inactive_conversations() from public;
grant execute on function app.close_inactive_conversations() to commerce_runtime;

reset role;
