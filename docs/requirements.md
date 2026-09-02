# Requisitos iniciales

## Funcionales

- Registrar y administrar múltiples tenants.
- Vincular cada evento entrante con un único tenant.
- Mantener contactos, conversaciones y mensajes aislados por `tenant_id`.
- Configurar identidad, tono, catálogo, políticas y prompts por tenant.
- Consultar datos autorizados antes de afirmar precios, disponibilidad o políticas.
- Detectar incertidumbre y escalar en vez de inventar información.
- Preparar un pedido u oportunidad comercial y solicitar confirmación antes de acciones sensibles.
- Escalar a una persona con resumen, intención y siguiente acción sugerida.
- Registrar errores, fuentes consultadas, decisiones relevantes, resultado y consumo básico.
- Presentar decisiones simples mediante botones o listas sin impedir respuestas libres.
- Recomendar únicamente productos configurados, compatibles y disponibles, sin repetir ofertas rechazadas.
- Medir recomendaciones mostradas, aceptadas y rechazadas, así como su aporte al valor del pedido.

## No funcionales

- Evitar filtraciones de datos entre tenants.
- Procesar webhooks de forma autenticada, idempotente y tolerante a reintentos.
- Hacer cumplir el aislamiento mediante claves foráneas compuestas, filtros de aplicación y RLS forzado.
- Registrar efectos asíncronos mediante outbox y deduplicarlos en cada consumidor.
- Proteger secretos y datos personales.
- Contar con trazabilidad suficiente para diagnosticar conversaciones.
- Mantener el MVP simple y con costo operativo objetivo inferior a USD 30 mensuales.
- Mantener separados dominio, presentación interactiva, proveedor de mensajería e IA para facilitar mantenimiento y pruebas.

## Criterios por definir

- Tiempos de respuesta y disponibilidad esperados.
- Volumen de mensajes y tenants soportados.
- Límites de costo y uso por tenant.
- Reglas de aprobación humana y contenidos prohibidos.
- Retención de conversaciones y consentimiento.
- Almacenamiento de multimedia y proveedor de secretos.

## Métricas del piloto

- Porcentaje de conversaciones resueltas sin intervención humana.
- Porcentaje de conversaciones que producen un pedido preparado u oportunidad calificada.
- Tasa de escalamiento correcto y de respuestas no sustentadas detectadas en evaluación.
- Tiempo hasta primera respuesta y tiempo hasta resultado.
- Costo por conversación y por resultado comercial.
- Satisfacción del operador y correcciones humanas requeridas.

Los umbrales de aceptación se definirán después de obtener una línea base con conversaciones reales anonimizadas o escenarios representativos.

Los recorridos y escenarios iniciales del primer tenant están definidos en [pilot-santos-tacos.md](pilot-santos-tacos.md).
