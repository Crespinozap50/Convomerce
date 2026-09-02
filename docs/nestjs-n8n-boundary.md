# Límite entre NestJS y n8n

## Decisión principal

NestJS es el núcleo transaccional y la única puerta de entrada a los datos de negocio. n8n coordina automatizaciones externas y tareas operativas reemplazables mediante contratos explícitos con NestJS.

```text
WhatsApp Cloud API
        │
        ▼
      NestJS ───────── PostgreSQL
        │                  ▲
        ├──── BullMQ ──────┤
        │       │
        │       ▼
        └───── n8n ───── servicios externos
```

n8n no consulta ni modifica PostgreSQL directamente. Toda operación de dominio pasa por NestJS, que resuelve el tenant, valida autorización, aplica reglas, abre la transacción y queda sujeto a Row-Level Security.

## Por qué se divide así

- El flujo visual de n8n facilita integrar servicios y cambiar automatizaciones.
- NestJS ofrece contratos, pruebas, transacciones y control de acceso más fuertes para el núcleo del SaaS.
- PostgreSQL conserva una sola fuente de verdad.
- Un flujo de n8n puede reemplazarse sin migrar reglas críticas ni datos.
- El aislamiento por tenant se implementa una vez, en lugar de replicarse en cada workflow.

## Responsabilidades de NestJS

### Seguridad y tenancy

- Verificar firmas y autenticidad de webhooks.
- Resolver el tenant desde el canal o la sesión autenticada.
- Establecer el contexto transaccional usado por RLS.
- Autorizar usuarios, roles, aplicaciones internas y capacidades por tenant.
- Administrar referencias a secretos sin exponer credenciales a respuestas o logs.

### Dominio y datos

- Crear y actualizar contactos, conversaciones y mensajes.
- Consultar catálogo, conocimiento, políticas y configuración vigente.
- Validar solicitudes comerciales, líneas, importes, moneda y transiciones de estado.
- Registrar resultados conversacionales, escalamiento, auditoría y consumo.
- Mantener idempotencia de eventos y mensajes.
- Aplicar transacciones y restricciones multiempresa.

### Canal y ejecución confiable

- Recibir webhooks de WhatsApp Cloud API.
- Enviar mensajes mediante un adaptador de canal controlado.
- Persistir estados de entrega.
- Crear trabajos asíncronos y aplicar reintentos con BullMQ cuando sean necesarios.
- Publicar eventos internos después de confirmar la transacción correspondiente.

### IA controlada

- Seleccionar configuración, políticas, fuentes y versión de prompt.
- Construir el contexto autorizado para una conversación.
- Validar la salida estructurada del modelo antes de convertirla en acción.
- Registrar modelo, propósito, uso, costo estimado y trazabilidad.
- Decidir cuándo una capacidad requiere confirmación o escalamiento.

La llamada técnica al proveedor de IA puede ejecutarse desde NestJS o delegarse de forma controlada, pero la política y la validación pertenecen siempre al núcleo.

## Responsabilidades de n8n

- Coordinar integraciones secundarias con sistemas externos.
- Ejecutar notificaciones internas y tareas administrativas no críticas.
- Transformar formatos cuando no altera reglas de negocio.
- Programar sincronizaciones de catálogos o fuentes externas.
- Orquestar procesos largos mediante APIs y eventos de NestJS.
- Facilitar experimentos operativos antes de convertir un flujo estable y crítico en código.

Ejemplos apropiados: importar un catálogo desde una hoja autorizada, notificar un escalamiento a un canal interno o solicitar una actualización a un sistema de terceros.

## Lo que n8n no debe hacer

- Acceder directamente a tablas de PostgreSQL.
- Resolver por su cuenta el tenant a partir de datos no verificados.
- Calcular importes finales o aprobar transiciones de estado críticas.
- Guardar una copia autoritativa de conversaciones, pedidos o configuración.
- Contener condiciones con nombres de clientes.
- Incluir tokens o credenciales dentro de workflows exportados.
- Enviar mensajes sin registrar antes la intención de envío mediante NestJS.
- Implementar decisiones de autorización o RLS.

## Contrato de integración

NestJS expone una API interna versionada y, cuando convenga, eventos o trabajos. n8n se autentica como una identidad de servicio con permisos mínimos.

Cada solicitud interna debe transportar:

- `correlation_id`: sigue una operación a través de componentes.
- `idempotency_key`: evita repetir una acción ante reintentos.
- Identidad autenticada del servicio.
- Referencia de tenant emitida o validada por NestJS; nunca una autorización basada solo en el cuerpo.
- Versión del contrato.
- Marca temporal y, para webhooks internos, firma con vencimiento.

n8n recibe solo los datos mínimos necesarios. Para información vigente o sensible usa una referencia y consulta nuevamente a NestJS.

## Endpoints conceptuales

Los nombres definitivos se decidirán al diseñar la API. El contrato puede incluir operaciones equivalentes a:

- Obtener una vista autorizada de una conversación.
- Solicitar la sincronización de una fuente de catálogo.
- Proponer una respuesta o acción estructurada para validación.
- Registrar el resultado técnico de una integración.
- Solicitar un escalamiento o una notificación.
- Consultar el estado de un trabajo previamente iniciado.

n8n no recibe un endpoint genérico para ejecutar SQL ni modificar entidades arbitrarias.

## Flujo principal de mensaje entrante

1. WhatsApp envía el webhook a NestJS.
2. NestJS verifica firma, registra el evento idempotente y resuelve el tenant mediante el canal.
3. Dentro de una transacción con contexto RLS, registra mensaje y conversación.
4. Confirma rápidamente la recepción al proveedor.
5. Publica un trabajo después del commit.
6. El trabajador carga datos autorizados y decide el siguiente paso.
7. Si necesita una automatización externa, invoca n8n con un contrato firmado y mínimo.
8. n8n ejecuta la integración y devuelve un resultado técnico idempotente.
9. NestJS valida el resultado, persiste la decisión y registra la intención de respuesta.
10. El adaptador envía el mensaje y actualiza su estado de entrega.

El webhook no debe esperar una conversación completa ni una ejecución larga de n8n para responder a Meta.

## Transacciones y eventos

Una transacción de PostgreSQL no se mantiene abierta mientras se llama a n8n, OpenAI, WhatsApp u otro servicio externo.

La secuencia segura es:

1. Validar y guardar el cambio local.
2. Confirmar la transacción.
3. Publicar o reclamar un trabajo durable.
4. Ejecutar el servicio externo.
5. Guardar el resultado en una nueva transacción idempotente.

Para evitar perder trabajos entre los pasos 2 y 3 se implementará transactional outbox desde la primera migración. El cambio de negocio y su evento se guardan juntos; un publicador entrega después el evento a BullMQ con semántica de al menos una vez.

## Reintentos y fallos

- Todo efecto externo debe admitir idempotencia o deduplicación local.
- Los reintentos usan espera creciente y un máximo configurable.
- Los errores permanentes pasan a revisión, no se reintentan indefinidamente.
- Una caída de n8n no impide recibir y conservar mensajes entrantes.
- Una caída de OpenAI activa respuesta segura, espera o escalamiento según política.
- Una caída de WhatsApp conserva la intención de envío para reintentar sin duplicar.
- Cada fallo conserva `correlation_id`, código estable y contexto mínimo de diagnóstico.

## Uso de BullMQ y n8n

No cumplen la misma función:

- **BullMQ:** ejecución técnica confiable dentro del backend, con reintentos, concurrencia y trabajos cortos o medianos.
- **n8n:** orquestación visible de integraciones y procesos operativos modificables.

Un trabajo de BullMQ puede invocar un workflow de n8n. n8n no reemplaza la cola durable del núcleo ni BullMQ debe convertirse en un editor de procesos de negocio para operadores.

## Criterio para mover un flujo a NestJS

Un workflow debe convertirse en código cuando cumple una o más condiciones:

- Define una regla crítica de dinero, autorización, privacidad o estado.
- Necesita transacciones o invariantes fuertes.
- Tiene alto volumen o sensibilidad de latencia.
- Requiere pruebas unitarias y de integración exhaustivas.
- Su complejidad hace difícil razonar sobre reintentos y efectos parciales.
- Se reutiliza como capacidad central entre varios tenants.

## Criterio para mantener un flujo en n8n

- Integra sistemas externos con cambios frecuentes.
- Es una automatización operativa no autoritativa.
- Necesita visibilidad y ajustes rápidos por el equipo.
- Tolera consistencia eventual y puede reintentarse de forma segura.
- Usa contratos estables sin acceder a internals del dominio.

## Impacto en el costo del MVP

Redis, BullMQ y n8n se incorporan solo cuando un recorrido real los necesita. Para mantener el objetivo inferior a USD 30, el primer despliegue puede compartir infraestructura pequeña, limitar concurrencia y evitar workflows redundantes. La separación lógica descrita aquí no obliga a desplegar cada componente en una máquina distinta.

## Pendientes antes de implementar

- Elegir autenticación de servicio entre NestJS y n8n.
- Definir esquema de eventos internos y política de versionado.
- Identificar cuáles integraciones concretas del piloto justifican n8n.
- Establecer tiempos máximos, reintentos y destino de trabajos fallidos.
- Definir estados, retención, recuperación y monitoreo del outbox.
