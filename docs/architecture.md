# Arquitectura inicial

## Componentes previstos

- **WhatsApp Cloud API:** entrada y salida de mensajes.
- **n8n:** orquestación de webhooks, reglas e integraciones.
- **OpenAI:** interpretación y generación controlada de respuestas.
- **PostgreSQL:** fuente de verdad para tenants, contactos, conversaciones, mensajes, configuración y auditoría.
- **NestJS sobre Node.js y TypeScript:** API principal organizada inicialmente como monolito modular.
- **Redis y BullMQ:** colas, reintentos y trabajo asíncrono cuando el flujo lo requiera.
- **Next.js:** panel web posterior, fuera del primer incremento del MVP.

## Incremento ejecutable actual

El primer corte vertical ya está implementado sin servicios externos reales:

1. Una ruta exclusiva de desarrollo recibe identificadores ficticios.
2. NestJS abre una transacción, adopta `commerce_runtime` y establece
   `app.tenant_id` localmente.
3. Deduplica el evento, reutiliza o crea la conversación activa y guarda el
   mensaje.
4. Inserta `message.received` en el outbox dentro de la misma transacción.
5. Después del commit, un publicador con el rol `commerce_outbox` reclama el
   evento y crea el trabajo BullMQ en Redis.
6. El consumidor abre otra transacción tenant, reclama el evento en
   `processed_events` y registra `message.processed` en auditoría.

La marca de deduplicación y el efecto se confirman juntos. Si el efecto falla,
ambos se revierten y BullMQ puede reintentar. Si el trabajo se entrega otra vez,
la restricción única del consumidor evita repetir el efecto.

La prueba de integración verifica el recorrido contra PostgreSQL y Redis reales,
incluyendo consumo después de iniciar un worker nuevo, reentrega, rollback y RLS.
La ruta no representa todavía el contrato ni la seguridad del webhook de Meta.

La frontera HTTP de WhatsApp ya está implementada con fixtures: verifica el
challenge, conserva el cuerpo crudo, valida HMAC-SHA256 con comparación de tiempo
constante y solo entonces resuelve el tenant desde `metadata.phone_number_id`.
La unicidad global del identificador receptor impide una resolución ambigua. Aún
no existe conexión con una cuenta real ni manejo completo de tipos multimedia.

Los eventos de estado de entrega ya se procesan idempotentemente. El canal receptor
determina el tenant y RLS impide que un `wamid` existente en otra empresa sea
actualizado. Solo se modifica `delivery_status`; los avances generan auditoría y
los estados repetidos o atrasados no producen efectos adicionales.

El envío ficticio también recorre outbox y BullMQ. Persiste primero un mensaje
`queued`; después del commit invoca un adaptador inyectable y confirma el
identificador externo mediante una función PostgreSQL de asignación única. Ninguna
transacción queda abierta durante la llamada al proveedor.

Existe un adaptador Meta desactivado por defecto. Construye la solicitud Cloud API
solo con número emisor, destinatario e identidad de secreto obtenidos desde datos
tenant protegidos; nunca desde el request que solicita el envío. El selector por
configuración permite probar el fixture y activar Meta sin cambiar el consumidor.

## Operabilidad del backend

NestJS valida toda configuración antes de construir servicios. Liveness mide el
proceso; readiness comprueba PostgreSQL, Redis y los procesos asíncronos
habilitados. Esta separación evita reiniciar un proceso sano solo porque una
dependencia esté temporalmente caída y evita recibir tráfico cuando no puede
procesarlo de forma segura.

La correlación HTTP usa UUID y se devuelve al llamador. Los logs son estructurados
y deliberadamente excluyen cuerpos y query strings para no filtrar mensajes,
firmas o el token de verificación del webhook.

Las métricas internas usan un token propio y etiquetas de cardinalidad acotada.
El snapshot combina gauges consultados en PostgreSQL/BullMQ con contadores e
histogramas del proceso. Las reglas de alerta iniciales se versionan sin imponer
todavía un proveedor de monitoreo o notificaciones.

## Flujo conceptual

1. WhatsApp entrega un evento al webhook.
2. El número receptor se resuelve a un tenant activo.
3. Se carga configuración y contexto usando `tenant_id`.
4. Un provider produce `ConversationUnderstanding` sin autorizar efectos.
5. `ConversationDecisionEngine` selecciona una capacidad y ejecuta validaciones de dominio.
6. `LocalizedResponseComposer` aplica idioma, plantillas y límites del canal.
7. La respuesta o escalamiento se registra y se envía por WhatsApp.

Los contratos actuales se detallan en [conversation-understanding.md](conversation-understanding.md), [conversation-decision-engine.md](conversation-decision-engine.md) y [response-composition.md](response-composition.md).

NestJS recibe y autentica el webhook, conserva el estado y aplica las reglas de dominio. n8n se limita a automatizaciones e integraciones mediante contratos internos. El límite completo está definido en [nestjs-n8n-boundary.md](nestjs-n8n-boundary.md).

## Multiempresa

- `tenant_id` será obligatorio en toda entidad de dominio que pertenezca a un comercio.
- Las consultas y operaciones deben aplicar el contexto del tenant en servidor, nunca confiar solo en un valor enviado por el cliente.
- Credenciales, prompts, políticas, catálogos y límites serán configurables por tenant.
- PostgreSQL aplica Row-Level Security desde la primera migración como defensa adicional a los filtros de NestJS.
- La aplicación usa un rol limitado por RLS; los roles administrativos y de migración permanecen separados.

El diseño de entidades y relaciones se detalla en [data-model.md](data-model.md).
La apertura, continuidad, escalamiento y cierre de sesiones se define en [conversation-lifecycle.md](conversation-lifecycle.md).

## Despliegue y costo

Para el MVP se favorece un despliegue pequeño y compartido, con procesos y base de datos dimensionados al volumen inicial. El objetivo menor a USD 30 debe validarse incluyendo alojamiento, base de datos, respaldos, n8n, consumo de modelos y costos variables de Meta.

## Decisiones pendientes

- Topología de despliegue y proveedor.
- Colas, reintentos e idempotencia.
- Estrategia de memoria conversacional, búsqueda y versionado de prompts.
- Cifrado, retención, borrado y respaldo de datos.
