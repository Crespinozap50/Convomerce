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

1. **Diseño propuesto en D-039** (`docs/operational-requirements.md`). Los requisitos operativos todavía modelan principalmente nombre, teléfono y dirección mediante bloques de código cableados por campo (`awaiting_X` en `commercial-flow.service.ts`) en vez de datos configurables. Además, la validación de dirección codifica el formato colombiano de nomenclatura urbana como si fuera universal — confirmado por auditoría de código el 2026-08-30. Deben evolucionar a campos configurables y tipados para datos como vehículo, alergias declaradas, preferencia de profesional o información de facturación, con reglas de validación también configurables por locale.
2. El perfil operativo admite traducciones aprobadas, pero catálogo, variantes y FAQ aún necesitan el mismo modelo de localización administrable. (Sin diseño propuesto todavía; sigue como P1.)
3. **Diseño propuesto en D-040** (`docs/operational-requirements.md`). Los mensajes que contienen varios datos deben convertirse en un conjunto de entidades verificadas y completar varios pasos sin omitir confirmaciones sensibles — confirmado por auditoría que hoy el motor solo llena un campo por turno.

Estas brechas se consideran trabajo del núcleo y no deben resolverse con condiciones específicas por tenant.
