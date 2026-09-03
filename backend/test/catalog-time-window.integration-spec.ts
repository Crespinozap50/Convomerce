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

// D-097: a catalog item can now be restricted to a daily time window
// (available_from_time/available_until_time on app.catalog_items) — this
// exercises the real "now() at time zone <tenant timezone>" comparison
// against actual Postgres, which a jest-mocked client.query test cannot
// verify at all (the predicate lives in the SQL, not in JS).
describe('D-097 — catalog items restricted to a daily time window', () => {
  const suffix = `${Date.now()}`;
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

  const tenantId = '0194f000-0000-7000-8000-000000000001';
  const channelId = '0194f001-0000-7000-8000-000000000001';
  const catalogId = '0194f004-0000-7000-8000-000000000001';
  const inWindowItemId = uuidv7();
  const inWindowVariantId = uuidv7();
  const outOfWindowItemId = uuidv7();
  const outOfWindowVariantId = uuidv7();
  // catalogChoiceReply() truncates row titles to WhatsApp's 24-char list
  // limit — kept short enough here to never truncate, so the title
  // comparison below is exact.
  const shortSuffix = suffix.slice(-6);
  const inWindowName = `PruebaDisp${shortSuffix}`;
  const outOfWindowName = `PruebaFuera${shortSuffix}`;
  const conversationIds: string[] = [];

  beforeAll(async () => {
    // Bounds are computed from Postgres' own current time in the tenant's
    // timezone, not the test runner's clock — avoids flakiness around
    // whatever time this actually runs, while still exercising the exact
    // same "now() at time zone" comparison catalogItems() uses.
    const now = await pool.query<{ now_bogota: string }>(
      `select (now() at time zone 'America/Bogota')::time::text as now_bogota`,
    );
    const nowBogota = now.rows[0].now_bogota;

    await pool.query(
      `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type,available_from_time,available_until_time)
       values ($1,$2,$3,$4,'active','prueba','product', ($5::time - interval '2 hours')::time, ($5::time - interval '1 hour')::time)`,
      [outOfWindowItemId, tenantId, catalogId, outOfWindowName, nowBogota],
    );
    await pool.query(
      `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
       values ($1,$2,$3,'Unidad','active',100000,'COP','available')`,
      [outOfWindowVariantId, tenantId, outOfWindowItemId],
    );
    await pool.query(
      `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type,available_from_time,available_until_time)
       values ($1,$2,$3,$4,'active','prueba','product', ($5::time - interval '1 hour')::time, ($5::time + interval '1 hour')::time)`,
      [inWindowItemId, tenantId, catalogId, inWindowName, nowBogota],
    );
    await pool.query(
      `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
       values ($1,$2,$3,'Unidad','active',100000,'COP','available')`,
      [inWindowVariantId, tenantId, inWindowItemId],
    );
  });

  afterAll(async () => {
    for (const conversationId of conversationIds) {
      const messageIds = (
        await pool.query<{ id: string }>(
          'select id from app.messages where conversation_id = $1',
          [conversationId],
        )
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
          await pool.query(
            'delete from app.processed_events where event_id = any($1::uuid[])',
            [outboxIds],
          );
          await pool.query('delete from app.outbox_events where id = any($1::uuid[])', [
            outboxIds,
          ]);
        }
        await pool.query('delete from app.audit_events where subject_id = any($1::uuid[])', [
          messageIds,
        ]);
      }
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
    await pool.query('delete from app.item_variants where id = any($1::uuid[])', [
      [inWindowVariantId, outOfWindowVariantId],
    ]);
    await pool.query('delete from app.catalog_items where id = any($1::uuid[])', [
      [inWindowItemId, outOfWindowItemId],
    ]);
    await database.onModuleDestroy();
    await pool.end();
  });

  // Uses "price" rather than "menu" — offeringReply() only attaches an
  // interactive list for "menu" when the total catalog is at most
  // WhatsApp's 10-row limit, which the tenant's real catalog is expected to
  // exceed once fully loaded (D-097/D-098). Asking the price of one named
  // item directly exercises the time-window filter itself, independent of
  // how many other items the catalog happens to have.
  it.each([
    ['a product whose window includes the current time', () => inWindowName, true],
    ['a product whose window has already passed for today', () => outOfWindowName, false],
  ])('asking the price of %s', async (_label, getName, shouldBeFound) => {
    const name = getName();
    const providerSubject = `time-window-${suffix}-${shouldBeFound}`;
    const id = uuidv7();
    const result = await messages.receive({
      tenantId,
      channelId,
      providerSubject,
      externalEventId: `time-window-${suffix}-${id}`,
      externalMessageId: `time-window-${suffix}-${id}`,
      text: `¿Cuánto cuesta ${name}?`,
    });
    conversationIds.push(result.conversationId);
    if (!result.duplicate) {
      await consumer.consume({
        eventId: result.outboxEventId!,
        tenantId,
        messageId: result.messageId,
        conversationId: result.conversationId,
      });
    }
    const reply = await pool.query<{ body: string; sources: string[] | null }>(
      `select content->>'body' as body, content->'sources' as sources from app.messages
        where conversation_id = $1 and direction = 'outbound'
        order by occurred_at desc, id desc limit 1`,
      [result.conversationId],
    );
    if (shouldBeFound) {
      expect(reply.rows[0]?.body).toContain(name);
      expect(reply.rows[0]?.body).toContain('$ 1.000');
    } else {
      expect(reply.rows[0]?.sources ?? []).toEqual([]);
      expect(reply.rows[0]?.body).not.toContain(name);
    }
  });
});
