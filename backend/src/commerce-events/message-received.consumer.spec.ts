import { MessageReceivedConsumer } from './message-received.consumer';

describe('MessageReceivedConsumer', () => {
  const event = {
    eventId: '0194f100-0000-7000-8000-000000000001',
    tenantId: '0194f000-0000-7000-8000-000000000001',
    messageId: '0194f100-0000-7000-8000-000000000002',
    conversationId: '0194f003-0000-7000-8000-000000000001',
  };

  function buildConsumer() {
    const calls: string[] = [];
    const domainClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('insert into app.processed_events'))
          return { rowCount: 1, rows: [{ id: 'processed-1' }] };
        if (sql.includes('select message.channel_id'))
          return {
            rowCount: 1,
            rows: [
              {
                channel_id: 'channel-1',
                body: 'hola',
                interactive_selection_id: null,
                handling_mode: 'bot',
                display_name: null,
                contact_id: 'contact-1',
              },
            ],
          };
        if (sql.includes('insert into app.audit_events')) return { rows: [] };
        if (sql.includes('select bot.enabled'))
          return {
            rows: [
              {
                enabled: true,
                assistant_name: 'Santos',
                business_name: 'Santos Tacos',
                locale: 'es',
                welcome_message: null,
                fallback_message: null,
                handoff_keywords: [],
                timezone: 'America/Bogota',
              },
            ],
          };
        if (sql.includes('update app.conversations')) return { rows: [] };
        return { rows: [] };
      }),
    };
    const sendClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    const database = {
      withTenantTransaction: jest
        .fn()
        .mockImplementationOnce((_tenantId: string, cb: (client: unknown) => unknown) => {
          calls.push('domain-transaction');
          return cb(domainClient);
        })
        .mockImplementationOnce((_tenantId: string, cb: (client: unknown) => unknown) => {
          calls.push('persist-transaction');
          return cb(sendClient);
        }),
    };
    const config = { get: jest.fn().mockReturnValue('false') };
    const decisions = {
      decide: jest.fn().mockResolvedValue({
        outcome: 'respond',
        capability: 'knowledge',
        intent: 'hours',
        requestedAction: null,
        confidence: 0.9,
        sources: [],
        reason: 'knowledge_intent_matched',
        responsePlan: {
          kind: 'localized_template',
          template: { namespace: 'commercial', key: 'itemUnknown' },
          values: {},
        },
      }),
    };
    const composer = {
      compose: jest
        .fn()
        .mockReturnValue({ locale: 'es', body: 'texto determinista', composition: 'template' }),
    };
    const rewriter = {
      rewrite: jest.fn().mockImplementation(async () => {
        calls.push('rewrite');
        return {
          response: { locale: 'es', body: 'texto final', composition: 'template' },
          mode: 'deterministic',
        };
      }),
      protectedFacts: jest.fn().mockReturnValue([]),
    };
    const conversationLanguage = {
      resolve: jest.fn().mockResolvedValue({ locale: 'es', source: 'tenant_default' }),
    };
    const understandingProvider = {
      understand: jest.fn().mockResolvedValue({
        locale: 'es',
        localeSource: 'tenant_default',
        intent: 'hours',
        confidence: 0.9,
        entities: {},
        requestedAction: null,
        missingInformation: [],
        requiresHuman: false,
        provider: 'deterministic',
        providerVersion: 'test',
      }),
    };
    const consumer = new MessageReceivedConsumer(
      database as never,
      config as never,
      decisions as never,
      composer as never,
      rewriter as never,
      conversationLanguage as never,
      understandingProvider as never,
    );
    return { consumer, database, domainClient, sendClient, calls, rewriter, decisions };
  }

  it('runs the domain transaction, then rewrite, then persists the reply in a separate transaction', async () => {
    const { consumer, domainClient, sendClient, calls } = buildConsumer();

    const result = await consumer.consume(event);

    expect(result).toEqual({ duplicate: false });
    // Regression guard for the D-041 deadlock finding: rewrite() must only
    // run after the domain transaction's callback already completed (and
    // thus committed), and strictly before the persist transaction opens —
    // never nested inside an open transaction.
    expect(calls).toEqual(['domain-transaction', 'rewrite', 'persist-transaction']);
    expect(
      domainClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('insert into app.processed_events'),
      ),
    ).toBe(true);
    expect(
      sendClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('insert into app.messages'),
      ),
    ).toBe(true);
    expect(
      sendClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('insert into app.outbox_events'),
      ),
    ).toBe(true);
  });

  it('inserts each of decision.additionalMessages as its own outbound message, in order, after the primary reply (D-144)', async () => {
    // deterministic-reply.service.ts's offeringReply() (Ficha técnica,
    // D-138/D-144) attaches additionalMessages when a real technical
    // description needs more than one message to show in full without
    // truncation — this bypasses composition/rewriting entirely (each
    // entry is already final text) and must reach app.messages the same
    // way the primary reply does, or the extra parts would just silently
    // never get sent.
    const { consumer, decisions, sendClient } = buildConsumer();
    decisions.decide.mockResolvedValue({
      outcome: 'respond',
      capability: 'knowledge',
      intent: 'menu',
      requestedAction: null,
      confidence: 0.9,
      sources: [],
      reason: 'knowledge_intent_matched',
      responsePlan: { kind: 'verified_content', body: 'Parte 1 de la ficha técnica' },
      additionalMessages: [
        { body: 'Parte 2 de la ficha técnica' },
        { body: 'Encabezado', interactive: { type: 'list', body: 'Encabezado', buttonLabel: 'Elegir', options: [{ id: 'variant-1', title: 'Producto' }] } },
      ],
    });

    const result = await consumer.consume(event);

    expect(result).toEqual({ duplicate: false });
    const messageInserts = sendClient.query.mock.calls.filter(([sql]: [string]) =>
      String(sql).includes('insert into app.messages'),
    );
    // Primary reply + 2 additionalMessages = 3 message rows.
    expect(messageInserts).toHaveLength(3);
    expect(messageInserts[1][1]).toContain('Parte 2 de la ficha técnica');
    expect(
      (messageInserts[2][1] as unknown[]).some(
        (param) => typeof param === 'string' && param.includes('Producto'),
      ),
    ).toBe(true);
  });

  it('queues a single outbox event carrying every additionalMessages id as followUpMessageIds, not one event per message (D-146, found live on CrediCel Store)', async () => {
    // Found live: each additionalMessages entry used to get its own
    // outbox event, and therefore its own BullMQ job — with the worker's
    // default concurrency, two jobs for the same reply could be sent to
    // WhatsApp at the same time, with no guarantee of completing in the
    // order they were queued. The tappable list arrived before the
    // technical text it was supposed to follow. A single outbox event now
    // carries the primary messageId plus every follow-up id, in order, so
    // SendRequestedConsumer can send them all sequentially inside one job.
    const { consumer, decisions, sendClient } = buildConsumer();
    decisions.decide.mockResolvedValue({
      outcome: 'respond',
      capability: 'knowledge',
      intent: 'menu',
      requestedAction: null,
      confidence: 0.9,
      sources: [],
      reason: 'knowledge_intent_matched',
      responsePlan: { kind: 'verified_content', body: 'Parte 1 de la ficha técnica' },
      additionalMessages: [
        { body: 'Parte 2 de la ficha técnica' },
        { body: 'Encabezado', interactive: { type: 'list', body: 'Encabezado', buttonLabel: 'Elegir', options: [{ id: 'variant-1', title: 'Producto' }] } },
      ],
    });

    await consumer.consume(event);

    const outboxInserts = sendClient.query.mock.calls.filter(([sql]: [string]) =>
      String(sql).includes('insert into app.outbox_events'),
    );
    expect(outboxInserts).toHaveLength(1);
    const params = outboxInserts[0][1] as unknown[];
    const followUpIds = params[4] as string[];
    expect(followUpIds).toHaveLength(2);
  });

  it('rejects an additionalMessages entry with an empty interactive.body loudly instead of letting it fail silently at WhatsApp (D-144, found live on CrediCel Store)', async () => {
    // Found live: offeringReply()'s detailMode built its interactive list
    // from a shared object whose own `body` stays '' until
    // LocalizedResponseComposer copies the outer body into it — a step
    // additionalMessages skips entirely by design (see its own comment on
    // DeterministicReply). The customer got the full technical text, but
    // the tappable list after it silently failed every WhatsApp API retry
    // ("Interactive message body is required") — no crash, no error
    // visible anywhere except the server log, and no way for the customer
    // to act on what they'd just read. This guard turns that into a loud,
    // immediate failure here instead.
    const { consumer, decisions } = buildConsumer();
    decisions.decide.mockResolvedValue({
      outcome: 'respond',
      capability: 'knowledge',
      intent: 'menu',
      requestedAction: null,
      confidence: 0.9,
      sources: [],
      reason: 'knowledge_intent_matched',
      responsePlan: { kind: 'verified_content', body: 'Ficha técnica' },
      additionalMessages: [
        { body: 'Encabezado', interactive: { type: 'list', body: '', buttonLabel: 'Elegir', options: [{ id: 'variant-1', title: 'Producto' }] } },
      ],
    });

    await expect(consumer.consume(event)).rejects.toThrow('Interactive message body is required');
  });

  it('does not log a "fallback"-intent question as unresolved when a knowledge entry actually answered it (D-078 regression)', async () => {
    // classifyMessage's fixed intents no longer cover every FAQ topic
    // (D-078) — a message can be tagged 'fallback' and still be answered
    // via the tenant's own knowledge_entries. Logging it into
    // unresolved_customer_questions anyway would misreport an answered
    // question as a gap in the bot's knowledge.
    const { consumer, decisions, domainClient } = buildConsumer();
    decisions.decide.mockResolvedValue({
      outcome: 'respond',
      capability: 'knowledge',
      intent: 'fallback',
      requestedAction: null,
      confidence: 0.9,
      sources: ['knowledge_entry:1'],
      reason: 'knowledge_intent_matched',
      responsePlan: { kind: 'verified_content', body: 'Answer' },
    });

    await consumer.consume(event);

    expect(
      domainClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('insert into app.unresolved_customer_questions'),
      ),
    ).toBe(false);
  });

  it('detects a duplicate event and never calls rewrite or persists a reply', async () => {
    const { consumer, database, rewriter } = buildConsumer();
    (database.withTenantTransaction as jest.Mock).mockReset();
    (database.withTenantTransaction as jest.Mock).mockImplementationOnce(
      (_tenantId: string, cb: (client: unknown) => unknown) =>
        cb({ query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) }),
    );

    const result = await consumer.consume(event);

    expect(result).toEqual({ duplicate: true });
    expect(rewriter.rewrite).not.toHaveBeenCalled();
    expect(database.withTenantTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not generate a reply when the bot is disabled', async () => {
    const { consumer, database, rewriter } = buildConsumer();
    (database.withTenantTransaction as jest.Mock).mockReset();
    (database.withTenantTransaction as jest.Mock).mockImplementationOnce(
      (_tenantId: string, cb: (client: unknown) => unknown) =>
        cb({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('insert into app.processed_events'))
              return { rowCount: 1, rows: [{ id: 'x' }] };
            if (sql.includes('select message.channel_id'))
              return {
                rowCount: 1,
                rows: [
                  {
                    channel_id: 'c',
                    body: 'hola',
                    interactive_selection_id: null,
                    handling_mode: 'human',
                    display_name: null,
                    contact_id: 'contact-1',
                  },
                ],
              };
            if (sql.includes('select bot.enabled')) return { rows: [{ enabled: false }] };
            return { rows: [] };
          }),
        }),
    );

    const result = await consumer.consume(event);

    expect(result).toEqual({ duplicate: false });
    expect(rewriter.rewrite).not.toHaveBeenCalled();
    expect(database.withTenantTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not treat an implausible WhatsApp profile name (e.g. a single letter) as a real customer name', async () => {
    const { consumer, database, decisions } = buildConsumer();
    (database.withTenantTransaction as jest.Mock).mockReset();
    (database.withTenantTransaction as jest.Mock)
      .mockImplementationOnce((_tenantId: string, cb: (client: unknown) => unknown) =>
        cb({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('insert into app.processed_events'))
              return { rowCount: 1, rows: [{ id: 'x' }] };
            if (sql.includes('select message.channel_id'))
              return {
                rowCount: 1,
                rows: [
                  {
                    channel_id: 'c',
                    body: 'hola',
                    interactive_selection_id: null,
                    handling_mode: 'bot',
                    display_name: 'S',
                    contact_id: 'contact-1',
                  },
                ],
              };
            if (sql.includes('insert into app.audit_events')) return { rows: [] };
            if (sql.includes('select bot.enabled'))
              return {
                rows: [
                  {
                    enabled: true,
                    assistant_name: 'Santos',
                    business_name: 'Santos Tacos',
                    locale: 'es',
                    welcome_message: null,
                    fallback_message: null,
                    handoff_keywords: [],
                    timezone: 'America/Bogota',
                  },
                ],
              };
            return { rows: [] };
          }),
        }),
      )
      .mockImplementationOnce((_tenantId: string, cb: (client: unknown) => unknown) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [] }) }),
      );

    await consumer.consume(event);

    const [flowInput, bot] = decisions.decide.mock.calls[0].slice(1);
    expect(flowInput.displayName).toBeNull();
    expect(bot.customerName).toBeNull();
  });
});
