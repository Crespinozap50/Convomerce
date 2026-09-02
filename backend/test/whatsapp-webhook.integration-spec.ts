import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
// esModuleInterop is off project-wide; supertest's CJS export is a callable
// function, not an object with a `.default`, so a plain default import
// wouldn't bind correctly under ts-jest's commonjs output.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { validate as isUuid } from 'uuid';
import { AppModule } from '../src/app.module';

describe('frontera HTTP del webhook de WhatsApp', () => {
  const secret = 'integration-fixture-app-secret';
  const verifyToken = 'integration-fixture-verify-token';
  const suffix = `${Date.now()}`;
  const senderId = `fixture-sender-${suffix}`;
  const messageId = `fixture-message-${suffix}`;
  const connectionString = process.env.DATABASE_URL ??
    'postgresql://postgres:local_postgres_only@localhost:54329/whatsapp_commerce';
  const pool = new Pool({ connectionString });
  const outboundExternalIds: string[] = [];
  let app: INestApplication;
  let restaurantPhoneNumberId: string;
  let restaurantChannelStatus: string;

  beforeAll(async () => {
    const channel = await pool.query<{ external_account_id: string;status:string }>(
      `select external_account_id,status from app.channels
        where id = '0194f001-0000-7000-8000-000000000001'`,
    );
    restaurantPhoneNumberId = channel.rows[0].external_account_id;
    restaurantChannelStatus = channel.rows[0].status;
    await pool.query(`update app.channels set status='active' where id='0194f001-0000-7000-8000-000000000001'`);
    process.env.DATABASE_URL = connectionString;
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '56379';
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    process.env.COMMERCE_WORKER_ENABLED = 'false';
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = verifyToken;
    process.env.WHATSAPP_APP_SECRET = secret;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    if(restaurantChannelStatus)await pool.query(`update app.channels set status=$1 where id='0194f001-0000-7000-8000-000000000001'`,[restaurantChannelStatus]);
    if (outboundExternalIds.length > 0) {
      const outbound = await pool.query<{ id: string }>(
        'select id from app.messages where external_message_id = any($1::text[])',
        [outboundExternalIds],
      );
      const outboundIds = outbound.rows.map((row) => row.id);
      if (outboundIds.length > 0) {
        await pool.query('delete from app.audit_events where subject_id = any($1::uuid[])', [outboundIds]);
        await pool.query('delete from app.messages where id = any($1::uuid[])', [outboundIds]);
      }
      await pool.query(
        "delete from app.processing_events where source = 'whatsapp_delivery_status' and " +
        'external_event_id like any($1::text[])',
        [outboundExternalIds.map((id) => `${id}:%`)],
      );
    }
    const stored = await pool.query<{ message_id: string; conversation_id: string; contact_id: string }>(
      `select message.id as message_id, message.conversation_id, conversation.contact_id
       from app.messages as message
       join app.conversations as conversation on conversation.id = message.conversation_id
       where message.external_message_id = $1`,
      [messageId],
    );
    if (stored.rowCount === 1) {
      const row = stored.rows[0];
      const conversationMessages = await pool.query<{ id: string }>(
        'select id from app.messages where conversation_id = $1', [row.conversation_id],
      );
      const messageIds = conversationMessages.rows.map((message) => message.id);
      if (messageIds.length > 0) {
        const outbox = await pool.query<{ id: string }>(
          "select id from app.outbox_events where aggregate_type = 'message' and aggregate_id = any($1::uuid[])",
          [messageIds],
        );
        const outboxIds = outbox.rows.map((event) => event.id);
        if (outboxIds.length > 0) {
          await pool.query('delete from app.processed_events where event_id = any($1::uuid[])', [outboxIds]);
          await pool.query('delete from app.outbox_events where id = any($1::uuid[])', [outboxIds]);
        }
        await pool.query('delete from app.audit_events where subject_id = any($1::uuid[])', [messageIds]);
        await pool.query('delete from app.messages where id = any($1::uuid[])', [messageIds]);
      }
      await pool.query("delete from app.processing_events where source = 'development_harness' and external_event_id = $1", [messageId]);
      await pool.query('delete from app.conversations where id = $1', [row.conversation_id]);
      await pool.query('delete from app.contact_identities where contact_id = $1', [row.contact_id]);
      await pool.query('delete from app.contacts where id = $1', [row.contact_id]);
    }
    if (app) await app.close();
    await pool.end();
  });

  it('responde el challenge únicamente con modo y token correctos', async () => {
    await request(app.getHttpServer())
      .get('/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': 'fixture-challenge' })
      .expect(200, 'fixture-challenge');

    await request(app.getHttpServer())
      .get('/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'incorrecto', 'hub.challenge': 'fixture-challenge' })
      .expect(403);
  });

  it('expone liveness, readiness real y correlación sin datos sensibles', async () => {
    const live = await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'alive' });
    expect(isUuid(live.headers['x-correlation-id'])).toBe(true);

    await request(app.getHttpServer()).get('/health/ready').expect(200, {
      status: 'ready',
      checks: {
        postgres: 'up', redis: 'up',
        outboxPublisher: 'disabled', commerceWorker: 'disabled',
      },
    });

    const correlationId = '0194f900-0000-7000-8000-000000000001';
    const rejected = await request(app.getHttpServer())
      .get('/v1/webhooks/whatsapp')
      .set('x-correlation-id', correlationId)
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token-que-no-debe-aparecer',
        'hub.challenge': 'challenge-que-no-debe-aparecer',
      })
      .expect(403);
    expect(rejected.headers['x-correlation-id']).toBe(correlationId);
    expect(rejected.body).toEqual({
      statusCode: 403,
      code: 'REQUEST_REJECTED',
      message: 'Forbidden',
      correlationId,
    });
    expect(JSON.stringify(rejected.body)).not.toContain('token-que-no-debe-aparecer');
  });

  it('rechaza una firma inválida antes de tocar la base', async () => {
    const rawPayload = fixturePayload();
    await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', 'sha256=incorrecta')
      .send(rawPayload)
      .expect(401);

    const count = await pool.query('select 1 from app.messages where external_message_id = $1', [messageId]);
    expect(count.rowCount).toBe(0);
  });

  it('resuelve el tenant desde phone_number_id y deduplica la reentrega', async () => {
    const rawPayload = fixturePayload();
    const signature = `sha256=${createHmac('sha256', secret).update(rawPayload).digest('hex')}`;

    await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(rawPayload)
      .expect(200, { accepted: true, messages: 1, statuses: 0 });

    await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(rawPayload)
      .expect(200, { accepted: true, messages: 1, statuses: 0 });

    const stored = await pool.query(
      `select message.tenant_id, identity.provider_subject
       from app.messages as message
       join app.conversations as conversation on conversation.id = message.conversation_id
       join app.contact_identities as identity on identity.contact_id = conversation.contact_id
       where message.external_message_id = $1`,
      [messageId],
    );
    expect(stored.rows).toEqual([{
      tenant_id: '0194f000-0000-7000-8000-000000000001',
      provider_subject: senderId,
    }]);
  });

  it('aplica estados progresivos sin duplicar ni cruzar tenants', async () => {
    const restaurantExternalId = `fixture-outbound-restaurant-${suffix}`;
    const failedExternalId = `fixture-outbound-failed-${suffix}`;
    const technologyExternalId = `fixture-outbound-technology-${suffix}`;
    outboundExternalIds.push(restaurantExternalId, failedExternalId, technologyExternalId);

    await createOutbound(
      restaurantExternalId,
      '0194f000-0000-7000-8000-000000000001',
      '0194f001-0000-7000-8000-000000000001',
      '0194f003-0000-7000-8000-000000000001',
    );
    await createOutbound(
      failedExternalId,
      '0194f000-0000-7000-8000-000000000001',
      '0194f001-0000-7000-8000-000000000001',
      '0194f003-0000-7000-8000-000000000001',
    );
    await createOutbound(
      technologyExternalId,
      '0194f000-0000-7000-8000-000000000002',
      '0194f001-0000-7000-8000-000000000002',
      '0194f003-0000-7000-8000-000000000002',
    );

    const delivered = statusFixture(restaurantExternalId, 'delivered', '1700000100');
    await postSigned(delivered).expect(200, { accepted: true, messages: 0, statuses: 1 });
    await postSigned(delivered).expect(200, { accepted: true, messages: 0, statuses: 1 });
    await postSigned(statusFixture(restaurantExternalId, 'sent', '1700000200'))
      .expect(200, { accepted: true, messages: 0, statuses: 1 });
    await postSigned(statusFixture(restaurantExternalId, 'read', '1700000300'))
      .expect(200, { accepted: true, messages: 0, statuses: 1 });

    await postSigned(statusFixture(failedExternalId, 'failed', '1700000400', '131000'))
      .expect(200, { accepted: true, messages: 0, statuses: 1 });

    // El receiver pertenece al restaurante, pero el wamid existe en tecnología.
    // RLS lo trata como desconocido y no modifica la fila ajena.
    await postSigned(statusFixture(technologyExternalId, 'delivered', '1700000500'))
      .expect(200, { accepted: true, messages: 0, statuses: 1 });
    const unknownExternalId = `fixture-outbound-unknown-${suffix}`;
    outboundExternalIds.push(unknownExternalId);
    await postSigned(statusFixture(unknownExternalId, 'delivered', '1700000600'))
      .expect(200, { accepted: true, messages: 0, statuses: 1 });

    const states = await pool.query<{ external_message_id: string; delivery_status: string }>(
      `select external_message_id, delivery_status from app.messages
       where external_message_id = any($1::text[]) order by external_message_id`,
      [[restaurantExternalId, failedExternalId, technologyExternalId]],
    );
    expect(Object.fromEntries(states.rows.map((row) => [row.external_message_id, row.delivery_status])))
      .toEqual({
        [restaurantExternalId]: 'read',
        [failedExternalId]: 'failed',
        [technologyExternalId]: 'sent',
      });

    const audits = await pool.query(
      `select 1 from app.audit_events as audit
       join app.messages as message on message.id = audit.subject_id
       where audit.action = 'message.delivery_status_changed'
         and message.external_message_id = $1`,
      [restaurantExternalId],
    );
    expect(audits.rowCount).toBe(2);
  });

  it('protege y expone métricas sin etiquetas de negocio', async () => {
    await request(app.getHttpServer()).get('/internal/metrics').expect(401);

    const prometheus = await request(app.getHttpServer())
      .get('/internal/metrics')
      .set('authorization', 'Bearer integration-fixture-metrics-token')
      .expect(200);
    expect(prometheus.headers['content-type']).toContain('text/plain');
    expect(prometheus.text).toContain('commerce_outbox_pending ');
    expect(prometheus.text).toContain('commerce_outbox_expired_leases ');
    expect(prometheus.text).toContain('commerce_bullmq_failed_jobs ');
    expect(prometheus.text).toContain('commerce_http_request_duration_seconds');
    expect(prometheus.text).toContain('commerce_webhook_requests_total{result="accepted"}');
    expect(prometheus.text).toContain('commerce_webhook_requests_total{result="rejected_signature"} 1');
    expect(prometheus.text).not.toContain('0194f000-0000-7000-8000-000000000001');
    expect(prometheus.text).not.toContain('fixture-sender');

    const status = await request(app.getHttpServer())
      .get('/internal/metrics/status')
      .set('authorization', 'Bearer integration-fixture-metrics-token')
      .expect(200);
    expect(['ok', 'warning']).toContain(status.body.status);
    expect(status.body.values.outboxPending).toBeGreaterThanOrEqual(0);
    expect(status.body.values.outboxPending).toBeLessThan(100);
    expect(status.body.values.outboxExpiredLeases).toBeGreaterThanOrEqual(0);
    expect(status.body.values.bullmqFailed).toBeGreaterThanOrEqual(0);
    expect(status.body.thresholds).toEqual({
      outboxPending: 100, outboxExpiredLeases: 1, bullmqFailed: 1,
    });
  });

  function fixturePayload(): string {
    return readFileSync(join(__dirname, 'fixtures/whatsapp-text-message.json'), 'utf8')
      .replaceAll('fixture-sender-id', senderId)
      .replace('fixture-message-id', messageId)
      .replace('demo-account-restaurant', restaurantPhoneNumberId);
  }

  async function createOutbound(
    externalMessageId: string,
    tenantId: string,
    channelId: string,
    conversationId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/v1/dev/outbound-messages')
      .send({ tenantId, channelId, conversationId, externalMessageId, text: 'Salida ficticia' })
      .expect(201);
  }

  function statusFixture(
    externalMessageId: string,
    status: string,
    timestamp: string,
    errorCode?: string,
  ): string {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/whatsapp-delivery-status.json'), 'utf8')
        .replace('fixture-outbound-wamid', externalMessageId)
        .replace('fixture-delivery-status', status)
        .replace('1700000100', timestamp)
        .replace('demo-account-restaurant', restaurantPhoneNumberId),
    );
    if (errorCode) {
      fixture.entry[0].changes[0].value.statuses[0].errors = [{ code: Number(errorCode), title: 'Error ficticio' }];
    }
    return JSON.stringify(fixture);
  }

  function postSigned(rawPayload: string) {
    const signature = `sha256=${createHmac('sha256', secret).update(rawPayload).digest('hex')}`;
    return request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(rawPayload);
  }
});
