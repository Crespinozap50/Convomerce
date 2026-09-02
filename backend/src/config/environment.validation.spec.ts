import { validateEnvironment } from './environment.validation';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:local@localhost:54329/commerce',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token-long',
  WHATSAPP_APP_SECRET: 'fixture-app-secret-long',
  METRICS_BEARER_TOKEN: 'fixture-metrics-token-long-enough',
  CREDENTIAL_ENCRYPTION_KEY: 'fixture-credential-encryption-key-at-least-32-characters',
};

describe('validateEnvironment', () => {
  it('normaliza valores y aplica defaults explícitos', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      NODE_ENV: 'test', PORT: 3000, REDIS_PORT: 56379,
      OUTBOX_PUBLISHER_ENABLED: 'true', COMMERCE_WORKER_ENABLED: 'true',
      OUTBOX_PENDING_WARNING: 100,
      SESSION_TTL_HOURS: 8,
      OPENAI_RESPONSE_REWRITING_ENABLED:'false',
      OPENAI_RESPONSE_MODEL:'gpt-5.4-nano',
      OPENAI_RESPONSE_TIMEOUT_MS:8000,
      OPENAI_INPUT_COST_MINOR_PER_MILLION:100,
      OPENAI_OUTPUT_COST_MINOR_PER_MILLION:400,
    });
  });

  it.each([
    [{ ...valid, DATABASE_URL: 'http://localhost' }, 'postgresql'],
    [{ ...valid, OUTBOX_BATCH_SIZE: 'cero' }, 'OUTBOX_BATCH_SIZE'],
    [{ ...valid, COMMERCE_WORKER_ENABLED: 'quizás' }, 'COMMERCE_WORKER_ENABLED'],
    [{ ...valid, NODE_ENV: 'production' }, 'fixture'],
    [{ ...valid, METRICS_BEARER_TOKEN: 'corto' }, 'METRICS_BEARER_TOKEN'],
    [{ ...valid, WHATSAPP_ADAPTER_MODE: 'real' }, 'WHATSAPP_ADAPTER_MODE'],
    [{ ...valid, WHATSAPP_ADAPTER_MODE: 'meta' }, 'WHATSAPP_GRAPH_API_VERSION'],
    [{ ...valid, SESSION_TTL_HOURS: 0 }, 'SESSION_TTL_HOURS'],
    [{ ...valid, SESSION_TTL_HOURS: 169 }, 'SESSION_TTL_HOURS'],
    [{ ...valid, CREDENTIAL_ENCRYPTION_KEY: '' }, 'CREDENTIAL_ENCRYPTION_KEY'],
    [{ ...valid, CREDENTIAL_ENCRYPTION_KEY: 'too-short' }, 'CREDENTIAL_ENCRYPTION_KEY'],
    [{ ...valid, OPENAI_RESPONSE_REWRITING_ENABLED: 'true' }, 'OPENAI_API_KEY'],
    [{ ...valid, OPENAI_RESPONSE_TIMEOUT_MS: 10001 }, 'OPENAI_RESPONSE_TIMEOUT_MS'],
  ])('rechaza configuración insegura', (environment, expected) => {
    expect(() => validateEnvironment(environment)).toThrow(expected);
  });
});
