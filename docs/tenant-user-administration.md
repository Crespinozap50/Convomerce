# Administración de usuarios por empresa

## Flujo disponible

1. Un `platform owner/operator` o `tenant owner/admin` inicia sesión.
2. Crea una invitación para un correo y selecciona un rol.
3. En desarrollo, la API devuelve un token ficticio para pruebas.
4. El invitado acepta el token, define nombre y contraseña.
5. La aplicación crea la cuenta y la membresía activa del tenant.
6. El token queda consumido y no puede reutilizarse.

## Endpoints

```text
GET  /v1/admin/tenants/{tenantId}/users
POST /v1/admin/tenants/{tenantId}/invitations
POST /v1/auth/invitations/accept
PATCH  /v1/admin/tenants/{tenantId}/users/{membershipId}
DELETE /v1/admin/tenants/{tenantId}/invitations/{invitationId}
```

Ejemplo de invitación:

```json
{
  "email": "usuario@example.test",
  "role": "operator"
}
```

Ejemplo de aceptación:

```json
{
  "token": "token-recibido",
  "displayName": "Usuario Demo",
  "password": "contraseña-de-desarrollo"
}
```

## Seguridad

- La tabla de invitaciones tiene RLS forzada.
- El runtime no puede leer tokens ni invitaciones directamente.
- Solo se almacena SHA-256 del token; el valor original no se guarda.
- Las invitaciones vencen después de 72 horas.
- Solo existe una invitación pendiente por correo y tenant.
- Los cambios generan eventos de auditoría.
- El runtime no tiene escritura directa sobre `tenant_users`; cambios de rol o
  estado pasan por una función autorizada.
- Deshabilitar una membresía revoca las sesiones activas del usuario.
- El último `owner` activo de una empresa no puede degradarse ni deshabilitarse.
- La aceptación usa una función `SECURITY DEFINER` propiedad de un rol
  `NOLOGIN + BYPASSRLS`, necesaria porque el tenant todavía se desconoce. La
  función tiene una única operación estrecha y el acceso público está revocado.

## Limitación deliberada

En desarrollo se devuelve `invitationToken` para poder verificar el flujo con
Postman. En producción nunca se devuelve: deberá enviarse mediante un proveedor
de correo reemplazable.

La administración base del backend está completa. El siguiente incremento es
la interfaz gráfica de login, selector de empresa y gestión de miembros.
