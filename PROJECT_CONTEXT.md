# Contexto del proyecto

## Problema

Los comercios necesitan responder consultas, recomendar productos y acompañar ventas por WhatsApp con rapidez, conservando control operativo y contexto por empresa.

## Propuesta

Una plataforma SaaS multiempresa que coordine mensajes de WhatsApp, automatizaciones, datos comerciales y respuestas asistidas por IA. Santos Tacos será el primer caso de validación y un comercio de tecnología el segundo; ambos deben configurarse como tenants, no codificarse en el núcleo.

La propuesta diferencial es convertir conversaciones en resultados comerciales verificables —pedido preparado, oportunidad calificada o escalamiento útil— mediante una IA configurable, controlada y con costos medibles. Ver [docs/value-proposition.md](docs/value-proposition.md).

## Principios

- Todo dato de negocio debe estar asociado a un `tenant_id`.
- El comportamiento variable se resuelve mediante configuración, catálogo, políticas y prompts por tenant.
- Los secretos no se guardan en Git.
- Se priorizan servicios administrados o autoalojados de bajo costo y una arquitectura sencilla.
- El sistema debe permitir intervención humana, trazabilidad y límites de uso.

## Supuestos iniciales

- Cada número de WhatsApp pertenece a un tenant en el MVP.
- El español es el idioma inicial, sin impedir otros idiomas.
- El MVP tendrá volumen bajo y podrá operar en una sola región.
- WhatsApp Cloud API será el canal inicial; no se contemplan otros canales todavía.
- La IA propone respuestas, pero acciones sensibles o ambiguas podrán requerir confirmación humana.

## Pendientes principales

- Conectar el webhook ya autenticado a una aplicación de prueba de Meta solo
  cuando existan secretos administrados, HTTPS y un plan operativo acordado.
- Sustituir el proveedor temporal de access token por un almacén de secretos antes
  de configurar más de una cuenta real.
- Elegir dónde ejecutar Prometheus/Alertmanager o un servicio equivalente y qué
  canal recibirá las alertas operativas ya definidas.
- Reemplazar el efecto ficticio de auditoría del primer consumidor BullMQ por la
  siguiente decisión real del flujo conversacional, manteniendo deduplicación.
- Diseñar el adaptador de envío que registre una intención antes de llamar a Meta
  y asocie de forma segura el `wamid` devuelto, reemplazando el adaptador fixture.
- Definir alcance exacto de pedidos, pagos, inventario y escalamiento humano.
- Elegir proveedor de infraestructura y validar el presupuesto con tráfico real.
- Definir autenticación, roles, retención de datos y requisitos legales.
- Determinar estrategia de despliegue y operación de NestJS, n8n, PostgreSQL y Redis.
- Fijar valores objetivo para las métricas de éxito y límites de consumo por tenant.
