# Motor conversacional multiindustria

## Regla de diseño

El motor se organiza por capacidades y operaciones, no por tipos de negocio. Un tenant configura catálogo, capacidades, recursos, requisitos, conocimiento y modalidades; el código no contiene ramas para restaurantes, spas, lavaderos o comercios de tecnología.

## Mapeo transversal

| Contrato del motor | Restaurante | Spa | Lavadero | Tecnología |
| --- | --- | --- | --- | --- |
| Oferta | plato o bebida | tratamiento | tipo de lavado | producto |
| Variante | tamaño o presentación | duración | tipo de vehículo | modelo o capacidad |
| Operación | pedido | cita | cita o servicio | pedido o cotización |
| Recurso | mesa o repartidor | terapeuta o cabina | bahía o equipo | asesor o inventario |
| Complemento | bebida | ritual adicional | encerado | accesorio |
| Modalidad | domicilio o recogida | en sede | en sede o a domicilio | envío o recogida |

## Garantías implementadas

- Catálogos, precios, disponibilidad, recursos y recomendaciones están aislados por `tenant_id`.
- `ConversationDecisionEngine` ejecuta solamente capacidades habilitadas para el tenant.
- Una oferta reservable se dirige a `appointment`; una oferta vendible se dirige a `order`.
- Las preguntas de conocimiento se comparan con FAQ y políticas publicadas sin depender de una industria fija.
- Idioma, presentación y perfil operativo localizado permanecen separados del dominio.
- Los nombres concretos de productos y servicios pertenecen a seeds o datos administrados, nunca al motor.

## Brechas identificadas

1. **Resuelta (D-039, implementada 2026-08-31)**. Los requisitos operativos ya no están cableados por campo (`awaiting_X` en `commercial-flow.service.ts`); son datos configurables y tipados por tenant/capacidad/oferta (`app.operational_requirements`, migración 056+057). La validación de dirección dejó de codificar el formato colombiano como universal: es una regla declarativa (`structure_pattern`) configurable por tenant/locale. Detalle en `docs/operational-requirements.md`.
2. El perfil operativo admite traducciones aprobadas, pero catálogo, variantes y FAQ aún necesitan el mismo modelo de localización administrable. (Sin diseño propuesto todavía; sigue como P1.)
3. **Resuelta (D-040, implementada 2026-08-31)**. Los mensajes con varios datos se procesan con `extractPendingRequirementValues` (`requirement-loop.ts`), completando varios requisitos pendientes por turno cuando la confianza lo permite, con fallback conservador a una pregunta por campo ante ambigüedad — sin omitir confirmaciones sensibles. Detalle en `docs/operational-requirements.md`.

**Genericidad validada (D-109)**: los tenants usados originalmente para validar el modelo configurable (restaurante, tecnología, spa, barbería, lavadero) ya existían antes de D-039. D-109 cerró esa brecha agregando Peluquería Aurora — una industria nunca configurada antes — solo con datos (`database/seeds/006_peluqueria_aurora.sql`), verificada de punta a punta contra la misma matriz de aceptación sin tocar código.

Estas brechas se consideran trabajo del núcleo y no deben resolverse con condiciones específicas por tenant.
