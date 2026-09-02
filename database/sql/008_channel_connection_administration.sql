-- Administración multiempresa de conexiones externas.
-- Los secretos permanecen fuera de PostgreSQL; aquí solo se conserva su referencia.

set role commerce_owner;

create table app.platform_admins (
  user_id uuid primary key references app.users(id) on delete restrict,
  role text not null check (role in ('owner', 'operator')),
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.channel_connections (
  id uuid primary key,
  tenant_id uuid not null,
  channel_id uuid not null,
  provider text not null check (provider in ('meta_whatsapp')),
  external_business_account_id text not null,
  provider_app_id text,
  secret_reference text not null,
  status text not null check (status in ('pending', 'connected', 'reconnect_required', 'error', 'disconnected')),
  token_expires_at timestamptz,
  last_validated_at timestamptz,
  last_error_code text,
  connected_by_user_id uuid references app.users(id) on delete restrict,
  connected_at timestamptz,
  disconnected_at timestamptz,
  configuration_version integer not null default 1 check (configuration_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, channel_id),
  foreign key (tenant_id, channel_id) references app.channels(tenant_id, id) on delete restrict,
  check ((status = 'connected' and connected_at is not null) or status <> 'connected'),
  check ((status = 'disconnected' and disconnected_at is not null) or status <> 'disconnected')
);

create index channel_connections_status_idx
  on app.channel_connections (tenant_id, status, updated_at desc);

alter table app.channel_connections enable row level security;
alter table app.channel_connections force row level security;
create policy tenant_isolation on app.channel_connections
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

create function app.can_manage_channel_connections(_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select app.current_tenant_id() is not null and (
    exists (
      select 1 from app.platform_admins admin
      where admin.user_id = _actor_user_id and admin.status = 'active'
    )
    or exists (
      select 1 from app.tenant_users membership
      where membership.tenant_id = app.current_tenant_id()
        and membership.user_id = _actor_user_id
        and membership.status = 'active'
        and membership.role in ('owner', 'admin')
    )
  )
$$;

create function app.register_channel_connection(
  _actor_user_id uuid,
  _connection_id uuid,
  _channel_id uuid,
  _external_business_account_id text,
  _provider_app_id text,
  _secret_reference text,
  _correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  _tenant_id uuid := app.current_tenant_id();
  _result_id uuid;
begin
  if _tenant_id is null or not app.can_manage_channel_connections(_actor_user_id) then
    raise insufficient_privilege using message = 'Actor no autorizado para administrar conexiones';
  end if;
  if nullif(trim(_external_business_account_id), '') is null
     or nullif(trim(_secret_reference), '') is null then
    raise check_violation using message = 'WABA y referencia de secreto son obligatorios';
  end if;

  insert into app.channel_connections (
    id, tenant_id, channel_id, provider, external_business_account_id,
    provider_app_id, secret_reference, status, connected_by_user_id,
    connected_at, last_validated_at
  ) values (
    _connection_id, _tenant_id, _channel_id, 'meta_whatsapp',
    _external_business_account_id, _provider_app_id, _secret_reference,
    'connected', _actor_user_id, now(), now()
  )
  on conflict (tenant_id, channel_id) do update set
    external_business_account_id = excluded.external_business_account_id,
    provider_app_id = excluded.provider_app_id,
    secret_reference = excluded.secret_reference,
    status = 'connected',
    connected_by_user_id = excluded.connected_by_user_id,
    connected_at = now(),
    disconnected_at = null,
    last_error_code = null,
    last_validated_at = now(),
    configuration_version = app.channel_connections.configuration_version + 1,
    updated_at = now()
  returning id into _result_id;

  insert into app.audit_events (
    id, tenant_id, actor_type, actor_id, action, subject_type,
    subject_id, correlation_id, metadata
  ) values (
    _correlation_id, _tenant_id, 'user', _actor_user_id,
    'channel_connection.connected', 'channel_connection', _result_id,
    _correlation_id, jsonb_build_object('provider', 'meta_whatsapp')
  );
  return _result_id;
end
$$;

create function app.disconnect_channel_connection(
  _actor_user_id uuid,
  _connection_id uuid,
  _correlation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  _tenant_id uuid := app.current_tenant_id();
begin
  if _tenant_id is null or not app.can_manage_channel_connections(_actor_user_id) then
    raise insufficient_privilege using message = 'Actor no autorizado para administrar conexiones';
  end if;
  update app.channel_connections set
    status = 'disconnected', disconnected_at = now(), updated_at = now(),
    configuration_version = configuration_version + 1
  where tenant_id = _tenant_id and id = _connection_id and status <> 'disconnected';
  if not found then return false; end if;
  insert into app.audit_events (
    id, tenant_id, actor_type, actor_id, action, subject_type,
    subject_id, correlation_id, metadata
  ) values (
    _correlation_id, _tenant_id, 'user', _actor_user_id,
    'channel_connection.disconnected', 'channel_connection', _connection_id,
    _correlation_id, '{}'::jsonb
  );
  return true;
end
$$;

revoke all on app.platform_admins from public, commerce_runtime, commerce_readonly, commerce_outbox;
revoke all on function app.can_manage_channel_connections(uuid) from public;
grant execute on function app.can_manage_channel_connections(uuid) to commerce_runtime;
revoke all on function app.register_channel_connection(uuid,uuid,uuid,text,text,text,uuid) from public;
revoke all on function app.disconnect_channel_connection(uuid,uuid,uuid) from public;
grant execute on function app.register_channel_connection(uuid,uuid,uuid,text,text,text,uuid) to commerce_runtime;
grant execute on function app.disconnect_channel_connection(uuid,uuid,uuid) to commerce_runtime;
grant select on app.channel_connections to commerce_runtime;
grant select on app.channel_connections to commerce_readonly;

reset role;
