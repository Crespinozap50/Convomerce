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

// D-099 follow-up: modifier_groups.min_selections/max_selections is generic
// (per-group, per-tenant data) — nothing in commercial-flow.service.ts
// branches on tenant or industry. This file proves that with harder shapes
// than the single-group happy path already covered in
// modifier-group-selections.integration-spec.ts:
//   1. two independent required/optional groups on the same item,
//   2. a group where min < max (not forced to stop at the minimum),
//   3. the exact same mechanism reused on a *different* tenant, in a
//      completely unrelated vertical (electronics, not food) that has never
//      had a modifier group before this test — the strongest available
//      evidence that nothing here is Santos Tacos-specific,
//   4. that same unrelated tenant's plain no-modifier order flow is
//      untouched (regression).
describe('D-099 — modifier group selections, harder shapes and a second tenant', () => {
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

  type Fixture = {
    tenantId: string;
    channelId: string;
    catalogId: string;
    itemId: string;
    variantId: string;
    groupIds: string[];
    optionIds: string[];
    linkIds: string[];
    itemName: string;
  };

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

  // Cleans up every conversation this fixture's tests created, in FK
  // dependency order, before touching the fixture's own catalog/modifier
  // rows — a modifier_option can't be deleted while a
  // request_line_modifiers row still references it (only conversation
  // cleanup removes those), so callers must pass every conversationId their
  // describe block produced.
  async function cleanupFixture(fixture: Fixture, conversationIds: string[]) {
    for (const conversationId of conversationIds) {
      await cleanupConversation(conversationId);
    }
    for (const linkId of fixture.linkIds) {
      await pool.query('delete from app.item_modifier_groups where id = $1', [linkId]);
    }
    if (fixture.optionIds.length > 0) {
      await pool.query('delete from app.modifier_options where id = any($1::uuid[])', [
        fixture.optionIds,
      ]);
    }
    for (const groupId of fixture.groupIds) {
      await pool.query('delete from app.modifier_groups where id = $1', [groupId]);
    }
    await pool.query('delete from app.item_variants where id = $1', [fixture.variantId]);
    await pool.query('delete from app.catalog_items where id = $1', [fixture.itemId]);
  }

  async function send(
    fixture: Fixture,
    conversationIds: string[],
    providerSubject: string,
    text: string,
  ): Promise<{ body: string | null; interactive: unknown; conversationId: string }> {
    const id = uuidv7();
    const result = await messages.receive({
      tenantId: fixture.tenantId,
      channelId: fixture.channelId,
      providerSubject,
      externalEventId: `${providerSubject}-${id}`,
      externalMessageId: `${providerSubject}-${id}`,
      text,
    });
    if (!conversationIds.includes(result.conversationId)) conversationIds.push(result.conversationId);
    if (!result.duplicate) {
      await consumer.consume({
        eventId: result.outboxEventId!,
        tenantId: fixture.tenantId,
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

  afterAll(async () => {
    await database.onModuleDestroy();
    await pool.end();
  });

  describe('two independent groups (one required, one optional) on the same item', () => {
    const tenantId = '0194f000-0000-7000-8000-000000000001'; // restaurante-demo
    const channelId = '0194f001-0000-7000-8000-000000000001';
    const catalogId = '0194f004-0000-7000-8000-000000000001';
    const itemId = uuidv7();
    const variantId = uuidv7();
    const requiredGroupId = uuidv7();
    const optionalGroupId = uuidv7();
    const requiredOptionAId = uuidv7();
    const requiredOptionBId = uuidv7();
    const optionalOptionId = uuidv7();
    const requiredLinkId = uuidv7();
    const optionalLinkId = uuidv7();
    const itemName = `PruebaDosGrupos${shortSuffix}`;
    const requiredGroupName = `Obligatorio${shortSuffix}`;
    const optionalGroupName = `Opcional${shortSuffix}`;
    const requiredOptionAName = `ReqA${shortSuffix}`;
    const requiredOptionBName = `ReqB${shortSuffix}`;
    const optionalOptionName = `Opt${shortSuffix}`;
    const fixture: Fixture = {
      tenantId,
      channelId,
      catalogId,
      itemId,
      variantId,
      groupIds: [requiredGroupId, optionalGroupId],
      optionIds: [requiredOptionAId, requiredOptionBId, optionalOptionId],
      linkIds: [requiredLinkId, optionalLinkId],
      itemName,
    };
    const conversationIds: string[] = [];

    beforeAll(async () => {
      await pool.query(
        `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type)
         values ($1,$2,$3,$4,'active','prueba','product')`,
        [itemId, tenantId, catalogId, itemName],
      );
      await pool.query(
        `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
         values ($1,$2,$3,'Unidad','active',500000,'COP','available')`,
        [variantId, tenantId, itemId],
      );
      // Required: pick exactly 1 of 2.
      await pool.query(
        `insert into app.modifier_groups(id,tenant_id,name,selection_type,min_selections,max_selections,status)
         values ($1,$2,$3,'multiple',1,1,'active')`,
        [requiredGroupId, tenantId, requiredGroupName],
      );
      await pool.query(
        `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
         values ($1,$4,$2,$3,0,'COP','active',1)`,
        [requiredOptionAId, requiredGroupId, requiredOptionAName, tenantId],
      );
      await pool.query(
        `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
         values ($1,$4,$2,$3,0,'COP','active',2)`,
        [requiredOptionBId, requiredGroupId, requiredOptionBName, tenantId],
      );
      await pool.query(
        `insert into app.item_modifier_groups(id,tenant_id,catalog_item_id,modifier_group_id,required,sort_order)
         values ($1,$2,$3,$4,true,1)`,
        [requiredLinkId, tenantId, itemId, requiredGroupId],
      );
      // Optional: min_selections = 0, purely additive.
      await pool.query(
        `insert into app.modifier_groups(id,tenant_id,name,selection_type,min_selections,max_selections,status)
         values ($1,$2,$3,'multiple',0,null,'active')`,
        [optionalGroupId, tenantId, optionalGroupName],
      );
      await pool.query(
        `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
         values ($1,$4,$2,$3,150000,'COP','active',1)`,
        [optionalOptionId, optionalGroupId, optionalOptionName, tenantId],
      );
      await pool.query(
        `insert into app.item_modifier_groups(id,tenant_id,catalog_item_id,modifier_group_id,required,sort_order)
         values ($1,$2,$3,$4,false,2)`,
        [optionalLinkId, tenantId, itemId, optionalGroupId],
      );
    });

    afterAll(() => cleanupFixture(fixture, conversationIds));

    it('blocks on the required group while the optional group stays untouched, then finishes leaving the optional group at zero', async () => {
      const providerSubject = `two-groups-${shortSuffix}`;
      const opened = await send(fixture, conversationIds, providerSubject, `Quiero ${itemName}`);

      // D-106 finding #5, live: the very first modifier prompt — right when
      // the item lands in the cart, before "Listo" is ever tapped — used to
      // mix the required group's options together with every optional
      // group's, both under the same generic "¿quieres agregar algo más?"
      // wording. On Santos Tacos' real menu that pushed real optional
      // options (e.g. a second "Adiciones" item) past WhatsApp's 10-row cap
      // with no way to reach them, and said nothing about anything being
      // required. The required group must be offered alone until satisfied.
      expect(opened.body).toBe(`Elige 1 más de "${requiredGroupName}" antes de continuar.`);
      expect(opened.interactive).toEqual({
        type: 'buttons',
        body: opened.body,
        options: [
          { id: requiredOptionAId, title: requiredOptionAName },
          { id: requiredOptionBId, title: requiredOptionBName },
          { id: 'modifier:finish', title: 'Listo' },
        ],
      });

      // The required group (min=1,max=1) still has both options unpicked —
      // "Listo" must be blocked, even though the optional group has never
      // been touched and never will be.
      const blocked = await send(fixture, conversationIds, providerSubject, 'Listo');
      expect(blocked.body).toBe(`Elige 1 más de "${requiredGroupName}" antes de continuar.`);

      // Picking the required option reaches its max (1), so that group
      // stops being offered — but the optional group (min=0, no max) still
      // is, so the item does NOT auto-finish yet; it waits, same as any
      // 'multiple' extra today.
      const afterPick = await send(fixture, conversationIds, providerSubject, requiredOptionAName);
      expect(afterPick.body).toBe(`Agregué ${requiredOptionAName}. ¿Quieres agregar otra adición?`);

      // The optional group never blocks — "Listo" finishes immediately even
      // though its min_selections=0 option was never picked.
      const finished = await send(fixture, conversationIds, providerSubject, 'Listo');
      expect(finished.body).toContain('¿Quieres agregar algo más?');

      const modifiers = await pool.query<{ description_snapshot: string }>(
        `select modifier.description_snapshot
           from app.request_line_modifiers modifier
           join app.request_lines line on line.id = modifier.request_line_id
           join app.commercial_requests request on request.id = line.commercial_request_id
          where request.conversation_id = $1`,
        [afterPick.conversationId],
      );
      expect(modifiers.rows.map((row) => row.description_snapshot)).toEqual([
        requiredOptionAName,
      ]);
    });
  });

  describe('a group where min < max (free to stop anywhere between)', () => {
    const tenantId = '0194f000-0000-7000-8000-000000000001'; // restaurante-demo
    const channelId = '0194f001-0000-7000-8000-000000000001';
    const catalogId = '0194f004-0000-7000-8000-000000000001';
    const itemId = uuidv7();
    const variantId = uuidv7();
    const groupId = uuidv7();
    const optionAId = uuidv7();
    const optionBId = uuidv7();
    const optionCId = uuidv7();
    const linkId = uuidv7();
    const itemName = `PruebaMinMenorMax${shortSuffix}`;
    const groupName = `Elige1a3${shortSuffix}`;
    const optionAName = `TopA${shortSuffix}`;
    const optionBName = `TopB${shortSuffix}`;
    const optionCName = `TopC${shortSuffix}`;
    const fixture: Fixture = {
      tenantId,
      channelId,
      catalogId,
      itemId,
      variantId,
      groupIds: [groupId],
      optionIds: [optionAId, optionBId, optionCId],
      linkIds: [linkId],
      itemName,
    };
    const conversationIds: string[] = [];

    beforeAll(async () => {
      await pool.query(
        `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type)
         values ($1,$2,$3,$4,'active','prueba','product')`,
        [itemId, tenantId, catalogId, itemName],
      );
      await pool.query(
        `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
         values ($1,$2,$3,'Unidad','active',400000,'COP','available')`,
        [variantId, tenantId, itemId],
      );
      await pool.query(
        `insert into app.modifier_groups(id,tenant_id,name,selection_type,min_selections,max_selections,status)
         values ($1,$2,$3,'multiple',1,3,'active')`,
        [groupId, tenantId, groupName],
      );
      for (const [id, name, order] of [
        [optionAId, optionAName, 1],
        [optionBId, optionBName, 2],
        [optionCId, optionCName, 3],
      ] as const) {
        await pool.query(
          `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
           values ($1,$5,$2,$3,0,'COP','active',$4)`,
          [id, groupId, name, order, tenantId],
        );
      }
      await pool.query(
        `insert into app.item_modifier_groups(id,tenant_id,catalog_item_id,modifier_group_id,required,sort_order)
         values ($1,$2,$3,$4,true,1)`,
        [linkId, tenantId, itemId, groupId],
      );
    });

    afterAll(() => cleanupFixture(fixture, conversationIds));

    it('lets "Listo" finish right after the minimum, without forcing the customer up to the maximum', async () => {
      const providerSubject = `min-lt-max-${shortSuffix}`;
      await send(fixture, conversationIds, providerSubject, `Quiero ${itemName}`);

      const blockedAtZero = await send(fixture, conversationIds, providerSubject, 'Listo');
      expect(blockedAtZero.body).toBe(`Elige 1 más de "${groupName}" antes de continuar.`);

      const afterOnePick = await send(fixture, conversationIds, providerSubject, optionAName);
      expect(afterOnePick.body).toContain(optionAName);

      // Only 1 of 3 picked, but min_selections=1 is already satisfied — the
      // customer is never forced to pick a 2nd or 3rd.
      const finishedAtMinimum = await send(fixture, conversationIds, providerSubject, 'Listo');
      expect(finishedAtMinimum.body).toContain('¿Quieres agregar algo más?');
    });

    it('still allows picking above the minimum, up to the configured maximum, on a fresh line', async () => {
      const providerSubject = `min-lt-max-above-${shortSuffix}`;
      await send(fixture, conversationIds, providerSubject, `Quiero ${itemName}`);
      await send(fixture, conversationIds, providerSubject, optionAName);
      await send(fixture, conversationIds, providerSubject, optionBName);
      // Reaching max=3 auto-finishes, same as every other max_selections case.
      const afterThird = await send(fixture, conversationIds, providerSubject, optionCName);
      expect(afterThird.body).toContain('¿Quieres agregar algo más?');
    });
  });

  describe('the exact same mechanism on a second, unrelated tenant (electronics, not food)', () => {
    const tenantId = '0194f000-0000-7000-8000-000000000002'; // tecnologia-demo
    const channelId = '0194f001-0000-7000-8000-000000000002';
    const catalogId = '0194f004-0000-7000-8000-000000000002';
    const itemId = uuidv7();
    const variantId = uuidv7();
    const groupId = uuidv7();
    const optionAId = uuidv7();
    const optionBId = uuidv7();
    const linkId = uuidv7();
    const itemName = `PruebaTech${shortSuffix}`;
    const groupName = `EligeColor${shortSuffix}`;
    const optionAName = `Negro${shortSuffix}`;
    const optionBName = `Blanco${shortSuffix}`;
    const fixture: Fixture = {
      tenantId,
      channelId,
      catalogId,
      itemId,
      variantId,
      groupIds: [groupId],
      optionIds: [optionAId, optionBId],
      linkIds: [linkId],
      itemName,
    };
    const conversationIds: string[] = [];

    beforeAll(async () => {
      // Confirms this tenant's REAL (non-test) data has never used a
      // modifier group before — the strongest available check that D-099
      // isn't quietly coupled to Santos Tacos' data. Scoped to groups
      // attached to a non-'prueba' item rather than a flat row count: an
      // earlier interrupted run's own 'prueba' debris (afterAll didn't
      // finish — e.g. --forceExit racing a slow, unrelated test file) would
      // otherwise fail this assertion for a reason that has nothing to do
      // with real seeded data.
      const existingRealGroups = await pool.query(
        `select count(*) from app.modifier_groups g
          where g.tenant_id = $1
            and exists (
              select 1 from app.item_modifier_groups link
                join app.catalog_items item
                  on item.tenant_id = link.tenant_id and item.id = link.catalog_item_id
               where link.modifier_group_id = g.id and item.category <> 'prueba'
            )`,
        [tenantId],
      );
      expect(Number(existingRealGroups.rows[0].count)).toBe(0);

      // Self-heal: remove any 'prueba' debris a prior interrupted run left
      // behind, so this run starts from a clean slate regardless — deepest
      // dependents first (a stray request_lines row, from a run whose test
      // body finished but whose afterAll got cut off, blocks the
      // item_variants delete below just like it did the catalog_items one).
      await pool.query(
        `delete from app.request_line_modifiers where request_line_id in (
           select rl.id from app.request_lines rl
             join app.item_variants v on v.id = rl.item_variant_id
             join app.catalog_items c on c.id = v.catalog_item_id
            where c.tenant_id = $1 and c.category = 'prueba'
         )`,
        [tenantId],
      );
      await pool.query(
        `delete from app.request_lines where item_variant_id in (
           select v.id from app.item_variants v
             join app.catalog_items c on c.id = v.catalog_item_id
            where c.tenant_id = $1 and c.category = 'prueba'
         )`,
        [tenantId],
      );
      await pool.query(
        `delete from app.item_modifier_groups where catalog_item_id in (
           select id from app.catalog_items where tenant_id = $1 and category = 'prueba'
         )`,
        [tenantId],
      );
      await pool.query(
        `delete from app.modifier_options where modifier_group_id in (
           select g.id from app.modifier_groups g
            where g.tenant_id = $1 and not exists (
              select 1 from app.item_modifier_groups link where link.modifier_group_id = g.id
            )
         )`,
        [tenantId],
      );
      await pool.query(
        `delete from app.modifier_groups g
          where g.tenant_id = $1 and not exists (
            select 1 from app.item_modifier_groups link where link.modifier_group_id = g.id
          )`,
        [tenantId],
      );
      await pool.query(
        `delete from app.item_variants where catalog_item_id in (
           select id from app.catalog_items where tenant_id = $1 and category = 'prueba'
         )`,
        [tenantId],
      );
      await pool.query(`delete from app.catalog_items where tenant_id = $1 and category = 'prueba'`, [
        tenantId,
      ]);

      await pool.query(
        `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type)
         values ($1,$2,$3,$4,'active','prueba','product')`,
        [itemId, tenantId, catalogId, itemName],
      );
      await pool.query(
        `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
         values ($1,$2,$3,'Unidad','active',9900000,'COP','available')`,
        [variantId, tenantId, itemId],
      );
      await pool.query(
        `insert into app.modifier_groups(id,tenant_id,name,selection_type,min_selections,max_selections,status)
         values ($1,$2,$3,'multiple',1,1,'active')`,
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
        `insert into app.item_modifier_groups(id,tenant_id,catalog_item_id,modifier_group_id,required,sort_order)
         values ($1,$2,$3,$4,true,1)`,
        [linkId, tenantId, itemId, groupId],
      );
    });

    afterAll(() => cleanupFixture(fixture, conversationIds));

    it('blocks "Listo" until a color is picked, on a tenant that has never had a modifier group before', async () => {
      const providerSubject = `tech-tenant-${shortSuffix}`;
      await send(fixture, conversationIds, providerSubject, `Quiero ${itemName}`);

      const blocked = await send(fixture, conversationIds, providerSubject, 'Listo');
      expect(blocked.body).toBe(`Elige 1 más de "${groupName}" antes de continuar.`);

      const finished = await send(fixture, conversationIds, providerSubject, optionAName);
      expect(finished.body).toContain('¿Quieres agregar algo más?');
    });

    it('leaves a plain order with no modifiers on this same tenant completely unaffected (regression)', async () => {
      const plainItem = await pool.query<{ name: string }>(
        `select name from app.catalog_items
          where tenant_id = $1 and status = 'active' and category <> 'prueba' limit 1`,
        [tenantId],
      );
      const name = plainItem.rows[0]?.name;
      expect(name).toBeTruthy();
      const providerSubject = `tech-tenant-plain-${shortSuffix}`;
      const reply = await send(fixture, conversationIds, providerSubject, `Quiero ${name}`);
      // No modifier prompt at all — goes straight to "anything else?".
      expect(reply.body).toContain('¿Quieres agregar algo más?');
    });
  });

  describe('two items in the same cart, each with its own required group', () => {
    const tenantId = '0194f000-0000-7000-8000-000000000001'; // restaurante-demo
    const channelId = '0194f001-0000-7000-8000-000000000001';
    const catalogId = '0194f004-0000-7000-8000-000000000001';
    // Two separate items, each its own fixture (afterAll iterates both), so
    // this reuses cleanupFixture without changing its Fixture shape.
    const itemAId = uuidv7();
    const variantAId = uuidv7();
    const groupAId = uuidv7();
    const optionA1Id = uuidv7();
    const optionA2Id = uuidv7();
    const linkAId = uuidv7();
    const itemAName = `PruebaCarritoA${shortSuffix}`;
    const groupAName = `EligeA${shortSuffix}`;
    const optionA1Name = `A1${shortSuffix}`;
    const optionA2Name = `A2${shortSuffix}`;

    const itemBId = uuidv7();
    const variantBId = uuidv7();
    const groupBId = uuidv7();
    const optionB1Id = uuidv7();
    const optionB2Id = uuidv7();
    const linkBId = uuidv7();
    const itemBName = `PruebaCarritoB${shortSuffix}`;
    const groupBName = `EligeB${shortSuffix}`;
    const optionB1Name = `B1${shortSuffix}`;
    const optionB2Name = `B2${shortSuffix}`;

    const fixtureA: Fixture = {
      tenantId,
      channelId,
      catalogId,
      itemId: itemAId,
      variantId: variantAId,
      groupIds: [groupAId],
      optionIds: [optionA1Id, optionA2Id],
      linkIds: [linkAId],
      itemName: itemAName,
    };
    const fixtureB: Fixture = {
      tenantId,
      channelId,
      catalogId,
      itemId: itemBId,
      variantId: variantBId,
      groupIds: [groupBId],
      optionIds: [optionB1Id, optionB2Id],
      linkIds: [linkBId],
      itemName: itemBName,
    };
    const conversationIds: string[] = [];

    async function seedItemWithRequiredGroup(
      itemId: string,
      variantId: string,
      itemName: string,
      groupId: string,
      groupName: string,
      option1Id: string,
      option1Name: string,
      option2Id: string,
      option2Name: string,
      linkId: string,
    ) {
      await pool.query(
        `insert into app.catalog_items(id,tenant_id,catalog_id,name,status,category,offering_type)
         values ($1,$2,$3,$4,'active','prueba','product')`,
        [itemId, tenantId, catalogId, itemName],
      );
      await pool.query(
        `insert into app.item_variants(id,tenant_id,catalog_item_id,name,status,price_minor,currency,availability_status)
         values ($1,$2,$3,'Unidad','active',300000,'COP','available')`,
        [variantId, tenantId, itemId],
      );
      await pool.query(
        `insert into app.modifier_groups(id,tenant_id,name,selection_type,min_selections,max_selections,status)
         values ($1,$2,$3,'multiple',1,1,'active')`,
        [groupId, tenantId, groupName],
      );
      await pool.query(
        `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
         values ($1,$4,$2,$3,0,'COP','active',1)`,
        [option1Id, groupId, option1Name, tenantId],
      );
      await pool.query(
        `insert into app.modifier_options(id,tenant_id,modifier_group_id,name,price_delta_minor,currency,status,sort_order)
         values ($1,$4,$2,$3,0,'COP','active',2)`,
        [option2Id, groupId, option2Name, tenantId],
      );
      await pool.query(
        `insert into app.item_modifier_groups(id,tenant_id,catalog_item_id,modifier_group_id,required,sort_order)
         values ($1,$2,$3,$4,true,1)`,
        [linkId, tenantId, itemId, groupId],
      );
    }

    beforeAll(async () => {
      await seedItemWithRequiredGroup(
        itemAId, variantAId, itemAName, groupAId, groupAName,
        optionA1Id, optionA1Name, optionA2Id, optionA2Name, linkAId,
      );
      await seedItemWithRequiredGroup(
        itemBId, variantBId, itemBName, groupBId, groupBName,
        optionB1Id, optionB1Name, optionB2Id, optionB2Name, linkBId,
      );
    });

    afterAll(async () => {
      await cleanupFixture(fixtureA, conversationIds);
      // conversationIds already cleaned by fixtureA's pass — pass an empty
      // list here so item B's rows aren't deleted before A's cleanup (which
      // shares the same conversations) has run.
      await cleanupFixture(fixtureB, []);
    });

    it("resolving item A's required group never touches item B's, and vice versa", async () => {
      const providerSubject = `two-items-cart-${shortSuffix}`;
      // Both items land in the same order before either's extras are
      // resolved — afterAddItem() only prompts for the item that was just
      // added, so A's group comes up first.
      await send(fixtureA, conversationIds, providerSubject, `Quiero ${itemAName}`);
      const blockedOnA = await send(fixtureA, conversationIds, providerSubject, 'Listo');
      expect(blockedOnA.body).toBe(`Elige 1 más de "${groupAName}" antes de continuar.`);

      // Resolving A's group (reaches max=1) auto-finishes item A and
      // returns to "add another item" — from there, ordering B starts B's
      // own required-group prompt completely independently of A's state.
      const finishedA = await send(fixtureA, conversationIds, providerSubject, optionA1Name);
      expect(finishedA.body).toContain('¿Quieres agregar algo más?');

      await send(fixtureA, conversationIds, providerSubject, `Quiero ${itemBName}`);
      const blockedOnB = await send(fixtureA, conversationIds, providerSubject, 'Listo');
      expect(blockedOnB.body).toBe(`Elige 1 más de "${groupBName}" antes de continuar.`);

      const finishedB = await send(fixtureA, conversationIds, providerSubject, optionB1Name);
      expect(finishedB.body).toContain('¿Quieres agregar algo más?');

      // Both lines ended up with exactly their own option, never the
      // other's — proves request_line-scoped state, not global/session
      // state that could leak between cart lines.
      const modifiers = await pool.query<{ description_snapshot: string }>(
        `select modifier.description_snapshot
           from app.request_line_modifiers modifier
           join app.request_lines line on line.id = modifier.request_line_id
           join app.commercial_requests request on request.id = line.commercial_request_id
          where request.conversation_id = $1
          order by modifier.created_at`,
        [finishedB.conversationId],
      );
      expect(modifiers.rows.map((row) => row.description_snapshot)).toEqual([
        optionA1Name,
        optionB1Name,
      ]);
    });
  });
});
