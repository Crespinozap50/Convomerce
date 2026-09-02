process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??=
  'postgresql://postgres:local_postgres_only@localhost:54329/whatsapp_commerce';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '56379';
process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
process.env.COMMERCE_WORKER_ENABLED = 'false';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'integration-fixture-verify-token';
process.env.WHATSAPP_APP_SECRET = 'integration-fixture-app-secret';
process.env.METRICS_BEARER_TOKEN = 'integration-fixture-metrics-token';
