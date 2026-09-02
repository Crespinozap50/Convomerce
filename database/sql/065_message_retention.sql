-- Configurable per-tenant message retention: once a message is older than
-- the configured window, it gets purged permanently regardless of whether
-- its conversation is still open — confirmed with the project owner that no
-- bot logic reads historical app.messages rows as conversation context (only
-- the single triggering message per turn), so this is functionally safe for
-- an in-progress conversation. A hard floor of 7 days is enforced (via the
-- check constraint below and the controller's validation) specifically so a
-- tenant can never configure something aggressive enough to delete messages
-- out from under an active conversation — the project owner's explicit
-- requirement. NULL (the default) disables purging for a tenant, same
-- optional-behavior-flag convention as conversation_timeout_minutes (059).
--
-- A conversation left with zero messages after purging is not deleted here
-- (its request/workflow/recommendation history, if any, is untouched) — the
-- admin inbox listing (ConversationsService.list()) simply stops showing a
-- conversation with no messages, which is enough to satisfy "quitarla de la
-- bandeja" without the FK-cascade risk of hard-deleting the conversation row.
set role commerce_owner;

alter table app.bot_configurations
  add column message_retention_days integer
  check (message_retention_days is null or message_retention_days >= 7);

-- 026 already switched unresolved_customer_questions.last_message_id to
-- ON DELETE SET NULL in anticipation of exactly this feature ("Learning
-- records survive conversation/message retention cleanup"). These two were
-- still ON DELETE RESTRICT and would otherwise block a purge outright.
alter table app.messages
  drop constraint messages_tenant_id_reply_to_message_id_fkey,
  add constraint messages_reply_to_message_id_fkey
    foreign key (tenant_id,reply_to_message_id) references app.messages(tenant_id,id)
    on delete set null (reply_to_message_id);

alter table app.ai_usage
  drop constraint ai_usage_tenant_id_message_id_fkey,
  add constraint ai_usage_message_id_fkey
    foreign key (tenant_id,message_id) references app.messages(tenant_id,id)
    on delete set null (message_id);

-- save_bot_configuration's signature changes (a new parameter), so it is
-- dropped and recreated rather than edited in place.
drop function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer);

create function app.save_bot_configuration(
  _actor_user_id uuid, _enabled boolean, _assistant_name text, _locale text,
  _welcome_message text, _fallback_message text, _handoff_keywords text[],
  _conversation_timeout_minutes integer, _message_retention_days integer
) returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$
declare _tenant_id uuid := app.current_tenant_id();
begin
  if _tenant_id is null or not app.can_manage_channel_connections(_actor_user_id) then
    raise insufficient_privilege using message='Actor is not authorized to configure the bot';
  end if;
  insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords,conversation_timeout_minutes,message_retention_days,updated_by_user_id)
  values(_tenant_id,_enabled,trim(_assistant_name),_locale,trim(_welcome_message),trim(_fallback_message),_handoff_keywords,_conversation_timeout_minutes,_message_retention_days,_actor_user_id)
  on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,
    locale=excluded.locale,welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,
    handoff_keywords=excluded.handoff_keywords,conversation_timeout_minutes=excluded.conversation_timeout_minutes,
    message_retention_days=excluded.message_retention_days,
    updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
  return true;
end $$;

revoke all on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer,integer) from public;
grant execute on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer,integer) to commerce_runtime;

-- Cross-tenant sweep, same per-tenant set_config loop pattern as
-- close_inactive_conversations() (047's RLS fix applies equally here — see
-- D-047 — since app.messages is a multi-tenant table under FORCE ROW LEVEL
-- SECURITY and this function has no single tenant context of its own).
create function app.purge_old_messages()
returns table(purged integer)
language plpgsql security definer set search_path=pg_catalog,app as $$
declare
  total_purged integer := 0;
  affected integer;
  retention_days integer;
  tenant record;
begin
  for tenant in select id as tenant_id from app.tenants loop
    perform set_config('app.tenant_id', tenant.tenant_id::text, true);
    select bot.message_retention_days into retention_days
      from app.bot_configurations bot where bot.tenant_id=tenant.tenant_id;
    if retention_days is not null then
      -- Short-lived (5-minute expiry) reservation ledger rows require a
      -- non-null message_id by design (see 047) — by the time a message is
      -- old enough to purge its reservation, if any row remains, has long
      -- since settled and carries no meaning worth keeping tied to deleted
      -- message content.
      delete from app.ai_usage_reservations reservation
       using app.messages message
       where reservation.tenant_id=tenant.tenant_id
         and message.tenant_id=tenant.tenant_id
         and reservation.message_id=message.id
         and message.occurred_at<=now()-make_interval(days=>retention_days);

      delete from app.messages
       where tenant_id=tenant.tenant_id
         and occurred_at<=now()-make_interval(days=>retention_days);
      get diagnostics affected = row_count;
      total_purged := total_purged + affected;
    end if;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return query select total_purged;
end $$;

revoke all on function app.purge_old_messages() from public;
grant execute on function app.purge_old_messages() to commerce_runtime;

reset role;
