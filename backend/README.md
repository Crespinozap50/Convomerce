# Backend NestJS

Primer corte vertical del núcleo transaccional. Recibe un mensaje ficticio de
desarrollo, establece el tenant dentro de una transacción PostgreSQL, deduplica
el evento, crea o reutiliza la conversación activa, guarda el mensaje y registra
su evento outbox. Un publicador independiente entrega posteriormente el evento
a BullMQ.

Incluye conexión de prueba con WhatsApp Cloud API, autenticación local de
usuarios y redacción opcional con OpenAI detrás de controles de seguridad,
presupuesto y rollout por tenant. Todavía no incluye flujos productivos de n8n.

La evaluación bilingüe de comprensión se ejecuta desde la raíz con:

```bash
make backend-eval
```

## Inicio local

Desde la raíz:

```bash
make infra-up
make db-migrate
make db-seed
cd backend
cp .env.example .env
npm ci
npm run start:dev
```

El endpoint de prueba solo se habilita fuera de producción:

```http
POST /v1/dev/inbound-messages
Content-Type: application/json

{
  "tenantId": "0194f000-0000-7000-8000-000000000001",
  "channelId": "0194f001-0000-7000-8000-000000000001",
  "contactId": "0194f002-0000-7000-8000-000000000001",
  "externalEventId": "demo-event-1",
  "externalMessageId": "demo-message-1",
  "text": "Quiero conocer el producto de demostración"
}
```

`tenantId` se acepta únicamente porque esta ruta es un arnés local. El webhook
real deberá resolver el tenant desde un canal cuya autenticidad haya sido
verificada; nunca confiará en un tenant suministrado por el cliente.

## Webhook de WhatsApp

La ruta `GET /v1/webhooks/whatsapp` implementa el challenge de suscripción. La
ruta `POST` exige `X-Hub-Signature-256`, calculada sobre los bytes exactos del
cuerpo con `WHATSAPP_APP_SECRET`, antes de consultar PostgreSQL.

Después de autenticar el payload:

1. Usa `metadata.phone_number_id` para resolver un único canal activo.
2. Obtiene el tenant mediante una función PostgreSQL de superficie mínima.
3. Crea o reutiliza el contacto por la identidad externa `wa_id`.
4. Traduce mensajes de texto al comando interno ya probado.
5. Responde `200` incluso en reentregas válidas ya procesadas.

Por ahora los mensajes no textuales y los tipos de evento no reconocidos se
aceptan sin producir efectos. Esto evita interpretar parcialmente contratos que
todavía no se han implementado. Los valores del `.env.example` son exclusivamente
ficticios.

### Estados de entrega

Los objetos `statuses` actualizan mensajes salientes por `external_message_id`.
La máquina de estados admite avance y evita retrocesos:

```text
sent ──▶ delivered ──▶ read
  └────────▶ failed
```

Un evento puede saltar hacia adelante, pero `read → delivered` y
`delivered → failed` se consideran atrasados y no cambian la fila. Cada aviso se
deduplica mediante mensaje, estado y timestamp. Los cambios efectivos generan
`message.delivery_status_changed` en auditoría; de un error solo se conserva su
código estable.

`POST /v1/dev/outbound-messages` crea mensajes salientes ficticios ya marcados
como `sent`. La ruta desaparece en producción y nunca llama a Meta.

### Solicitud de envío asíncrona

`POST /v1/dev/outbound-messages/send-requests` demuestra el recorrido que usará
el envío real:

```text
mensaje queued + outbox
        ↓ commit
      BullMQ
        ↓
adaptador reemplazable
        ↓
wamid + sent + processed_event + auditoría
```

La llamada al adaptador ocurre después de cerrar la transacción de preparación y
antes de abrir la transacción de confirmación. El adaptador fixture genera un
`wamid.fixture.*` determinístico a partir del UUID del evento y no usa red.

La entrega sigue siendo al menos una vez. El fixture tolera reintentos mediante
su clave idempotente; antes de conectar Meta debe definirse cómo reconciliar una
respuesta aceptada si el proceso cae antes de guardar el `wamid`.

### Respuestas automáticas basadas en datos

Cuando el bot del tenant está habilitado, `message.received` clasifica de forma
determinística consultas sobre saludo, menú, precio, horario, domicilio, pagos,
opciones vegetarianas, picante, alérgenos, recogida y tiempo de preparación.
Los textos se construyen desde `business_profiles`, `catalog_items`,
`item_variants` y `knowledge_entries`, siempre dentro de la transacción RLS del
tenant. La respuesta guarda en `content` la intención y las referencias usadas;
si no existe un dato, utiliza el fallback configurado y no inventa información.

Las palabras de transferencia cambian la conversación a manejo humano. Este
motor es la base verificable: una integración futura de IA podrá mejorar la
comprensión, pero los precios y condiciones seguirán viniendo de PostgreSQL.

### Bandeja de conversaciones

Las rutas protegidas bajo `GET /v1/admin/tenants/:tenantId/conversations`
permiten listar conversaciones y consultar su historial. Propietarios,
administradores y operadores pueden tomar una conversación, devolverla al bot,
cerrarla y responder manualmente. Los perfiles `viewer` conservan acceso de
solo lectura. Una respuesta manual crea `message.send_requested` mediante el
mismo transactional outbox; nunca llama a Meta dentro de la transacción HTTP.

### Adaptador Meta preparado

`WHATSAPP_ADAPTER_MODE=fixture` sigue siendo el valor predeterminado. El modo
`meta` implementa el contrato de texto de Cloud API, pero el arranque lo rechaza
si faltan versión, referencia de secreto o access token.

El consumidor obtiene `phone_number_id`, destinatario `wa_id` y
`secret_reference` mediante relaciones protegidas por RLS. El endpoint de
desarrollo no puede suministrarlos ni sustituirlos. Para el primer número de
prueba, el proveedor local solo entrega el token cuando la referencia del canal
coincide exactamente con `WHATSAPP_TEST_SECRET_REFERENCE`.

Este proveedor por variables de entorno es una transición para una sola cuenta
de prueba. Antes de múltiples tenants debe reemplazarse por un almacén de secretos
que resuelva cada referencia sin cargar todos los tokens en el proceso.

## Pruebas

```bash
npm test
npm run test:integration
```

Las pruebas de integración requieren PostgreSQL migrado y Redis saludables. Cada
caso usa identificadores ficticios y revierte o limpia únicamente sus propios
registros.

## Configuración y arranque seguro

El arranque falla inmediatamente si falta o es inválida una variable obligatoria.
Se validan URL PostgreSQL, puertos, enteros, booleanos, entorno y longitud mínima
de los secretos del webhook. En producción también se rechazan valores que
contengan `fixture`.

`.env.example` contiene únicamente valores locales conocidos. Copiarlo crea un
archivo ignorado por Git; no debe convertirse en fuente de secretos compartidos.

## Salud y observabilidad

- `GET /health/live`: confirma que el proceso HTTP está vivo. No consulta
  dependencias y puede continuar respondiendo durante una caída de PostgreSQL.
- `GET /health/ready`: comprueba PostgreSQL y Redis reales, además del estado del
  publicador outbox y worker cuando están habilitados. Devuelve `503` si una
  dependencia requerida no está disponible.

Cada respuesta incluye `x-correlation-id`. Un UUID válido recibido en ese header
se conserva; cualquier otro valor se reemplaza por UUIDv7. Los errores tienen un
contrato estable con `statusCode`, `code`, `message` y `correlationId`.

Los logs estructurados incluyen método, ruta sin query string, resultado,
duración y correlación. No incluyen cuerpos, tokens, firmas, secretos ni query
parameters; esto es especialmente importante porque el challenge de Meta lleva
el verify token en la URL.

### Métricas internas

`GET /internal/metrics` expone Prometheus y `/internal/metrics/status` ofrece una
vista breve de valores frente a umbrales. Ambas rutas exigen
`METRICS_BEARER_TOKEN`; nunca se registran el header ni su valor.

Las métricas incluyen backlog y leases outbox, trabajos BullMQ fallidos, latencia
HTTP y webhooks aceptados/rechazados. Consulta
[`observability/README.md`](observability/README.md) para nombres, umbrales y reglas
de alerta propuestas.

## Módulos actuales

- `database`: administra el pool y delimita transacciones con roles y contexto
  RLS locales. El `SET LOCAL` evita filtrar tenant o privilegios entre conexiones.
- `inbound-messages`: aplica idempotencia de entrada, reutiliza o crea la
  conversación activa, persiste el mensaje y genera el outbox en un solo commit.
- `outbox`: reclama eventos mediante `FOR UPDATE SKIP LOCKED`, establece un lease,
  crea un trabajo BullMQ usando el UUID del evento como `jobId` y registra la
  publicación. Si Redis falla, libera el evento para reintento.
- `commerce-events`: ejecuta workers BullMQ. El consumidor `message-received-v1`
  registra su deduplicación y un efecto observable en `audit_events` dentro de la
  misma transacción tenant.
- `whatsapp-webhook`: autentica el cuerpo crudo, traduce el payload externo y
  resuelve el tenant desde el canal; nunca acepta `tenant_id` desde Meta.
- `delivery-statuses`: aplica la máquina de estados, deduplicación y auditoría.
- `outbound-messages`: arnés local para crear una salida ficticia verificable.
- `auth`: login propio, verificación Argon2id y sesiones opacas revocables por
  cookie. Los roles se resuelven en PostgreSQL y no desde datos del navegador.
- `channel-connections`: administración protegida de conexiones por rol de
  plataforma o por membresía `owner/admin` del tenant.

La autenticación local y sus endpoints están explicados en
[`../docs/local-authentication.md`](../docs/local-authentication.md).

La entrega entre PostgreSQL y Redis es **al menos una vez**. Marcar `published` no
convierte ambos sistemas en una transacción distribuida; por eso todo consumidor
debe usar `processed_events` antes de aplicar efectos.

El worker reintenta fallos transitorios hasta cinco veces con espera exponencial.
Eventos incompletos o de tipo desconocido son no recuperables y no se reintentan
indefinidamente. En un apagado normal NestJS espera el cierre del worker.
