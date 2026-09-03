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

// D-104 (automatic "1 packaging fee per N food items" line) + D-106 finding
// #2 (that line must never be offered among the cart's own tappable
// options) — proven against real Postgres and the real syncPackagingFee()
// SQL, not a mock. Runs on tecnologia-demo (electronics), a tenant that has
// never had a packaging fee configured, rather than Santos Tacos: Santos
// Tacos' real "Empaque para llevar" is a singleton per tenant (nothing in
// syncPackagingFee()'s query caps its join at one row), so adding a second
// active is_packaging_fee item to that same tenant here would make its own
// join return two rows and could corrupt real orders — using an unrelated,
// currently-unconfigured tenant instead also doubles as proof the feature
// is generic, not restaurant-specific (same reasoning already established
// for modifier groups in modifier-group-selections-complexity).
describe('D-104 / D-106 — automatic packaging fee stays in sync and out of the cart pickers', () => {
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

  const productItemId = uuidv7();
  const productVariantId = uuidv7();
  const productName = `PruebaProducto${shortSuffix}`;
  const packagingItemId = uuidv7();
  const packagingVariantId = uuidv7();
  const packagingName = `PruebaEmpaque${shortSuffix}`;
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
    interactiveSelection?: { type: 'button' | 'list'; id: string; title: string },
  ): Promise<{ body: string | null; interactive: unknown; conversationId: string }> {
    const id = uuidv7();
    const result = await messages.receive({
      tenantId,
      channelId,
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
        tenantId,
        messageId: result.messageId,
        conversationId: result.conversationId,
      });
    }
    const reply = await pool.query<{ body: string; interactive: unknown }>(
      `select content->>'body' as body, content->'interactive' as interactive from app.messages
        where conversation_id = $1 and direction = 'outbound'
        order by occurred_at desc, id desc limit 1`,
      [result.conversationId],
    );
    return {
      body: reply.rows[0]?.body ?? null,
      interactive: reply.rows[0]?.interactive ?? null,
      conversationId: result.conversationId,
    };
  }

  async function activeLines(conversationId: string) {
    const result = await pool.query<{ description_snapshot: string; quantity: string }>(
      `select line.description_snapshot, line.quantity::text from app.request_lines line
         join app.commercial_requests request on request.id = line.commercial_request_id
        where request.conversation_id = $1 and line.status = 'active'
        order by line.created_at`,
      [conversationId],
    );
    return result.rows;
  }

  beforeAll(async () => {
    await pool.query(
      `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type,counts_toward_packaging)
       values ($1,$2,$3,$4,'active','prueba','product',true)`,
      [productItemId, tenantId, catalogId, productName],
    );
    await pool.query(
      `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
       values ($1,$2,$3,'Unidad','active',500000,'COP','available')`,
      [productVariantId, tenantId, productItemId],
    );
    // packaging_ratio=2 (1 packaging line per 2 food units, rounded up),
    // customer_orderable=false so it can never be requested directly by
    // name — mirrors Santos Tacos' real "Empaque para llevar" config
    // (D-104), just on a tenant nothing else uses it on.
    await pool.query(
      `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type,is_packaging_fee,packaging_ratio,customer_orderable)
       values ($1,$2,$3,$4,'active','prueba','product',true,2,false)`,
      [packagingItemId, tenantId, catalogId, packagingName],
    );
    await pool.query(
      `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
       values ($1,$2,$3,'Unidad','active',100000,'COP','available')`,
      [packagingVariantId, tenantId, packagingItemId],
    );
  });

  afterAll(async () => {
    for (const conversationId of conversationIds) {
      await cleanupConversation(conversationId);
    }
    await pool.query('delete from app.item_variants where id in ($1,$2)', [
      productVariantId,
      packagingVariantId,
    ]);
    await pool.query('delete from app.catalog_items where id in ($1,$2)', [
      productItemId,
      packagingItemId,
    ]);
    await database.onModuleDestroy();
    await pool.end();
  });

  it('adds one packaging line per N food units on pickup, keeps it out of the cart pickers, and resyncs it after a quantity change', async () => {
    const providerSubject = `packaging-${shortSuffix}`;

    await send(providerSubject, `Quiero 3 ${productName}`);
    const finishAfterAdd = await send(providerSubject, 'Listo', {
      type: 'button',
      id: 'cart:finish_items',
      title: 'Listo',
    });
    // Fresh contact, so the wildcard 'name' requirement is still pending —
    // answered before the fulfillment question even appears.
    expect(finishAfterAdd.body).toContain('nombre');
    const afterName = await send(providerSubject, `Cliente Prueba ${shortSuffix}`);
    // tecnologia-demo has delivery disabled (app.tenant_capabilities) —
    // NOTE: as of this writing deliveryCapabilityEnabled() reads that table
    // with no tenant_id filter at all, so which tenant's row it actually
    // sees is undefined; flagged separately, not fixed by this suite.
    expect(afterName.body).toContain('recogida');

    const afterPickup = await send(providerSubject, 'Recogida', {
      type: 'button',
      id: 'fulfillment:pickup',
      title: 'Recogida',
    });
    // 3 food units at ratio 2 -> ceil(3/2) = 2 packaging units.
    let lines = await activeLines(afterPickup.conversationId);
    expect(lines).toEqual(
      expect.arrayContaining([
        { description_snapshot: `${productName} (Unidad)`, quantity: '3.000' },
        { description_snapshot: packagingName, quantity: '2.000' },
      ]),
    );
    expect(lines).toHaveLength(2);

    // D-106 finding #2: the packaging line is derived, never offered as a
    // choice — "Cambiar cantidad" must show only the real product.
    const corregir = await send(providerSubject, 'Corregir', {
      type: 'button',
      id: 'confirm:no',
      title: 'Corregir',
    });
    expect(corregir.body).toContain('cambiar');
    const changeQuantity = await send(providerSubject, 'Cambiar cantidad', {
      type: 'list',
      id: 'change:quantity',
      title: 'Cambiar cantidad',
    });
    expect(changeQuantity.interactive).toEqual({
      type: 'buttons',
      body: changeQuantity.body,
      options: [{ id: '1', title: productName }],
    });

    const picked = await send(providerSubject, productName, {
      type: 'button',
      id: '1',
      title: productName,
    });
    expect(picked.body).toBe(`¿Cuántas unidades de ${productName} quieres?`);
    await send(providerSubject, '5');

    // Re-choosing fulfillment (the flow always re-asks it after any
    // correction) is the next point syncPackagingFee() runs — proving the
    // packaging line tracks a cart change made *after* it was first added,
    // not just its initial value.
    await send(providerSubject, 'Listo', { type: 'button', id: 'cart:finish_items', title: 'Listo' });
    const afterSecondPickup = await send(providerSubject, 'Recogida', {
      type: 'button',
      id: 'fulfillment:pickup',
      title: 'Recogida',
    });
    lines = await activeLines(afterSecondPickup.conversationId);
    // 5 food units at ratio 2 -> ceil(5/2) = 3 packaging units.
    expect(lines).toEqual(
      expect.arrayContaining([
        { description_snapshot: `${productName} (Unidad)`, quantity: '5.000' },
        { description_snapshot: packagingName, quantity: '3.000' },
      ]),
    );
    expect(lines).toHaveLength(2);
  });
});
