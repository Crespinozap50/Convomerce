# Ciclo de vida de una conversación

## Definición

Una conversación es una sesión operativa entre un contacto y un tenant a través de un canal. Agrupa mensajes, intención, trabajo humano, solicitudes comerciales y un resultado medible.

No representa toda la relación histórica con el cliente. Un contacto puede tener muchas conversaciones y conservar memoria comercial autorizada entre ellas.

## Principios

- Como máximo existe una conversación activa por combinación de tenant, canal y contacto.
- Un mensaje nunca se mueve silenciosamente de una conversación a otra.
- El estado operativo y el resultado comercial son conceptos distintos.
- Cerrar una conversación no elimina mensajes ni memoria autorizada.
- Una conversación cerrada es inmutable en sus hechos históricos; nueva actividad crea una conversación nueva o una reapertura auditada según las reglas siguientes.
- Los temporizadores se configuran por tenant dentro de límites de plataforma.

## Estados operativos

### `open`

La plataforma está procesando la conversación o puede actuar inmediatamente.

### `waiting_customer`

Se solicitó al cliente información, corrección o confirmación y no hay trabajo automático pendiente.

### `waiting_human`

Existe un escalamiento activo o una acción que requiere intervención del equipo.

### `closed`

La sesión terminó y debe tener un motivo de cierre. Los mensajes entrantes posteriores se evalúan como una nueva sesión.

## Apertura

Un mensaje entrante abre una conversación cuando no existe otra activa para el mismo tenant, canal y contacto.

Al abrirla, NestJS:

1. Resuelve el tenant desde el canal autenticado.
2. Deduplica el evento y registra el mensaje.
3. Busca una conversación activa con bloqueo o restricción que evite duplicados concurrentes.
4. Si no existe, crea una conversación `open` con UUIDv7.
5. Registra un evento outbox para procesar el mensaje después del commit.

Mensajes casi simultáneos deben terminar en la misma conversación activa.

## Continuidad

Un mensaje se incorpora a la conversación activa si esta se encuentra en `open`, `waiting_customer` o `waiting_human`.

- Desde `waiting_customer`, un mensaje entrante vuelve normalmente a `open`.
- Desde `waiting_human`, el mensaje se conserva y notifica al responsable; no devuelve automáticamente el control a la IA.
- Mensajes salientes no abren por sí solos una conversación comercial, salvo que una capacidad futura de campañas lo defina expresamente.

## Cierre

Una conversación pasa a `closed` por una de estas razones:

- `completed`: alcanzó un resultado como consulta resuelta o solicitud lista.
- `human_resolved`: una persona marcó el caso como resuelto.
- `inactive`: superó el periodo de inactividad configurado.
- `customer_ended`: el cliente expresó que terminó y no queda una acción pendiente.
- `cancelled`: la solicitud o atención fue cancelada explícitamente.
- `failed`: un error permanente impidió continuar y quedó registrado para revisión.

El cierre registra `closed_at`, `close_reason`, actor y resultado. Si no existe un resultado comercial adecuado, se crea uno consistente con el motivo, por ejemplo `abandoned` o `failed`.

## Cierre por inactividad

Un trabajo programado identifica conversaciones elegibles usando `last_activity_at` y la política del tenant.

La duración exacta no se fija todavía como regla universal. El piloto debe distinguir al menos:

- Espera normal de una respuesta del cliente.
- Espera de intervención humana, que no debe cerrar con el mismo temporizador.
- Solicitud comercial con vencimiento propio.

Se propone comenzar con un valor configurable y medir reaperturas antes de establecer el valor predeterminado de plataforma.

## Nueva conversación frente a reapertura

Para el MVP, un mensaje recibido después de `closed` crea una conversación nueva y enlaza opcionalmente `previous_conversation_id`.

No se reabre la conversación cerrada porque:

- Preserva métricas y resultados del periodo anterior.
- Evita alterar un pedido o resumen ya confirmado.
- Simplifica auditoría y concurrencia.
- Permite usar memoria histórica sin mezclar sesiones operativas.

Una corrección inmediata causada por un cierre erróneo será una acción administrativa auditada, no el comportamiento normal del bot.

## Resultado conversacional

`conversation_result` se modela como historial append-only. Puede registrar avances, pero solo un resultado se considera final y vigente al cerrar.

Cada registro incluye tipo, fuente, fecha y referencia opcional al resultado anterior. Corregir un resultado crea una nueva versión; no sobrescribe el registro original.

Reglas iniciales:

- `resolved`: consulta atendida sin una solicitud comercial lista.
- `order_ready`: solicitud comercial confirmada y en estado `ready`.
- `qualified_opportunity`: intención válida que necesita seguimiento.
- `human_handoff`: escalamiento solicitado; puede ser provisional hasta la resolución humana.
- `abandoned`: cierre por inactividad sin otro resultado final.
- `failed`: cierre por error permanente.

## Escalamiento humano

Crear un `human_handoff` lleva la conversación a `waiting_human`.

- La IA deja de ejecutar respuestas automáticas ordinarias.
- Los mensajes nuevos se adjuntan a la conversación y notifican al equipo.
- Una persona puede responder, devolver el control a `open` o cerrar el caso.
- Resolver el handoff no cierra automáticamente la conversación si queda una acción comercial pendiente.
- Toda transferencia de control registra actor, motivo y momento.

## Solicitud comercial

Una conversación puede tener una o más solicitudes a lo largo del tiempo, pero solo una solicitud editable activa por tipo en el MVP.

- `draft` o `awaiting_confirmation` mantiene la conversación activa.
- `ready` permite cerrar con resultado `order_ready` si no quedan acciones pendientes.
- `cancelled` no obliga a cerrar si el cliente desea iniciar otra solicitud.
- El vencimiento de la solicitud y el cierre por inactividad son eventos relacionados pero independientes.

## Memoria

La memoria se divide para evitar enviar todo el historial al modelo:

- **Memoria de sesión:** mensajes, resumen e intención de la conversación activa.
- **Memoria comercial:** preferencias o hechos autorizados asociados al contacto y tenant.
- **Historial auditable:** mensajes completos sujetos a la política de retención.

Al cerrar, se puede generar un resumen estructurado. Solo los datos necesarios, consentidos y vigentes pasan a memoria comercial. El resumen no reemplaza el historial ni se comparte entre tenants.

## Actividad y temporizadores

`last_message_at` registra el último mensaje. `last_activity_at` incluye además acciones relevantes como confirmación, respuesta humana o cambio de solicitud.

Los trabajos de cierre deben:

- Ejecutarse de manera idempotente.
- Bloquear o comprobar versión antes de cerrar.
- No cerrar si apareció actividad después de seleccionar el registro.
- Crear resultado y evento outbox en la misma transacción.
- Respetar políticas distintas para `waiting_customer` y `waiting_human`.

## Concurrencia

PostgreSQL debe impedir dos conversaciones activas para la misma combinación de tenant, canal y contacto, mediante una restricción o índice único parcial.

Las transiciones usan control de versión o bloqueo de fila. Un mensaje, cierre programado y respuesta humana concurrentes deben producir un estado determinista y auditable.

## Métricas derivadas

- Tiempo desde apertura hasta primera respuesta.
- Tiempo activo, tiempo esperando al cliente y tiempo esperando a una persona.
- Cantidad de transiciones y escalamientos.
- Resultado final y correcciones posteriores.
- Conversaciones nuevas de un contacto y retorno después de cierre.
- Porcentaje de cierres por inactividad.
- Solicitudes listas por conversación.

## Escenarios de aceptación

### Mensajes simultáneos

Dos mensajes entrantes concurrentes del mismo contacto y canal se registran una vez y pertenecen a una sola conversación activa.

### Respuesta después de una pregunta

Una conversación `waiting_customer` recibe la respuesta, pasa a `open` y continúa sin perder la solicitud en preparación.

### Cliente durante escalamiento

Una conversación `waiting_human` recibe otro mensaje; se conserva y notifica, pero la IA no recupera el control automáticamente.

### Inactividad concurrente

Si llega un mensaje mientras se ejecuta el cierre programado, el sistema no pierde el mensaje ni deja una conversación nueva innecesaria.

### Actividad posterior al cierre

Un mensaje posterior crea una conversación nueva vinculada a la anterior y puede consultar memoria comercial autorizada, sin modificar el resultado final previo.

### Separación entre tenants

La existencia de una conversación activa para un contacto en un tenant no afecta sus conversaciones en otro tenant.

## Decisiones pendientes

- Duración inicial del temporizador de inactividad por estado.
- Periodo permitido para una corrección administrativa de cierre.
- Reglas exactas para conversaciones iniciadas por el comercio en funcionalidades futuras.
- Contenido y retención de resúmenes de sesión.
