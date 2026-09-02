\set ON_ERROR_STOP on
\pset pager off

begin;

-- Todos los cambios de esta suite se revierten al final.
set local role commerce_runtime;

-- RLS: el tenant restaurante solo observa su propia fila.
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);
do $$
begin
  if not exists (
    select 1 from app.contacts
    where id = '0194f002-0000-7000-8000-000000000001'
  ) then
    raise exception 'RLS no mostró el contacto conocido del tenant restaurante';
  end if;
  if exists (
    select 1 from app.contacts
    where tenant_id = '0194f000-0000-7000-8000-000000000002'
  ) then
    raise exception 'RLS expuso datos del tenant tecnológico';
  end if;
end
$$;

-- Sin contexto, la lectura devuelve cero filas y la escritura es rechazada.
select set_config('app.tenant_id', '', true);
do $$
begin
  if exists (select 1 from app.contacts) then
    raise exception 'RLS permitió leer sin contexto tenant';
  end if;
  begin
    insert into app.contacts (id, tenant_id, display_name, consent_status)
    values ('0194f100-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001', 'No permitido', 'unknown');
    raise exception 'RLS permitió insertar sin contexto tenant';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);

-- Una FK compuesta rechaza combinar canal del restaurante y contacto de tecnología.
do $$
begin
  begin
    insert into app.conversations (id, tenant_id, channel_id, contact_id, status)
    values ('0194f100-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000001',
            '0194f001-0000-7000-8000-000000000001', '0194f002-0000-7000-8000-000000000002', 'open');
    raise exception 'La FK compuesta permitió una relación entre tenants';
  exception
    when foreign_key_violation then null;
  end;
end
$$;

-- El índice parcial impide una segunda conversación activa para el mismo contacto/canal.
do $$
begin
  begin
    insert into app.conversations (id, tenant_id, channel_id, contact_id, status)
    values ('0194f100-0000-7000-8000-000000000003', '0194f000-0000-7000-8000-000000000001',
            '0194f001-0000-7000-8000-000000000001', '0194f002-0000-7000-8000-000000000001', 'waiting_customer');
    raise exception 'Se permitieron dos conversaciones activas';
  exception
    when unique_violation then null;
  end;
end
$$;

-- Idempotencia de mensajes externos.
insert into app.messages (
  id, tenant_id, conversation_id, channel_id, direction, sender_type,
  external_message_id, message_type, content, delivery_status, occurred_at
) values (
  '0194f100-0000-7000-8000-000000000004', '0194f000-0000-7000-8000-000000000001',
  '0194f003-0000-7000-8000-000000000001', '0194f001-0000-7000-8000-000000000001',
  'inbound', 'contact', 'wamid.test.duplicate', 'text', '{"body":"mensaje ficticio"}', 'received', now()
);
do $$
begin
  begin
    insert into app.messages (
      id, tenant_id, conversation_id, channel_id, direction, sender_type,
      external_message_id, message_type, content, delivery_status, occurred_at
    ) values (
      '0194f100-0000-7000-8000-000000000005', '0194f000-0000-7000-8000-000000000001',
      '0194f003-0000-7000-8000-000000000001', '0194f001-0000-7000-8000-000000000001',
      'inbound', 'contact', 'wamid.test.duplicate', 'text', '{}', 'received', now()
    );
    raise exception 'Se permitió duplicar un mensaje externo';
  exception
    when unique_violation then null;
  end;
end
$$;

-- Idempotencia de webhooks/eventos de entrada.
insert into app.processing_events (id, tenant_id, source, external_event_id, correlation_id, status)
values ('0194f100-0000-7000-8000-000000000006', '0194f000-0000-7000-8000-000000000001',
        'whatsapp', 'webhook-test-1', '0194f100-0000-7000-8000-000000000007', 'received');
do $$
begin
  begin
    insert into app.processing_events (id, tenant_id, source, external_event_id, correlation_id, status)
    values ('0194f100-0000-7000-8000-000000000008', '0194f000-0000-7000-8000-000000000001',
            'whatsapp', 'webhook-test-1', '0194f100-0000-7000-8000-000000000009', 'received');
    raise exception 'Se permitió duplicar un webhook';
  exception
    when unique_violation then null;
  end;
end
$$;

-- Deduplicación de consumidores.
insert into app.processed_events (id, tenant_id, consumer_name, event_id)
values ('0194f100-0000-7000-8000-000000000010', '0194f000-0000-7000-8000-000000000001',
        'test-consumer', '0194f100-0000-7000-8000-000000000011');
do $$
begin
  begin
    insert into app.processed_events (id, tenant_id, consumer_name, event_id)
    values ('0194f100-0000-7000-8000-000000000012', '0194f000-0000-7000-8000-000000000001',
            'test-consumer', '0194f100-0000-7000-8000-000000000011');
    raise exception 'El consumidor pudo procesar dos veces el mismo evento';
  exception
    when unique_violation then null;
  end;
end
$$;

-- Transactional outbox: negocio y evento desaparecen juntos al revertir.
savepoint before_outbox_operation;
insert into app.contacts (id, tenant_id, display_name, consent_status)
values ('0194f100-0000-7000-8000-000000000013', '0194f000-0000-7000-8000-000000000001', 'Contacto transaccional', 'unknown');
insert into app.outbox_events (
  id, tenant_id, event_type, aggregate_type, aggregate_id, correlation_id,
  payload_schema_version, payload
) values (
  '0194f100-0000-7000-8000-000000000014', '0194f000-0000-7000-8000-000000000001',
  'contact.created', 'contact', '0194f100-0000-7000-8000-000000000013',
  '0194f100-0000-7000-8000-000000000015', 1, '{"test":true}'
);
rollback to savepoint before_outbox_operation;
do $$
begin
  if exists (select 1 from app.contacts where id = '0194f100-0000-7000-8000-000000000013')
     or exists (select 1 from app.outbox_events where id = '0194f100-0000-7000-8000-000000000014') then
    raise exception 'El rollback no revirtió negocio y outbox atómicamente';
  end if;
end
$$;

reset role;

-- Autorización: owner/admin del tenant y administrador de plataforma pueden
-- administrar; viewer y solicitudes sin contexto tenant fallan cerradas.
set local role commerce_owner;
insert into app.users (id, email, display_name, status) values
  ('0194f100-0000-7000-8000-000000000101', 'owner-test@example.invalid', 'Owner Test', 'active'),
  ('0194f100-0000-7000-8000-000000000102', 'viewer-test@example.invalid', 'Viewer Test', 'active'),
  ('0194f100-0000-7000-8000-000000000103', 'platform-test@example.invalid', 'Platform Test', 'active');
insert into app.tenant_users (id, tenant_id, user_id, role, status) values
  ('0194f100-0000-7000-8000-000000000111', '0194f000-0000-7000-8000-000000000001',
   '0194f100-0000-7000-8000-000000000101', 'owner', 'active'),
  ('0194f100-0000-7000-8000-000000000112', '0194f000-0000-7000-8000-000000000001',
   '0194f100-0000-7000-8000-000000000102', 'viewer', 'active');
insert into app.platform_admins (user_id, role, status)
values ('0194f100-0000-7000-8000-000000000103', 'operator', 'active');

set local role commerce_runtime;
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);
do $$
begin
  if not app.can_manage_channel_connections('0194f100-0000-7000-8000-000000000101')
     or app.can_manage_channel_connections('0194f100-0000-7000-8000-000000000102')
     or not app.can_manage_channel_connections('0194f100-0000-7000-8000-000000000103') then
    raise exception 'La matriz owner/viewer/platform admin es incorrecta';
  end if;
  perform set_config('app.tenant_id', '', true);
  if app.can_manage_channel_connections('0194f100-0000-7000-8000-000000000101') then
    raise exception 'La autorización administrativa no falló sin tenant';
  end if;
end
$$;

-- Un administrador de plataforma puede actualizar el perfil sin ser miembro
-- del tenant; la referencia de auditoría queda nula y no viola la FK compuesta.
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);
do $$
begin
  if not app.save_business_profile(
    '0194f100-0000-7000-8000-000000000103',
    'Perfil actualizado por plataforma','','','Lunes a viernes · 09:00–18:00','',''
  ) then
    raise exception 'El administrador de plataforma no pudo guardar el perfil';
  end if;
  if not exists (
    select 1 from app.business_profiles
    where tenant_id='0194f000-0000-7000-8000-000000000001'
      and updated_by_user_id is null
  ) then
    raise exception 'La auditoría del perfil conservó una membresía inexistente';
  end if;
end
$$;

reset role;

-- Verificación explícita de la matriz de privilegios.
do $$
begin
  if has_table_privilege('commerce_runtime', 'app.tenants', 'SELECT') then
    raise exception 'runtime puede leer la tabla global tenants';
  end if;
  if has_table_privilege('commerce_runtime', 'app.audit_events', 'UPDATE')
     or has_table_privilege('commerce_runtime', 'app.audit_events', 'DELETE') then
    raise exception 'runtime puede modificar auditoría append-only';
  end if;
  if not has_column_privilege('commerce_runtime', 'app.messages', 'delivery_status', 'UPDATE')
     or has_column_privilege('commerce_runtime', 'app.messages', 'content', 'UPDATE') then
    raise exception 'Los permisos de actualización de mensajes son incorrectos';
  end if;
  if not has_table_privilege('commerce_outbox', 'app.outbox_events', 'SELECT,UPDATE') then
    raise exception 'outbox no puede reclamar eventos';
  end if;
  if has_table_privilege('commerce_outbox', 'app.contacts', 'SELECT')
     or has_table_privilege('commerce_outbox', 'app.outbox_events', 'INSERT,DELETE') then
    raise exception 'outbox tiene privilegios excesivos';
  end if;
  if not has_table_privilege('commerce_readonly', 'app.contacts', 'SELECT')
     or has_table_privilege('commerce_readonly', 'app.contacts', 'INSERT,UPDATE,DELETE') then
    raise exception 'readonly tiene permisos incorrectos';
  end if;
  if not (select rolbypassrls from pg_roles where rolname = 'commerce_outbox')
     or (select rolbypassrls from pg_roles where rolname = 'commerce_runtime') then
    raise exception 'BYPASSRLS no está limitado al rol outbox';
  end if;
  if not has_function_privilege(
       'commerce_runtime', 'app.resolve_whatsapp_channel(text)', 'EXECUTE'
     ) then
    raise exception 'runtime no puede resolver el canal autenticado';
  end if;
  if has_function_privilege(
       'commerce_readonly', 'app.resolve_whatsapp_channel(text)', 'EXECUTE'
     ) then
    raise exception 'readonly recibió acceso al resolver de canal';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'app'
      and tablename = 'channels'
      and indexname = 'channels_provider_external_account_uidx'
  ) then
    raise exception 'phone_number_id no está protegido por unicidad global';
  end if;
  if not has_function_privilege(
       'commerce_runtime', 'app.mark_outbound_message_sent(uuid,text)', 'EXECUTE'
     ) or has_function_privilege(
       'commerce_readonly', 'app.mark_outbound_message_sent(uuid,text)', 'EXECUTE'
     ) then
    raise exception 'Los permisos para confirmar un envío saliente son incorrectos';
  end if;
  if not has_function_privilege(
       'commerce_runtime', 'app.can_manage_channel_connections(uuid)', 'EXECUTE'
     ) or has_function_privilege(
       'commerce_readonly', 'app.can_manage_channel_connections(uuid)', 'EXECUTE'
     ) then
    raise exception 'Los permisos de autorización administrativa son incorrectos';
  end if;
  if has_table_privilege('commerce_runtime', 'app.platform_admins', 'SELECT')
     or not has_table_privilege('commerce_runtime', 'app.channel_connections', 'SELECT')
     or has_table_privilege('commerce_runtime', 'app.channel_connections', 'INSERT,UPDATE,DELETE') then
    raise exception 'Los permisos de administración de conexiones son incorrectos';
  end if;
  if has_table_privilege('commerce_runtime', 'app.local_credentials', 'SELECT')
     or has_table_privilege('commerce_runtime', 'app.user_sessions', 'SELECT')
     or has_table_privilege('commerce_runtime', 'app.login_attempts', 'SELECT') then
    raise exception 'runtime puede leer directamente secretos de autenticación';
  end if;
  if not has_function_privilege('commerce_runtime', 'app.get_local_login(text)', 'EXECUTE')
     or not has_function_privilege('commerce_runtime', 'app.resolve_local_session(char)', 'EXECUTE')
     or not has_function_privilege(
       'commerce_runtime', 'app.change_local_password(uuid,uuid,text,text)', 'EXECUTE'
     )
     or not has_function_privilege('commerce_runtime', 'app.get_local_user_context(uuid)', 'EXECUTE')
     or not has_function_privilege(
       'commerce_runtime', 'app.update_user_interface_locale(uuid,uuid,text)', 'EXECUTE'
     )
     or not has_function_privilege('commerce_runtime', 'app.list_tenant_users(uuid)', 'EXECUTE')
     or has_table_privilege('commerce_runtime', 'app.tenant_user_invitations', 'SELECT')
     or has_function_privilege(
       'public', 'app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid)', 'EXECUTE'
     )
     or has_function_privilege('commerce_readonly', 'app.resolve_local_session(char)', 'EXECUTE') then
    raise exception 'La frontera de autenticación local tiene permisos incorrectos';
  end if;
end
$$;

-- Las sesiones son opacas, expiran y pueden revocarse sin exponer sus tablas.
set local role commerce_owner;
insert into app.local_credentials (user_id, password_hash)
values ('0194f100-0000-7000-8000-000000000101',
        '$argon2id$v=19$m=65536,t=3,p=4$NgJmJmX9A2dcOTxG8Uc7rg$LxWgIujor6bP10Anph87TTwh4GI3i3PsqEtLpp3u1jo');
set local role commerce_runtime;
select app.create_local_session(
  '0194f100-0000-7000-8000-000000000121',
  '0194f100-0000-7000-8000-000000000101',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  now() + interval '1 hour'
);
select app.create_local_session(
  '0194f100-0000-7000-8000-000000000122',
  '0194f100-0000-7000-8000-000000000101',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  now() + interval '1 hour'
);
do $$
begin
  if not exists (
    select 1 from app.resolve_local_session(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ) where user_id = '0194f100-0000-7000-8000-000000000101'
  ) then
    raise exception 'No se pudo resolver una sesión local válida';
  end if;
  if not app.change_local_password(
    '0194f100-0000-7000-8000-000000000101',
    '0194f100-0000-7000-8000-000000000121',
    '$argon2id$v=19$m=65536,t=3,p=4$NgJmJmX9A2dcOTxG8Uc7rg$LxWgIujor6bP10Anph87TTwh4GI3i3PsqEtLpp3u1jo',
    '$argon2id$v=19$m=65536,t=3,p=4$NgJmJmX9A2dcOTxG8Uc7rg$nuevopruebaseguranoesunhashreal0000000000000'
  ) then
    raise exception 'No se pudo cambiar la contraseña local';
  end if;
  if exists (
    select 1 from app.resolve_local_session(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  ) then
    raise exception 'El cambio de contraseña no revocó las demás sesiones';
  end if;
  if not exists (
    select 1 from app.resolve_local_session(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ) where must_change_password = false
  ) then
    raise exception 'La sesión actual no sobrevivió al cambio de contraseña';
  end if;
  if not app.update_user_interface_locale(
    '0194f100-0000-7000-8000-000000000101',
    '0194f100-0000-7000-8000-000000000121', 'es'
  ) then
    raise exception 'No se pudo guardar el idioma de interfaz';
  end if;
  if (app.get_local_user_context('0194f100-0000-7000-8000-000000000101')->>'uiLanguage') <> 'es' then
    raise exception 'El contexto de usuario no contiene el idioma guardado';
  end if;
  begin
    perform app.update_user_interface_locale(
      '0194f100-0000-7000-8000-000000000102',
      '0194f100-0000-7000-8000-000000000121', 'en'
    );
    raise exception 'Una sesión pudo cambiar las preferencias de otro usuario';
  exception when invalid_authorization_specification then null;
  end;
  if not app.revoke_local_session(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) then
    raise exception 'No se pudo revocar la sesión local';
  end if;
  if exists (
    select 1 from app.resolve_local_session(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  ) then
    raise exception 'Una sesión revocada continuó activa';
  end if;
end
$$;

-- Invitación: solo un administrador autorizado puede crearla; el token es de
-- un solo uso y al aceptarlo se crea la membresía en el tenant correcto.
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);
select app.create_tenant_user_invitation(
  '0194f100-0000-7000-8000-000000000131',
  '0194f100-0000-7000-8000-000000000101',
  'invitado-test@example.invalid', 'operator',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  now() + interval '1 hour',
  '0194f100-0000-7000-8000-000000000132'
);
select * from app.accept_tenant_user_invitation(
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '0194f100-0000-7000-8000-000000000133',
  '0194f100-0000-7000-8000-000000000134',
  'Invitado Test',
  '$argon2id$v=19$m=65536,t=3,p=4$NgJmJmX9A2dcOTxG8Uc7rg$nuevopruebaseguranoesunhashreal0000000000000',
  '0194f100-0000-7000-8000-000000000135'
);
do $$
begin
  if not exists (
    select 1 from app.list_tenant_users('0194f100-0000-7000-8000-000000000101')
    where email = 'invitado-test@example.invalid' and role = 'operator' and status = 'active'
  ) then raise exception 'La invitación no creó la membresía esperada'; end if;
  begin
    perform app.accept_tenant_user_invitation(
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '0194f100-0000-7000-8000-000000000136',
      '0194f100-0000-7000-8000-000000000137', 'Duplicado',
      '$argon2id$v=19$m=65536,t=3,p=4$NgJmJmX9A2dcOTxG8Uc7rg$nuevopruebaseguranoesunhashreal0000000000000',
      '0194f100-0000-7000-8000-000000000138'
    );
    raise exception 'La invitación pudo aceptarse dos veces';
  exception when invalid_authorization_specification then null;
  end;
end
$$;

-- Gestión de membresías: la escritura directa está revocada, deshabilitar
-- revoca sesiones y nunca se puede degradar al último owner activo.
do $$
begin
  if has_table_privilege('commerce_runtime', 'app.tenant_users', 'INSERT,UPDATE,DELETE') then
    raise exception 'runtime conserva escritura directa sobre membresías';
  end if;
  if not app.update_tenant_membership(
    '0194f100-0000-7000-8000-000000000101',
    '0194f100-0000-7000-8000-000000000134', 'viewer', 'disabled',
    '0194f100-0000-7000-8000-000000000139'
  ) then raise exception 'No se actualizó la membresía invitada'; end if;
end
$$;

set local role commerce_owner;
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000002', true);
insert into app.tenant_users (id, tenant_id, user_id, role, status)
values ('0194f100-0000-7000-8000-000000000141', '0194f000-0000-7000-8000-000000000002',
        '0194f100-0000-7000-8000-000000000101', 'owner', 'active');
set local role commerce_runtime;
do $$
begin
  begin
    perform app.update_tenant_membership(
      '0194f100-0000-7000-8000-000000000103',
      '0194f100-0000-7000-8000-000000000141', 'admin', 'active',
      '0194f100-0000-7000-8000-000000000142'
    );
    raise exception 'Se pudo degradar al último owner activo';
  exception when check_violation then null;
  end;
end
$$;

-- Configuración de conexiones: actualiza canal y metadatos dentro del tenant,
-- conserva solo la referencia del secreto y rechaza canales de otro tenant.
do $$
declare
  _connection_id uuid;
begin
  _connection_id := app.configure_channel_connection(
    '0194f100-0000-7000-8000-000000000101',
    '0194f100-0000-7000-8000-000000000151',
    '0194f001-0000-7000-8000-000000000002',
    'sql-test-phone-number-id', 'sql-test-waba-id', 'sql-test-app-id',
    'secrets/sql-test/whatsapp',
    '0194f100-0000-7000-8000-000000000152'
  );
  if _connection_id <> '0194f100-0000-7000-8000-000000000151' then
    raise exception 'La conexión no devolvió el identificador esperado';
  end if;
  if not exists (
    select 1 from app.channels
     where id = '0194f001-0000-7000-8000-000000000002'
       and external_account_id = 'sql-test-phone-number-id'
       and secret_reference = 'secrets/sql-test/whatsapp'
  ) then raise exception 'El canal no recibió la configuración esperada'; end if;
  begin
    perform app.configure_channel_connection(
      '0194f100-0000-7000-8000-000000000101',
      '0194f100-0000-7000-8000-000000000153',
      '0194f001-0000-7000-8000-000000000001',
      'cross-tenant-phone', 'cross-tenant-waba', null, 'secrets/cross-tenant',
      '0194f100-0000-7000-8000-000000000154'
    );
    raise exception 'Se configuró un canal perteneciente a otro tenant';
  exception when foreign_key_violation then null;
  end;
end
$$;

-- Capacidades y agendas: configuración por tenant, RLS forzado y escritura
-- únicamente mediante la función autorizada.
do $$
begin
  if has_table_privilege('commerce_runtime', 'app.tenant_capabilities', 'INSERT,UPDATE,DELETE') then
    raise exception 'runtime conserva escritura directa sobre capacidades';
  end if;
  if not app.save_tenant_capabilities(
    '0194f100-0000-7000-8000-000000000101',
    array['commercial_offerings','appointments']
  ) then raise exception 'No se guardaron las capacidades del tenant'; end if;
  if not exists (select 1 from app.tenant_capabilities where capability='appointments' and enabled) then
    raise exception 'La capacidad de reservas no quedó activa';
  end if;
end
$$;

select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);
do $$
begin
  if exists (
    select 1 from app.tenant_capabilities
     where tenant_id = '0194f000-0000-7000-8000-000000000002'
  ) then raise exception 'RLS expuso capacidades de otra empresa'; end if;
end
$$;

-- Disponibilidad por recurso y prevención transaccional de citas cruzadas.
insert into app.booking_resources(id,tenant_id,resource_type,name,status)
values('0194f100-0000-7000-8000-000000000181','0194f000-0000-7000-8000-000000000001','person','Barbero SQL','active');
insert into app.resource_availability_rules(id,tenant_id,resource_id,day_of_week,starts_at,ends_at,timezone)
values('0194f100-0000-7000-8000-000000000182','0194f000-0000-7000-8000-000000000001','0194f100-0000-7000-8000-000000000181',1,'09:00','18:00','America/Bogota');
insert into app.service_resource_links(tenant_id,catalog_item_id,resource_id,duration_minutes)
select '0194f000-0000-7000-8000-000000000001',item.id,'0194f100-0000-7000-8000-000000000181',30
from app.catalog_items item where item.tenant_id='0194f000-0000-7000-8000-000000000001' limit 1;
insert into app.appointments(id,tenant_id,catalog_item_id,contact_id,resource_id,idempotency_key,starts_at,ends_at,timezone,status)
select '0194f100-0000-7000-8000-000000000183','0194f000-0000-7000-8000-000000000001',item.id,
  '0194f002-0000-7000-8000-000000000001','0194f100-0000-7000-8000-000000000181','appointment-sql-1',
  '2030-01-07 14:00:00+00','2030-01-07 15:00:00+00','America/Bogota','confirmed'
from app.catalog_items item where item.tenant_id='0194f000-0000-7000-8000-000000000001' limit 1;
do $$ begin
  begin
    insert into app.appointments(id,tenant_id,catalog_item_id,contact_id,resource_id,idempotency_key,starts_at,ends_at,timezone,status,hold_expires_at)
    select '0194f100-0000-7000-8000-000000000184','0194f000-0000-7000-8000-000000000001',item.id,
      '0194f002-0000-7000-8000-000000000001','0194f100-0000-7000-8000-000000000181','appointment-sql-2',
      '2030-01-07 14:30:00+00','2030-01-07 15:30:00+00','America/Bogota','held',now()+interval '10 minutes'
    from app.catalog_items item where item.tenant_id='0194f000-0000-7000-8000-000000000001' limit 1;
    raise exception 'Se permitieron citas cruzadas para el mismo recurso';
  exception when exclusion_violation then null;
  end;
end $$;
do $$ declare item_id uuid; held_id uuid; begin
  select id into item_id from app.catalog_items where tenant_id='0194f000-0000-7000-8000-000000000001' limit 1;
  if not exists(select 1 from app.find_available_slots(item_id,'2030-01-07 15:00:00+00','2030-01-07 22:00:00+00',10)) then
    raise exception 'El motor no encontró espacios dentro de la disponibilidad';
  end if;
  held_id:=app.hold_appointment(
    '0194f100-0000-7000-8000-000000000185',item_id,
    '0194f002-0000-7000-8000-000000000001','0194f100-0000-7000-8000-000000000181',null,
    'appointment-sql-hold','2030-01-07 15:00:00+00','2030-01-07 15:30:00+00','America/Bogota',10
  );
  if held_id<>'0194f100-0000-7000-8000-000000000185' then raise exception 'La retención no devolvió su identificador'; end if;
  if app.transition_appointment(held_id,'confirm',null,null)<>'appointment.confirmed' then
    raise exception 'No se confirmó la cita retenida';
  end if;
  insert into app.appointments(id,tenant_id,catalog_item_id,contact_id,resource_id,idempotency_key,starts_at,ends_at,timezone,status,hold_expires_at)
  values('0194f100-0000-7000-8000-000000000186','0194f000-0000-7000-8000-000000000001',item_id,
    '0194f002-0000-7000-8000-000000000001','0194f100-0000-7000-8000-000000000181','appointment-expired-hold',
    '2030-01-07 16:00:00+00','2030-01-07 16:30:00+00','America/Bogota','held',now()-interval '1 minute');
  held_id:=app.hold_appointment(
    '0194f100-0000-7000-8000-000000000187',item_id,
    '0194f002-0000-7000-8000-000000000001','0194f100-0000-7000-8000-000000000181',null,
    'appointment-after-expiry','2030-01-07 16:00:00+00','2030-01-07 16:30:00+00','America/Bogota',10
  );
  if held_id<>'0194f100-0000-7000-8000-000000000187' then raise exception 'Una retención vencida continuó bloqueando el espacio'; end if;
end $$;
select * from app.advance_operational_lifecycle();
do $$ begin
  if (select status from app.appointments where id='0194f100-0000-7000-8000-000000000186')<>'cancelled' then
    raise exception 'La automatización no liberó una retención vencida';
  end if;
end $$;
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from app.booking_resources where id='0194f100-0000-7000-8000-000000000181') then
    raise exception 'RLS expuso un recurso reservable de otra empresa';
  end if;
end $$;
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000001',true);

-- Memoria de cliente: datos reutilizables aislados por tenant y vinculados
-- mediante claves foráneas compuestas al contacto correcto.
insert into app.contact_assets
  (id,tenant_id,contact_id,asset_type,display_name,attributes,consented_at)
values
  ('0194f100-0000-7000-8000-000000000171','0194f000-0000-7000-8000-000000000001',
   '0194f002-0000-7000-8000-000000000001','vehicle','Moto de prueba',
   '{"kind":"motorcycle","plate":"TEST123"}',now());
do $$ begin
  if not exists(select 1 from app.contact_assets where id='0194f100-0000-7000-8000-000000000171') then
    raise exception 'No se guardó el objeto recordado del cliente';
  end if;
end $$;
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from app.contact_assets where id='0194f100-0000-7000-8000-000000000171') then
    raise exception 'RLS expuso memoria de cliente a otra empresa';
  end if;
end $$;
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000001',true);

-- Requisitos operativos configurables (D-039): aislamiento por tenant sobre
-- los datos ya sembrados por la migración 056 (sin insertar filas nuevas
-- para este bloque de aislamiento, reutilizando el backfill real).
do $$
begin
  if not exists(
    select 1 from app.operational_requirements
    where tenant_id='0194f000-0000-7000-8000-000000000001' and field_key='name'
  ) then raise exception 'El backfill de requisitos no sembró el nombre para el tenant restaurante'; end if;
end
$$;
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);
do $$
begin
  if exists(
    select 1 from app.operational_requirements where tenant_id='0194f000-0000-7000-8000-000000000001'
  ) then raise exception 'RLS expuso requisitos operativos de otra empresa'; end if;
end
$$;
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000001',true);

-- FK compuesta: un catalog_item_id de otra empresa debe ser rechazado aunque
-- tenant_id sea el propio. RLS solo deja leer el id ajeno bajo el contexto de
-- esa empresa, así que se captura antes de volver al contexto del tenant que
-- intenta el insert cruzado.
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);
do $$
declare foreign_item_id uuid;
begin
  select id into foreign_item_id from app.catalog_items
    where tenant_id='0194f000-0000-7000-8000-000000000002' limit 1;
  perform set_config('app.tenant_id','0194f000-0000-7000-8000-000000000001',true);
  begin
    insert into app.operational_requirements
      (id,tenant_id,operation_type,fulfillment_type,catalog_item_id,field_key,data_type)
    values
      ('0194f100-0000-7000-8000-000000000190','0194f000-0000-7000-8000-000000000001',
       'order','delivery',foreign_item_id,'test_cross_tenant_field','text');
    raise exception 'La FK compuesta permitió un catalog_item_id de otra empresa';
  exception
    when foreign_key_violation then null;
  end;
end
$$;
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000001',true);

-- Índices únicos parciales: dos requisitos globales (catalog_item_id nulo)
-- con la misma clave chocan; el mismo field_key vuelve a ser válido cuando
-- se ata a una oferta específica (catalog_item_id no nulo).
do $$
declare own_item_id uuid;
begin
  select id into own_item_id from app.catalog_items
    where tenant_id='0194f000-0000-7000-8000-000000000001' limit 1;
  insert into app.operational_requirements
    (id,tenant_id,operation_type,fulfillment_type,field_key,data_type)
  values
    ('0194f100-0000-7000-8000-000000000191','0194f000-0000-7000-8000-000000000001',
     'order','pickup','test_unique_field','text');
  begin
    insert into app.operational_requirements
      (id,tenant_id,operation_type,fulfillment_type,field_key,data_type)
    values
      ('0194f100-0000-7000-8000-000000000192','0194f000-0000-7000-8000-000000000001',
       'order','pickup','test_unique_field','text');
    raise exception 'El índice único global permitió un requisito duplicado';
  exception
    when unique_violation then null;
  end;
  insert into app.operational_requirements
    (id,tenant_id,operation_type,fulfillment_type,catalog_item_id,field_key,data_type)
  values
    ('0194f100-0000-7000-8000-000000000193','0194f000-0000-7000-8000-000000000001',
     'order','pickup',own_item_id,'test_unique_field','text');
  if not exists(
    select 1 from app.operational_requirements where id='0194f100-0000-7000-8000-000000000193'
  ) then raise exception 'Un requisito atado a una oferta específica no debería chocar con el requisito global'; end if;
end
$$;

select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000001',true);

rollback;

\echo 'OK: isolation, integrity, idempotency, outbox, and roles verified.'
