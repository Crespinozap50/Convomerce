set role commerce_owner;

create table app.bot_configurations (
  tenant_id uuid primary key references app.tenants(id) on delete restrict,
  enabled boolean not null default false,
  assistant_name text not null default 'Commerce Assistant' check (length(assistant_name) between 2 and 80),
  locale text not null default 'es' check (locale in ('es','en')),
  welcome_message text not null default '¡Hola! ¿En qué puedo ayudarte?',
  fallback_message text not null default 'No entendí tu solicitud. Puedo comunicarte con una persona.',
  handoff_keywords text[] not null default array['asesor','humano','persona'],
  updated_by_user_id uuid references app.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table app.bot_configurations enable row level security;
alter table app.bot_configurations force row level security;
create policy tenant_isolation on app.bot_configurations
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

alter table app.conversations add column handling_mode text not null default 'bot'
  check (handling_mode in ('bot','human','paused'));

create function app.save_bot_configuration(
  _actor_user_id uuid, _enabled boolean, _assistant_name text, _locale text,
  _welcome_message text, _fallback_message text, _handoff_keywords text[]
) returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$
declare _tenant_id uuid := app.current_tenant_id();
begin
  if _tenant_id is null or not app.can_manage_channel_connections(_actor_user_id) then
    raise insufficient_privilege using message='Actor is not authorized to configure the bot';
  end if;
  insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords,updated_by_user_id)
  values(_tenant_id,_enabled,trim(_assistant_name),_locale,trim(_welcome_message),trim(_fallback_message),_handoff_keywords,_actor_user_id)
  on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,
    locale=excluded.locale,welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,
    handoff_keywords=excluded.handoff_keywords,updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
  return true;
end $$;

revoke all on app.bot_configurations from public;
grant select on app.bot_configurations to commerce_runtime, commerce_readonly;
revoke all on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[]) from public;
grant execute on function app.save_bot_configuration(uuid,boolean,text,text,text,text,text[]) to commerce_runtime;
grant select, update on app.conversations to commerce_runtime;
reset role;
