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

// Turns this session's live-WhatsApp regression testing (D-050, D-100,
// D-107) into an executable suite against real Postgres, instead of only
// living in a manual conversation transcript. Exercises the exact bug class
// found live: "Quiero un {producto claro} y un {producto ambiguo}" used to
// silently drop the ambiguous product entirely (matchItemMentions()
// required 2+ *confident* matches to act at all) — D-107 made a genuine tie
// count alongside a confident match, and offers it for disambiguation
// instead. commercial-flow.service.spec.ts already covers the branching
// logic with mocks; this proves the real SQL (catalogItems()'s scoring
// query, the request_lines insert, the conversation_workflows tiedItems
// persistence) actually behaves the same way end to end.
describe('D-107 — an ambiguous product inside a multi-item message is offered for disambiguation, never silently dropped', () => {
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

  const tenantId = '0194f000-0000-7000-8000-000000000001'; // restaurante-demo (Santos Tacos)
  const channelId = '0194f001-0000-7000-8000-000000000001';
  const catalogId = '0194f004-0000-7000-8000-000000000001';

  // A confident, unambiguous match.
  const claroItemId = uuidv7();
  const claroVariantId = uuidv7();
  const claroName = `PruebaClaro${shortSuffix}`;
  // Two products whose names tie against each other on every token of the
  // shorter one — the exact "Chelita"/"Chelita Envenenada" shape found live.
  const ambiItemId = uuidv7();
  const ambiVariantId = uuidv7();
  const ambiName = `PruebaAmbi${shortSuffix}`;
  const ambiExtraItemId = uuidv7();
  const ambiExtraVariantId = uuidv7();
  const ambiExtraName = `${ambiName} Extra`;
  // A second, independent ambiguous pair — only used by the "two ties in
  // one message" edge case below.
  const dosItemId = uuidv7();
  const dosVariantId = uuidv7();
  const dosName = `PruebaDos${shortSuffix}`;
  const dosExtraItemId = uuidv7();
  const dosExtraVariantId = uuidv7();
  const dosExtraName = `${dosName} Extra`;

  const itemIds = [
    claroItemId,
    ambiItemId,
    ambiExtraItemId,
    dosItemId,
    dosExtraItemId,
  ];
  const variantIds = [
    claroVariantId,
    ambiVariantId,
    ambiExtraVariantId,
    dosVariantId,
    dosExtraVariantId,
  ];
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

  beforeAll(async () => {
    for (const [itemId, variantId, name] of [
      [claroItemId, claroVariantId, claroName],
      [ambiItemId, ambiVariantId, ambiName],
      [ambiExtraItemId, ambiExtraVariantId, ambiExtraName],
      [dosItemId, dosVariantId, dosName],
      [dosExtraItemId, dosExtraVariantId, dosExtraName],
    ] as const) {
      await pool.query(
        `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type)
         values ($1,$2,$3,$4,'active','prueba','product')`,
        [itemId, tenantId, catalogId, name],
      );
      await pool.query(
        `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
         values ($1,$2,$3,'Unidad','active',500000,'COP','available')`,
        [variantId, tenantId, itemId],
      );
    }
  });

  afterAll(async () => {
    for (const conversationId of conversationIds) {
      await cleanupConversation(conversationId);
    }
    await pool.query('delete from app.item_variants where id = any($1::uuid[])', [variantIds]);
    await pool.query('delete from app.catalog_items where id = any($1::uuid[])', [itemIds]);
    await database.onModuleDestroy();
    await pool.end();
  });

  it('adds the confident match and offers the ambiguous one for disambiguation, in the same message, instead of dropping it', async () => {
    const providerSubject = `multi-tie-${shortSuffix}`;

    const first = await send(providerSubject, `Quiero un ${claroName} y un ${ambiName}`);
    // The confident match is already visible in the cart alongside the
    // disambiguation question — not replaced by it.
    expect(first.body).toContain(claroName);
    expect(first.body).toContain('Encontré varias opciones, ¿cuál prefieres?');
    // The persisted content's interactive.body carries the full composed
    // text (unlike the service layer's own InteractiveMessage, which leaves
    // body empty and lets the surrounding template supply it) — confirmed
    // against a real send earlier this session.
    expect(first.interactive).toEqual({
      type: 'list',
      body: first.body,
      buttonLabel: 'Elegir',
      options: [
        { id: '1', title: ambiName },
        { id: '2', title: ambiExtraName },
      ],
    });

    const claroLines = await pool.query<{ description_snapshot: string }>(
      `select line.description_snapshot from app.request_lines line
         join app.commercial_requests request on request.id = line.commercial_request_id
        where request.conversation_id = $1 and line.status = 'active'`,
      [first.conversationId],
    );
    expect(claroLines.rows.map((row) => row.description_snapshot)).toEqual([
      `${claroName} (Unidad)`,
    ]);

    // The workflow is parked on the disambiguation step, not left dangling.
    const workflow = await pool.query<{ step: string; context: { tiedItems?: unknown[] } }>(
      `select step, context from app.conversation_workflows
        where commercial_request_id in (
          select id from app.commercial_requests where conversation_id = $1
        ) and status = 'active'`,
      [first.conversationId],
    );
    expect(workflow.rows[0]?.step).toBe('selecting_item');
    expect(workflow.rows[0]?.context.tiedItems).toHaveLength(2);

    // Tapping the ambiguous option resolves it by index, same as any other
    // tie in this flow.
    const second = await send(providerSubject, ambiExtraName, {
      type: 'list',
      id: '2',
      title: ambiExtraName,
    });
    expect(second.body).toContain(claroName);
    expect(second.body).toContain(ambiExtraName);

    const finalLines = await pool.query<{ description_snapshot: string }>(
      `select line.description_snapshot from app.request_lines line
         join app.commercial_requests request on request.id = line.commercial_request_id
        where request.conversation_id = $1 and line.status = 'active'
        order by line.created_at`,
      [first.conversationId],
    );
    expect(finalLines.rows.map((row) => row.description_snapshot)).toEqual([
      `${claroName} (Unidad)`,
      `${ambiExtraName} (Unidad)`,
    ]);
  });

  it('does not crash when both segments of a message tie, and reports the second tie as unmatched instead of guessing', async () => {
    const providerSubject = `double-tie-${shortSuffix}`;

    const reply = await send(providerSubject, `Quiero un ${ambiName} y un ${dosName}`);
    expect(reply.body).not.toBeNull();
    // Nothing was confidently matched, so nothing was inserted — only the
    // first tie is offered; the second is reported as unmatched, not lost.
    expect(reply.body).toContain('No encontré');
    // splitItemMentions() lowercases/strips accents before matching, so the
    // reported unmatched segment reads back lowercase, not in the message's
    // original casing.
    expect(reply.body?.toLowerCase()).toContain(dosName.toLowerCase());
    expect(reply.interactive).toEqual({
      type: 'list',
      body: reply.body,
      buttonLabel: 'Elegir',
      options: [
        { id: '1', title: ambiName },
        { id: '2', title: ambiExtraName },
      ],
    });

    const lines = await pool.query<{ id: string }>(
      `select line.id from app.request_lines line
         join app.commercial_requests request on request.id = line.commercial_request_id
        where request.conversation_id = $1 and line.status = 'active'`,
      [reply.conversationId],
    );
    expect(lines.rows).toHaveLength(0);
  });
});
