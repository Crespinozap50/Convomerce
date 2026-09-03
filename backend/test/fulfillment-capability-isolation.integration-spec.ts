import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { MessageReceivedConsumer } from '../src/commerce-events/message-received.consumer';
import { DeterministicReplyService } from '../src/commerce-events/deterministic-reply.service';
import { CommercialFlowService } from '../src/commerce-events/commercial-flow.service';
import { AppointmentFlowService } from '../src/commerce-events/appointment-flow.service';
import { RecommendationService } from '../src/recommendations/recommendation.service';
import { DatabaseService } from '../src/database/database.service';
import { InboundMessagesService } from '../src/inbound-messages/inbound-messages.service';
import { DeterministicUnderstandingProvider } from '../src/conversation-understanding/deterministic-understanding.provider';
import { ConversationLanguageService } from '../src/localization/conversation-language.service';
import { ConversationDecisionEngine } from '../src/conversation-decisions/conversation-decision.engine';
import { LocalizedResponseComposer } from '../src/response-composition/localized-response.composer';
import { NaturalResponseRewriter } from '../src/response-composition/natural-response.rewriter';
import { AiUsageBudgetService } from '../src/response-composition/ai-usage-budget.service';
import { OperationalRequirementsService } from '../src/operational-requirements/operational-requirements.service';

// D-108: deliveryCapabilityEnabled() used to read app.tenant_capabilities
// with no tenant_id filter and no order by — undefined which tenant's row
// rows[0] returned. app.tenant_capabilities has 5 seeded tenants, only 1 of
// which (restaurante-demo / Santos Tacos) has delivery=true — meaning an
// unfiltered read risked landing on a *different* tenant's disabled row,
// hiding "Domicilio" from real Santos Tacos customers, or the reverse on
// another tenant. The fix (join through the commercial_request's own
// tenant_id) is what commercial-flow.service.spec.ts's "scopes the
// delivery-capability check..." unit test actually pins down at the SQL
// level — verified there to fail without the fix and pass with it. This
// integration test does NOT reliably reproduce that specific failure (this
// small, unindexed table happens to come back in a stable order in this
// environment, so it passed even against the unfixed query in a manual
// check). It stays anyway as real end-to-end proof that each tenant's own
// fulfillment question reflects its own configured capability — the
// behavior actually being promised — exercised across two live tenants at
// once the same way the modifier-group tests prove genericity.
describe('D-108 — the delivery option offered is the asking tenant\'s own capability, never another tenant\'s', () => {
  const suffix = `${Date.now()}`;
  const shortSuffix = suffix.slice(-6);
  const connectionString =
    process.env.DATABASE_URL ??
    'postgresql://postgres:local_postgres_only@localhost:54329/whatsapp_commerce';
  const config = new ConfigService({
    DATABASE_URL: connectionString,
    REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
    REDIS_PORT: Number(process.env.REDIS_PORT ?? 56379),
    OUTBOX_PUBLISHER_ENABLED: 'false',
    COMMERCE_WORKER_ENABLED: 'false',
  });
  const database = new DatabaseService(config);
  const messages = new InboundMessagesService(database);
  const recommendations = new RecommendationService();
  const requirements = new OperationalRequirementsService(database);
  const appointments = new AppointmentFlowService(requirements);
  const commerce = new CommercialFlowService(recommendations, requirements);
  const knowledge = new DeterministicReplyService();
  const consumer = new MessageReceivedConsumer(
    database,
    config,
    new ConversationDecisionEngine(appointments, commerce, knowledge),
    new LocalizedResponseComposer(),
    new NaturalResponseRewriter(config, new AiUsageBudgetService(database)),
    new ConversationLanguageService(),
    new DeterministicUnderstandingProvider(),
  );
  const pool = new Pool({ connectionString });

  const withDelivery = {
    tenantId: '0194f000-0000-7000-8000-000000000001', // restaurante-demo, delivery=true
    channelId: '0194f001-0000-7000-8000-000000000001',
    catalogId: '0194f004-0000-7000-8000-000000000001',
  };
  const withoutDelivery = {
    tenantId: '0194f000-0000-7000-8000-000000000002', // tecnologia-demo, delivery=false
    channelId: '0194f001-0000-7000-8000-000000000002',
    catalogId: '0194f004-0000-7000-8000-000000000002',
  };

  const itemA = { itemId: uuidv7(), variantId: uuidv7(), name: `PruebaFulfillA${shortSuffix}` };
  const itemB = { itemId: uuidv7(), variantId: uuidv7(), name: `PruebaFulfillB${shortSuffix}` };
  const conversationIds: string[] = [];

  async function cleanupConversation(conversationId: string) {
    const messageIds = (
      await pool.query<{ id: string }>('select id from app.messages where conversation_id = $1', [
        conversationId,
      ])
    ).rows.map((row) => row.id);
    if (messageIds.length > 0) {
      const outboxIds = (
        await pool.query<{ id: string }>(
          `select id from app.outbox_events
            where aggregate_type = 'message' and aggregate_id = any($1::uuid[])`,
          [messageIds],
        )
      ).rows.map((row) => row.id);
      if (outboxIds.length > 0) {
        await pool.query('delete from app.processed_events where event_id = any($1::uuid[])', [
          outboxIds,
        ]);
        await pool.query('delete from app.outbox_events where id = any($1::uuid[])', [outboxIds]);
      }
      await pool.query('delete from app.audit_events where subject_id = any($1::uuid[])', [
        messageIds,
      ]);
    }
    await pool.query(
      `delete from app.request_lines where commercial_request_id in (
         select id from app.commercial_requests where conversation_id = $1
       )`,
      [conversationId],
    );
    await pool.query(
      `delete from app.conversation_workflows where commercial_request_id in (
         select id from app.commercial_requests where conversation_id = $1
       )`,
      [conversationId],
    );
    await pool.query('delete from app.commercial_requests where conversation_id = $1', [
      conversationId,
    ]);
    await pool.query('delete from app.messages where conversation_id = $1', [conversationId]);
    const contact = await pool.query<{ contact_id: string }>(
      'select contact_id from app.conversations where id = $1',
      [conversationId],
    );
    await pool.query('delete from app.conversations where id = $1', [conversationId]);
    if (contact.rows[0]) {
      await pool.query('delete from app.contact_identities where contact_id = $1', [
        contact.rows[0].contact_id,
      ]);
      await pool.query('delete from app.contacts where id = $1', [contact.rows[0].contact_id]);
    }
  }

  async function send(
    tenant: { tenantId: string; channelId: string },
    providerSubject: string,
    text: string,
    interactiveSelection?: { type: 'button' | 'list'; id: string; title: string },
  ): Promise<{ body: string | null; conversationId: string }> {
    const id = uuidv7();
    const result = await messages.receive({
      tenantId: tenant.tenantId,
      channelId: tenant.channelId,
      providerSubject,
      externalEventId: `${providerSubject}-${id}`,
      externalMessageId: `${providerSubject}-${id}`,
      text,
      ...(interactiveSelection ? { interactiveSelection } : {}),
    });
    if (!conversationIds.includes(result.conversationId)) conversationIds.push(result.conversationId);
    if (!result.duplicate) {
      await consumer.consume({
        eventId: result.outboxEventId!,
        tenantId: tenant.tenantId,
        messageId: result.messageId,
        conversationId: result.conversationId,
      });
    }
    const reply = await pool.query<{ body: string }>(
      `select content->>'body' as body from app.messages
        where conversation_id = $1 and direction = 'outbound'
        order by occurred_at desc, id desc limit 1`,
      [result.conversationId],
    );
    return { body: reply.rows[0]?.body ?? null, conversationId: result.conversationId };
  }

  beforeAll(async () => {
    for (const [tenant, item] of [
      [withDelivery, itemA],
      [withoutDelivery, itemB],
    ] as const) {
      await pool.query(
        `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type)
         values ($1,$2,$3,$4,'active','prueba','product')`,
        [item.itemId, tenant.tenantId, tenant.catalogId, item.name],
      );
      await pool.query(
        `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
         values ($1,$2,$3,'Unidad','active',500000,'COP','available')`,
        [item.variantId, tenant.tenantId, item.itemId],
      );
    }
  });

  afterAll(async () => {
    for (const conversationId of conversationIds) {
      await cleanupConversation(conversationId);
    }
    await pool.query('delete from app.item_variants where id in ($1,$2)', [
      itemA.variantId,
      itemB.variantId,
    ]);
    await pool.query('delete from app.catalog_items where id in ($1,$2)', [
      itemA.itemId,
      itemB.itemId,
    ]);
    await database.onModuleDestroy();
    await pool.end();
  });

  it('offers Domicilio only to the tenant that actually has delivery enabled, even when requests interleave', async () => {
    const subjectA1 = `fulfill-a1-${shortSuffix}`;
    const subjectB1 = `fulfill-b1-${shortSuffix}`;
    const subjectA2 = `fulfill-a2-${shortSuffix}`;
    const subjectB2 = `fulfill-b2-${shortSuffix}`;

    // Interleaved on purpose: A (enabled) - B (disabled) - A - B, so a
    // regression to the unfiltered query is very likely to surface as one
    // tenant's answer bleeding into the other's, not just an isolated flake.
    await send(withDelivery, subjectA1, `Quiero ${itemA.name}`);
    const a1 = await send(withDelivery, subjectA1, 'Listo', {
      type: 'button',
      id: 'cart:finish_items',
      title: 'Listo',
    });
    await send(withDelivery, subjectA1, `Cliente A1 ${shortSuffix}`);

    await send(withoutDelivery, subjectB1, `Quiero ${itemB.name}`);
    const b1 = await send(withoutDelivery, subjectB1, 'Listo', {
      type: 'button',
      id: 'cart:finish_items',
      title: 'Listo',
    });
    await send(withoutDelivery, subjectB1, `Cliente B1 ${shortSuffix}`);

    await send(withDelivery, subjectA2, `Quiero ${itemA.name}`);
    await send(withDelivery, subjectA2, 'Listo', {
      type: 'button',
      id: 'cart:finish_items',
      title: 'Listo',
    });

    await send(withoutDelivery, subjectB2, `Quiero ${itemB.name}`);
    await send(withoutDelivery, subjectB2, 'Listo', {
      type: 'button',
      id: 'cart:finish_items',
      title: 'Listo',
    });

    // Both tenants' fulfillment question is the reply right after answering
    // 'name' — re-fetched here (rather than relying on the intermediate
    // `send()` return values above) so both checks read the same way.
    const afterNameA = await pool.query<{ body: string }>(
      `select content->>'body' as body from app.messages
        where conversation_id = $1 and direction = 'outbound'
        order by occurred_at desc, id desc limit 1`,
      [a1.conversationId],
    );
    const afterNameB = await pool.query<{ body: string }>(
      `select content->>'body' as body from app.messages
        where conversation_id = $1 and direction = 'outbound'
        order by occurred_at desc, id desc limit 1`,
      [b1.conversationId],
    );

    expect(afterNameA.rows[0]?.body).toContain('domicilio, recogida');
    expect(afterNameB.rows[0]?.body).not.toContain('domicilio');
    expect(afterNameB.rows[0]?.body).toContain('recogida');
  });
});
