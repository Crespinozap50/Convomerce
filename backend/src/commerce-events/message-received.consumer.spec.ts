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
