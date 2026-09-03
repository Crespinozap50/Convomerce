# Matriz de aceptación — Fase 2 (validación multiempresa)

Cubre lo que pide [roadmap.md](roadmap.md) para Fase 2: catálogo, pedidos, citas,
recursos, conocimiento y recomendaciones, verificados en vivo contra los 5
tenants sembrados, con una instalación de base de datos genuinamente fresca
(`docker compose down --volumes` → `migrate.sh` → `seed.sh`), no contra un
entorno de desarrollo con historia acumulada.

Cada celda se probó enviando webhooks de WhatsApp simulados a un contacto de
prueba aislado, verificando la respuesta directamente en `app.messages`, y
limpiando todos los datos de prueba al terminar (ver `docs/decisions.md`, D-060).

## Resultado

| Dimensión | Santos Tacos (restaurante) | CrediCel Store (tecnología) | Distrito Barbería | Botánica Spa | Ruta 80 Car Wash |
|---|---|---|---|---|---|
| **Catálogo** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Pedidos** | ✅ | ✅ | N/A (`orders` deshabilitado) | N/A | N/A |
| **Citas** | N/A (`appointments` deshabilitado) | N/A | ✅ | ✅ | ✅ |
| **Recursos** (asignación de profesional/bahía + disponibilidad) | N/A | N/A | ✅ | ✅ (no reprobado en esta ronda; validado en D-075 y por diseño compartido con barbería) | ✅ |
| **Conocimiento** (FAQ) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Recomendaciones** | ✅ | N/A (sin reglas configuradas) | N/A | N/A | N/A |

N/A = la capacidad no está habilitada para ese tenant, o no tiene reglas
configuradas — no es un hueco, es una diferencia de configuración deliberada
que la propia matriz existe para confirmar (ver la fila de "Aislamiento").

## Aislamiento y ausencia de lógica específica por comercio

Confirmado en cada prueba: ningún tenant usó una rama de código propia. Las
diferencias observadas (CrediCel sin domicilio, Santos Tacos sin citas,
barbería/spa/lavadero sin pedidos) vienen enteramente de `app.tenant_capabilities`
y de los datos sembrados por tenant — nunca de un `if` por nombre de negocio.
Confirmado también en D-075 (portabilidad de CrediCel) y en la auditoría de
D-077/D-078/D-079 (retiro del vocabulario global compartido entre rubros).

## Hallazgos reales encontrados construyendo esta matriz

Antes de poder probar nada, la primera pasada contra una instalación fresca
reveló que **3 de los 5 tenants no eran alcanzables o no funcionaban en absoluto**
en una instalación nueva — toda esa configuración vivía únicamente en la base
de datos de desarrollo de larga duración de esta sesión, nunca en un archivo
versionado:

- **D-083** — CrediCel Store no tenía ninguna fila en `app.tenant_capabilities`;
  su flujo de pedidos estaba completamente roto.
- **D-084** — Barbería, spa y lavadero no tenían ningún canal de WhatsApp
  sembrado; eran inalcanzables por webhook.
- **D-082** — `app.operational_requirements` (el paso de "¿cómo te llamas?")
  estaba vacío para todos los tenants.

Ya con la base corregida, la primera prueba de conocimiento contra la
barbería encontró un cuarto bug real:

- **D-085** — "¿Atienden niños?" (una FAQ real) respondía el horario de
  atención en su lugar, porque "atienden" es palabra clave del intent fijo
  `hours` — la misma familia de colisión de D-077, nunca corregida para
  `hours`/`location`/`delivery`/`payments`. Generalizado a los 6 intents fijos.

Los cuatro quedaron corregidos y verificados con una instalación 100% fresca
antes de completar esta matriz — ver el detalle técnico completo de cada uno
en [decisions.md](decisions.md).

## Qué no cubre esta ronda

- **Recursos para spa**: se probó el arranque de reserva (selección de
  servicio) pero no se volvió a completar hasta ver horarios disponibles en
  esta ronda — sí se validó ese mecanismo específico contra barbería y
  lavadero, y comparte el mismo código (`appointment-flow.service.ts`) sin
  ninguna rama por tenant, así que el riesgo de que spa se comporte distinto
  es bajo, pero queda como pendiente formal si se quiere cobertura exhaustiva.
- ~~Localizaciones administrables para catálogo/variantes/conocimiento~~ —
  **implementado y verificado en vivo** el mismo día (D-086): traducción al
  inglés opcional para ofertas, entradas de conocimiento y perfil del
  negocio, con fallback verificado al español cuando no hay traducción.
- **Comparación de calidad/conversión/latencia/costo por tenant** — no hay
  métricas desglosadas por tenant hoy; también sigue pendiente en Fase 2.

## Automatizada desde D-091

Esta matriz se probó manualmente el 2026-09-02 (webhooks simulados, limpieza
manual de datos de prueba). Desde D-091 ese snapshot **también** corre como
suite de integración en cada push —
[`backend/test/acceptance-matrix.integration-spec.ts`](../backend/test/acceptance-matrix.integration-spec.ts),
parte de `npm run test:integration` en CI. Cubre, por tenant, exactamente la
clase de bug que la ronda manual encontró (colisión de vocabulario fijo,
datos sembrados incompletos, fuga de routing entre tenants) — no repite la
lógica interna de cada máquina de estados, que ya cubren
`commercial-flow.service.spec.ts` y `appointment-flow.service.spec.ts` con
mocks. Un pedido/cita se verifica hasta que arranca el flujo real (capacidad
correcta, fila `conversation_workflows` activa), no hasta la confirmación
completa — ver D-091 para el detalle de ese recorte deliberado.
