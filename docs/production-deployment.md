# Despliegue a producción — recomendación de proveedores

> Implementa D-005 de `docs/decisions.md`. Este documento es una **recomendación
> técnica**, no una decisión ejecutada: crear las cuentas, ingresar método de
> pago y aprobar el proveedor final es una acción del propietario del
> proyecto, no de la IA que continúa este trabajo. Ver §5.

## 1. Qué necesita realmente esta pila

- **Backend NestJS**: proceso Node.js de larga duración, no una función
  serverless de un solo request — el worker de BullMQ (outbox, reintentos)
  necesita seguir corriendo entre requests.
- **PostgreSQL**: con Row-Level Security forzada y funciones `security
  definer` (D-004, D-013). Cualquier Postgres administrado estándar sirve;
  no se usan extensiones exóticas.
- **Redis**: solo para colas BullMQ, sin necesidad de cluster ni
  persistencia avanzada más allá de lo que ya configura `docker-compose.yml`
  local (`appendonly yes`).
- **Frontend**: build estático de Vite — cualquier host de archivos
  estáticos con CDN sirve, no necesita cómputo propio.
- **Secretos**: `CREDENTIAL_ENCRYPTION_KEY`, token de Meta, credenciales de
  DB — hoy viven en `backend/.env` (gitignored); en producción deben vivir
  en el gestor de variables de entorno del proveedor elegido, nunca en Git.
- **TLS**: obligatorio para el webhook de WhatsApp (Meta exige HTTPS).

No existe hoy ningún `Dockerfile` para backend/frontend (solo Postgres/Redis
están containerizados, para desarrollo local) — construirlos es parte de
este trabajo, sea cual sea el proveedor elegido.

## 2. Opción A — Todo administrado (recomendada para arrancar)

Menor esfuerzo operativo; el costo escala con el uso pero parte de niveles
gratuitos generosos para el volumen de un piloto.

| Componente | Proveedor sugerido | Costo estimado/mes | Por qué |
|---|---|---|---|
| Backend (proceso persistente) | Railway | $5–10 | Detecta el `Dockerfile`/Nixpacks automáticamente, despliega con `git push`, TLS y logs incluidos. |
| PostgreSQL | Neon | $0 (free tier) | Postgres serverless real, autosuspend cuando no hay tráfico — ideal para el volumen bajo de un piloto. Incluye backups/point-in-time recovery incluso en el free tier. |
| Redis | Upstash | $0 (free tier) | Redis serverless, cobra por comando; el volumen de BullMQ de un piloto (cientos de jobs/día) no se acerca al límite gratuito. |
| Frontend | Vercel o Cloudflare Pages | $0 | Build estático de Vite, CDN y TLS automáticos. |
| Dominio | Cualquier registrador (Namecheap, Cloudflare) | ~$1 (amortizado anual) | Opcional si te alcanza con el subdominio gratuito del proveedor. |
| **Total** | | **~$6–11/mes** | Dentro de la meta de D-005 (<$30/mes). |

**Trade-off:** casi todo el costo es variable/por uso — si el tráfico crece
mucho más allá de un piloto, esto puede subir más rápido que la Opción B.

## 3. Opción B — VPS propio (más barato, más trabajo tuyo)

Costo fijo más bajo, pero tú (o quien administre) asume parches de sistema
operativo, monitoreo y backups manuales.

| Componente | Proveedor sugerido | Costo estimado/mes |
|---|---|---|
| VPS único (Postgres + Redis + backend + Caddy/nginx sirviendo el frontend) | Hetzner Cloud CX22 (2 vCPU/4GB) | ~€4.5 (~$5) |
| TLS | Caddy (automático) o certbot | $0 |
| Backups | `database/scripts/backup.sh` (ya existe) adaptado + cron + almacenamiento externo (Backblaze B2) | ~$0.50 |
| **Total** | | **~$5.50/mes** |

**Trade-off:** el propio `docker-compose.yml` de este repo ya define
Postgres/Redis con la configuración correcta — desplegar en un VPS es
extender ese mismo archivo, no reinventarlo. Pero backups, actualizaciones
de seguridad del SO y monitoreo de caídas quedan por tu cuenta (o hay que
automatizarlos aparte, que también es trabajo).

## 4. Recomendación

**Empezar con la Opción A.** Para un piloto de 1-5 tenants el esfuerzo
operativo de la Opción B no se justifica todavía, y los niveles gratuitos de
Neon/Upstash/Vercel cubren el volumen actual sin acercarse a sus límites.
Revisar la Opción B más adelante si el tráfico crece lo suficiente como para
que el costo por uso de la Opción A supere el costo fijo de un VPS.

## 5. División de responsabilidad

| Acción | Quién |
|---|---|
| Crear las cuentas (Railway, Neon, Upstash, Vercel) | Propietario — requiere email y, en la mayoría, método de pago |
| Verificación de negocio en Meta Business Manager | Propietario — Meta lo exige directamente con el dueño |
| Cuenta OpenAI (si se activa redacción natural) | Propietario |
| Elegir/aprobar el proveedor final | Propietario |
| Escribir `Dockerfile`s, configuración de despliegue, CI/CD | Continuidad técnica (IA u otro desarrollador) |
| Conectar el repo a la infraestructura vía API keys/tokens que el propietario genere | Continuidad técnica, una vez recibidas las credenciales |
| Ejecutar migraciones, seeds iniciales y despliegue una vez la cuenta esté activa | Continuidad técnica |

## 6. Pendiente antes de poder desplegar, sin importar el proveedor

- `Dockerfile` para `backend/` (build de NestJS) y para `frontend/` (build
  estático servido por nginx o subido directo al host estático elegido).
- CI/CD: correr `npm run test`/`test:integration`/`lint`/`build` en cada
  push antes de desplegar (no existe pipeline hoy).
- Adaptar `database/scripts/backup.sh`/`migrate.sh` a un entorno sin
  `docker compose exec` local si se elige Opción A (Neon expone su propia
  cadena de conexión; los scripts actuales asumen el contenedor local).
- Plan de incidentes y alertas — no definido todavía (P2 del roadmap).
