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
process.env.DEV_HARNESS_ENABLED = 'true';
// D-159 (docs/decisions.md) live finding: without these, ConfigModule loads
// the real backend/.env — dotenv fills in only vars NOT already set here,
// and SMTP_* was never one of them. Once D-158 pointed the real .env at
// live Resend credentials, every integration test run started sending
// real invitation/reset emails through Resend instead of MailHog — one
// was rejected outright (Resend refuses example.com addresses), silently
// swallowed by EmailService's own catch (by design, so a real bounce never
// breaks the action that triggered it — but that also means it never
// surfaces as a loud test failure on its own). Forced here the same way
// the WhatsApp/metrics fixture secrets already are, so tests never depend
// on whatever happens to be live in .env.
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '51025';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';
