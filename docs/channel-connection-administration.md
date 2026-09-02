# Administración multiempresa de conexiones de WhatsApp

## Quién puede administrar

- **Administrador de plataforma:** opera conexiones de cualquier tenant para
  soporte, siempre con tenant objetivo explícito y auditoría.
- **Owner o admin del tenant:** conecta, reconecta o desconecta únicamente los
  canales de su empresa.
- **Operator y viewer:** no pueden modificar conexiones ni referencias de
  secretos.

La identidad del actor proviene del login local y de una sesión válida. Los
endpoints administrativos nunca aceptan un `user_id` enviado por el navegador.

## Dónde vive cada dato

PostgreSQL guarda metadatos operativos en `app.channel_connections`: tenant,
canal, WABA, App ID, estado, expiración, validación y `secret_reference`.
No guarda access tokens.

El secreto real vive en un gestor de secretos bajo una ruta como:

```text
tenants/{tenant_id}/channels/{channel_id}/meta-access-token
```

El backend resuelve esa ruta mediante `SecretProvider`. La implementación
`EnvironmentWhatsAppTokenProvider` queda limitada a una sola cuenta local; será
reemplazada en producción por Vault/KMS/Secret Manager.

## Controles implementados

- RLS forzada sobre `channel_connections`.
- Función fail-closed `can_manage_channel_connections(actor_user_id)`.
- Mutaciones encapsuladas en `register_channel_connection` y
  `disconnect_channel_connection`.
- Sin `INSERT`, `UPDATE` ni `DELETE` directo para `commerce_runtime`.
- Auditoría append-only en la misma transacción.
- Las vistas del servicio no exponen `secret_reference`.
- Login propio con correo y contraseña dentro de la aplicación.
- Contraseñas almacenadas exclusivamente como hashes Argon2id.
- Sesiones opacas revocables mediante cookies `HttpOnly`, `SameSite=Strict` y
  `Secure` en producción. PostgreSQL conserva únicamente el SHA-256 del token.
- Cinco intentos fallidos bloquean temporalmente la credencial durante 15 minutos.

## Endpoints protegidos

```http
GET /v1/admin/tenants/{tenantId}/channel-connections
DELETE /v1/admin/tenants/{tenantId}/channel-connections/{connectionId}
```

Ambos requieren una cookie de sesión válida. La conexión no se expone todavía
por HTTP: será iniciada por Embedded Signup y el callback autenticado almacenará
el secreto antes de registrar los metadatos.

Configuración de la sesión:

```dotenv
SESSION_TTL_HOURS=8
```

Los endpoints son `POST /v1/auth/login`, `GET /v1/auth/me` y
`POST /v1/auth/logout`.

## Experiencia futura del panel

El cliente verá estado, número enmascarado, última validación y acciones de
conectar/reconectar/desconectar. El propietario de plataforma verá lo mismo con
filtros por tenant y trazabilidad. Ningún panel mostrará el token completo.

## Próximos incrementos

1. Cambio y recuperación segura de contraseña.
2. Alta/invitación de usuarios y asignación de roles.
3. Meta Embedded Signup para autorización por el propio cliente.
4. Proveedor de secretos gestionado y rotación.
5. Endpoint de conexión y panel.
6. Monitor de validez, reconexión y revocación.
