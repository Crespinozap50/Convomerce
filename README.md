# Convomerce

Plataforma SaaS multiempresa que convierte conversaciones de WhatsApp en resultados
comerciales: pedidos, citas y atención al cliente automatizados con IA, aislados por
negocio, sin lógica específica de rubro en el núcleo.

## Requisitos

- [Docker](https://www.docker.com/) y Docker Compose (para PostgreSQL y Redis locales).
- Node.js 20 o superior y npm.

## Instalación

```bash
git clone https://github.com/Crespinozap50/Convomerce.git
cd Convomerce
cp backend/.env.example backend/.env
```

Abre `backend/.env` y genera un valor propio para `CREDENTIAL_ENCRYPTION_KEY`
(mínimo 32 caracteres aleatorios) — es la clave que cifra en reposo cualquier
credencial de terceros (token de WhatsApp, refresh token de Google Calendar).
El resto de las variables ya trae valores por defecto que funcionan para
desarrollo local.

## Levantar la infraestructura local

```bash
make infra-up      # PostgreSQL (puerto 54329) y Redis (puerto 56379) con Docker
make db-migrate     # Aplica el esquema y las migraciones
make db-seed        # Carga tenants y datos ficticios de demostración
```

`make db-reset` reinicia todo desde cero (borra los volúmenes de Docker,
vuelve a migrar y a sembrar) — útil si la base local queda en un estado raro.

## Backend (API NestJS)

```bash
cd backend
npm install
npm run start:dev   # http://localhost:3000, recompila en caliente
```

Otros comandos útiles: `npm test` (pruebas unitarias), `npm run lint`,
`npm run build`.

## Frontend (panel de administración)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

El frontend apunta a `http://localhost:3000` por defecto; para cambiarlo,
define `VITE_API_URL` en un `frontend/.env`.

## Acceder al panel

Con los datos de la semilla (`make db-seed`), ya existen dos usuarios listos
para iniciar sesión en `http://localhost:5173`:

| Rol | Email | Contraseña |
|---|---|---|
| Administrador de plataforma | `admin@commerce.test` | `LocalDemo-ChangeMe-2026!` |
| Dueño de Santos Tacos (tenant demo) | `owner.restaurante@commerce.test` | `LocalDemo-ChangeMe-2026!` |

Ambas cuentas piden cambiar la contraseña en el primer inicio de sesión.

## Probar mensajes de WhatsApp sin credenciales reales

Con `WHATSAPP_ADAPTER_MODE=fixture` (valor por defecto en `.env.example`), el
backend no necesita ninguna credencial real de Meta: los webhooks se pueden
simular firmándolos con `WHATSAPP_APP_SECRET` y enviándolos a
`POST /v1/webhooks/whatsapp`. La colección de Postman en [`postman/`](postman/)
incluye ejemplos listos para usar.

## Estructura

- `docs/`: visión, arquitectura, requisitos, hoja de ruta y decisiones.
- `backend/`: API NestJS (monolito modular).
- `frontend/`: panel React + TypeScript para login y administración multiempresa.
- `database/`: esquema PostgreSQL, migraciones, semillas de demostración y pruebas SQL.
- `postman/`: colección y environment locales para probar todos los endpoints.
- `n8n/`, `prompts/`: documentación de automatizaciones y prompts futuros.

## Documentación

Consulta [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) para contexto, supuestos y preguntas abiertas.
El historial completo de decisiones de diseño está en [docs/decisions.md](docs/decisions.md).
La diferenciación del producto se resume en [docs/value-proposition.md](docs/value-proposition.md).
La preparación de una cuenta de prueba de Meta está en [docs/meta-test-setup.md](docs/meta-test-setup.md).
El primer recorrido funcional se define en [docs/pilot-santos-tacos.md](docs/pilot-santos-tacos.md).
El diseño conceptual multiempresa está en [docs/data-model.md](docs/data-model.md).
El ciclo operativo de las conversaciones está en [docs/conversation-lifecycle.md](docs/conversation-lifecycle.md).
El esquema físico y la estrategia de migraciones están en [database/README.md](database/README.md).
El diseño del motor de conversación está en [docs/conversation-engine.md](docs/conversation-engine.md).
