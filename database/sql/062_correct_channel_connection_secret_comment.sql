-- 020_configure_channel_connection.sql's header comment claimed "the token
-- stays outside PostgreSQL; only its opaque reference is persisted" — that
-- assumed an external secret manager that was never built. What actually
-- ships (see backend/src/secrets/credential-encryption.service.ts and
-- EncryptedChannelSecretProvider in whatsapp-adapter.ts) encrypts the token
-- with AES-256-GCM before it ever reaches this function and stores the
-- ciphertext directly in secret_reference (prefixed enc:v1:), the same
-- pattern already used for app.calendar_sources.secret_reference. This
-- migration only corrects the comment — the function body is byte-for-byte
-- unchanged from 020.
set role commerce_owner;

drop function app.configure_channel_connection(uuid,uuid,uuid,text,text,text,text,uuid);

-- Configura el Phone Number ID y la conexión como una sola operación por tenant.
-- El token se cifra (AES-256-GCM) antes de llegar aquí; solo se persiste el
-- valor cifrado en secret_reference, nunca el texto plano.
create function app.configure_channel_connection(
  _actor_user_id uuid, _connection_id uuid, _channel_id uuid,
  _phone_number_id text, _external_business_account_id text,
  _provider_app_id text, _secret_reference text, _correlation_id uuid
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
    raise insufficient_privilege using message = 'Actor is not authorized to manage connections';
  end if;
  if nullif(trim(_phone_number_id), '') is null
     or nullif(trim(_external_business_account_id), '') is null
     or nullif(trim(_secret_reference), '') is null then
    raise check_violation using message = 'Phone Number ID, WABA ID, and secret reference are required';
  end if;

  update app.channels
     set external_account_id = trim(_phone_number_id),
         secret_reference = trim(_secret_reference), status = 'active',
         configuration_version = configuration_version + 1, updated_at = now()
   where tenant_id = _tenant_id and id = _channel_id and provider = 'whatsapp_cloud';
  if not found then
    raise foreign_key_violation using message = 'WhatsApp channel does not belong to the selected tenant';
  end if;

  insert into app.channel_connections (
    id, tenant_id, channel_id, provider, external_business_account_id,
    provider_app_id, secret_reference, status, connected_by_user_id, connected_at
  ) values (
    _connection_id, _tenant_id, _channel_id, 'meta_whatsapp',
    trim(_external_business_account_id), nullif(trim(_provider_app_id), ''),
    trim(_secret_reference), 'connected', _actor_user_id, now()
  )
  on conflict (tenant_id, channel_id) do update set
    external_business_account_id = excluded.external_business_account_id,
    provider_app_id = excluded.provider_app_id,
    secret_reference = excluded.secret_reference, status = 'connected',
    connected_by_user_id = excluded.connected_by_user_id, connected_at = now(),
    disconnected_at = null, last_error_code = null, last_validated_at = null,
    configuration_version = app.channel_connections.configuration_version + 1,
    updated_at = now()
  returning id into _result_id;

  insert into app.audit_events (
    id, tenant_id, actor_type, actor_id, action, subject_type,
    subject_id, correlation_id, metadata
  ) values (
    _correlation_id, _tenant_id, 'user', _actor_user_id,
    'channel_connection.configured', 'channel_connection', _result_id,
    _correlation_id, jsonb_build_object('provider', 'meta_whatsapp', 'channel_id', _channel_id)
  );
  return _result_id;
end
$$;

revoke all on function app.configure_channel_connection(uuid,uuid,uuid,text,text,text,text,uuid) from public;
grant execute on function app.configure_channel_connection(uuid,uuid,uuid,text,text,text,text,uuid) to commerce_runtime;

reset role;
