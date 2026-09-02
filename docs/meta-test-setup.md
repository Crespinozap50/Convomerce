# Preparación de la integración de prueba con Meta

La secuencia visual completa está en [meta-app-visual-setup.md](meta-app-visual-setup.md).

El código está preparado, pero permanece en `WHATSAPP_ADAPTER_MODE=fixture` hasta
completar deliberadamente esta lista. No pegues credenciales en Git, Postman,
documentación, issues ni conversaciones.

## Datos que debes obtener en Meta

- App Secret de la aplicación.
- Verify token generado por ti con suficiente entropía.
- Access token con permiso `whatsapp_business_messaging`.
- WABA ID.
- Phone Number ID del número de prueba.
- Número destinatario permitido por el entorno de prueba.
- Versión de Graph API vigente seleccionada para la aplicación.

## URL pública

Meta necesita HTTPS público para llamar al webhook. La ruta que debe publicarse es:

```text
https://TU_HOST/v1/webhooks/whatsapp
```

No se debe exponer PostgreSQL (`54329`), Redis (`56379`) ni el endpoint interno de
métricas. Para una prueba temporal puede usarse un túnel HTTPS confiable; para el
piloto se requiere un host estable.

## Configuración del canal local

El `external_account_id` del canal debe contener el Phone Number ID real y
`secret_reference` una referencia opaca elegida para el token. Nunca se almacena
el access token en `app.channels`.

La actualización se ejecutará con una migración o comando administrativo
controlado cuando conozcamos esos valores; no debe hacerse desde el webhook.

## Variables locales privadas

En `backend/.env`, que está ignorado por Git:

```dotenv
WHATSAPP_ADAPTER_MODE=meta
WHATSAPP_GRAPH_API_VERSION=vNN.N
WHATSAPP_TEST_SECRET_REFERENCE=referencia/que-coincide-con-el-canal
WHATSAPP_ACCESS_TOKEN=valor-obtenido-desde-meta
WHATSAPP_WEBHOOK_VERIFY_TOKEN=valor-generado-por-ti
WHATSAPP_APP_SECRET=valor-obtenido-desde-meta
```

El backend fallará al arrancar si el modo es `meta` y falta alguno. El proveedor
por entorno admite solamente una referencia y una cuenta de prueba. No es la
solución multiempresa definitiva.

## Orden de validación

1. Mantener `fixture` y ejecutar toda la suite automatizada.
2. Publicar únicamente el backend por HTTPS.
3. Registrar callback y verify token en Meta.
4. Confirmar el challenge `GET`.
5. Enviar un mensaje desde el destinatario de prueba y confirmar su persistencia.
6. Activar `meta` y solicitar una respuesta de texto.
7. Confirmar el `wamid` y los estados `sent`, `delivered` y `read`.
8. Revisar métricas, auditoría, outbox y trabajos fallidos.
9. Volver a `fixture` al finalizar si el túnel o token son temporales.

## Criterio de éxito

La prueba termina correctamente cuando un mensaje real entra firmado, se aísla
en el tenant esperado, genera una respuesta por outbox/BullMQ, Meta devuelve un
`wamid` y los estados posteriores actualizan el mismo mensaje sin duplicados.
