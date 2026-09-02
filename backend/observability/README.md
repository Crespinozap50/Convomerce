# Observabilidad

## Endpoints internos

`GET /internal/metrics` entrega formato Prometheus y
`GET /internal/metrics/status` compara el estado actual con umbrales locales.
Ambos requieren:

```http
Authorization: Bearer <METRICS_BEARER_TOKEN>
```

El token no se reutiliza como secreto de Meta ni autenticación de usuarios. En
producción debe proceder de un almacén de secretos y rotarse independientemente.

## Métricas iniciales

- `commerce_outbox_pending`: eventos listos que aún no fueron publicados.
- `commerce_outbox_expired_leases`: publicaciones abandonadas o demoradas.
- `commerce_bullmq_failed_jobs`: trabajos retenidos en estado fallido.
- `commerce_http_request_duration_seconds`: histograma HTTP por método, ruta
  estática y código de respuesta.
- `commerce_webhook_requests_total`: webhooks aceptados o rechazados por una
  categoría acotada.

No se usan tenant, teléfono, mensaje, evento, correlación ni URL completa como
labels. Esos valores provocarían cardinalidad no controlada y podrían exponer
información de negocio.

## Umbrales iniciales

| Señal | Umbral | Espera | Severidad |
|---|---:|---:|---|
| Outbox pendiente | 100 | 5 min | warning |
| Lease outbox vencido | 1 | 2 min | critical |
| Trabajo BullMQ fallido | 1 | 1 min | critical |
| Latencia HTTP p95 | 1 segundo | 10 min | warning |
| Webhooks rechazados | más de 10/5 min | 2 min | warning |

Son valores conservadores para el MVP y deben ajustarse con tráfico observado.
`prometheus-alerts.yml` contiene las reglas propuestas, pero este repositorio no
instala Prometheus, Alertmanager ni un destino de notificación.

Los tres umbrales de backlog también se configuran mediante variables de entorno
para `/internal/metrics/status`. Si cambian, las reglas Prometheus deben revisarse
en la misma entrega para evitar criterios contradictorios.
