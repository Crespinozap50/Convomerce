# Piloto inicial: Santos Tacos

## Objetivo

Validar que la plataforma puede atender consultas frecuentes y preparar correctamente un pedido por WhatsApp, reduciendo trabajo manual sin ocultar incertidumbre ni ejecutar acciones sensibles sin confirmación.

Santos Tacos es un tenant de validación. Este documento describe su configuración y escenarios; no autoriza lógica con nombres de comercios dentro del núcleo, el esquema de datos o los flujos compartidos.

## Resultado principal

Una conversación exitosa termina en uno de estos estados explícitos:

- `resolved`: consulta respondida con información autorizada.
- `order_ready`: pedido estructurado y listo para confirmación humana o del cliente.
- `qualified_opportunity`: intención comercial válida que requiere seguimiento.
- `human_handoff`: conversación entregada con contexto a una persona.
- `abandoned`: conversación sin actividad después del plazo definido.
- `failed`: no fue posible procesarla y quedó registrada para revisión.

Los estados son genéricos y deben servir también para otros tipos de comercio.

## Recorrido prioritario

1. El cliente inicia una conversación.
2. La plataforma identifica el tenant a partir del número receptor.
3. Se recuperan identidad, horario, catálogo, políticas y capacidades habilitadas para ese tenant.
4. La IA identifica la intención: consulta, exploración de catálogo, preparación de pedido, seguimiento o solicitud humana.
5. Para preparar un pedido, recopila productos, cantidades, variantes y datos de entrega o recogida definidos como necesarios.
6. Antes de registrar el resultado, presenta un resumen con precios y datos obtenidos de fuentes vigentes.
7. El cliente confirma o corrige el resumen.
8. La plataforma registra el resultado y entrega a una persona cuando la política lo exija.

## Capacidades incluidas

- Responder horarios, cobertura, formas de entrega y políticas configuradas.
- Consultar un catálogo estructurado con productos, variantes, precios y disponibilidad conocida.
- Aclarar opciones faltantes sin repetir preguntas ya respondidas.
- Recomendar alternativas únicamente con criterios disponibles en los datos del tenant.
- Construir y modificar un borrador estructurado de pedido.
- Resumir y escalar la conversación conservando intención y datos recopilados.

## Fuera de alcance del piloto

- Cobrar o confirmar pagos automáticamente.
- Prometer inventario en tiempo real si no existe una fuente vigente.
- Confirmar por sí sola que cocina, despacho u otro sistema operativo aceptó el pedido.
- Calcular rutas de entrega complejas.
- Ejecutar campañas salientes o recuperación automática de clientes.
- Sustituir el canal operativo utilizado por el equipo para aceptar pedidos.

## Reglas de confianza

- Nunca inventar productos, precios, disponibilidad, promociones, tiempos ni zonas de entrega.
- Indicar cuando una respuesta depende de confirmación humana.
- Solicitar confirmación del resumen antes de marcar un pedido como `order_ready`.
- Escalar ante reclamos, riesgo de seguridad, intención ambigua persistente, datos contradictorios o solicitud expresa.
- Evitar pedir datos personales que no sean necesarios para el resultado acordado.
- Registrar la versión de configuración y prompt utilizada en cada decisión asistida por IA.

## Datos mínimos de configuración

- Identidad pública, zona horaria, idioma y tono.
- Número de WhatsApp y credenciales referenciadas de forma segura.
- Horarios y mensajes fuera de horario.
- Catálogo, variantes, precios, disponibilidad y fecha de actualización.
- Modalidades de entrega o recogida y datos requeridos para cada una.
- Políticas, restricciones y condiciones de escalamiento.
- Destino operativo del escalamiento humano.
- Límites de consumo y capacidades de IA habilitadas.

## Escenarios de aceptación

### Consulta simple

Dada una pregunta cubierta por la configuración vigente, la respuesta debe usar esa fuente, mantener el tono del tenant y terminar como `resolved` sin solicitar datos innecesarios.

### Pedido completo

Dada una selección válida, el sistema debe recopilar solo los campos faltantes, calcular el resumen desde el catálogo, solicitar confirmación y producir un borrador estructurado como `order_ready`.

### Producto no disponible

Si la fuente indica que una opción no está disponible, el sistema debe informarlo y ofrecer alternativas existentes sin inventar equivalencias.

### Información insuficiente

Si disponibilidad, precio o política no pueden verificarse, el sistema debe reconocerlo y pasar a `human_handoff` con un resumen útil.

### Cambio de pedido

Si el cliente modifica un elemento antes de confirmar, el sistema debe actualizar el borrador, recalcular el resumen y pedir una nueva confirmación.

### Aislamiento multiempresa

Ante identificadores, contactos o productos de otro tenant, ninguna consulta o respuesta debe revelar esos datos. El intento debe rechazarse y quedar auditado.

## Métricas del piloto

- Exactitud del pedido preparado frente a la conversación.
- Porcentaje de consultas resueltas sin corrección humana.
- Porcentaje de escalamientos útiles y falsos escalamientos.
- Respuestas no sustentadas detectadas en evaluación.
- Tiempo hasta primera respuesta y hasta `order_ready`.
- Correcciones necesarias después del resumen.
- Costo de WhatsApp, infraestructura e IA por conversación y pedido preparado.

## Criterio inicial de salida

Antes de operar con clientes reales se debe ejecutar un conjunto acordado de conversaciones de prueba, sin filtraciones entre tenants ni afirmaciones críticas inventadas. Los umbrales numéricos y el tamaño de la muestra siguen pendientes hasta disponer de ejemplos representativos del negocio.

## Prueba de portabilidad

El mismo recorrido debe admitir el comercio de tecnología cambiando configuración y catálogo. En ese tenant, `order_ready` puede representar una cotización o carrito preliminar y `qualified_opportunity` una recomendación que requiere asesoría; no debe ser necesario alterar los estados ni introducir ramas con el nombre del comercio.
