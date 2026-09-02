-- La función pertenece a commerce_resolver; solo su propietario puede ajustar
-- sus privilegios por defecto.

set role commerce_resolver;
revoke all on function app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid) from public;
grant execute on function app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid) to commerce_runtime;
reset role;
