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

// D-099: a modifier group can require an exact number of picks (Santos
// Tacos' "elige tus 3 tacos" package). remainingModifiers()'s new
// group_totals subquery and the min_selections check in
// handleSelectingModifiers only run as real SQL here — a jest-mocked
// client.query test would just echo back whatever rows it was told to,
// which can't catch a broken join or off-by-one in the aggregate itself.
describe('D-099 — modifier groups with min/max selection counts', () => {
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

  const tenantId = '0194f000-0000-7000-8000-000000000001';
  const channelId = '0194f001-0000-7000-8000-000000000001';
  const catalogId = '0194f004-0000-7000-8000-000000000001';
  const itemId = uuidv7();
  const variantId = uuidv7();
  const groupId = uuidv7();
  const optionAId = uuidv7();
  const optionBId = uuidv7();
  const optionCId = uuidv7();
  const linkId = uuidv7();
  const itemName = `PruebaPaquete${shortSuffix}`;
  const groupName = `Elige2${shortSuffix}`;
  const optionAName = `Sabor Uno ${shortSuffix}`;
  const optionBName = `Sabor Dos ${shortSuffix}`;
  const optionCName = `Sabor Tres ${shortSuffix}`;
  const providerSubject = `modifier-min-max-${shortSuffix}`;
  let conversationId: string | undefined;

  beforeAll(async () => {
    await pool.query(
      `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type)
       values ($1,$2,$3,$4,'active','prueba','package')`,
      [itemId, tenantId, catalogId, itemName],
    );
    await pool.query(
      `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
       values ($1,$2,$3,'Unidad','active',1000000,'COP','available')`,
      [variantId, tenantId, itemId],
    );
    await pool.query(
      `insert into app.modifier_groups(id,tenant_id,name,selection_type,min_selections,max_selections,status)
       values ($1,$2,$3,'multiple',2,2,'active')`,
      [groupId, tenantId, groupName],
    );
    await pool.query(
      `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
       values ($1,$4,$2,$3,0,'COP','active',1)`,
      [optionAId, groupId, optionAName, tenantId],
    );
    await pool.query(
      `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
       values ($1,$4,$2,$3,0,'COP','active',2)`,
      [optionBId, groupId, optionBName, tenantId],
    );
    await pool.query(
      `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
       values ($1,$4,$2,$3,0,'COP','active',3)`,
      [optionCId, groupId, optionCName, tenantId],
    );
    await pool.query(
      `insert into app.item_modifier_groups(id,tenant_id,catalog_item_id,modifier_group_id,required,sort_order)
       values ($1,$2,$3,$4,true,1)`,
      [linkId, tenantId, itemId, groupId],
    );
  });

  afterAll(async () => {
    if (conversationId) {
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
      await pool.query(
        `delete from app.request_line_modifiers where request_line_id in (
           select rl.id from app.request_lines rl
             join app.commercial_requests cr on cr.id = rl.commercial_request_id
            where cr.conversation_id = $1
         )`,
        [conversationId],
      );
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
    await pool.query('delete from app.item_modifier_groups where id = $1', [linkId]);
    await pool.query('delete from app.modifier_options where id = any($1::uuid[])', [
      [optionAId, optionBId, optionCId],
    ]);
    await pool.query('delete from app.modifier_groups where id = $1', [groupId]);
    await pool.query('delete from app.item_variants where id = $1', [variantId]);
    await pool.query('delete from app.catalog_items where id = $1', [itemId]);
    await database.onModuleDestroy();
    await pool.end();
  });

  async function send(text: string): Promise<string | null> {
    const id = uuidv7();
    const result = await messages.receive({
      tenantId,
      channelId,
      providerSubject,
      externalEventId: `modifier-min-max-${shortSuffix}-${id}`,
      externalMessageId: `modifier-min-max-${shortSuffix}-${id}`,
      text,
    });
    conversationId = result.conversationId;
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
    return reply.rows[0]?.body ?? null;
  }

  it('blocks finishing before the minimum is picked, then auto-finishes once the maximum is reached', async () => {
    await send(`Quiero ${itemName}`);

    const blockedEarly = await send('Listo');
    expect(blockedEarly).toBe(`Elige 2 más de "${groupName}" antes de continuar.`);

    const afterFirstPick = await send(optionAName);
    expect(afterFirstPick).toContain(optionAName);

    const blockedOnceMore = await send('Listo');
    expect(blockedOnceMore).toBe(`Elige 1 más de "${groupName}" antes de continuar.`);

    // Reaching max_selections (2) finishes the item automatically, without
    // ever tapping "Listo" again — same as picking the sole option of a
    // 'single' group does today.
    const afterSecondPick = await send(optionBName);
    expect(afterSecondPick).toContain('¿Quieres agregar algo más?');

    const picked = await pool.query<{ description_snapshot: string; quantity: string }>(
      `select modifier.description_snapshot,modifier.quantity::text
         from app.request_line_modifiers modifier
         join app.request_lines line on line.id = modifier.request_line_id
         join app.commercial_requests request on request.id = line.commercial_request_id
        where request.conversation_id = $1
        order by modifier.created_at`,
      [conversationId],
    );
    expect(picked.rows.map((row) => ({ ...row, quantity: Number(row.quantity) }))).toEqual([
      { description_snapshot: optionAName, quantity: 1 },
      { description_snapshot: optionBName, quantity: 1 },
    ]);

    // The 3rd flavor was never offered again after the group's max (2) was
    // reached — confirms group_totals actually gated the option, not just
    // the finish_items branch.
    const thirdPickIgnored = await send(optionCName);
    expect(thirdPickIgnored).not.toBeNull();
  });
});
