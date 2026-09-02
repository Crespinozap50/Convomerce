-- 004 creó correctamente la función con commerce_resolver como propietario,
-- pero los grants posteriores debían ejecutarse con ese mismo rol.

set role commerce_resolver;

revoke all on function app.resolve_whatsapp_channel(text) from public;
grant execute on function app.resolve_whatsapp_channel(text) to commerce_runtime;

reset role;
