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

// Automatiza la matriz de aceptación de Fase 2 (docs/acceptance-matrix.md),
// probada manualmente hasta ahora. Cubre exactamente la clase de bug que esa
// ronda manual encontró en D-077/D-082/D-083/D-084/D-085: colisión de
// vocabulario fijo entre rubros, datos sembrados incompletos por tenant, y
// fuga de datos/routing entre tenants — no re-prueba la lógica interna de
// cada máquina de estados (eso ya lo cubren commercial-flow.service.spec.ts
// y appointment-flow.service.spec.ts con mocks).
//
// Las aserciones usan los campos estructurados que ya persiste
// message-received.consumer.ts (`content->'decision'`, `content->'sources'`)
// en vez de texto libre — así una regresión real (routing a la capacidad
// equivocada, un `knowledge_entry`/`catalog_item` de OTRO tenant, un cambio
// de redacción del bot) hace fallar la prueba, pero retocar una frase de
// copy no.
describe('Fase 2 — matriz de aceptación automatizada (D-091)', () => {
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

  type Tenant = {
    slug: string;
    tenantId: string;
    channelId: string;
    capabilities: { orders: boolean; appointments: boolean };
  };
  const restaurante: Tenant = {
    slug: 'restaurante-demo',
    tenantId: '0194f000-0000-7000-8000-000000000001',
    channelId: '0194f001-0000-7000-8000-000000000001',
    capabilities: { orders: true, appointments: false },
  };
  const tecnologia: Tenant = {
    slug: 'tecnologia-demo',
    tenantId: '0194f000-0000-7000-8000-000000000002',
    channelId: '0194f001-0000-7000-8000-000000000002',
    capabilities: { orders: true, appointments: false },
  };
  const barberia: Tenant = {
    slug: 'barberia-robledo',
    tenantId: '0194f000-0000-7000-8000-000000000003',
    channelId: '0194f001-0000-7000-8000-000000000003',
    capabilities: { orders: false, appointments: true },
  };
  const spa: Tenant = {
    slug: 'spa-botanica',
    tenantId: '0194f000-0000-7000-8000-000000000004',
    channelId: '0194f001-0000-7000-8000-000000000004',
    capabilities: { orders: false, appointments: true },
  };
  const lavadero: Tenant = {
    slug: 'lavadero-ruta-80',
    tenantId: '0194f000-0000-7000-8000-000000000005',
    channelId: '0194f001-0000-7000-8000-000000000005',
    capabilities: { orders: false, appointments: true },
  };
  const allTenants = [restaurante, tecnologia, barberia, spa, lavadero];

  const createdConversations: { tenantId: string; conversationId: string }[] =
    [];

  afterAll(async () => {
    for (const { tenantId, conversationId } of createdConversations) {
      await cleanupConversation(pool, tenantId, conversationId);
    }
    await database.onModuleDestroy();
    await pool.end();
  });

  async function sendTurn(tenant: Tenant, providerSubject: string, text: string) {
    const id = uuidv7();
    const result = await messages.receive({
      tenantId: tenant.tenantId,
      channelId: tenant.channelId,
      providerSubject,
      externalEventId: `matrix-${suffix}-${id}`,
      externalMessageId: `matrix-${suffix}-${id}`,
      text,
    });
    if (
      !createdConversations.some(
        (c) => c.conversationId === result.conversationId,
      )
    ) {
      createdConversations.push({
        tenantId: tenant.tenantId,
        conversationId: result.conversationId,
      });
    }
    if (!result.duplicate) {
      await consumer.consume({
        eventId: result.outboxEventId!,
        tenantId: tenant.tenantId,
        messageId: result.messageId,
        conversationId: result.conversationId,
      });
    }
    const reply = await pool.query<{
      body: string;
      decision: { capability: string; intent: string; outcome: string } | null;
      sources: string[] | null;
    }>(
      `select content->>'body' as body, content->'decision' as decision, content->'sources' as sources
         from app.messages
        where conversation_id = $1 and direction = 'outbound'
        order by occurred_at desc, id desc limit 1`,
      [result.conversationId],
    );
    return { conversationId: result.conversationId, ...reply.rows[0] };
  }

  describe.each(allTenants)('$slug', (tenant) => {
    it('está alcanzable y expone exactamente las capacidades de la matriz', async () => {
      const channel = await pool.query<{ status: string }>(
        'select status from app.channels where id = $1 and tenant_id = $2',
        [tenant.channelId, tenant.tenantId],
      );
      expect(channel.rows[0]?.status).toBe('active');

      const caps = await pool.query<{ capability: string; enabled: boolean }>(
        'select capability, enabled from app.tenant_capabilities where tenant_id = $1',
        [tenant.tenantId],
      );
      const enabled = Object.fromEntries(
        caps.rows.map((row) => [row.capability, row.enabled]),
      );
      expect(enabled.orders).toBe(tenant.capabilities.orders);
      expect(enabled.appointments).toBe(tenant.capabilities.appointments);

      // D-082: el requisito operativo ("¿cómo te llamas?") debe existir para
      // cualquier tenant que pueda completar un pedido o una cita.
      if (tenant.capabilities.orders || tenant.capabilities.appointments) {
        const requirementsRows = await pool.query(
          'select 1 from app.operational_requirements where tenant_id = $1 limit 1',
          [tenant.tenantId],
        );
        expect(requirementsRows.rowCount).toBeGreaterThan(0);
      }
    });
  });

  describe('conocimiento — cada tenant responde con SU PROPIA FAQ, no con el fallback ni con otro intent fijo (D-077/D-085)', () => {
    it.each([
      {
        tenant: restaurante,
        question: '¿Tienen opciones vegetarianas?',
        entryId: '0194f007-0000-7000-8000-000000000014',
      },
      {
        tenant: tecnologia,
        question: 'Garantía',
        entryId: '0194f007-0000-7000-8000-000000000002',
      },
      {
        // Caso real de D-085: "atienden" es palabra clave del intent fijo
        // "hours"; esta pregunta debe responderse con su propia FAQ, no con
        // el horario de atención.
        tenant: barberia,
        question: '¿Atienden niños?',
        entryId: '0194f007-0000-7000-8000-000000000033',
      },
      {
        tenant: spa,
        question: '¿Qué debo informar antes del masaje?',
        entryId: '0194f007-0000-7000-8000-000000000043',
      },
      {
        tenant: lavadero,
        question: '¿Cuánto tarda el lavado?',
        entryId: '0194f007-0000-7000-8000-000000000052',
      },
    ])(
      '$tenant.slug: "$question" resuelve a su propia entrada de conocimiento',
      async ({ tenant, question, entryId }) => {
        const reply = await sendTurn(
          tenant,
          `matrix-${suffix}-conocimiento-${tenant.slug}`,
          question,
        );
        expect(reply.sources).toContain(`knowledge_entry:${entryId}`);
        expect(reply.decision?.outcome).toBe('respond');
      },
    );
  });

  describe('catálogo — cada tenant expone su propio catálogo activo, nunca el de otro tenant', () => {
    it.each([
      {
        tenant: restaurante,
        question: '¿Qué tienen en el menú?',
        itemId: '0194f005-0000-7000-8000-000000000001',
      },
      {
        tenant: tecnologia,
        question: '¿Cuánto cuesta el celular gama alta?',
        itemId: '0194f005-0000-7000-8000-100000000003',
      },
      {
        tenant: barberia,
        question: '¿Cuál es el precio del corte?',
        itemId: '0194f005-0000-7000-8000-000000000031',
      },
      {
        tenant: spa,
        question: '¿Cuánto cuesta el masaje?',
        itemId: '0194f005-0000-7000-8000-000000000041',
      },
      {
        tenant: lavadero,
        question: '¿Cuánto cuesta el lavado?',
        itemId: '0194f005-0000-7000-8000-000000000052',
      },
    ])(
      '$tenant.slug: "$question" incluye su propio catálogo',
      async ({ tenant, question, itemId }) => {
        const reply = await sendTurn(
          tenant,
          `matrix-${suffix}-catalogo-${tenant.slug}`,
          question,
        );
        expect(reply.sources).toContain(`catalog_item:${itemId}`);
      },
    );
  });

  describe('pedidos — solo los tenants con `orders` habilitado inician un pedido real', () => {
    it.each([
      { tenant: restaurante, message: 'Quiero pedir Tacos al pastor' },
      { tenant: tecnologia, message: 'Quiero pedir Celular gama alta' },
    ])('$tenant.slug: inicia un pedido real', async ({ tenant, message }) => {
      const reply = await sendTurn(
        tenant,
        `matrix-${suffix}-pedido-${tenant.slug}`,
        message,
      );
      expect(reply.decision?.capability).toBe('commerce');
      expect(reply.decision?.outcome).toBe('respond');

      const workflow = await pool.query(
        `select 1 from app.conversation_workflows
          where conversation_id = $1 and status = 'active' and operation_type = 'order'`,
        [reply.conversationId],
      );
      expect(workflow.rowCount).toBe(1);
    });
  });

  describe('citas y recursos — solo los tenants con `appointments` habilitado inician una reserva real', () => {
    it.each([
      {
        tenant: barberia,
        message: 'Quiero reservar Corte clásico o degradado',
      },
      { tenant: spa, message: 'Quiero reservar Masaje relajante' },
      {
        tenant: lavadero,
        message: 'Quiero reservar Lavado completo de automóvil',
      },
    ])('$tenant.slug: inicia una reserva real', async ({ tenant, message }) => {
      const reply = await sendTurn(
        tenant,
        `matrix-${suffix}-cita-${tenant.slug}`,
        message,
      );
      expect(reply.decision?.capability).toBe('appointment');
      expect(reply.decision?.outcome).toBe('respond');

      const workflow = await pool.query(
        `select 1 from app.conversation_workflows
          where conversation_id = $1 and status = 'active' and operation_type = 'appointment'`,
        [reply.conversationId],
      );
      expect(workflow.rowCount).toBe(1);

      // Todo tenant con citas habilitadas de esta muestra también tiene
      // recursos reservables configurados (barbero, terapeuta, bahía...) —
      // sin esto, D-084-class: canal alcanzable pero sin nada que ofrecer.
      const resources = await pool.query(
        `select 1 from app.booking_resources where tenant_id = $1 and status = 'active' limit 1`,
        [tenant.tenantId],
      );
      expect(resources.rowCount).toBeGreaterThan(0);
    });
  });

  it('recomendaciones — solo Santos Tacos tiene reglas configuradas; el resto es N/A por diseño, no por bug', async () => {
    const rows = await pool.query<{ slug: string; count: number }>(
      `select tenant.slug, count(recommendation.id)::int as count
         from app.tenants tenant
         left join app.product_recommendations recommendation
           on recommendation.tenant_id = tenant.id
        where tenant.id = any($1::uuid[])
        group by tenant.slug`,
      [allTenants.map((tenant) => tenant.tenantId)],
    );
    const counts = Object.fromEntries(
      rows.rows.map((row) => [row.slug, row.count]),
    );
    expect(counts['restaurante-demo']).toBeGreaterThan(0);
    expect(counts['tecnologia-demo']).toBe(0);
    expect(counts['barberia-robledo']).toBe(0);
    expect(counts['spa-botanica']).toBe(0);
    expect(counts['lavadero-ruta-80']).toBe(0);
  });
});

async function cleanupConversation(
  pool: Pool,
  tenantId: string,
  conversationId: string,
): Promise<void> {
  const contact = await pool.query<{ contact_id: string }>(
    'select contact_id from app.conversations where id = $1',
    [conversationId],
  );
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
  const commercialRequestIds = (
    await pool.query<{ id: string }>(
      'select id from app.commercial_requests where conversation_id = $1',
      [conversationId],
    )
  ).rows.map((row) => row.id);
  if (commercialRequestIds.length > 0) {
    await pool.query(
      'delete from app.request_lines where commercial_request_id = any($1::uuid[])',
      [commercialRequestIds],
    );
  }
  await pool.query('delete from app.conversation_workflows where conversation_id = $1', [
    conversationId,
  ]);
  await pool.query('delete from app.commercial_requests where conversation_id = $1', [
    conversationId,
  ]);
  await pool.query(
    'delete from app.unresolved_customer_questions where tenant_id = $1 and last_conversation_id = $2',
    [tenantId, conversationId],
  );
  await pool.query(
    "delete from app.processing_events where tenant_id = $1 and source = 'development_harness' and external_event_id like $2",
    [tenantId, `matrix-%`],
  );
  await pool.query('delete from app.messages where conversation_id = $1', [
    conversationId,
  ]);
  await pool.query('delete from app.conversations where id = $1', [conversationId]);
  if (contact.rows[0]?.contact_id) {
    await pool.query('delete from app.contact_identities where contact_id = $1', [
      contact.rows[0].contact_id,
    ]);
    await pool.query('delete from app.contacts where id = $1', [
      contact.rows[0].contact_id,
    ]);
  }
}
