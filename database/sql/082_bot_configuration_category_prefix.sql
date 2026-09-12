-- D-139/D-140 removed the hardcoded "Menú" word from every category-picker
-- row for every tenant ("Celulares", not "Menú Celulares") — the project
-- owner's own follow-up: that's the right call for CrediCel Store, but
-- Santos Tacos should keep saying "Menú Tacos", and a future tenant might
-- want its own wording entirely ("Servicio de lavado premium"). Rather than
-- picking one global answer, this makes the prefix a per-tenant setting —
-- same optional-behavior-flag convention as conversation_timeout_minutes
-- (059) and message_retention_days (065): NULL (the default) means no
-- prefix at all, a tenant opts into whatever word or phrase fits its own
-- business by setting this from the admin panel.
set role commerce_owner;

alter table app.bot_configurations add column category_label_prefix text;

-- save_bot_configuration's signature changes (a new parameter), so it is
-- dropped and recreated rather than edited in place.
drop function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer,integer);

create function app.save_bot_configuration(
  _actor_user_id uuid, _enabled boolean, _assistant_name text, _locale text,
  _welcome_message text, _fallback_message text, _handoff_keywords text[],
  _conversation_timeout_minutes integer, _message_retention_days integer,
  _category_label_prefix text
) returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$
declare _tenant_id uuid := app.current_tenant_id();
begin
  if _tenant_id is null or not app.can_manage_channel_connections(_actor_user_id) then
    raise insufficient_privilege using message='Actor is not authorized to configure the bot';
  end if;
  insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords,conversation_timeout_minutes,message_retention_days,category_label_prefix,updated_by_user_id)
  values(_tenant_id,_enabled,trim(_assistant_name),_locale,trim(_welcome_message),trim(_fallback_message),_handoff_keywords,_conversation_timeout_minutes,_message_retention_days,nullif(trim(coalesce(_category_label_prefix,'')),''),_actor_user_id)
  on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,
    locale=excluded.locale,welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,
    handoff_keywords=excluded.handoff_keywords,conversation_timeout_minutes=excluded.conversation_timeout_minutes,
    message_retention_days=excluded.message_retention_days,category_label_prefix=excluded.category_label_prefix,
    updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
  return true;
end $$;

revoke all on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer,integer,text) from public;
grant execute on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[],integer,integer,text) to commerce_runtime;

reset role;
