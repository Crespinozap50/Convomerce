-- Resuelve el tenant desde el identificador del número receptor autenticado por
-- la firma de Meta. No acepta tenant_id ni expone configuración o secretos.

set role commerce_owner;

grant usage, create on schema app to commerce_resolver;
grant select (tenant_id, id, provider, external_account_id, status)
  on app.channels to commerce_resolver;

reset role;
set role commerce_resolver;

create function app.resolve_whatsapp_channel(_phone_number_id text)
returns table (tenant_id uuid, channel_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select channel.tenant_id, channel.id
  from app.channels as channel
  where channel.provider = 'whatsapp_cloud'
    and channel.external_account_id = _phone_number_id
    and channel.status = 'active'
$$;

reset role;
set role commerce_owner;

revoke create on schema app from commerce_resolver;
revoke all on function app.resolve_whatsapp_channel(text) from public;
grant execute on function app.resolve_whatsapp_channel(text) to commerce_runtime;

reset role;
