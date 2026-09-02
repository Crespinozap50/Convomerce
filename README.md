# WhatsApp Commerce AI

Base inicial para una plataforma SaaS multiempresa que automatiza la atención comercial por WhatsApp mediante IA.

## Alcance del MVP

- Integrar WhatsApp Cloud API, n8n, PostgreSQL, OpenAI y un backend en Node.js, TypeScript y NestJS.
- Aislar datos, configuración, conversaciones y automatizaciones por `tenant_id`.
- Validar inicialmente con Santos Tacos y luego con un comercio de tecnología, sin lógica específica por negocio en el núcleo.
- Mantener un costo operativo objetivo inferior a USD 30 mensuales durante el MVP.

## Estructura

- `docs/`: visión, arquitectura, requisitos, hoja de ruta y decisiones.
- `n8n/`: futuros flujos y documentación de automatización.
- `backend/`: API NestJS como monolito modular y primer flujo transaccional.
- `frontend/`: panel React + TypeScript para login y administración multiempresa.
- `database/`: esquema PostgreSQL, migraciones, semillas ficticias y pruebas SQL.
- `prompts/`: futuras plantillas de prompts agnósticas al negocio.
- `postman/`: colección y environment locales para probar todos los endpoints.

## Estado

El esquema PostgreSQL inicial puede ejecutarse localmente con Docker Compose y
cuenta con pruebas de aislamiento e integridad. El backend NestJS incluye el
primer flujo vertical ficticio: mensaje entrante, RLS, idempotencia, conversación,
transactional outbox y publicación en BullMQ. La integración real de WhatsApp,
autenticación local, roles e interfaz administrativa inicial ya están disponibles.

Consulta [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) para contexto, supuestos y preguntas abiertas.
La diferenciación del producto se resume en [docs/value-proposition.md](docs/value-proposition.md).
La preparación segura de la cuenta de prueba de Meta está en [docs/meta-test-setup.md](docs/meta-test-setup.md).
El primer recorrido funcional se define en [docs/pilot-santos-tacos.md](docs/pilot-santos-tacos.md).
El diseño conceptual multiempresa está en [docs/data-model.md](docs/data-model.md).
Las responsabilidades de NestJS y n8n están delimitadas en [docs/nestjs-n8n-boundary.md](docs/nestjs-n8n-boundary.md).
El ciclo operativo de las conversaciones está en [docs/conversation-lifecycle.md](docs/conversation-lifecycle.md).
El esquema físico inicial y la estrategia de migraciones están en [database/README.md](database/README.md).
La evolución hacia una conversación natural y mantenible está en [docs/conversation-engine.md](docs/conversation-engine.md).
