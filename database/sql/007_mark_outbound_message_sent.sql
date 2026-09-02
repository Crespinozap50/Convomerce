-- Encapsula la asignación única del wamid después de una llamada al proveedor.
-- El runtime no recibe UPDATE directo sobre external_message_id.

set role commerce_owner;

create function app.mark_outbound_message_sent(
  _message_id uuid,
  _external_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  update app.messages
  set external_message_id = _external_message_id,
      delivery_status = 'sent'
  where tenant_id = app.current_tenant_id()
    and id = _message_id
    and direction = 'outbound'
    and delivery_status = 'queued'
    and external_message_id is null;

  return found;
end
$$;

revoke all on function app.mark_outbound_message_sent(uuid, text) from public;
grant execute on function app.mark_outbound_message_sent(uuid, text) to commerce_runtime;

reset role;
