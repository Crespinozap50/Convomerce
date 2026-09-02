# Colección Postman local

Importa estos dos archivos en Postman:

1. `whatsapp-commerce-ai.postman_collection.json`
2. `whatsapp-commerce-ai.postman_environment.json`

Selecciona el environment **WhatsApp Commerce AI - Local** antes de ejecutar.

## Preparación

```bash
make infra-up
make db-migrate
make db-seed
cd backend
cp .env.example .env
npm ci
npm run start:dev
```

Después ejecuta primero `1. Operabilidad / Readiness`. Si responde `ready`, puede
usarse el resto de la colección. Postman conserva automáticamente la cookie de
sesión entregada por el login.

## Orden recomendado

1. Liveness y Readiness.
2. `Login administrador demo`.
3. `Mi sesión y roles`.
4. Definir `local_admin_new_password` y cambiar la contraseña temporal.
5. Probar `Listar conexiones del restaurante`.
6. Invitar un usuario ficticio y aceptar la invitación.
7. Confirmar el nuevo miembro con `Listar usuarios del restaurante`.
8. Mensaje entrante ficticio y solicitud de envío asíncrono.
9. Challenge, mensaje firmado y estado `delivered` del webhook.
10. Consultar métricas, probar la firma incorrecta y hacer logout.

`Desconectar conexión` es una operación manual y destructiva. No se incluye en
el recorrido normal; solo debe ejecutarse después de definir conscientemente
`channel_connection_id`.

Los scripts de los webhooks calculan la firma sobre el cuerpo exacto después de
resolver variables. Utilizan el objeto `CryptoJS` incluido en las versiones de
Postman compatibles con esta colección. Todos los IDs, tokens, números y secretos incluidos son
locales y ficticios. El environment exportado no debe modificarse para incluir
credenciales reales ni subirse nuevamente con secretos.
