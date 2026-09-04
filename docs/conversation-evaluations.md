# Evaluaciones conversacionales

## Propósito

Los cambios de reglas, catálogos, prompts o providers deben demostrar que mejoran la conversación sin romper acciones comerciales. Las evaluaciones son una barrera adicional a las pruebas unitarias: usan frases cercanas a cómo escriben clientes reales y reportan resultados por idioma.

## Suite inicial

`backend/evals/conversation-understanding.json` y `backend/evals/conversation-multiturn.json` contienen 74 turnos equilibrados entre español e inglés (D-111 amplió de 48 a 74). La segunda suite organiza los turnos como recorridos completos de pedido, entrega, cita, corrección de carrito, recomendación y handoff. Cubren:

- intención de compra y cantidades;
- catálogo, precio y resumen del pedido;
- quitar productos y cambiar cantidades;
- domicilio y recogida;
- crear, consultar, cancelar y reprogramar citas;
- solicitud de atención humana;
- confirmaciones, rechazos y selecciones numéricas;
- búsqueda de productos y selección indiferente de recursos;
- saludos, corrección de producto, mensaje incompleto ("Quiero" sin nombrar nada), negación que redirige la modalidad de entrega, cancelación completa de un pedido (D-111);
- una conversación larga de 12 turnos que combina varias de las categorías anteriores en una sola sesión realista (D-111).

"Cambios de idioma" (también pedido por el roadmap) no vive en este arnés: `run-conversation-understanding.ts` llama directamente al proveedor de comprensión con un `configuredLocale` fijo, nunca a `ConversationLanguageService` — el componente real que decide y persiste el idioma. Esa cobertura vive en `backend/src/localization/conversation-language.service.spec.ts` (detección inicial, estabilidad ante mensajes ambiguos, regla de dos mensajes consecutivos para cambiar, y desde D-111 también la prioridad de la preferencia conocida del contacto).

Cada caso declara resultados observables: intención, acción solicitada, entidades, términos de búsqueda y necesidad de intervención humana. No evalúa ni almacena razonamiento interno.

## Ejecución

```bash
make backend-eval
```

El comando produce JSON apto para CI con puntaje general, puntaje por idioma y diferencias por caso. La línea base exige 100 % porque estas suites iniciales son pequeñas y contienen acciones críticas conocidas. Toda nueva regresión hace fallar el proceso.

La primera ejecución reveló que `pick it up` no se reconocía como recogida aunque `pickup` y `pick up` sí. La regla se generalizó y el caso quedó como protección permanente.

## Calidad de respuesta natural

La comprensión exacta es solo una dimensión. Antes del rollout productivo se añadirá una suite de respuestas con revisión ciega y escala de 1 a 5 para:

1. exactitud factual;
2. naturalidad y calidez;
3. concisión;
4. continuidad con el turno anterior;
5. adecuación cultural e idioma;
6. ausencia de presión comercial o recomendaciones irrelevantes.

Exactitud factual, aislamiento de tenant, identificadores interactivos y acciones válidas son criterios de bloqueo, no promedios compensables. Una respuesta agradable nunca puede compensar un precio, horario o acción incorrectos.

### Comparación ciega

El repositorio incluye un arnés que oculta de forma determinística qué respuesta es la base y cuál es la candidata. El revisor recibe únicamente `A` y `B`, contexto, idioma y hechos protegidos.

`backend/evals/response-review.golden.json` aporta la primera línea base equilibrada: cuatro escenarios en español y cuatro en inglés para confirmación, tiempo de preparación, ausencia de pedido activo y transferencia humana. Cada escenario conserva hechos que ninguna mejora de estilo puede cambiar.

```bash
cd backend
npm run eval:prepare-review -- \
  evals/response-review.golden.json \
  /tmp/response-review.json \
  /tmp/response-review.key.json

# El revisor completa factualPass y las puntuaciones de 1 a 5 en response-review.json.
npm run eval:score-review -- \
  /tmp/response-review.json \
  /tmp/response-review.key.json
```

El puntaje combina naturalidad, calidez, concisión, continuidad y adecuación cultural. Una respuesta que falla exactitud queda fuera de la comparación y cuenta como fallo factual. El archivo de clave debe permanecer separado del revisor hasta cerrar la calificación.

### Exportar candidatos reales por tenant

Cuando el rollout genere respuestas OpenAI válidas, el mensaje conserva en metadata la respuesta determinística original y sus valores protegidos. La exportación exige un `tenant_id` explícito y nunca mezcla filas de empresas distintas:

```bash
cd backend
set -a
source .env
npm run eval:export-review -- \
  0194f000-0000-7000-8000-000000000001 \
  /tmp/tenant-response-candidates.json \
  50
```

El archivo se crea con permisos `0600`. Puede contener fragmentos de conversación y debe tratarse como dato sensible: mantenerlo fuera de Git, compartirlo únicamente con revisores autorizados y eliminarlo conforme a la política de retención. Después se pasa por `eval:prepare-review` para separar el paquete ciego de su clave.

Si todavía no hay respuestas con `rewriting.mode=openai`, la exportación produce una lista vacía. No genera respuestas ni realiza llamadas a OpenAI.

## Evolución del conjunto

- Agregar todo fallo confirmado como caso reproducible.
- Mantener ejemplos de ambos tenants sin incluir nombres en las reglas.
- Separar conjunto de desarrollo y conjunto ciego cuando exista suficiente volumen.
- Versionar cambios de criterios junto con prompts y modelos.
- Comparar provider determinístico, híbrido y OpenAI sobre exactamente los mismos casos.
- Medir costo y latencia junto con calidad antes de ampliar rollout.
