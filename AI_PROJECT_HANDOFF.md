# WhatsApp Commerce AI — traspaso técnico integral para continuidad con IA

> Documento maestro de contexto, arquitectura, estado y continuidad.
>
> **Actualizado:** 2026-08-30  
> **Repositorio local:** `/Users/carlosespinoza/Sites/Personal/whatsapp-commerce-ai`  
> **Estado de Git:** repositorio inicializado, con trabajo local sin consolidar; por decisión del propietario no se deben crear commits ni configurar un remoto hasta recibir autorización explícita.  
> **Audiencia:** desarrolladores y agentes de IA que deban continuar el proyecto sin reconstruir su contexto desde cero.

## 1. Resumen ejecutivo

WhatsApp Commerce AI es una plataforma SaaS multiempresa para automatizar conversaciones comerciales por WhatsApp. El sistema combina respuestas determinísticas, conocimiento del negocio, flujos transaccionales e IA generativa opcional para conseguir conversaciones naturales sin entregar a un modelo de lenguaje el control del estado comercial.

El primer tenant de validación es **Santos Tacos**. Existen además datos de demostración para tecnología y escenarios de otras industrias. Santos Tacos es un caso de uso y una configuración: **no debe convertirse en lógica del núcleo**.

La arquitectura actual está formada por:

- un backend en Node.js, TypeScript y NestJS como monolito modular;
- PostgreSQL como fuente durable de verdad, con aislamiento por `tenant_id` y Row-Level Security;
- Redis y BullMQ para procesamiento asíncrono;
- transactional outbox para no perder trabajos después de confirmar transacciones;
- WhatsApp Cloud API como canal real y un adaptador fixture para desarrollo;
- OpenAI como capa opcional de mejora de redacción y evaluación, limitada por presupuesto;
- React, TypeScript y Vite para el panel administrativo;
- n8n reservado para integraciones y automatizaciones reemplazables, no para reglas críticas;
- Google Calendar como integración opcional para agendas.

El objetivo funcional prioritario es que el motor converse de forma natural, conserve contexto, convierta conversaciones en pedidos o reservas y permita intervención humana. El objetivo de arquitectura es que estas capacidades funcionen para restaurantes, comercios, spas, lavaderos y otros negocios por medio de configuración, no mediante ramas específicas por industria.

## 2. Reglas de oro

Toda continuación debe respetar estas reglas:

1. **El motor se modela por capacidades, no por industrias.** No agregar condiciones como `if restaurant`, `if spa` o `if Santos Tacos`.
2. **Todo dato de negocio pertenece a un tenant.** Las tablas de negocio deben incluir `tenant_id`; las relaciones deben impedir referencias entre tenants.
3. **La base de datos aplica el aislamiento.** No confiar únicamente en filtros de aplicación: preservar RLS y el contexto de tenant.
4. **PostgreSQL es la fuente de verdad.** Redis, BullMQ, n8n y proveedores externos son componentes derivados o de transporte.
5. **El backend posee el dominio crítico.** Estado conversacional, pedidos, reservas, disponibilidad, idempotencia, autorización y auditoría no se delegan a n8n.
6. **La IA no inventa ni ejecuta acciones.** Recibe hechos y una respuesta base; puede mejorar redacción dentro de límites. Las decisiones y mutaciones siguen siendo determinísticas.
7. **No hay aprendizaje automático sin aprobación.** Las mejoras reutilizables propuestas por IA pasan por revisión humana antes de convertirse en variantes aprobadas.
8. **El código, identificadores y mensajes internos están en inglés.** Los textos visibles se sirven desde catálogos de idioma o datos localizados.
9. **Las acciones sensibles requieren confirmación.** Crear/cancelar pedidos o reservas y otros cambios materiales deben tener un punto inequívoco de confirmación.
10. **No mantener transacciones abiertas durante llamadas externas.** Usar reservas, estados intermedios, outbox e idempotencia.
11. **No editar migraciones ya aplicadas.** Cualquier cambio del esquema se implementa en una migración nueva y verificable.
12. **El propietario mantendrá el código.** Priorizar nombres explícitos, módulos pequeños, contratos estables, pruebas y documentación antes que abstracciones opacas.

## 3. Propuesta de valor y diferenciadores

La plataforma no busca ser solamente un bot de preguntas frecuentes. Convierte conversaciones en resultados comerciales trazables:

- prepara y confirma pedidos o reservas;
- entiende lenguaje natural sin convertir cada mensaje en una llamada costosa a IA;
- recomienda complementos configurados para aumentar el ticket promedio;
- conserva memoria útil y estado de la operación;
- entrega el caso a un humano con contexto cuando la automatización no debe continuar;
- muestra en el panel cómo se produjo cada respuesta: reglas, reutilización aprobada o IA;
- controla consumo, latencia y costo por tenant;
- aprende únicamente mediante un circuito humano de propuesta, revisión y aprobación;
- separa los hechos confiables del negocio de la presentación lingüística;
- permite incorporar nuevas industrias configurando ofertas, capacidades, recursos y requisitos.

La meta económica original del MVP es operar por debajo de USD 30 mensuales. Es una meta, no una garantía: debe validarse con tráfico, retención, proveedor de infraestructura, uso real de OpenAI y costos de observabilidad.

## 4. Alcance actual

### 4.1 Implementado

- Esquema físico PostgreSQL versionado mediante 55 migraciones.
- UUIDv7, claves foráneas multiempresa, roles separados y RLS.
- Autenticación local con sesiones opacas HttpOnly y Argon2id.
- Administración de tenants, usuarios, membresías y roles.
- Configuración de conexiones de canal y del bot.
- Webhook de WhatsApp, verificación, validación de firma e idempotencia.
- Ingesta de mensajes, conversaciones, lectura/no lectura e intervención humana.
- Transactional outbox, BullMQ, reintentos y estados de entrega.
- Adaptador WhatsApp fixture y adaptador Meta.
- Contrato estable de comprensión conversacional y proveedor determinístico.
- Puerta central de decisiones conversacionales.
- Flujos de pedidos y reservas/citas.
- Catálogos, variantes, precios, disponibilidad y solicitudes comerciales.
- Capacidades por tenant y enrutamiento basado en capacidades.
- Recursos, horarios, excepciones, disponibilidad, holds y citas.
- Base de conocimiento, preguntas no resueltas y circuito de revisión.
- Recomendaciones determinísticas y medibles.
- Composición de respuestas localizada.
- Mejora opcional con OpenAI, presupuestos por tenant y métricas de uso.
- Biblioteca de variantes de respuesta revisadas y aprobadas.
- Persistencia y cambio controlado del idioma de la conversación.
- Perfiles de negocio localizados.
- Panel administrativo bilingüe con conversaciones, pedidos/reservas, conocimiento, configuración, equipo y conexiones.
- Datos de demostración y conversaciones de prueba preservadas para inspección visual.

### 4.2 Parcial o pendiente

- Los requisitos operativos todavía están centrados en nombre, teléfono y dirección; falta un modelo administrable de campos tipados por operación.
- Catálogos, variantes y entradas de conocimiento requieren localizaciones administrables equivalentes a las del perfil del negocio.
- Un mensaje con múltiples entidades debe poder completar varios campos de manera segura.
- El frontend funciona, pero `frontend/src/App.tsx` concentra demasiado código y debe modularizarse sin cambiar comportamiento.
- n8n aún no contiene flujos operativos; solo se definió su frontera arquitectónica.
- El token real de WhatsApp utilizado en pruebas recientes expiró o quedó inválido. La persistencia local funciona, pero Meta no enviará hasta renovar la credencial.
- Falta estrategia definitiva de despliegue, backups, secretos, métricas externas y alertas.
- Falta una matriz completa de aceptación multiindustria ejecutable.
- Las pruebas de costos y carga todavía son de MVP/local, no de producción.

## 5. Arquitectura de alto nivel

```text
Cliente de WhatsApp
        |
        v
WhatsApp Cloud API
        |
        v
Webhook NestJS --> validación de firma e idempotencia
        |
        v
PostgreSQL: mensaje + conversación + evento outbox (una transacción)
        |
        v
Outbox publisher --> BullMQ / Redis --> commerce worker
                                        |
                                        v
                              motor conversacional
                    idioma -> comprensión -> decisión
                    -> flujo de dominio -> respuesta base
                                        |
                         variante aprobada disponible?
                           /                     \
                         sí                       no
                         |                        |
                    reutilizar            OpenAI elegible?
                                             /       \
                                           sí         no
                                           |          |
                                      reescritura   respuesta base
                                           \          /
                                            v        v
                                   mensaje saliente + outbox
                                             |
                                             v
                                     adaptador WhatsApp
                                      fixture o Meta
```

El panel React consume exclusivamente la API NestJS. No accede directamente a PostgreSQL, Redis, Meta ni OpenAI.

### 5.1 Frontera NestJS / n8n

NestJS conserva:

- autenticación y autorización;
- contexto de tenant y RLS;
- webhooks e idempotencia;
- conversaciones y memoria;
- pedidos, reservas y disponibilidad;
- decisiones y confirmaciones;
- presupuestos de IA;
- outbox, auditoría y estado de entrega.

n8n podrá encargarse de:

- notificaciones internas no críticas;
- sincronizaciones reemplazables;
- integraciones de CRM o marketing;
- reportes y tareas administrativas;
- prototipos que no sean la fuente de verdad.

Un flujo n8n nunca debe ser el único lugar donde exista una transición comercial crítica.

## 6. Estructura del repositorio

```text
whatsapp-commerce-ai/
├── AI_PROJECT_HANDOFF.md       # este documento maestro
├── PROJECT_CONTEXT.md          # contexto inicial; contiene pendientes históricos
├── README.md                   # introducción y comandos principales
├── Makefile                    # comandos locales de infraestructura, DB y aplicaciones
├── docker-compose.yml          # PostgreSQL y Redis locales
├── backend/                    # API, workers y motor conversacional NestJS
│   ├── src/                    # módulos de producción
│   ├── test/                   # pruebas de integración
│   ├── evals/                  # evaluaciones conversacionales y revisión ciega
│   ├── scripts/                # verificaciones operativas
│   └── observability/          # configuración/artefactos de observabilidad
├── frontend/                   # panel React + TypeScript + Vite
│   ├── src/App.tsx             # composición actual del panel; candidato a dividir
│   ├── src/api.ts              # cliente HTTP
│   ├── src/i18n/               # catálogos de interfaz ES/EN
│   └── src/styles.css          # estilos del panel
├── database/
│   ├── sql/                    # migraciones 001..055 y plantilla de roles
│   ├── seeds/                  # tenants y escenarios ficticios
│   ├── tests/                  # pruebas SQL de aislamiento e integridad
│   ├── scripts/                # migrate, seed y test
│   ├── README.md               # operación del esquema
│   └── physical-schema.md      # descripción física inicial
├── docs/                       # decisiones y documentación especializada
├── n8n/                        # frontera y futuros flujos no críticos
├── prompts/                    # contratos/plantillas de prompts agnósticos
├── postman/                    # colección y environment de desarrollo
├── scripts/                    # verificaciones operativas desde la raíz
├── entregables/                # artefactos de entrega; no son código de ejecución
├── outputs/                    # salidas generadas de trabajo local
└── work/                       # material auxiliar de trabajo
```

No tratar `frontend/dist`, `backend/dist`, `node_modules`, `.idea`, `outputs` o archivos temporales como fuentes de verdad.

## 7. Backend: módulos y responsabilidades

El backend es un monolito modular. La coordinación está en `backend/src/app.module.ts` y el arranque en `backend/src/main.ts`.

| Módulo | Responsabilidad |
| --- | --- |
| `auth` | Login local, sesiones opacas, cambio obligatorio de contraseña, guards y contexto del actor. |
| `bot-config` | Nombre, comportamiento, idiomas, activación de IA y configuración del asistente por tenant. |
| `channel-connections` | Alta y estado de cuentas/canales de WhatsApp y referencias de secretos. |
| `commerce-events` | Consumidores BullMQ, worker, flujos de pedido/cita, generación automática y adaptadores de envío. |
| `commercial-requests` | Lectura y administración de pedidos, reservas y sus líneas/operaciones. |
| `config` | Validación y acceso tipado a variables de entorno. |
| `conversation-decisions` | Puerta única que transforma comprensión + estado + capacidades en una decisión autorizada. |
| `conversation-understanding` | Contrato de intents/entidades y proveedor determinístico; desacopla comprensión de ejecución. |
| `conversations` | Inbox, detalle, mensajes, lectura, toma/devolución al bot, cierre, respuestas manuales y reintentos. |
| `database` | Pools, transacciones y establecimiento seguro del contexto RLS. |
| `delivery-statuses` | Recepción y persistencia de estados de entrega del proveedor. |
| `health` | Salud y disponibilidad del servicio. |
| `inbound-messages` | Ingesta idempotente, resolución de canal/contacto/conversación y persistencia inicial. |
| `interactive-messages` | Representación de opciones interactivas compatibles con WhatsApp. |
| `knowledge` | Perfil, FAQ/políticas, preguntas no resueltas, revisión y respuestas aprendidas. |
| `localization` | Catálogos de dominio, selección/persistencia de idioma y cambio controlado. |
| `metrics` | Estado operativo y métricas protegidas por bearer token. |
| `observability` | Errores estructurados, correlación, logging y filtros HTTP. |
| `outbound-messages` | Registro durable de intenciones de envío y su ciclo de entrega. |
| `outbox` | Reclamo, publicación y reintento seguro de eventos transaccionales. |
| `platform-tenants` | Administración de tenants por actores de plataforma. |
| `public-info` | Endpoints públicos estrictamente limitados. |
| `recommendations` | Reglas de complementos, elegibilidad, aceptación y medición. |
| `response-composition` | Respuesta base, variantes aprobadas, OpenAI opcional, presupuesto, uso y metadatos de generación. |
| `scheduling` | Recursos, disponibilidad, holds, citas e integración opcional con Google Calendar. |
| `secrets` | Contratos para resolver referencias secretas sin persistir credenciales en Git. |
| `tenant-users` | Invitaciones, membresías, roles y administración del equipo. |
| `whatsapp-webhook` | Verificación de Meta, firma del webhook, parsing y delegación a ingesta. |

### 7.1 Flujo de un mensaje entrante

1. `whatsapp-webhook` valida el origen y normaliza el evento.
2. `inbound-messages` resuelve el canal y tenant sin aceptar un `tenant_id` arbitrario del cliente.
3. Se deduplica por identificador externo/idempotency key.
4. En una transacción se persisten contacto, conversación, mensaje y evento outbox.
5. El publicador toma el evento con lease y lo envía a BullMQ.
6. `message-received.consumer` restablece el contexto del tenant y carga estado durable.
7. `ConversationLanguageService` determina o conserva el idioma.
8. El proveedor de comprensión produce intent, entidades y confianza bajo un contrato estable.
9. `ConversationDecisionEngine` verifica capacidades del tenant y elige una acción.
10. El flujo comercial, de cita o de conocimiento realiza cambios transaccionales.
11. Se compone una respuesta determinística localizada.
12. Se intenta primero una variante local aprobada; si no existe y se cumplen rollout/presupuesto, OpenAI puede reescribir.
13. Se persisten respuesta final, trazabilidad de generación y evento de envío.
14. El consumidor de envío llama al adaptador fixture o Meta y actualiza el estado.

### 7.2 Principio de IA no autoritativa

OpenAI no recibe autorización para:

- cambiar precios;
- seleccionar un producto inexistente;
- confirmar una compra o cita;
- modificar disponibilidad;
- omitir una confirmación;
- resolver acceso, tenant o permisos;
- inventar políticas o información del negocio.

La capa de IA puede mejorar naturalidad, tono y claridad de una respuesta base. El sistema conserva texto original, texto final, modelo, tokens, latencia, costo estimado, resultado y razón de fallback.

## 8. Frontend y experiencia administrativa

El panel vive en `frontend/` y utiliza React, TypeScript y Vite. El idioma de la interfaz es independiente del idioma de cada conversación.

Rutas principales:

| Ruta | Uso |
| --- | --- |
| `/` | Login o redirección al panel según sesión. |
| `/conversations` | Inbox, conversación, búsqueda, filtros, respuesta manual, control bot/humano y datos técnicos. |
| `/orders-and-bookings` | Solicitudes comerciales, líneas, totales, estados y acciones excepcionales. |
| `/knowledge/learned-responses` | Propuestas de respuesta, pendientes, aprobadas y rechazadas. |
| Rutas bajo `/knowledge/...` | Perfil, fuentes, preguntas y subsecciones de conocimiento. |

También existen vistas para equipo, conexiones, bot, agenda y administración de tenant. Las rutas exactas están centralizadas al inicio de `frontend/src/App.tsx`.

Mejoras visuales ya realizadas en conversaciones:

- diferenciación clara entre cliente y asistente;
- etiquetas de respuesta automática, regla, fallback, variante reutilizada o IA;
- estado de WhatsApp desconectado sin confundirlo con un fallo del motor;
- datos técnicos colapsables;
- modelo, tokens, latencia y costo disponibles sin saturar la lectura principal;
- fechas separadas de etiquetas para evitar solapamientos;
- opciones interactivas presentadas como acciones legibles;
- búsqueda y filtros por tipo de respuesta;
- marcador para regresar al mensaje más reciente;
- textos y estados traducidos.

Deuda técnica principal: `App.tsx` es monolítico. La división futura debería separar layout, routing, páginas, componentes de conversación, hooks y tipos, manteniendo primero pruebas o snapshots de comportamiento.

## 9. Modelo de datos

### 9.1 Principios físicos

- IDs primarios UUIDv7 para orden temporal aproximado y mejor localidad que UUIDv4.
- `tenant_id` obligatorio en entidades de negocio.
- FK compuestas `(tenant_id, id)` para impedir referencias cruzadas.
- RLS habilitada desde las primeras migraciones.
- importes almacenados como unidades monetarias menores, nunca `float`;
- timestamps con zona horaria;
- estados como texto restringido mediante `CHECK`, facilitando migraciones incrementales;
- índices alineados con tenant, estado y fechas de actividad;
- sin particionamiento prematuro en el MVP.

### 9.2 Áreas del esquema

| Área | Entidades representativas |
| --- | --- |
| Identidad | tenants, users, tenant_users, platform_admins, local_credentials, sessions, invitations. |
| Canales | channels, channel connections, contacts, contact_identities. |
| Conversación | conversations, messages, reads, memory, workflows, unresolved questions. |
| Catálogo | catalogs, catalog_items, item_variants, prices/disponibilidad. |
| Comercio | commercial_requests, request_lines, operations y resultados. |
| Agenda | resources, availability rules/exceptions, offering-resource links, holds, appointments. |
| Conocimiento | profiles, entries, sources, localizations y circuito de revisión. |
| Recomendaciones | reglas, exposiciones/decisiones y medición por conversación. |
| IA | configuración, reservas de presupuesto, uso y variantes aprobadas. |
| Integración | outbox_events, delivery attempts/status y auditoría. |

Consultar `database/physical-schema.md` y las migraciones para nombres exactos. La migración más reciente es `055_business_profile_localizations.sql`.

### 9.3 Roles PostgreSQL

- `commerce_owner`: propietario de objetos y migraciones; no debe ser el rol normal de la aplicación.
- `commerce_runtime`: acceso de la aplicación sujeto a RLS y grants mínimos.
- `commerce_worker`: capacidades necesarias para procesamiento asíncrono, también con contexto controlado.

Los nombres y privilegios efectivos se definen en `database/sql/000_roles.template.sql`, `003_runtime_grants.sql` y migraciones posteriores. No usar el superusuario de PostgreSQL como identidad de producción.

### 9.4 Contexto y RLS

Cada operación tenant-scoped debe establecer `app.tenant_id` dentro de su transacción. Los endpoints administrativos también establecen actor y permisos. No interpolar un tenant proveniente del body sin resolver primero la membresía/autorización.

Las tareas de worker deben transportar el identificador necesario, pero volver a validar y establecer el contexto al procesar. Una cola no constituye un límite de seguridad.

## 10. Evolución del esquema

Las migraciones `database/sql/001...055` reflejan estas etapas:

1. esquema inicial, roles, RLS, grants e identidad de WhatsApp;
2. envío durable y administración de conexiones;
3. autenticación, sesiones, invitaciones y membresías;
4. administración de tenants e idioma de interfaz;
5. bot, conocimiento y capacidades del negocio;
6. preguntas no resueltas, entrega fallida y lecturas;
7. memoria, workflows y ciclo de solicitudes;
8. recursos, disponibilidad, citas y calendarios;
9. recomendaciones y configuración multilingüe;
10. presupuestos de IA y acceso a zona horaria/identidad;
11. variantes aprobadas y su revisión obligatoria;
12. idioma persistente de conversación y perfiles localizados.

Los scripts registran migraciones aplicadas y deben ejecutarse en orden. Para agregar una capacidad, crear `056_nombre_descriptivo.sql`; no modificar 001–055 si ya pudieron aplicarse en una base existente.

## 11. Motor conversacional multiindustria

El vocabulario del dominio es transversal:

| Concepto | Restaurante | Spa | Lavadero | Tecnología |
| --- | --- | --- | --- | --- |
| Oferta | plato/bebida | tratamiento | tipo de lavado | producto |
| Variante | tamaño/presentación | duración | tipo de vehículo | modelo/capacidad |
| Operación | pedido | cita | cita/servicio | pedido/cotización |
| Recurso | mesa/repartidor | terapeuta/cabina | bahía/equipo | asesor/inventario |
| Complemento | bebida | ritual adicional | encerado | accesorio |
| Modalidad | domicilio/recogida | en sede | sede/domicilio | envío/recogida |

### 11.1 Garantías actuales

- Catálogos, precios, recursos y reglas se consultan por tenant.
- `ConversationDecisionEngine` solo activa una capacidad habilitada.
- Una oferta reservable se dirige a cita y una vendible a pedido.
- La recuperación de conocimiento utiliza vocabulario localizado y coincidencia genérica de títulos/contenido, no palabras de restaurante incrustadas.
- Los nombres de productos concretos existen en seeds o datos, no en el motor.
- Existen pruebas cruzadas de FAQ de spa y tiempos de lavadero.

### 11.2 Brecha estructural prioritaria

Debe implementarse un modelo de **requisitos operativos configurables y tipados**. Ejemplos:

- restaurante: dirección, modalidad, observaciones;
- spa: servicio, profesional opcional, restricciones declaradas, fecha;
- lavadero: tipo/tamaño de vehículo, ubicación, servicio;
- tecnología: variante, dirección, facturación o entrega.

La solución correcta es definir requisitos por capacidad/oferta/tenant, con tipo, obligatoriedad, validación, sensibilidad, traducciones y reglas de confirmación. No crear columnas o condiciones específicas para cada industria.

## 12. Idiomas y localización

Hay dos idiomas distintos que no deben confundirse:

- **idioma de interfaz:** preferencia del usuario del panel;
- **idioma de conversación:** estado persistente asociado a la conversación/contacto.

Reglas implementadas para conversación:

1. El primer mensaje claramente identificable puede seleccionar el idioma.
2. Un mensaje ambiguo no cambia el idioma vigente.
3. En una conversación activa se requieren dos mensajes consecutivos y claros en el nuevo idioma para cambiarlo.
4. La preferencia conocida del contacto tiene prioridad cuando corresponde.
5. El perfil del negocio se presenta en una localización aprobada, con fallback controlado.

Los catálogos de interfaz viven en `frontend/src/i18n/locales/en.ts` y `es.ts`. Los catálogos de respuestas del backend viven bajo `backend/src/localization`. No introducir texto visible directamente en servicios o componentes cuando deba traducirse.

Pendiente: localización administrable de nombres/descripciones de catálogo, variantes, FAQ y requisitos operativos.

## 13. Pedidos, reservas y recomendaciones

### 13.1 Pedidos

El flujo mantiene un workflow durable por conversación, resuelve ofertas contra el catálogo, maneja cantidad y variante, solicita modalidad/datos faltantes, muestra resumen y exige confirmación. Después de confirmar crea o actualiza la solicitud comercial y sus líneas.

Correcciones relevantes ya incorporadas:

- desambiguación conservadora cuando varios productos empatan;
- reconocimiento de intención de compra natural;
- manejo correcto de cantidades numéricas de PostgreSQL;
- formato de cantidades en español;
- validación mínima de dirección: longitud, palabras, número y estructura reconocible;
- rechazo de direcciones vagas como solo “Robledo”;
- títulos de resumen y `Total:` con énfasis compatible con WhatsApp y el panel.

### 13.2 Reservas/citas

El flujo usa ofertas reservables, recursos compatibles, horarios semanales, excepciones, disponibilidad, holds temporales y protección transaccional contra solapamientos. Google Calendar es una sincronización externa, no la autoridad de disponibilidad.

### 13.3 Recomendaciones

Las recomendaciones son reglas tenant-scoped y catalog-backed. Su finalidad es aumentar ticket sin inventar productos ni insistir. Deben registrar exposición, aceptación/rechazo y resultado. La IA puede redactar la sugerencia, pero la elegibilidad y el artículo recomendado son determinísticos.

## 14. Respuestas aprendidas y control de costos

Cuando OpenAI mejora una respuesta base, el sistema puede registrar una propuesta reutilizable identificada por una identidad estable, no por una comparación frágil del texto completo. El panel permite revisar, editar, aprobar o rechazar.

Estados conceptuales:

- pendiente: no puede reutilizarse;
- aprobada: puede resolverse localmente antes de llamar a OpenAI;
- rechazada: se conserva como evidencia, pero no se usa;
- sin cambios materiales: no debe requerir una aprobación engañosa.

El matching debe tolerar variaciones no semánticas mediante identidad/contexto estable, pero no reutilizar una respuesta cuando cambian hechos, tenant, idioma o parámetros que alteran su veracidad.

El orden de resolución recomendado es:

1. regla/respuesta determinística;
2. variante aprobada compatible;
3. OpenAI, solo si tenant, rollout y presupuesto lo permiten;
4. fallback seguro ante timeout, cuota, formato inválido o error.

El presupuesto se reserva atómicamente antes de llamar al proveedor y se liquida después. Nunca mantener locks de DB durante la llamada. Cada intento registra uso, incluso si falla.

## 15. Seguridad, privacidad e idempotencia

- Secretos reales no se versionan.
- Las contraseñas se almacenan como hashes Argon2id.
- Las sesiones son tokens opacos enviados en cookies HttpOnly.
- Los webhooks de Meta validan firma y token de verificación.
- Mensajes y eventos externos se deduplican.
- Los jobs deben ser reintentables y sus consumidores idempotentes.
- El outbox evita el fallo “commit realizado, job nunca publicado”.
- Las llamadas externas ocurren fuera de transacciones de dominio.
- La aplicación usa referencias de secreto; el almacenamiento definitivo de secretos sigue pendiente.
- Los logs deben evitar tokens, contraseñas y contenido sensible innecesario.
- Retención, eliminación, consentimiento y requisitos legales todavía necesitan una política de producción explícita.

## 16. Entorno local

### 16.1 Requisitos

- macOS con OrbStack o Docker activo;
- Node.js y npm;
- `psql` opcional para inspección manual;
- puertos locales libres: backend 3000, frontend 5173, PostgreSQL 54329 y Redis 56379 según configuración actual.

### 16.2 Preparación

```bash
cd /Users/carlosespinoza/Sites/Personal/whatsapp-commerce-ai
npm install --prefix backend
npm install --prefix frontend
cp backend/.env.example backend/.env
make infra-up
make db-migrate
make db-seed
make db-test
```

No sobrescribir un `backend/.env` existente: contiene configuración local no versionada. Revisar las variables, pero nunca imprimir ni copiar `OPENAI_API_KEY`, tokens de Meta o secretos en documentación/salidas.

### 16.3 Arranque

Terminal 1:

```bash
cd /Users/carlosespinoza/Sites/Personal/whatsapp-commerce-ai/backend
set -a
source .env
set +a
npm run start:dev
```

Para procesar respuestas automáticas, `WHATSAPP_AUTO_REPLY_ENABLED` debe estar habilitado en el entorno. En desarrollo seguro se recomienda `WHATSAPP_ADAPTER_MODE=fixture`; `meta` intenta enviar realmente.

Terminal 2:

```bash
cd /Users/carlosespinoza/Sites/Personal/whatsapp-commerce-ai/frontend
npm run dev
```

Abrir `http://localhost:5173/`. El backend escucha por defecto en `http://localhost:3000/`.

### 16.4 Usuarios ficticios

El seed documenta:

- plataforma: `admin@commerce.test`;
- propietario del tenant restaurante/Santos: `owner.restaurante@commerce.test`;
- contraseña temporal de seed: `LocalDemo-ChangeMe-2026!`.

La aplicación obliga a cambiar la contraseña temporal. Si la base ya fue usada, la contraseña vigente puede haber cambiado y no se puede recuperar del hash. En ese caso, restablecer únicamente el entorno local de manera consciente; `make db-reset` elimina los volúmenes y todos los datos locales, incluidas conversaciones preservadas, por lo que **no debe ejecutarse sin autorización explícita**.

## 17. Variables de entorno importantes

| Variable | Función |
| --- | --- |
| `DATABASE_URL` | conexión PostgreSQL. |
| `REDIS_HOST`, `REDIS_PORT` | conexión BullMQ. |
| `OUTBOX_*` | frecuencia, lote y habilitación del publicador. |
| `COMMERCE_WORKER_*` | activación y concurrencia del worker. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | handshake del webhook. |
| `WHATSAPP_APP_SECRET` | validación de firma. |
| `WHATSAPP_ADAPTER_MODE` | `fixture` o `meta`. |
| `WHATSAPP_AUTO_REPLY_ENABLED` | habilita procesamiento/respuesta automática. |
| `WHATSAPP_GRAPH_API_VERSION` | versión de Graph API cuando se usa Meta. |
| `WHATSAPP_ACCESS_TOKEN` | token local temporal; no versionar. |
| `SESSION_TTL_HOURS` | duración de sesión. |
| `FRONTEND_ORIGIN` | origen CORS permitido. |
| `METRICS_BEARER_TOKEN` | protege métricas internas. |
| `CREDENTIAL_ENCRYPTION_KEY` | cifrado de credenciales integradas. |
| `GOOGLE_CALENDAR_*` | OAuth de Calendar. |
| `OPENAI_RESPONSE_REWRITING_ENABLED` | interruptor global de reescritura. |
| `OPENAI_RESPONSE_MODEL` | modelo de reescritura. |
| `OPENAI_API_KEY` | credencial del proveedor. |
| `OPENAI_*_COST_MINOR_PER_MILLION` | estimación configurable de costo. |

El `.env.example` es la referencia exacta. Los permisos por tenant almacenados en DB siguen siendo necesarios aunque el interruptor global esté encendido.

## 18. Verificación y pruebas

Comandos principales:

```bash
make db-test
make backend-build
make backend-test
make backend-test-integration
make backend-eval
make frontend-build
git diff --check
git status --short
```

Último estado verificado antes de este documento:

- backend: 31 suites, 174 pruebas aprobadas;
- build del backend aprobado;
- pruebas SQL (`make db-test`) aprobadas;
- `git diff --check` sin errores;
- pruebas cross-industry agregadas para conocimiento de spa y tiempos de lavadero.

Esto es una fotografía, no una exención: después de cualquier cambio se deben volver a ejecutar las pruebas proporcionales al riesgo.

### 18.1 Pruebas manuales preservadas

La base local contiene conversaciones y pedidos de demostración visibles desde el panel. No borrarlos ni ejecutar `db-reset` mientras el propietario los use para validar el recorrido.

Se han probado, entre otros:

- conversación completa en español hasta pedido;
- conversación completa en inglés;
- cambio controlado español → inglés → español;
- dirección ambigua y corrección posterior;
- producto desconocido y propuesta de respuesta reutilizable;
- recomendación visual;
- intervención de IA y fallback seguro;
- fallo de entrega a WhatsApp sin pérdida del mensaje local.

Un mensaje marcado “No enviado” puede haber sido correctamente entendido, procesado y persistido: el estado describe el transporte hacia Meta, no necesariamente un fallo del motor.

## 19. Decisiones arquitectónicas vigentes

`docs/decisions.md` contiene D-001 a D-038. Las más importantes para continuar son:

- multiempresa desde el inicio;
- núcleo agnóstico al negocio;
- PostgreSQL durable y RLS;
- UUIDv7 y FK multiempresa;
- NestJS como núcleo transaccional;
- n8n para automatizaciones reemplazables;
- transactional outbox;
- una conversación activa por contacto/canal;
- solicitud comercial genérica;
- interacción guiada sin conversación rígida;
- recomendaciones determinísticas;
- código fuente en inglés y textos localizados;
- contrato estable de comprensión;
- una sola puerta de decisiones;
- redacción natural opcional y no autoritativa;
- presupuesto atómico por tenant;
- variantes aprobadas antes de consumir IA;
- idioma persistente y cambio controlado;
- conocimiento localizado separado de hechos;
- enrutamiento por capacidades, no por industria.

Una nueva decisión transversal debe añadirse a este registro con contexto, decisión, consecuencias y alternativas descartadas.

## 20. Documentos que debe leer la siguiente IA

Orden recomendado:

1. `AI_PROJECT_HANDOFF.md` — estado integral actual.
2. `docs/decisions.md` — decisiones no negociables y su historia.
3. `docs/architecture.md` — arquitectura general.
4. `database/README.md` y `database/physical-schema.md` — modelo físico y operación.
5. `docs/conversation-engine.md` — evolución del motor.
6. `docs/cross-industry-conversation-engine.md` — regla multiindustria y brechas.
7. `docs/conversation-understanding.md` — contrato de comprensión.
8. `docs/conversation-decision-engine.md` — puerta de decisiones.
9. `docs/natural-response-rewriting.md` — uso controlado de OpenAI.
10. `docs/business-capabilities-and-scheduling.md` — capacidades y agenda.
11. `docs/internationalization.md` — idiomas y localización.
12. `docs/nestjs-n8n-boundary.md` — límites de orquestación.
13. `docs/roadmap.md` y `docs/requirements.md` — prioridades y requisitos trazables.

`PROJECT_CONTEXT.md` conserva el contexto inicial, pero algunos pendientes allí ya fueron implementados. Ante una contradicción, comprobar código, migraciones y este documento antes de asumir que sigue vigente.

## 21. Próximos pasos recomendados

### P0 — Generalizar requisitos operativos

Diseñar e implementar campos configurables por tenant/capacidad/oferta:

- tipos: texto, número, selección, fecha, hora, dirección, teléfono, booleano;
- obligatoriedad y orden;
- validación declarativa;
- sensibilidad y retención;
- etiquetas/preguntas localizadas;
- confirmación requerida;
- extracción de múltiples campos desde un mensaje;
- fallback a humano cuando el dato sea ambiguo o sensible.

Entregable: ADR/decisión, migración 056+, servicios genéricos, endpoints administrativos, interfaz y pruebas para restaurante, spa, lavadero y tecnología.

### P0 — Matriz de aceptación multiindustria

Crear fixtures y pruebas ejecutables para, al menos:

- restaurante: pedido, variante, recomendación, domicilio;
- spa: servicio reservable, profesional/recurso, fecha, disponibilidad;
- lavadero: tipo de vehículo, servicio, bahía y cita;
- tecnología: producto, variante, stock, complemento y entrega;
- FAQ/política en ES y EN para cada caso;
- handoff ante ambigüedad, acción sensible o incapacidad deshabilitada.

La misma ruta de código debe resolver todos los casos con datos distintos.

### P1 — Localización completa del contenido

Extender el patrón de `business_profile_localizations` a ofertas, variantes, categorías, FAQ, políticas y requisitos. Definir fallback explícito y revisión/aprobación de traducciones.

### P1 — Comprensión multi-entidad

Permitir que “quiero lavado premium para una camioneta mañana a las 3” produzca varias entidades verificables y avance varios pasos sin saltarse confirmaciones.

### P1 — Renovar y verificar Meta

Renovar el token, verificar phone number ID/cuenta, mantener secretos fuera de Git y ejecutar una prueba real end-to-end. Separar claramente fallos de cuota OpenAI, motor y transporte WhatsApp.

### P1 — Consolidar evaluación de naturalidad

Ampliar el conjunto de evaluaciones con saludos, correcciones, mensajes incompletos, cambios de idioma, negaciones, cancelaciones y conversación larga. Medir naturalidad, exactitud, conversiones, escalamiento, costo y latencia.

### P2 — Modularizar el frontend

Extraer de `App.tsx`:

- router y layout;
- páginas por dominio;
- componentes de conversación;
- componentes de respuestas aprendidas;
- hooks de carga/mutación;
- tipos y formatters.

Hacerlo por incrementos pequeños y verificables, no como una reescritura.

### P2 — Operación de producción

Definir hosting, TLS, secretos administrados, backups/restores, retención, observabilidad, alertas, CI/CD, migraciones, rollback, límites por tenant y plan de incidentes.

### P3 — n8n e integraciones adicionales

Solo después de estabilizar el núcleo, agregar automatizaciones reemplazables: CRM, notificaciones, sincronización de catálogos o campañas. Mantener contratos idempotentes y versionados con NestJS.

## 22. Criterios de escalabilidad

La escalabilidad relevante tiene cuatro dimensiones:

### Funcional

Agregar una industria debe requerir datos y configuración, no una rama nueva del motor.

### Multiempresa

Cada tenant conserva datos, políticas, idioma, presupuesto y secretos aislados. Ninguna caché, job o consulta puede mezclar tenants.

### Operativa

Workers horizontales pueden consumir BullMQ; el outbox y la idempotencia hacen seguros los reintentos. Las llamadas externas no bloquean transacciones.

### Mantenibilidad

Los módulos tienen contratos claros; migraciones, decisiones y pruebas explican la evolución. La próxima mejora debe reducir o no aumentar el conocimiento implícito.

No es necesario introducir microservicios todavía. El monolito modular reduce costo y complejidad del MVP. Separar un servicio solo cuando haya una frontera estable, necesidad de escala independiente o aislamiento operativo demostrado.

## 23. Riesgos conocidos

- La heurística determinística de comprensión crecerá en complejidad si no se mantiene el contrato estable y un conjunto de evaluaciones.
- Usar OpenAI en exceso puede romper la meta de costo; usarlo muy poco puede reducir naturalidad. El rollout y las variantes aprobadas equilibran ambos.
- Una mala configuración de capacidades puede habilitar un flujo incorrecto; necesita validación y UI clara.
- Los requisitos operativos rígidos son la principal amenaza actual a la versatilidad multiindustria.
- `App.tsx` dificulta cambios visuales seguros y pruebas aisladas.
- Los tokens temporales de Meta expiran; producción necesita gestión y rotación de secretos.
- La base local contiene evidencia visual valiosa, pero no sustituye fixtures repetibles.
- La documentación histórica puede quedar obsoleta; actualizar este handoff cuando cambie una frontera importante.

## 24. Instrucciones de trabajo para otra IA

Antes de editar:

1. Ejecutar `git status --short` y preservar cambios existentes.
2. Leer este documento y los documentos específicos del área.
3. Buscar `AGENTS.md` o instrucciones locales aplicables.
4. Confirmar la migración más reciente y no editar migraciones aplicadas.
5. Identificar explícitamente cómo se mantiene `tenant_id`, RLS e idempotencia.

Durante la implementación:

- mantener código e identificadores en inglés;
- localizar textos visibles;
- no introducir nombres de Santos Tacos en producción;
- no ejecutar `db-reset` ni borrar conversaciones;
- no imprimir secretos;
- no crear commits ni remotos sin autorización;
- añadir pruebas unitarias, integración y/o SQL según la capa;
- documentar decisiones que cambien fronteras o invariantes.

Antes de terminar:

1. Ejecutar build y pruebas relevantes.
2. Ejecutar `git diff --check`.
3. Revisar consultas sin `tenant_id` y trabajos sin contexto RLS.
4. Revisar textos visibles hardcoded.
5. Explicar archivos cambiados, pruebas, deuda restante y paso siguiente.
6. Actualizar este documento si cambió arquitectura, operación o prioridad.

## 25. Lista de “no hacer”

- No convertir Santos Tacos en una subclase, módulo o conjunto de `if` del motor.
- No usar OpenAI para decidir precios, disponibilidad o confirmaciones.
- No publicar eventos directamente después de un commit sin outbox.
- No confiar en `tenant_id` enviado por un cliente.
- No almacenar dinero en punto flotante.
- No crear jobs sin idempotency key o consumidor reintentable.
- No poner secretos reales en `.env.example`, Postman, logs o Markdown.
- No usar n8n como base de datos o máquina de estados principal.
- No borrar la base local para “arreglar” un problema visual.
- No aprobar automáticamente respuestas aprendidas.
- No confundir una respuesta persistida con una entrega exitosa a WhatsApp.
- No realizar una reescritura total del frontend sin una red de pruebas.

## 26. Definición de avance exitoso

Una mejora está realmente terminada cuando:

- funciona con aislamiento de tenant;
- no contiene conocimiento específico de una industria en el núcleo;
- conserva idempotencia y trazabilidad;
- tiene respuesta/fallback seguro ante proveedores caídos;
- respeta idioma y localización;
- expone en el panel el estado necesario sin saturar al usuario;
- cuenta con pruebas proporcionales al riesgo;
- está documentada;
- no eleva costos sin medición y límite;
- puede ser entendida y mantenida por el propietario del proyecto.

---

Este archivo debe mantenerse como la puerta de entrada para continuidad. No reemplaza las migraciones ni el código: los resume, conecta y establece cómo interpretarlos.
