import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { CommerceEventsWorker } from '../src/commerce-events/commerce-events.worker';
import { MessageReceivedConsumer } from '../src/commerce-events/message-received.consumer';
import { SendRequestedConsumer } from '../src/commerce-events/send-requested.consumer';
import { FixtureWhatsAppAdapter } from '../src/commerce-events/whatsapp-adapter';
import { DeterministicReplyService } from '../src/commerce-events/deterministic-reply.service';
import { CommercialFlowService } from '../src/commerce-events/commercial-flow.service';
import { AppointmentFlowService } from '../src/commerce-events/appointment-flow.service';
import { RecommendationService } from '../src/recommendations/recommendation.service';
import { DatabaseService } from '../src/database/database.service';
import { InboundMessagesService } from '../src/inbound-messages/inbound-messages.service';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { OutboundMessagesService } from '../src/outbound-messages/outbound-messages.service';
import { DeterministicUnderstandingProvider } from '../src/conversation-understanding/deterministic-understanding.provider';
import { ConversationLanguageService } from '../src/localization/conversation-language.service';
import { ConversationDecisionEngine } from '../src/conversation-decisions/conversation-decision.engine';
import { LocalizedResponseComposer } from '../src/response-composition/localized-response.composer';
import { NaturalResponseRewriter } from '../src/response-composition/natural-response.rewriter';
import { AiUsageBudgetService } from '../src/response-composition/ai-usage-budget.service';
import { OperationalRequirementsService } from '../src/operational-requirements/operational-requirements.service';

describe('inbound message flow', () => {
  const suffix = `${Date.now()}`;
  const externalEventId = `integration-event-${suffix}`;
  const externalMessageId = `integration-message-${suffix}`;
  const tenantId = '0194f000-0000-7000-8000-000000000001';
  const channelId = '0194f001-0000-7000-8000-000000000001';
  const contactId = '0194f002-0000-7000-8000-000000000001';
  const connectionString = process.env.DATABASE_URL ??
    'postgresql://postgres:local_postgres_only@localhost:54329/whatsapp_commerce';
  const config = new ConfigService({
    DATABASE_URL: connectionString,
    REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
    REDIS_PORT: Number(process.env.REDIS_PORT ?? 56379),
    OUTBOX_PUBLISHER_ENABLED: 'false',
    COMMERCE_WORKER_ENABLED: 'true',
    COMMERCE_WORKER_CONCURRENCY: 1,
  });
  const database = new DatabaseService(config);
  const messages = new InboundMessagesService(database);
  const publisher = new OutboxPublisherService(database, config);
  const recommendations = new RecommendationService();
  const requirements = new OperationalRequirementsService(database);
  const appointments=new AppointmentFlowService(requirements);
  const commerce=new CommercialFlowService(recommendations,requirements);
  const knowledge=new DeterministicReplyService();
  const consumer = new MessageReceivedConsumer(
    database,
    config,
    new ConversationDecisionEngine(appointments,commerce,knowledge),
    new LocalizedResponseComposer(),
    new NaturalResponseRewriter(config,new AiUsageBudgetService(database)),
    new ConversationLanguageService(),
    new DeterministicUnderstandingProvider(),
  );
  const fixtureAdapter = new FixtureWhatsAppAdapter();
  const sendRequested = new SendRequestedConsumer(database, fixtureAdapter);
  const worker = new CommerceEventsWorker(
    consumer,
    sendRequested,
    config,
    { syncAppointment: jest.fn() } as never,
  );
  const outboundMessages = new OutboundMessagesService(database);
  const inspectionPool = new Pool({ connectionString });
  const queue = new Queue('commerce-events', {
    connection: { host: 'localhost', port: 56379, maxRetriesPerRequest: null },
  });
  let messageId: string;
  let outboxEventId: string;
  let sendMessageId: string;
  let sendOutboxEventId: string;

  afterAll(async () => {
    await worker.onModuleDestroy();
    if (sendOutboxEventId) await queue.remove(sendOutboxEventId);
    if (outboxEventId) await queue.remove(outboxEventId);
    if (messageId) {
      await inspectionPool.query(
        "delete from app.audit_events where action = 'message.processed' and subject_id = $1", [messageId],
      );
      await inspectionPool.query(
        "delete from app.processed_events where consumer_name = 'message-received-v1' and event_id = $1", [outboxEventId],
      );
      await inspectionPool.query('delete from app.outbox_events where id = $1', [outboxEventId]);
      await inspectionPool.query(
        "delete from app.unresolved_customer_questions where tenant_id = $1 and normalized_question = 'mensaje ficticio de integracion'",
        [tenantId],
      );
      await inspectionPool.query('delete from app.messages where id = $1', [messageId]);
      await inspectionPool.query(
        "delete from app.processing_events where tenant_id = $1 and source = 'development_harness' and external_event_id = $2",
        [tenantId, externalEventId],
      );
    }
    if (sendMessageId) {
      await inspectionPool.query('delete from app.audit_events where subject_id = $1', [sendMessageId]);
      await inspectionPool.query(
        "delete from app.processed_events where consumer_name = 'message-send-requested-v1' and event_id = $1",
        [sendOutboxEventId],
      );
      await inspectionPool.query('delete from app.outbox_events where id = $1', [sendOutboxEventId]);
      await inspectionPool.query('delete from app.messages where id = $1', [sendMessageId]);
    }
    await queue.close();
    await publisher.onModuleDestroy();
    await database.onModuleDestroy();
    await inspectionPool.end();
  });

  it('confirma, publica y consume de forma idempotente después de iniciar el worker', async () => {
    const first = await messages.receive({
      tenantId, channelId, contactId, externalEventId, externalMessageId, text: 'Mensaje ficticio de integración',
    });
    messageId = first.messageId;
    outboxEventId = first.outboxEventId!;
    expect(first.duplicate).toBe(false);

    const duplicate = await messages.receive({
      tenantId, channelId, contactId, externalEventId, externalMessageId, text: 'Reintento',
    });
    expect(duplicate).toEqual({
      duplicate: true,
      conversationId: first.conversationId,
      messageId: first.messageId,
    });

    const before = await inspectionPool.query(
      'select status from app.outbox_events where id = $1', [outboxEventId],
    );
    expect(before.rows[0].status).toBe('pending');

    expect(await publisher.publishBatch()).toBeGreaterThanOrEqual(1);
    const job = await queue.getJob(outboxEventId);
    expect(job?.data).toMatchObject({ eventId: outboxEventId, tenantId, messageId });

    const after = await inspectionPool.query(
      'select status, published_at from app.outbox_events where id = $1', [outboxEventId],
    );
    expect(after.rows[0].status).toBe('published');
    expect(after.rows[0].published_at).toBeTruthy();

    // El trabajo permanece durable mientras no existe worker. Al iniciar uno
    // nuevo, simula recuperación después de una caída o reinicio del proceso.
    worker.onApplicationBootstrap();
    await waitFor(async () => {
      const processed = await inspectionPool.query(
        "select 1 from app.processed_events where consumer_name = 'message-received-v1' and event_id = $1",
        [outboxEventId],
      );
      return processed.rowCount === 1;
    });

    const audits = await inspectionPool.query(
      "select 1 from app.audit_events where action = 'message.processed' and subject_id = $1",
      [messageId],
    );
    expect(audits.rowCount).toBe(1);

    await expect(consumer.consume(job!.data)).resolves.toEqual({ duplicate: true });
    const auditsAfterDuplicate = await inspectionPool.query(
      "select 1 from app.audit_events where action = 'message.processed' and subject_id = $1",
      [messageId],
    );
    expect(auditsAfterDuplicate.rowCount).toBe(1);

    const invalidEventId = uuidv7();
    await expect(consumer.consume({
      eventId: invalidEventId,
      tenantId,
      messageId: uuidv7(),
      conversationId: first.conversationId,
    })).rejects.toThrow('missing message or a message from another tenant');
    const rolledBack = await inspectionPool.query(
      "select 1 from app.processed_events where consumer_name = 'message-received-v1' and event_id = $1",
      [invalidEventId],
    );
    expect(rolledBack.rowCount).toBe(0);

    const crossTenantEventId = uuidv7();
    await expect(consumer.consume({
      eventId: crossTenantEventId,
      tenantId: '0194f000-0000-7000-8000-000000000002',
      messageId,
      conversationId: first.conversationId,
    })).rejects.toThrow('another tenant');
    const crossTenantRolledBack = await inspectionPool.query(
      "select 1 from app.processed_events where consumer_name = 'message-received-v1' and event_id = $1",
      [crossTenantEventId],
    );
    expect(crossTenantRolledBack.rowCount).toBe(0);
  });

  it('reabre la conversación cerrada del contacto en vez de crear una nueva y fragmentar el historial', async () => {
    const providerSubject = `integration-reopen-${suffix}`;
    const first = await messages.receive({
      tenantId, channelId, providerSubject, contactDisplayName: 'Prueba reapertura',
      externalEventId: `${externalEventId}-reopen-1`, externalMessageId: `${externalMessageId}-reopen-1`,
      text: 'Primer mensaje',
    });
    expect(first.duplicate).toBe(false);

    await inspectionPool.query(
      "update app.conversations set status='closed', closed_at=now(), close_reason='inactive' where id=$1",
      [first.conversationId],
    );

    try {
      const second = await messages.receive({
        tenantId, channelId, providerSubject,
        externalEventId: `${externalEventId}-reopen-2`, externalMessageId: `${externalMessageId}-reopen-2`,
        text: 'Segundo mensaje, tras el cierre',
      });

      expect(second.conversationId).toBe(first.conversationId);
      expect(second.duplicate).toBe(false);

      const reopened = await inspectionPool.query(
        "select status, closed_at, close_reason from app.conversations where id=$1",
        [first.conversationId],
      );
      expect(reopened.rows[0]).toEqual({ status: 'open', closed_at: null, close_reason: null });

      const messageCount = await inspectionPool.query(
        'select count(*)::int as count from app.messages where conversation_id=$1',
        [first.conversationId],
      );
      expect(messageCount.rows[0].count).toBe(2);
    } finally {
      await inspectionPool.query(
        "delete from app.audit_events where action='message.processed' and subject_id in (select id from app.messages where conversation_id=$1)",
        [first.conversationId],
      );
      await inspectionPool.query(
        "delete from app.processed_events where consumer_name='message-received-v1' and event_id in (select id from app.outbox_events where aggregate_id in (select id from app.messages where conversation_id=$1))",
        [first.conversationId],
      );
      await inspectionPool.query(
        'delete from app.outbox_events where aggregate_id in (select id from app.messages where conversation_id=$1)',
        [first.conversationId],
      );
      await inspectionPool.query('delete from app.messages where conversation_id=$1', [first.conversationId]);
      await inspectionPool.query(
        "delete from app.processing_events where tenant_id=$1 and source='development_harness' and external_event_id in ($2, $3)",
        [tenantId, `${externalEventId}-reopen-1`, `${externalEventId}-reopen-2`],
      );
      await inspectionPool.query('delete from app.conversations where id=$1', [first.conversationId]);
      await inspectionPool.query(
        'delete from app.contact_identities where tenant_id=$1 and channel_id=$2 and provider_subject=$3',
        [tenantId, channelId, providerSubject],
      );
      await inspectionPool.query(
        "delete from app.contacts where tenant_id=$1 and display_name='Prueba reapertura'",
        [tenantId],
      );
    }
  });

  it('confirma un envío ficticio después del commit y conserva un solo efecto', async () => {
    const requested = await outboundMessages.requestSend({
      tenantId,
      channelId,
      conversationId: '0194f003-0000-7000-8000-000000000001',
      text: 'Respuesta saliente ficticia',
    });
    sendMessageId = requested.messageId;
    sendOutboxEventId = requested.outboxEventId;

    const queued = await inspectionPool.query(
      'select delivery_status, external_message_id from app.messages where id = $1',
      [sendMessageId],
    );
    expect(queued.rows[0]).toEqual({ delivery_status: 'queued', external_message_id: null });

    await publisher.publishBatch();
    await waitFor(async () => {
      const sent = await inspectionPool.query(
        'select delivery_status from app.messages where id = $1', [sendMessageId],
      );
      return sent.rows[0]?.delivery_status === 'sent';
    });

    const sent = await inspectionPool.query(
      'select delivery_status, external_message_id from app.messages where id = $1',
      [sendMessageId],
    );
    expect(sent.rows[0].delivery_status).toBe('sent');
    expect(sent.rows[0].external_message_id).toMatch(/^wamid\.fixture\.[0-9a-f]{32}$/);

    await expect(sendRequested.consume({
      eventId: sendOutboxEventId,
      tenantId,
      messageId: sendMessageId,
    })).resolves.toEqual({ duplicate: true });

    const effects = await inspectionPool.query(
      "select 1 from app.audit_events where action = 'message.sent' and subject_id = $1",
      [sendMessageId],
    );
    expect(effects.rowCount).toBe(1);

    await expect(sendRequested.consume({
      eventId: uuidv7(),
      tenantId: '0194f000-0000-7000-8000-000000000002',
      messageId: sendMessageId,
    })).rejects.toThrow('tenant');
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Tiempo agotado esperando el consumo BullMQ');
}
