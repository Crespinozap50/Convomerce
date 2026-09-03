# Hoja de ruta

## Fase 0 — Base

- Acordar el recorrido comercial prioritario, métricas, supuestos de costo y modelo de datos multiempresa.
- Diseñar seguridad, observabilidad y gestión de secretos.
- Preparar un conjunto pequeño de conversaciones de prueba para evaluar respuestas y escalamiento.
- Revisar y aprobar el esquema físico PostgreSQL y su estrategia de migraciones.
- Ejecutar en un entorno local futuro pruebas de restricciones, RLS, roles, idempotencia y outbox antes de conectar NestJS.

## Fase 1 — MVP con primer tenant

- Recibir y enviar mensajes con WhatsApp Cloud API.
- Orquestar la conversación con n8n y OpenAI.
- Persistir contactos, conversaciones, mensajes, catálogo y configuración por `tenant_id`.
- Consultar fuentes autorizadas antes de responder sobre productos, disponibilidad o políticas.
- Preparar un pedido u oportunidad sin ejecutar todavía pagos de forma autónoma.
- Validar recomendaciones contextuales configuradas por tenant, con aceptación,
  rechazo, disponibilidad y medición de eventos; el fixture de Santos Tacos ya
  permite recorrer este caso localmente.
- Incorporar intervención humana con resumen, intención y registros básicos.
- Medir conversaciones atendidas, resultados, escalamiento, latencia y costo.
- Migrar pedidos y citas al contrato `ConversationUnderstanding` manteniendo el provider determinístico como fallback.
- Añadir comprensión con OpenAI solo después de contar con evaluaciones, límites por tenant y trazabilidad de costo.
- Validar la redacción natural opcional sobre plantillas simples con presupuesto, telemetría y rollout ya aislados por tenant; mantener el kill switch global apagado hasta aprobar evaluaciones y alertas operativas.
- Reutilizar variantes de respuesta aprobadas por tenant antes de consumir IA y añadir al panel la futura administración de candidatas, rechazos y promoción global.
- Mantener suites ejecutables bilingües de comprensión y recorridos multi-turno; ejecutar comparación ciega de naturalidad antes del rollout productivo.

El alcance funcional inicial se detalla en [pilot-santos-tacos.md](pilot-santos-tacos.md).

## Fase 2 — Validación multiempresa

- Incorporar el comercio de tecnología solo mediante configuración.
- Mantener una matriz de aceptación para restaurante, tecnología, spa, barbería y lavadero que cubra catálogo, pedidos, citas, recursos, conocimiento y recomendaciones.
- Sustituir requisitos fijos por campos operativos configurables y tipados por tenant, operación y modalidad.
- Añadir localizaciones administrables para catálogo, variantes y entradas de conocimiento usando fallback verificable.
- Validar mensajes con múltiples entidades sin introducir flujos específicos por industria.
- Probar aislamiento, diferencias de catálogo, tono y reglas.
- Confirmar que no se requieren condiciones específicas por comercio.
- Comparar calidad, conversión asistida, latencia y costo por tenant.

Fase 2 completa: matriz de aceptación automatizada en D-091 y comparación de
calidad/conversión/latencia/costo por tenant en D-092
([acceptance-matrix.md](acceptance-matrix.md)).

## Fase 3 — Producto

- Implementar el panel en Next.js, roles, límites de uso y operación repetible.
- Endurecer seguridad, respaldos, monitoreo y despliegues.

Las fechas y criterios de salida de cada fase están pendientes de definición.
