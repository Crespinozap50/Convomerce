-- Configurable per-tenant inactivity timeout: a conversation a human agent
-- is handling (handling_mode='human') closes itself once the customer's
-- last message (app.conversations.last_message_at — set only on inbound
-- messages, see inbound-messages.service.ts) is older than the tenant's
-- configured window. Bot-handled conversations are left alone: they already
-- have their own lifecycle (order confirmed/cancelled, hold expiry via
-- 040's advance_operational_lifecycle), and a customer mid order-flow going
-- quiet for a few minutes shouldn't get their conversation closed under
-- them.
-- NULL (the default) disables auto-close for a tenant, matching how
-- bot_configurations' other optional behavior flags already work.
set role commerce_owner;

alter table app.bot_configurations
  add column conversation_timeout_minutes integer
  check (conversation_timeout_minutes is null or conversation_timeout_minutes > 0);

-- save_bot_configuration's signature changes (a new parameter), so it is
-- dropped and recreated rather than edited in place — 021 is already
-- applied (see the handoff rule: never edit an already-applied migration).
drop function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[]);

create function app.save_bot_configuration(
  _actor_user_id uuid, _enabled boolean, _assistant_name text, _locale text,
  _welcome_message text, _fallback_message text, _handoff_keywords text[],
  _conversation_timeout_minutes integer
) returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$
declare _tenant_id uuid := app.current_tenant_id();
begin
  if _tenant_id is null or not app.can_manage_channel_connections(_actor_user_id) then
    raise insufficient_privilege using message='Actor is not authorized to configure the bot';
  end if;
  insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords,conversation_timeout_minutes,updated_by_user_id)
  values(_tenant_id,_enabled,trim(_assistant_name),_locale,trim(_welcome_message),trim(_fallback_message),_handoff_keywords,_conversation_timeout_minutes,_actor_user_id)
  on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,
    locale=excluded.locale,welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,
    handoff_keywords=excluded.handoff_keywords,conversation_timeout_minutes=excluded.conversation_timeout_minutes,
    updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
  return true;
end $$;

revoke all on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer) from public;
grant execute on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer) to commerce_runtime;

-- Cross-tenant sweep, mirrors 040's advance_operational_lifecycle: a single
-- security-definer function the app polls on an interval (no per-tenant
-- app.tenant_id context needed — commerce_runtime already has select/update
-- on app.conversations from 021).
create function app.close_inactive_conversations()
returns table(closed integer)
language plpgsql security definer set search_path=pg_catalog,app as $$
declare closed_count integer := 0;
begin
  update app.conversations conversation
     set status='closed', close_reason='inactive', closed_at=now(), updated_at=now(), version=version+1
    from app.bot_configurations bot
   where bot.tenant_id=conversation.tenant_id
     and bot.conversation_timeout_minutes is not null
     and conversation.status<>'closed'
     and conversation.handling_mode='human'
     and conversation.last_message_at is not null
     and conversation.last_message_at<=now()-make_interval(mins=>bot.conversation_timeout_minutes);
  get diagnostics closed_count = row_count;
  return query select closed_count;
end $$;

revoke all on function app.close_inactive_conversations() from public;
grant execute on function app.close_inactive_conversations() to commerce_runtime;

reset role;
