import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { MessageReceivedConsumer } from '../src/commerce-events/message-received.consumer';
import { DeterministicReplyService } from '../src/commerce-events/deterministic-reply.service';
import { CommercialFlowService } from '../src/commerce-events/commercial-flow.service';
import { ConsultativeRecommendationService } from '../src/commerce-events/consultative-recommendation.service';
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

// D-128/D-129 (docs/decisions.md): the consultative recommendation flow —
// a customer describing a need in free text instead of naming a product —
// only had unit-test coverage until now, even though it's CrediCel Store's
// (tecnologia-demo) actual business shape, unlike every other seeded
// tenant. This is the integration-level counterpart, following the exact
// harness pattern acceptance-matrix.integration-spec.ts already
// established (real DatabaseService/InboundMessagesService/
// MessageReceivedConsumer against real Postgres), with two differences:
// CommercialFlowService is built WITH its optional 3rd arg (every other
// integration spec omits it on purpose, so this is the only one that
// exercises the real hook, including the D-128 same-transaction budget
// fix — a regression there would hang this suite exactly like it hung the
// dev server before that fix, not just fail an assertion), and
// global.fetch is mocked so the suite stays fast, free and deterministic —
// D-129 already audited the model's actual judgment quality manually with
// real OpenAI calls; this suite verifies the wiring, not the model.
describe('D-128/D-129 — recomendación consultiva de CrediCel Store (tecnologia-demo)', () => {
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
    OPENAI_RESPONSE_REWRITING_ENABLED: 'false',
    OPENAI_CONSULTATIVE_RECOMMENDATIONS_ENABLED: 'true',
    OPENAI_API_KEY: 'test-key-not-real',
    OPENAI_RECOMMENDATION_MODEL: 'gpt-5.4-mini',
    OPENAI_RESPONSE_TIMEOUT_MS: 8000,
  });
  const database = new DatabaseService(config);
  const messages = new InboundMessagesService(database);
  const recommendations = new RecommendationService();
  const requirements = new OperationalRequirementsService(database);
  const appointments = new AppointmentFlowService(requirements);
  const budgets = new AiUsageBudgetService(database);
  const consultative = new ConsultativeRecommendationService(config, budgets);
  const commerce = new CommercialFlowService(recommendations, requirements, consultative);
  const knowledge = new DeterministicReplyService();
  const consumer = new MessageReceivedConsumer(
    database,
    config,
    new ConversationDecisionEngine(appointments, commerce, knowledge),
    new LocalizedResponseComposer(),
    new NaturalResponseRewriter(config, budgets),
    new ConversationLanguageService(),
    new DeterministicUnderstandingProvider(),
  );
  const pool = new Pool({ connectionString });

  const tenantId = '0194f000-0000-7000-8000-000000000002'; // tecnologia-demo (CrediCel Store)
  const channelId = '0194f001-0000-7000-8000-000000000002';

  // Real seeded catalog rows (database/seeds/005_credicel_store_catalog.sql)
  // — the candidate list tryConsultativeRecommendation() builds comes from
  // a real query against app.catalog_items/item_variants, so the mock's
  // picks must be real variant ids that query will actually return.
  const equipoPortatilDemo = {
    variantId: '0194f006-0000-7000-8000-000000000002',
    name: 'Equipo portátil demo',
  };
  const portatilAcer = {
    variantId: '0194f006-0000-7000-8000-100000000027',
    name: 'Portátil Acer para estudiantes',
  };

  const createdConversations: string[] = [];
  const originalFetch = global.fetch;
  let originalPolicy: Record<string, unknown> | null = null;
  let originalCapabilityEnabled: boolean | null = null;

  beforeAll(async () => {
    const policy = await pool.query(
      'select * from app.ai_response_policies where tenant_id = $1',
      [tenantId],
    );
    originalPolicy = policy.rows[0] ?? null;
    await pool.query(
      `insert into app.ai_response_policies(tenant_id,enabled,rollout_percentage,daily_request_limit,monthly_cost_limit_minor)
       values($1,true,100,1000,100000)
       on conflict(tenant_id) do update set enabled=true,rollout_percentage=100,daily_request_limit=1000,monthly_cost_limit_minor=100000,updated_at=now()`,
      [tenantId],
    );

    const capability = await pool.query<{ enabled: boolean }>(
      `select enabled from app.tenant_capabilities where tenant_id=$1 and capability='consultative_recommendations'`,
      [tenantId],
    );
    originalCapabilityEnabled = capability.rows[0]?.enabled ?? null;
    await pool.query(
      `insert into app.tenant_capabilities(tenant_id,capability,enabled) values($1,'consultative_recommendations',true)
       on conflict(tenant_id,capability) do update set enabled=true,updated_at=now()`,
      [tenantId],
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    for (const conversationId of createdConversations) {
      await cleanupConversation(pool, tenantId, conversationId);
    }
    if (originalPolicy) {
      await pool.query(
        `update app.ai_response_policies set enabled=$2,rollout_percentage=$3,daily_request_limit=$4,monthly_cost_limit_minor=$5,updated_at=now() where tenant_id=$1`,
        [
          tenantId,
          originalPolicy.enabled,
          originalPolicy.rollout_percentage,
          originalPolicy.daily_request_limit,
          originalPolicy.monthly_cost_limit_minor,
        ],
      );
    } else {
      await pool.query('delete from app.ai_response_policies where tenant_id=$1', [tenantId]);
    }
    if (originalCapabilityEnabled !== null) {
      await pool.query(
        `update app.tenant_capabilities set enabled=$2,updated_at=now() where tenant_id=$1 and capability='consultative_recommendations'`,
        [tenantId, originalCapabilityEnabled],
      );
    } else {
      await pool.query(
        `delete from app.tenant_capabilities where tenant_id=$1 and capability='consultative_recommendations'`,
        [tenantId],
      );
    }
    await database.onModuleDestroy();
    await pool.end();
  });

  function mockAiPicks(picks: { variantId: string; reason: string }[] | null) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({ picks: picks ?? [] }),
      }),
    }) as never;
  }

  // Real WhatsApp list/button taps carry an interactiveSelection (id +
  // reconstructed title) alongside the text, not a bare digit — a bare "1"
  // sent as plain text has no interactiveSelectionId at all and is
  // treated as free-text description by the deterministic understanding
  // provider (selectionIndex only ever comes from interactiveSelectionId).
  // See interactive-message.types.ts's InboundInteractiveSelection.
  async function sendTurn(
    providerSubject: string,
    text: string,
    interactiveSelection?: { id: string; title: string },
  ) {
    const id = uuidv7();
    const result = await messages.receive({
      tenantId,
      channelId,
      providerSubject,
      externalEventId: `consultative-${suffix}-${id}`,
      externalMessageId: `consultative-${suffix}-${id}`,
      text,
      interactiveSelection: interactiveSelection
        ? { type: 'list', id: interactiveSelection.id, title: interactiveSelection.title }
        : undefined,
    });
    if (!createdConversations.includes(result.conversationId)) {
      createdConversations.push(result.conversationId);
    }
    if (!result.duplicate) {
      await consumer.consume({
        eventId: result.outboxEventId!,
        tenantId,
        messageId: result.messageId,
        conversationId: result.conversationId,
      });
    }
    const reply = await pool.query<{
      body: string;
      interactive: { type: string; options: { id: string; title: string; description?: string }[] } | null;
      decision: { capability: string; outcome: string } | null;
    }>(
      `select content->>'body' as body, content->'interactive' as interactive, content->'decision' as decision
         from app.messages
        where conversation_id = $1 and direction = 'outbound'
        order by occurred_at desc, id desc limit 1`,
      [result.conversationId],
    );
    return { conversationId: result.conversationId, ...reply.rows[0] };
  }

  it('camino feliz: texto libre describiendo una necesidad recibe una lista tocable con precio, razón y "Ver más información"', async () => {
    mockAiPicks([
      { variantId: equipoPortatilDemo.variantId, reason: 'Tiene tarjeta gráfica dedicada para diseño gráfico.' },
      { variantId: portatilAcer.variantId, reason: 'Opción más económica si el presupuesto es ajustado.' },
    ]);

    const reply = await sendTurn(
      `consultative-${suffix}-happy`,
      'Necesito un computador para diseño gráfico, tengo 3 millones de pesos, ¿qué me pueden ofrecer?',
    );

    expect(reply.decision?.capability).toBe('commerce');
    expect(reply.interactive?.type).toBe('list');
    expect(reply.interactive?.options).toEqual([
      expect.objectContaining({ id: '1', title: equipoPortatilDemo.name, description: expect.stringContaining('diseño gráfico') }),
      expect.objectContaining({ id: '2', title: expect.stringContaining('Portátil Acer') }),
      expect.objectContaining({ id: '3', title: expect.stringContaining('Ver más') }),
    ]);

    const workflow = await pool.query<{ step: string; context: { tiedItems: unknown[]; consultativeReasons: Record<string, string> } }>(
      `select step, context from app.conversation_workflows where conversation_id=$1 and status='active'`,
      [reply.conversationId],
    );
    expect(workflow.rows[0]?.step).toBe('selecting_item');
    expect(workflow.rows[0]?.context.tiedItems).toHaveLength(2);
    expect(workflow.rows[0]?.context.consultativeReasons[equipoPortatilDemo.variantId]).toContain('diseño gráfico');
  });

  it('tocar una opción recomendada agrega el producto correcto al carrito', async () => {
    mockAiPicks([
      { variantId: equipoPortatilDemo.variantId, reason: 'Tiene tarjeta gráfica dedicada.' },
      { variantId: portatilAcer.variantId, reason: 'Opción económica.' },
    ]);
    const providerSubject = `consultative-${suffix}-select`;
    await sendTurn(providerSubject, 'Necesito un computador para diseño gráfico, tengo 3 millones de pesos');

    const tap = await sendTurn(providerSubject, equipoPortatilDemo.name, { id: '1', title: equipoPortatilDemo.name });

    expect(tap.decision?.outcome).toBe('respond');
    const line = await pool.query(
      `select description_snapshot, quantity from app.request_lines rl
         join app.commercial_requests cr on cr.id = rl.commercial_request_id
        where cr.conversation_id = $1 and rl.status = 'active'`,
      [tap.conversationId],
    );
    expect(line.rows).toEqual([
      expect.objectContaining({ description_snapshot: expect.stringContaining(equipoPortatilDemo.name) }),
    ]);
  });

  it('tocar "Ver más información" muestra el texto completo sin cortar y no toca el carrito', async () => {
    const longReason =
      'Trae tarjeta gráfica dedicada, procesador de alto rendimiento y suficiente memoria RAM para trabajar cómodamente en proyectos de diseño gráfico exigentes durante muchas horas seguidas.';
    mockAiPicks([
      { variantId: equipoPortatilDemo.variantId, reason: longReason },
      { variantId: portatilAcer.variantId, reason: 'Opción económica.' },
    ]);
    const providerSubject = `consultative-${suffix}-detail`;
    await sendTurn(providerSubject, 'Necesito un computador para diseño gráfico, tengo 3 millones de pesos');

    const detail = await sendTurn(providerSubject, 'Ver más información', { id: '3', title: 'Ver más información' });

    expect(detail.body).toContain(longReason);
    expect(detail.interactive?.type).toBe('list');
    const line = await pool.query(
      `select 1 from app.request_lines rl join app.commercial_requests cr on cr.id = rl.commercial_request_id where cr.conversation_id = $1`,
      [detail.conversationId],
    );
    expect(line.rowCount).toBe(0);
  });

  it('D-129 — reenviar texto libre en vez de tocar una opción re-muestra la lista, sin adivinar un producto del catálogo completo', async () => {
    // Reproduce el hallazgo en vivo: "diseño" del mensaje coincidía por
    // accidente con el nombre de un producto ajeno a las opciones
    // ofrecidas ("Tablet premium para diseño"), agregándolo con una
    // cantidad mal leída de "3 millones". Nunca debe volver a pasar
    // mientras el tie activo venga de una recomendación consultiva.
    mockAiPicks([
      { variantId: equipoPortatilDemo.variantId, reason: 'Tiene tarjeta gráfica dedicada.' },
      { variantId: portatilAcer.variantId, reason: 'Opción económica.' },
    ]);
    const providerSubject = `consultative-${suffix}-retype`;
    await sendTurn(providerSubject, 'Necesito un computador para diseño gráfico, tengo 3 millones de pesos');

    const retry = await sendTurn(
      providerSubject,
      'Necesito un computador para diseño gráfico, tengo 3 millones de pesos, ¿qué me pueden ofrecer?',
    );

    expect(retry.interactive?.options).toEqual([
      expect.objectContaining({ id: '1', title: equipoPortatilDemo.name }),
      expect.objectContaining({ id: '2', title: expect.stringContaining('Portátil Acer') }),
      expect.objectContaining({ id: '3', title: expect.stringContaining('Ver más') }),
    ]);
    const lines = await pool.query(
      `select 1 from app.request_lines rl join app.commercial_requests cr on cr.id = rl.commercial_request_id where cr.conversation_id = $1`,
      [retry.conversationId],
    );
    expect(lines.rowCount).toBe(0);
  });

  it('sin match razonable, la IA devuelve una lista vacía y el tenant cae a su comportamiento normal, sin forzar una recomendación', async () => {
    mockAiPicks([]);

    const reply = await sendTurn(
      `consultative-${suffix}-notopic`,
      'Busco un carro usado en buen estado, ¿qué tienen disponible?',
    );

    expect(reply.decision?.capability).not.toBe('commerce');
    const workflow = await pool.query(
      `select 1 from app.conversation_workflows where conversation_id=$1 and status='active'`,
      [reply.conversationId],
    );
    expect(workflow.rowCount).toBe(0);
  });

  it('con la capacidad `consultative_recommendations` deshabilitada, nunca llama al proveedor de IA', async () => {
    await pool.query(
      `update app.tenant_capabilities set enabled=false where tenant_id=$1 and capability='consultative_recommendations'`,
      [tenantId],
    );
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    try {
      const reply = await sendTurn(
        `consultative-${suffix}-capoff`,
        'Necesito un computador para diseño gráfico, tengo 3 millones de pesos, ¿qué me pueden ofrecer?',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(reply.decision?.capability).not.toBe('commerce');
    } finally {
      await pool.query(
        `update app.tenant_capabilities set enabled=true where tenant_id=$1 and capability='consultative_recommendations'`,
        [tenantId],
      );
    }
  });

  it('con `ai_response_policies` deshabilitada, nunca llama al proveedor de IA', async () => {
    await pool.query('update app.ai_response_policies set enabled=false where tenant_id=$1', [tenantId]);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    try {
      const reply = await sendTurn(
        `consultative-${suffix}-policyoff`,
        'Necesito un computador para diseño gráfico, tengo 3 millones de pesos, ¿qué me pueden ofrecer?',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(reply.decision?.capability).not.toBe('commerce');
    } finally {
      await pool.query('update app.ai_response_policies set enabled=true where tenant_id=$1', [tenantId]);
    }
  });
});

async function cleanupConversation(pool: Pool, tenantId: string, conversationId: string): Promise<void> {
  const contact = await pool.query<{ contact_id: string }>(
    'select contact_id from app.conversations where id = $1',
    [conversationId],
  );
  await pool.query('delete from app.ai_usage where tenant_id = $1 and conversation_id = $2', [
    tenantId,
    conversationId,
  ]);
  await pool.query(
    'delete from app.ai_usage_reservations where tenant_id = $1 and conversation_id = $2',
    [tenantId, conversationId],
  );
  const messageIds = (
    await pool.query<{ id: string }>('select id from app.messages where conversation_id = $1', [
      conversationId,
    ])
  ).rows.map((row) => row.id);
  if (messageIds.length > 0) {
    const outboxIds = (
      await pool.query<{ id: string }>(
        `select id from app.outbox_events where aggregate_type = 'message' and aggregate_id = any($1::uuid[])`,
        [messageIds],
      )
    ).rows.map((row) => row.id);
    if (outboxIds.length > 0) {
      await pool.query('delete from app.processed_events where event_id = any($1::uuid[])', [outboxIds]);
      await pool.query('delete from app.outbox_events where id = any($1::uuid[])', [outboxIds]);
    }
    await pool.query('delete from app.audit_events where subject_id = any($1::uuid[])', [messageIds]);
  }
  const commercialRequestIds = (
    await pool.query<{ id: string }>(
      'select id from app.commercial_requests where conversation_id = $1',
      [conversationId],
    )
  ).rows.map((row) => row.id);
  if (commercialRequestIds.length > 0) {
    await pool.query('delete from app.recommendation_events where commercial_request_id = any($1::uuid[])', [
      commercialRequestIds,
    ]);
    await pool.query('delete from app.request_lines where commercial_request_id = any($1::uuid[])', [
      commercialRequestIds,
    ]);
  }
  await pool.query('delete from app.conversation_workflows where conversation_id = $1', [conversationId]);
  await pool.query('delete from app.commercial_requests where conversation_id = $1', [conversationId]);
  await pool.query(
    'delete from app.unresolved_customer_questions where tenant_id = $1 and last_conversation_id = $2',
    [tenantId, conversationId],
  );
  await pool.query(
    "delete from app.processing_events where tenant_id = $1 and source = 'development_harness' and external_event_id like $2",
    [tenantId, 'consultative-%'],
  );
  await pool.query('delete from app.messages where conversation_id = $1', [conversationId]);
  await pool.query('delete from app.conversations where id = $1', [conversationId]);
  if (contact.rows[0]?.contact_id) {
    await pool.query('delete from app.contact_identities where contact_id = $1', [contact.rows[0].contact_id]);
    await pool.query('delete from app.contacts where id = $1', [contact.rows[0].contact_id]);
  }
}
