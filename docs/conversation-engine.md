# Motor conversacional mantenible

## Objetivo

La conversación debe sentirse natural sin permitir que un modelo invente precios,
disponibilidad o acciones. La arquitectura separa deliberadamente comprensión,
reglas comerciales, presentación y transporte.

## Primer corte implementado

```text
Webhook de WhatsApp
        │
        ├── texto ───────────────────────────────┐
        └── botón/lista ─ normalización ─────────┤
                                                 ▼
                                      flujo comercial seguro
                                                 │
                                      recomendador determinístico
                                                 │
                               texto, botones o lista independientes de Meta
                                                 │
                                      adaptador WhatsApp Cloud API
```

### Mensajes interactivos

`backend/src/interactive-messages/` contiene contratos propios para botones y
listas. El dominio no construye JSON de Meta. El adaptador convierte estos
contratos al formato externo y valida límites antes de enviar.

Una selección entrante conserva dos valores:

- `id`: comando estable para el backend, por ejemplo `rec:add:<uuid>`;
- `title`: texto visible que también permite continuar la conversación de forma
  natural y auditable.

La lógica nunca debe depender de títulos como “Sí, agregar”, porque pueden cambiar
por tono o idioma.

### Recomendaciones

`backend/src/recommendations/` selecciona candidatos desde relaciones explícitas
en `app.product_recommendations`. Solo considera productos activos, disponibles,
no presentes en el carrito y no ofrecidos anteriormente en la misma solicitud.

La migración `045_product_recommendations.sql` agrega:

- relaciones `complements`, `upgrade_to`, `often_bought_with`,
  `compatible_with` y `substitute_for`;
- prioridad configurable por tenant;
- eventos `shown`, `accepted`, `rejected` y `expired` para medir impacto;
- RLS, claves multiempresa e índices.

Aceptar una recomendación vuelve a comprobar disponibilidad dentro de la
transacción. Un botón antiguo no puede agregar silenciosamente un producto que ya
no está disponible.

El fixture local de Santos Tacos configura relaciones de complemento desde sus
productos de comida hacia una bebida disponible. Esto permite probar el recorrido
completo sin introducir condiciones del restaurante en el motor. Una recomendación
se presenta como máximo una vez por producto objetivo y solicitud; rechazarla no
provoca que el sistema insista durante el mismo pedido.

## Regla de diseño para la futura IA

La IA podrá:

- comprender lenguaje libre y referencias como “el segundo”;
- elegir el tono y redactar la pregunta;
- resumir contexto y evitar repeticiones.

La IA no podrá:

- crear candidatos de recomendación fuera del catálogo;
- decidir precios o disponibilidad;
- modificar directamente pedidos o citas;
- convertir texto libre en una acción sin validación de dominio.

## Cómo extenderlo

1. Agregar una relación de recomendación como dato del tenant.
2. Mantener la selección y el ranking en `RecommendationService`.
3. Representar nuevas presentaciones en `interactive-message.types.ts`.
4. Traducirlas a Meta únicamente en `whatsapp-adapter.ts`.
5. Añadir primero pruebas con nombres que describan el comportamiento comercial.

No agregar condiciones con nombres de clientes ni SQL al generador de lenguaje.

## Próximo incremento

Crear un banco versionado de conversaciones y el contrato estructurado del motor
de comprensión. Después se conectará OpenAI detrás de una interfaz, conservando el
motor determinístico como validador y fallback.
