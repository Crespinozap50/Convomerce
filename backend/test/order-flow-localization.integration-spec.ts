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

// D-110: D-086 localized the read-only "menu"/"price" replies
// (deterministic-reply.service.ts's offeringReply/publishedKnowledgeEntries)
// but never touched the actual order flow — commercial-flow.service.ts's
// catalogItems()/cartItems() always read the tenant's raw base-language
// name, so an English-speaking customer who actually places an order saw
// Spanish product names throughout the cart and confirmation, even with an
// approved English translation on file. Worse, the name only gets read
// *once*, at the moment an item is matched/added — item.name is frozen into
// request_lines.description_snapshot right there (addItem()) and never
// re-derived per turn, so the fix has to happen at match/write time, not by
// localizing the cart display. This proves the fix against real Postgres,
// not mocks — a join typo (wrong column, wrong table) compiles and passes
// every existing mocked spec, since none of them assert real SQL.
//
// Runs on tecnologia-demo (a synthetic item, category='prueba'), never
// Santos Tacos — same reasoning as packaging-fee.integration-spec.ts: an
// unrelated, currently-unconfigured tenant proves the mechanism is generic
// and can't risk corrupting real orders.
describe('D-110 — an English-speaking customer sees the approved English translation throughout the order flow, not just the menu reply', () => {
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

  const tenantId = '0194f000-0000-7000-8000-000000000002'; // tecnologia-demo
  const channelId = '0194f001-0000-7000-8000-000000000002';
  const catalogId = '0194f004-0000-7000-8000-000000000002';

  const itemId = uuidv7();
  const variantId = uuidv7();
  const category = `prueba-cat-${shortSuffix}`;
  const spanishName = `ProductoPrueba${shortSuffix}`;
  const englishName = `TestProductEN${shortSuffix}`;
  const englishCategoryLabel = `Test CategoryEN${shortSuffix}`;
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
    providerSubject: string,
    text: string,
  ): Promise<{ body: string | null; conversationId: string }> {
    const id = uuidv7();
    const result = await messages.receive({
      tenantId,
      channelId,
      providerSubject,
      externalEventId: `${providerSubject}-${id}`,
      externalMessageId: `${providerSubject}-${id}`,
      text,
    });
    if (!conversationIds.includes(result.conversationId)) conversationIds.push(result.conversationId);
    if (!result.duplicate) {
      await consumer.consume({
        eventId: result.outboxEventId!,
        tenantId,
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
    await pool.query(
      `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type,customer_orderable)
       values ($1,$2,$3,$4,'active',$5,'product',true)`,
      [itemId, tenantId, catalogId, spanishName, category],
    );
    await pool.query(
      `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
       values ($1,$2,$3,'Unidad','active',500000,'COP','available')`,
      [variantId, tenantId, itemId],
    );
    await pool.query(
      `insert into app.catalog_item_localizations(tenant_id,catalog_item_id,locale,name)
       values ($1,$2,'en',$3)`,
      [tenantId, itemId, englishName],
    );
    await pool.query(
      `insert into app.catalog_category_localizations(tenant_id,category,locale,label)
       values ($1,$2,'en',$3)`,
      [tenantId, category, englishCategoryLabel],
    );
  });

  afterAll(async () => {
    for (const conversationId of conversationIds) {
      await cleanupConversation(conversationId);
    }
    await pool.query('delete from app.catalog_category_localizations where tenant_id=$1 and category=$2', [
      tenantId,
      category,
    ]);
    await pool.query('delete from app.catalog_item_localizations where catalog_item_id=$1', [itemId]);
    await pool.query('delete from app.item_variants where id=$1', [variantId]);
    await pool.query('delete from app.catalog_items where id=$1', [itemId]);
    await database.onModuleDestroy();
    await pool.end();
  });

  it('matches, replies with, and freezes into the cart the English translation — never the Spanish base name', async () => {
    const providerSubject = `order-loc-${shortSuffix}`;

    // Rule 1 (docs/internationalization.md): the first clearly identifiable
    // message of a new conversation can select the language outright — no
    // need for two consecutive messages, that rule only applies once a
    // conversation is already active in another language.
    await send(providerSubject, 'Hello, I would like to place an order');

    const started = await send(providerSubject, `I would like the ${englishName}`);
    expect(started.body).toContain(englishName);
    expect(started.body).not.toContain(spanishName);

    const lines = await pool.query<{ description_snapshot: string }>(
      `select line.description_snapshot from app.request_lines line
         join app.commercial_requests request on request.id = line.commercial_request_id
        where request.conversation_id = $1 and line.status = 'active'`,
      [started.conversationId],
    );
    expect(lines.rows).toHaveLength(1);
    expect(lines.rows[0]!.description_snapshot).toContain(englishName);
    expect(lines.rows[0]!.description_snapshot).not.toContain(spanishName);
  });
});
