import { SendRequestedConsumer } from './send-requested.consumer';

describe('SendRequestedConsumer', () => {
  it('termina cada transacción de preparación antes de invocar el adaptador, nunca con una transacción abierta durante la llamada externa', async () => {
    const order: string[] = [];
    const database = {
      withTenantTransaction: jest.fn()
        .mockImplementationOnce(async () => {
          order.push('duplicate-check');
          return false;
        })
        .mockImplementationOnce(async () => {
          order.push('prepare-commit');
          return { content: { type: 'text', body: 'hola' }, delivery_status: 'queued', external_message_id: null };
        })
        .mockImplementationOnce(async () => {
          order.push('confirm-transaction');
          return undefined;
        })
        .mockImplementationOnce(async () => {
          order.push('claim-commit');
          return { duplicate: false };
        }),
    };
    const adapter = {
      send: jest.fn().mockImplementation(async () => {
        order.push('external-call');
        return { externalMessageId: 'wamid.fixture.test' };
      }),
    };
    const consumer = new SendRequestedConsumer(database as never, adapter as never);

    await expect(consumer.consume({
      eventId: '0194f100-0000-7000-8000-000000000001',
      tenantId: '0194f000-0000-7000-8000-000000000001',
      messageId: '0194f100-0000-7000-8000-000000000002',
    })).resolves.toEqual({ duplicate: false });

    expect(order).toEqual([
      'duplicate-check', 'prepare-commit', 'external-call', 'confirm-transaction', 'claim-commit',
    ]);
  });

  it('sends the primary message and every followUpMessageId strictly in order, sequentially, inside the same job (D-146, found live on CrediCel Store)', async () => {
    // Found live: additionalMessages used to get one outbox event — and
    // therefore one BullMQ job — each, so the worker's default
    // concurrency could send them to Meta out of order (a tappable list
    // arriving before the technical text it was supposed to follow). All
    // message ids for one reply now travel in a single job; this proves
    // SendRequestedConsumer awaits each adapter.send() before starting
    // the next, rather than firing them concurrently.
    const preparedById: Record<string, unknown> = {
      'msg-1': { content: { type: 'text', body: 'primero' }, delivery_status: 'queued', external_message_id: null },
      'msg-2': { content: { type: 'text', body: 'segundo' }, delivery_status: 'queued', external_message_id: null },
      'msg-3': { content: { type: 'interactive', interactive: { type: 'list', body: 'tercero', buttonLabel: 'Elegir', options: [] } }, delivery_status: 'queued', external_message_id: null },
    };
    let transactionCall = 0;
    const database = {
      withTenantTransaction: jest.fn().mockImplementation(async (_tenantId: string, callback: (client: unknown) => unknown) => {
        transactionCall += 1;
        if (transactionCall === 1) return false; // duplicate-check
        // Alternates prepare / confirm for each of the 3 messages, then
        // one final claim transaction — a fake `client` whose `query`
        // returns whatever this test needs for each specific statement.
        const client = {
          query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
            if (sql.includes('from app.messages as message')) {
              const messageId = params[1] as string;
              const row = preparedById[messageId];
              return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
            }
            if (sql.includes('mark_outbound_message_sent')) return { rows: [{ marked: true }] };
            if (sql.includes('insert into app.processed_events')) return { rowCount: 1 };
            return { rows: [] };
          }),
        };
        return callback(client);
      }),
    };
    const sendOrder: string[] = [];
    const adapter = {
      send: jest.fn().mockImplementation(async (command: { messageId: string }) => {
        sendOrder.push(command.messageId);
        return { externalMessageId: `wamid.fixture.${command.messageId}` };
      }),
    };
    const consumer = new SendRequestedConsumer(database as never, adapter as never);

    await consumer.consume({
      eventId: '0194f100-0000-7000-8000-000000000001',
      tenantId: '0194f000-0000-7000-8000-000000000001',
      messageId: 'msg-1',
      followUpMessageIds: ['msg-2', 'msg-3'],
    });

    expect(sendOrder).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('skips a message already sent by an earlier attempt at the same job, instead of resending or failing (D-146)', async () => {
    // A job retried after throwing partway through (e.g. the network call
    // for the 2nd of 3 messages failed) picks up exactly where it left
    // off: 'msg-1' is no longer 'queued' (a previous attempt already sent
    // it) — its guard query still finds the row (so a genuinely missing/
    // wrong-tenant message would still throw, see the next test), but its
    // own delivery_status/external_message_id show it's already done, so
    // sendOne() must treat that as "nothing left to do", not an error,
    // and must not call the adapter for it again.
    const database = {
      withTenantTransaction: jest.fn().mockImplementation(async (_tenantId: string, callback: (client: unknown) => unknown) => {
        const client = {
          query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
            if (sql.includes('select 1 from app.processed_events')) return { rowCount: 0 };
            if (sql.includes('from app.messages as message')) {
              const messageId = params[1] as string;
              // msg-1 already sent; only msg-2 is still genuinely queued.
              if (messageId === 'msg-1') {
                return { rowCount: 1, rows: [{ content: { type: 'text', body: 'primero' }, delivery_status: 'sent', external_message_id: 'wamid.fixture.msg-1' }] };
              }
              return { rowCount: 1, rows: [{ content: { type: 'text', body: 'segundo' }, delivery_status: 'queued', external_message_id: null }] };
            }
            if (sql.includes('mark_outbound_message_sent')) return { rows: [{ marked: true }] };
            if (sql.includes('insert into app.processed_events')) return { rowCount: 1 };
            return { rows: [] };
          }),
        };
        return callback(client);
      }),
    };
    const adapter = {
      send: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.fixture.msg-2' }),
    };
    const consumer = new SendRequestedConsumer(database as never, adapter as never);

    await consumer.consume({
      eventId: '0194f100-0000-7000-8000-000000000001',
      tenantId: '0194f000-0000-7000-8000-000000000001',
      messageId: 'msg-1',
      followUpMessageIds: ['msg-2'],
    });

    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(adapter.send).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-2' }));
  });

  it('still fails loudly when a message genuinely does not exist for the given tenant, instead of silently treating it as already sent (D-146 regression)', async () => {
    // The "already sent, skip" case (previous test) and "wrong tenant /
    // bogus id, this is a real problem" case both used to look identical
    // from a single query with no row returned — this guards against
    // collapsing them back into the same silent no-op, which would defeat
    // the tenant-isolation check this consumer has always relied on.
    const database = {
      withTenantTransaction: jest.fn().mockImplementation(async (_tenantId: string, callback: (client: unknown) => unknown) => {
        const client = {
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('select 1 from app.processed_events')) return { rowCount: 0 };
            if (sql.includes('from app.messages as message')) return { rowCount: 0, rows: [] };
            return { rows: [] };
          }),
        };
        return callback(client);
      }),
    };
    const adapter = { send: jest.fn() };
    const consumer = new SendRequestedConsumer(database as never, adapter as never);

    await expect(consumer.consume({
      eventId: '0194f100-0000-7000-8000-000000000001',
      tenantId: '0194f000-0000-7000-8000-000000000002',
      messageId: 'msg-from-another-tenant',
    })).rejects.toThrow('tenant');
    expect(adapter.send).not.toHaveBeenCalled();
  });
});
