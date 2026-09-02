# Esquema físico inicial de PostgreSQL

## Estado del diseño

Este documento traduce el modelo conceptual a un esquema físico inicial independiente de ORM. Los archivos de `database/sql/` se ejecutan y prueban localmente contra PostgreSQL 16 mediante Docker Compose.

## Convenciones

- PostgreSQL es la única fuente durable de verdad.
- Tablas y columnas usan `snake_case`; nombres en singular se reservan para conceptos, tablas en plural.
- Las claves principales son `uuid` con valores UUIDv7 generados por NestJS antes del `INSERT`.
- PostgreSQL valida el tipo `uuid`, pero no genera UUIDv7 en el MVP para evitar depender de una extensión o versión concreta.
- Los tiempos usan `timestamptz` y se almacenan en UTC.
- Los importes usan `bigint` en unidades monetarias menores, por ejemplo centavos; nunca `float`.
- Las monedas usan códigos ISO 4217 de tres letras y se normalizan a mayúsculas en la aplicación.
- Los estados usan `text` con restricciones `CHECK`, no enums nativos de PostgreSQL, para permitir migraciones aditivas simples.
- `jsonb` solo se usa para datos variables con una columna de versión o un contrato documentado.
- `created_at` es obligatorio; `updated_at` existe solo en registros mutables y lo actualiza la aplicación.
- Las tablas append-only no incluyen borrado lógico: auditoría, mensajes y resultados se corrigen mediante nuevos registros.

## Esquemas PostgreSQL

- `app`: tablas, funciones de contexto y políticas de la aplicación.
- `public`: no contiene tablas de dominio; se mantiene fuera de `search_path` del rol de ejecución.

Los nombres se califican siempre como `app.nombre_tabla` en migraciones y consultas sensibles.

## Grupos de tablas

### Plataforma e identidad

| Tabla | Propósito | Aislamiento |
|---|---|---|
| `tenants` | Empresas de la plataforma | Global; no usa RLS por tenant |
| `users` | Identidades del panel | Global; acceso solo mediante casos autorizados |
| `tenant_users` | Membresías y roles | `tenant_id` + RLS |

### Canal y contacto

| Tabla | Restricción principal |
|---|---|
| `channels` | Dirección externa única por proveedor |
| `contacts` | Perfil independiente en cada tenant |
| `contact_identities` | Sujeto externo único por tenant y canal |

Las credenciales no se almacenan en `channels`: `secret_reference` apunta a un almacén seguro.

### Conversación

| Tabla | Restricción principal |
|---|---|
| `conversations` | Una activa por tenant, canal y contacto |
| `messages` | Mensaje externo idempotente por tenant y canal |
| `conversation_results` | Un único resultado final vigente por conversación |
| `human_handoffs` | Un handoff activo por conversación |

`messages` es append-only. Estados de entrega que cambian se actualizan de forma controlada; el contenido y origen no se sobrescriben.

### Catálogo y conocimiento

| Tabla | Propósito |
|---|---|
| `catalogs` | Versiones publicables de una oferta |
| `catalog_items` | Productos o servicios |
| `item_variants` | Opciones vendibles o cotizables |
| `modifier_groups` | Grupos configurables, por ejemplo acompañamientos o memoria RAM |
| `modifier_options` | Opciones dentro del grupo |
| `item_modifier_groups` | Grupos aplicables a un ítem o variante |
| `knowledge_entries` | Horarios, cobertura, preguntas y políticas informativas |
| `tenant_policies` | Reglas operativas versionadas |
| `prompt_versions` | Referencias auditables de prompts |

Los modificadores son genéricos. El esquema no contiene conceptos como taco, salsa, computador o memoria; esos valores son datos del tenant.

### Solicitudes comerciales

| Tabla | Propósito |
|---|---|
| `commercial_requests` | Pedido, cotización, reserva u oportunidad |
| `request_lines` | Líneas con precio y descripción congelados |
| `request_line_modifiers` | Opciones elegidas con precio congelado |

Los snapshots preservan lo confirmado aunque el catálogo cambie. `ready` significa preparado para el proceso operativo, no pagado ni aceptado externamente.

### Operación

| Tabla | Propósito |
|---|---|
| `processing_events` | Deduplicación de webhooks y trabajos entrantes |
| `outbox_events` | Efectos asíncronos durables después del commit |
| `processed_events` | Deduplicación de consumidores internos |
| `audit_events` | Auditoría append-only |
| `ai_usage` | Uso, costo estimado y latencia de IA |

## Política obligatoria de `tenant_id`

`tenants` y `users` son las únicas tablas globales del esquema inicial. Todas las demás incluyen `tenant_id uuid not null`.

Cada tabla multiempresa declara:

1. `PRIMARY KEY (id)` o una clave natural compuesta cuando corresponda.
2. `UNIQUE (tenant_id, id)` para ser destino de claves foráneas compuestas.
3. Claves foráneas `(tenant_id, parent_id)` hacia `(tenant_id, id)`.
4. RLS habilitado y forzado.
5. Política que compara `tenant_id` con `app.current_tenant_id()`.

La redundancia deliberada de `tenant_id` permite que PostgreSQL rechace una relación cruzada aunque el código haya cargado un UUID válido de otro tenant.

## Contexto RLS

NestJS abre una transacción y establece el tenant localmente:

```sql
begin;
select set_config('app.tenant_id', '019...', true);
-- consultas y cambios del tenant
commit;
```

El tercer argumento `true` limita el valor a la transacción. El pool nunca debe conservar un tenant entre solicitudes.

`app.current_tenant_id()` devuelve `NULL` si falta el contexto y falla si el valor
no es un UUID válido. Como las políticas comparan mediante igualdad, sin contexto
las lecturas retornan cero filas y las escrituras son rechazadas: el resultado es
un fallo cerrado, no una consulta global accidental.

Las políticas aplican `USING` para lectura/cambio y `WITH CHECK` para inserción/actualización. `FORCE ROW LEVEL SECURITY` evita que el propietario de la tabla omita RLS durante uso ordinario; las migraciones se ejecutan con un rol separado.

## Roles

| Rol | LOGIN | BYPASSRLS | Uso |
|---|---:|---:|---|
| `commerce_owner` | no | no | Dueño estable de esquemas y objetos; no lo usa la aplicación |
| `commerce_migrator` | entorno | no | Ejecuta migraciones controladas mediante membresía en owner |
| `commerce_runtime` | entorno | no | NestJS; solo DML y funciones autorizadas, siempre con contexto tenant |
| `commerce_outbox` | entorno | sí | Publicador técnico; solo `SELECT/UPDATE` de `outbox_events` |
| `commerce_readonly` | entorno | no | Diagnóstico por tenant, sin acceso global |
| `commerce_resolver` | no | sí | Propietario sin LOGIN de una función estrecha para resolver canales |

`commerce_outbox` usa `BYPASSRLS` porque debe reclamar eventos de múltiples tenants. El riesgo se reduce sin otorgarle acceso a otras tablas ni permisos de `INSERT`/`DELETE`. No se reutiliza para n8n, soporte ni tareas administrativas.

`commerce_resolver` también usa `BYPASSRLS`, pero no inicia sesiones. Solo puede
leer las columnas mínimas de `channels` y posee una función `SECURITY DEFINER`
que recibe el `phone_number_id` ya autenticado y devuelve tenant/canal. La función
no está disponible para `PUBLIC` ni para el rol readonly.

Las contraseñas, rotación y creación efectiva de roles pertenecen al
provisionamiento de infraestructura, no a migraciones de aplicación.
`database/sql/000_roles.template.sql` documenta los grants sin credenciales. En
Docker todos estos roles son `NOLOGIN`; el acceso se hace con el usuario interno
del contenedor hasta que exista una aplicación.

## Idempotencia

### Entrada externa

`processing_events` impone unicidad en `(tenant_id, source, external_event_id)`. La primera transacción crea el registro; reintentos encuentran el existente y devuelven el resultado conocido o continúan según su estado.

`messages` añade una restricción parcial para `(tenant_id, channel_id, external_message_id)` cuando el proveedor entrega identificador.

### Consumidores

`processed_events` impone `(tenant_id, consumer_name, event_id)`. El consumidor inserta esa marca en la misma transacción que su efecto. Una violación única significa que el evento ya fue aplicado.

### Outbox

`outbox_events` empieza en `pending`. El publicador reclama lotes mediante `FOR UPDATE SKIP LOCKED`, los marca `publishing` con un lease temporal y publica usando `id` como `jobId` de BullMQ.

Estados: `pending`, `publishing`, `published`, `failed`. Un lease vencido devuelve el evento a procesamiento. `failed` es terminal y requiere revisión o una acción auditada de reprogramación.

La entrega sigue siendo al menos una vez: publicar y marcar `published` no forman una transacción distribuida. La deduplicación del consumidor es obligatoria.

## Auditoría

`audit_events` es append-only y contiene actor, acción, sujeto, correlación y metadatos mínimos. El runtime no recibe `UPDATE` ni `DELETE`. No almacena:

- secretos o tokens;
- cadenas internas de razonamiento del modelo;
- contenido completo cuando basta una referencia;
- datos personales no necesarios para investigar la acción.

El rol runtime recibe `INSERT` y `SELECT` limitado por RLS. Cualquier corrección genera otro evento.

## Índices principales

- Conversaciones activas: único parcial por `(tenant_id, channel_id, contact_id)` cuando `status <> 'closed'`.
- Actividad: `(tenant_id, status, last_activity_at)` para cierre programado y bandejas.
- Mensajes: `(tenant_id, conversation_id, occurred_at, id)` para paginación estable.
- Catálogo vigente: `(tenant_id, status, published_at desc)`.
- Variantes: `(tenant_id, catalog_item_id, status, availability_status)`.
- Solicitudes: `(tenant_id, conversation_id, status, updated_at desc)`.
- Outbox: `(status, available_at, created_at)` parcial para pendientes/reintentos.
- Auditoría y uso IA: `(tenant_id, occurred_at desc)`.

Los índices globales del outbox no exponen datos al rol runtime; solo el publicador técnico los utiliza sin RLS.

## Eliminación y retención

El esquema evita `ON DELETE CASCADE` en historial comercial, mensajes, auditoría y operación. Se usa `RESTRICT` o `NO ACTION` para evitar pérdidas silenciosas.

No se implementa todavía una política universal de borrado lógico. La retención y anonimización requieren una decisión legal y funcional. Los campos `status` desactivan entidades configurables sin borrar historial.

## Decisiones físicas adoptadas

- UUIDv7 generado en aplicación.
- Estados `text` + `CHECK`.
- Importes `bigint` en unidades menores.
- Claves foráneas multiempresa compuestas.
- RLS habilitado y forzado desde la primera migración de tablas tenant.
- Roles separados para owner, migración, runtime, outbox y lectura por tenant.
- Outbox y deduplicación de consumidor desde el esquema inicial.
- Sin particionamiento inicial; se medirá antes de introducirlo.
- Sin acceso directo de n8n a PostgreSQL.

## Decisiones aún abiertas

- Duraciones de retención, anonimización y eliminación.
- Umbrales exactos de reintento y duración del lease outbox.
- Valores predeterminados de inactividad conversacional.
- Moneda predeterminada por tenant y precisión admitida para casos sin unidad menor estándar.
- Método de almacenamiento de multimedia.
- Proveedor de secretos y credenciales.
- Si búsqueda semántica requerirá `pgvector`; no se incluye en el esquema inicial.
