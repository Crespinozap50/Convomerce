# Autenticación local y roles

## Responsabilidades

La aplicación autentica al usuario con correo y contraseña. PostgreSQL autoriza
las acciones usando las membresías y roles existentes:

1. La autenticación comprueba quién inició sesión.
2. La autorización comprueba qué puede hacer y sobre qué tenant.
3. RLS limita las filas visibles al tenant activo.

## Seguridad de las credenciales

- `app.local_credentials` conserva hashes Argon2id, nunca contraseñas.
- `app.login_attempts` registra resultados para auditoría y bloqueo.
- Después de cinco fallos, la cuenta se bloquea durante 15 minutos.
- El mensaje de error no revela si el correo existe.
- Las tablas anteriores no pueden leerse directamente con `commerce_runtime`.

## Seguridad de las sesiones

Al iniciar sesión se generan 32 bytes aleatorios. El token completo se entrega
solo como cookie `wc_session`; PostgreSQL recibe su hash SHA-256. Una lectura
accidental de la base no permite reutilizar sesiones activas.

La cookie usa `HttpOnly`, `SameSite=Strict`, `Secure` en producción y una
expiración configurable mediante `SESSION_TTL_HOURS` (8 horas por defecto).
`POST /v1/auth/logout` revoca la sesión y elimina la cookie.

Cuando `mustChangePassword` es verdadero, la sesión puede consultar su perfil y
cambiar la contraseña, pero los endpoints administrativos responden `403`.

```text
POST /v1/auth/change-password
{
  "currentPassword": "...",
  "newPassword": "..."
}
```

El cambio verifica nuevamente la contraseña actual, genera un hash Argon2id
nuevo y revoca todas las demás sesiones del usuario. La sesión que realizó el
cambio permanece activa.

## Roles actuales

Plataforma:

- `owner`: administra toda la plataforma.
- `operator`: realiza administración y soporte.

Tenant:

- `owner`: propietario de la empresa.
- `admin`: administra configuración y usuarios.
- `operator`: opera conversaciones.
- `viewer`: acceso de lectura.

Los endpoints de conexiones admiten administradores de plataforma y los roles
`owner` o `admin` del tenant. Siempre requieren también un tenant explícito; sin
él, la autorización falla cerrada.

## Prueba local

El seed incluye identidades ficticias y una contraseña temporal documentada en
`database/seeds/001_demo_tenants.sql`. Ambas identidades tienen
`must_change_password = true`.

```text
POST /v1/auth/login  -> 200 y cookie
GET  /v1/auth/me     -> 200
POST /v1/auth/logout -> 204
GET  /v1/auth/me     -> 401 con la sesión anterior
```

## Pendiente antes de producción

- Recuperación de contraseña con tokens de un solo uso.
- Invitaciones y administración de usuarios.
- Invalidación de todas las sesiones al cambiar contraseña.
- Protección CSRF adicional si frontend y API dejan de ser same-site.
- Limpieza programada de sesiones vencidas e intentos antiguos.
