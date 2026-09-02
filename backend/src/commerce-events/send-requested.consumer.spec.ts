import { SendRequestedConsumer } from './send-requested.consumer';

describe('SendRequestedConsumer', () => {
  it('termina la primera transacción antes de invocar el adaptador', async () => {
    const order: string[] = [];
    const database = {
      withTenantTransaction: jest.fn()
        .mockImplementationOnce(async () => {
          order.push('prepare-commit');
          return { content: { type: 'text', body: 'hola' } };
        })
        .mockImplementationOnce(async () => {
          order.push('confirm-transaction');
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

    expect(order).toEqual(['prepare-commit', 'external-call', 'confirm-transaction']);
  });
});
