const validNodeEnvironments = new Set(['development', 'test', 'production']);

export interface ValidatedEnvironment extends Record<string, unknown> {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  OUTBOX_POLL_INTERVAL_MS: number;
  OUTBOX_BATCH_SIZE: number;
  OUTBOX_PUBLISHER_ENABLED: string;
  COMMERCE_WORKER_ENABLED: string;
  COMMERCE_WORKER_CONCURRENCY: number;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  METRICS_BEARER_TOKEN: string;
  OUTBOX_PENDING_WARNING: number;
  OUTBOX_EXPIRED_LEASE_WARNING: number;
  BULLMQ_FAILED_WARNING: number;
  WHATSAPP_ADAPTER_MODE: string;
  WHATSAPP_AUTO_REPLY_ENABLED: string;
  SESSION_TTL_HOURS: number;
  FRONTEND_ORIGIN: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  OPENAI_RESPONSE_REWRITING_ENABLED:string;
  OPENAI_RESPONSE_MODEL:string;
  OPENAI_RESPONSE_TIMEOUT_MS:number;
  OPENAI_API_KEY:string;
  OPENAI_INPUT_COST_MINOR_PER_MILLION:number;
  OPENAI_OUTPUT_COST_MINOR_PER_MILLION:number;
}

export function validateEnvironment(source: Record<string, unknown>): ValidatedEnvironment {
  const nodeEnvironment = stringValue(source.NODE_ENV, 'development');
  if (!validNodeEnvironments.has(nodeEnvironment)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const databaseUrl = requiredString(source.DATABASE_URL, 'DATABASE_URL');
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use the postgresql protocol');
  }

  const verifyToken = requiredString(source.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  const appSecret = requiredString(source.WHATSAPP_APP_SECRET, 'WHATSAPP_APP_SECRET');
  const metricsToken = requiredString(source.METRICS_BEARER_TOKEN, 'METRICS_BEARER_TOKEN');
  const credentialEncryptionKey = requiredString(source.CREDENTIAL_ENCRYPTION_KEY, 'CREDENTIAL_ENCRYPTION_KEY');
  if (credentialEncryptionKey.length < 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters');
  const adapterMode = stringValue(source.WHATSAPP_ADAPTER_MODE, 'fixture');
  if (adapterMode !== 'fixture' && adapterMode !== 'meta') {
    throw new Error('WHATSAPP_ADAPTER_MODE must be fixture or meta');
  }
  if (verifyToken.length < 16 || appSecret.length < 16) {
    throw new Error('Webhook secrets must contain at least 16 characters');
  }
  if (metricsToken.length < 24) throw new Error('METRICS_BEARER_TOKEN must contain at least 24 characters');
  if (nodeEnvironment === 'production' &&
      (verifyToken.includes('fixture') || appSecret.includes('fixture'))) {
    throw new Error('Production does not allow fixture webhook secrets');
  }
  if (nodeEnvironment === 'production' && metricsToken.includes('fixture')) {
    throw new Error('Production does not allow a fixture metrics token');
  }
  if (nodeEnvironment === 'production' && adapterMode === 'fixture') {
    throw new Error('Production does not allow the fixture adapter');
  }
  if (adapterMode === 'meta') {
    const version = requiredString(source.WHATSAPP_GRAPH_API_VERSION, 'WHATSAPP_GRAPH_API_VERSION');
    if (!/^v\d+\.\d+$/.test(version)) throw new Error('WHATSAPP_GRAPH_API_VERSION must use the vNN.N format');
    // Access tokens are now per-tenant, stored encrypted in the database via
    // the Conexiones panel — no global token is required to start the app.
  }
  const responseRewritingEnabled=booleanString(source.OPENAI_RESPONSE_REWRITING_ENABLED,false,'OPENAI_RESPONSE_REWRITING_ENABLED');
  const openAiApiKey=stringValue(source.OPENAI_API_KEY,'').trim();
  if(responseRewritingEnabled==='true'&&openAiApiKey.length<20)throw new Error('OPENAI_API_KEY is required when response rewriting is enabled');
  return {
    ...source,
    NODE_ENV: nodeEnvironment,
    PORT: positiveInteger(source.PORT, 3000, 'PORT'),
    DATABASE_URL: databaseUrl,
    REDIS_HOST: requiredString(source.REDIS_HOST ?? 'localhost', 'REDIS_HOST'),
    REDIS_PORT: positiveInteger(source.REDIS_PORT, 56379, 'REDIS_PORT'),
    OUTBOX_POLL_INTERVAL_MS: positiveInteger(source.OUTBOX_POLL_INTERVAL_MS, 1000, 'OUTBOX_POLL_INTERVAL_MS'),
    OUTBOX_BATCH_SIZE: positiveInteger(source.OUTBOX_BATCH_SIZE, 20, 'OUTBOX_BATCH_SIZE'),
    OUTBOX_PUBLISHER_ENABLED: booleanString(source.OUTBOX_PUBLISHER_ENABLED, true, 'OUTBOX_PUBLISHER_ENABLED'),
    COMMERCE_WORKER_ENABLED: booleanString(source.COMMERCE_WORKER_ENABLED, true, 'COMMERCE_WORKER_ENABLED'),
    COMMERCE_WORKER_CONCURRENCY: positiveInteger(source.COMMERCE_WORKER_CONCURRENCY, 5, 'COMMERCE_WORKER_CONCURRENCY'),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: verifyToken,
    WHATSAPP_APP_SECRET: appSecret,
    METRICS_BEARER_TOKEN: metricsToken,
    OUTBOX_PENDING_WARNING: nonNegativeInteger(source.OUTBOX_PENDING_WARNING, 100, 'OUTBOX_PENDING_WARNING'),
    OUTBOX_EXPIRED_LEASE_WARNING: nonNegativeInteger(
      source.OUTBOX_EXPIRED_LEASE_WARNING, 1, 'OUTBOX_EXPIRED_LEASE_WARNING',
    ),
    BULLMQ_FAILED_WARNING: nonNegativeInteger(source.BULLMQ_FAILED_WARNING, 1, 'BULLMQ_FAILED_WARNING'),
    WHATSAPP_ADAPTER_MODE: adapterMode,
    WHATSAPP_AUTO_REPLY_ENABLED: booleanString(
      source.WHATSAPP_AUTO_REPLY_ENABLED, false, 'WHATSAPP_AUTO_REPLY_ENABLED',
    ),
    SESSION_TTL_HOURS: boundedPositiveInteger(source.SESSION_TTL_HOURS, 8, 1, 168, 'SESSION_TTL_HOURS'),
    FRONTEND_ORIGIN: validHttpUrl(source.FRONTEND_ORIGIN, 'http://localhost:5173', 'FRONTEND_ORIGIN'),
    CREDENTIAL_ENCRYPTION_KEY: credentialEncryptionKey,
    OPENAI_RESPONSE_REWRITING_ENABLED:responseRewritingEnabled,
    OPENAI_RESPONSE_MODEL:stringValue(source.OPENAI_RESPONSE_MODEL,'gpt-5.4-nano'),
    OPENAI_RESPONSE_TIMEOUT_MS:boundedPositiveInteger(source.OPENAI_RESPONSE_TIMEOUT_MS,8000,250,10000,'OPENAI_RESPONSE_TIMEOUT_MS'),
    OPENAI_API_KEY:openAiApiKey,
    OPENAI_INPUT_COST_MINOR_PER_MILLION:nonNegativeInteger(source.OPENAI_INPUT_COST_MINOR_PER_MILLION,100,'OPENAI_INPUT_COST_MINOR_PER_MILLION'),
    OPENAI_OUTPUT_COST_MINOR_PER_MILLION:nonNegativeInteger(source.OPENAI_OUTPUT_COST_MINOR_PER_MILLION,400,'OPENAI_OUTPUT_COST_MINOR_PER_MILLION'),
  };
}

function validHttpUrl(value: unknown, fallback: string, name: string): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    return parsed.origin;
  } catch {
    throw new Error(`${name} must be a valid HTTP origin`);
  }
}

function boundedPositiveInteger(
  value: unknown, fallback: number, minimum: number, maximum: number, name: string,
): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, fallback: number, name: string): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number, name: string): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 ||
      (parsed > 65535 && name.endsWith('PORT'))) {
    throw new Error(`${name} must be a valid positive integer`);
  }
  return parsed;
}

function booleanString(value: unknown, fallback: boolean, name: string): string {
  const normalized = value === undefined || value === '' ? String(fallback) : String(value).toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') throw new Error(`${name} must be true or false`);
  return normalized;
}
