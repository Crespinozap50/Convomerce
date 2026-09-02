# Requisitos operativos configurables y extracción multi-entidad

> Estado: **diseño propuesto**, pendiente de revisión y aprobación antes de implementar.
> Implementa D-039 y D-040 de `docs/decisions.md`.

## 1. Problema

Auditoría de código de 2026-08-30 confirmó dos hechos con evidencia directa:

1. Los datos que el flujo comercial/de citas necesita (nombre, dirección, modalidad) están resueltos con bloques `if(flow.step === "awaiting_X")` cableados uno por uno en `commercial-flow.service.ts` (~15 bloques mutuamente excluyentes). Agregar un campo nuevo (marca de vehículo, alergia declarada, profesional preferido) exige tocar ese código central, violando la regla de oro 1 del handoff ("el motor se modela por capacidades, no por industrias") en la práctica, aunque no en la letra.
2. La validación de dirección (`isAddressDetailedEnough`) codifica el formato colombiano de nomenclatura urbana (`#`, patrón `\d+-\d+`) como si fuera universal. Los fixtures de prueba usan literalmente "Robledo" (barrio de Medellín) como caso de rechazo — evidencia de que nunca se probó contra un formato no colombiano.
3. El motor extrae como máximo un campo por turno. Un mensaje como "lavado premium para camioneta mañana a las 3pm" solo llena el campo del paso actual e ignora el resto del mensaje, forzando turnos redundantes que un humano no necesitaría.

## 2. Objetivo

Convertir "qué datos necesita esta operación" en **datos consultados dinámicamente**, no en código, y permitir que un mensaje llene varios de esos datos a la vez cuando la confianza de extracción lo permite.

## 3. Modelo de datos (borrador, migración 056+)

No se ejecuta todavía — esto es un borrador para discusión.

```sql
-- 056_operational_requirements.sql (borrador)

create table app.operational_requirements (
  id uuid primary key default app.uuidv7(),
  tenant_id uuid not null references app.tenants(id),
  capability text not null check (capability in ('orders','appointments')),
  catalog_item_id uuid references app.catalog_items(id), -- null = aplica a toda la capacidad
  field_key text not null,               -- identificador estable: 'delivery_address', 'vehicle_type'
  data_type text not null check (data_type in
    ('text','number','select','date','time','address','phone','boolean')),
  is_required boolean not null default true,
  display_order integer not null default 0,
  validation_rule jsonb not null default '{}'::jsonb, -- min_length, pattern, min/max, opciones, etc.
  sensitivity text not null default 'none' check (sensitivity in ('none','pii','sensitive')),
  retention_days integer,                -- null = política por defecto del tenant
  requires_confirmation boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, capability, catalog_item_id, field_key)
);
-- RLS + FK compuesta (tenant_id, id) siguiendo el patrón ya establecido.

create table app.operational_requirement_localizations (
  requirement_id uuid not null references app.operational_requirements(id),
  locale text not null,
  label text not null,          -- pregunta/etiqueta mostrada al cliente
  help_text text,
  primary key (requirement_id, locale)
);

create table app.operational_requirement_options (
  requirement_id uuid not null references app.operational_requirements(id),
  option_value text not null,
  display_order integer not null default 0,
  primary key (requirement_id, option_value)
);

create table app.operational_requirement_option_localizations (
  requirement_id uuid not null,
  option_value text not null,
  locale text not null,
  label text not null,
  primary key (requirement_id, option_value, locale),
  foreign key (requirement_id, option_value)
    references app.operational_requirement_options (requirement_id, option_value)
);
```

`validation_rule` es JSON declarativo mínimo por `data_type`, no un lenguaje de reglas nuevo:

- `text`: `{ "min_length": int, "max_length": int, "min_words": int }`
- `address`: `{ "min_length": int, "min_words": int, "require_number": bool, "structure_pattern": "colombian_urban" | "generic_numbered" | "none" }` — la heurística colombiana actual se convierte en un valor de `structure_pattern`, no en el único comportamiento posible.
- `number`: `{ "min": number, "max": number }`
- `select`: usa `operational_requirement_options`, sin regla adicional.
- `phone`: `{ "country_hint": "CO" | "US" | ... }` opcional, solo para mensajes de ayuda, nunca para rechazar formatos válidos de otro país.
- `date` / `time`: `{ "min_horizon_days": int, "max_horizon_days": int }`.

### Migración de datos existentes

Los tenants ya configurados con nombre/teléfono/dirección obtienen filas de requisito por defecto generadas en la misma migración (`is_required=true`, `data_type` correspondiente), preservando comportamiento actual salvo por la generalización de `structure_pattern`. No se borra ni reescribe ningún dato de negocio existente.

## 4. Extracción multi-entidad

### 4.1 Contrato

El proveedor de comprensión determinístico expone hoy un intent + entidades planas. Se extiende (sin romper el contrato estable existente, ver `docs/conversation-understanding.md`) con un modo de extracción **guiado por lista de requisitos pendientes**:

```
extractRequirementValues(message, pendingRequirements[]) ->
  {
    filled: [{ field_key, value, confidence }],
    ambiguous: [{ field_key, candidates: [...], reason }],
    unmatched: [field_key, ...]   // requisitos que el mensaje no toca
  }
```

- Cada `field_key` pendiente aporta su propio matcher según `data_type` (reutilizando lo ya existente para fecha/cantidad/dirección; extendiendo a select/boolean/number genéricos).
- Un valor entra a `filled` solo si su confianza supera el umbral del tipo de dato (fechas y selects, alta precisión; texto libre, umbral más conservador).
- `requires_confirmation=true` en el requisito **siempre** exige confirmación explícita del usuario en un paso posterior, sin importar la confianza — no se puede completar automáticamente un dato sensible aunque la extracción esté segura. Esto preserva la regla de oro 9 del handoff sin excepción.

### 4.2 Regla de fallback conservador

Si `ambiguous` tiene 2 o más entradas simultáneas, o el mensaje no permite separar valores con confianza razonable (heurística: más de un `data_type` compatible reclama el mismo substring), el flujo **no adivina**: cae al comportamiento actual de pedir un campo a la vez, empezando por el de mayor prioridad (`display_order`). Esto es explícitamente conservador — preferimos un turno extra a una asignación incorrecta de un pedido o cita real.

### 4.3 Ejemplo por industria

| Mensaje | Requisitos pendientes | Resultado |
| --- | --- | --- |
| "lavado premium para camioneta mañana a las 3pm en la 70 con 45" | vehicle_type, service_date, service_time, address | 4/4 `filled` si la dirección supera el umbral configurado; si no, solo `address` queda `ambiguous` |
| "quiero un masaje con Laura el viernes" | professional_preference, service_date | 2/2 `filled` |
| "3 tacos de birria y una coca" | item, quantity | ya cubierto hoy (sin cambio) |

## 5. Qué NO cambia

- El motor de decisión (`ConversationDecisionEngine`) sigue siendo el único punto que activa una capacidad; este trabajo no toca su enrutamiento.
- Los hechos (precio, disponibilidad, producto) siguen siendo deterministas; la extracción multi-entidad no autoriza acciones, solo llena campos que luego pasan por la validación y confirmación existentes.
- No se relaja la confirmación explícita para pedidos/citas (regla de oro 9): sigue habiendo un resumen final y una confirmación inequívoca antes de crear/modificar una solicitud comercial.

## 6. Plan de entrega incremental

1. ✅ Migración 056: esquema + backfill de requisitos por defecto para tenants existentes (sin cambio de comportamiento visible). Implementada 2026-08-31; `name` se sembró como fila comodín `fulfillment_type='*'` (corrección sobre el borrador original, ver D-039 en `docs/decisions.md`).
2. ✅ Servicio `OperationalRequirementsService`: CRUD tenant-scoped (`backend/src/operational-requirements/`). Incluye `setOptionLocalization` (etiqueta por idioma de cada opción de un campo tipo "selección"), añadido durante la implementación del panel — no estaba en el diseño original.
3. ✅ Refactor de `commercial-flow.service.ts`/`appointment-flow.service.ts`: los bloques `awaiting_name`/`awaiting_saved_address`/`awaiting_address`/`awaiting_address_consent` fueron reemplazados por un paso genérico `awaiting_requirement:{field_key}`, con `requirement-loop.ts` como capa de funciones puras compartidas (selección del siguiente pendiente, validación por tipo). Verificado con 193 pruebas de backend (incluye regresión explícita de los casos nombre+dirección y modalidad sin dirección) y la suite SQL.
3.5. ✅ Panel admin en `frontend/src/operational-requirements/OperationalRequirementsPanel.tsx`, integrado en la navegación existente de "Conocimiento" sin reestructurar `App.tsx`. Probado en navegador real: crear, localizar, agregar opciones y activar un requisito nuevo funcionan de punta a punta.
4. Extractor multi-entidad (D-040): primero para `date`/`select`/`number` (mayor confianza), luego `address`/`text` libre. No iniciado — depende de que el esquema (paso 1-3) esté estable en producción.
5. Matriz de aceptación multiindustria (ya priorizada en el handoff) ejecutada contra este modelo: restaurante, spa, lavadero, tecnología, y al menos una industria nueva no contemplada hasta ahora (peluquería o taller) para validar que agregarla es solo configuración. No iniciado.
6. Actualizar `docs/cross-industry-conversation-engine.md` marcando la brecha 1 y 3 como resueltas. Brecha 1 (requisitos configurables) resuelta para el caso base; brecha 3 (multi-entidad) sigue pendiente hasta el paso 4.

## 7. Riesgos y mitigaciones

- **Riesgo:** el refactor de la máquina de estados puede introducir regresiones en flujos ya probados manualmente (ver §18.1 del handoff, conversaciones preservadas). *Mitigación:* congelar snapshots de las conversaciones de prueba actuales como fixtures antes de tocar `commercial-flow.service.ts`, y no ejecutar `db-reset`.
- **Riesgo:** extracción multi-entidad mal calibrada podría asignar un valor incorrecto silenciosamente. *Mitigación:* umbral conservador + fallback a pregunta por campo cuando hay ambigüedad, tal como se especifica en §4.2.
- **Riesgo:** UI administrativa de requisitos configurables agrega superficie a un frontend ya monolítico (`App.tsx`, 4,995 líneas). *Mitigación:* construir el nuevo panel de requisitos como componente aislado desde el día uno, no agregarlo al archivo existente — primer paso concreto de la modularización pendiente (P2 del plan de auditoría).
