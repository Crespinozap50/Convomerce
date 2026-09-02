import { InboundMessagesService } from './inbound-messages.service';

describe('InboundMessagesService', () => {
  it('delega el flujo completo a una transacción tenant', async () => {
    const result = { duplicate: false, conversationId: 'conversation', messageId: 'message' };
    const database = {
      withTenantTransaction: jest.fn().mockResolvedValue(result),
    };
    const service = new InboundMessagesService(database as never);

    // Esta prueba pequeña protege la frontera; la semántica SQL se cubre en integración.
    await expect(service.receive({
      tenantId: '0194f000-0000-7000-8000-000000000001',
      channelId: '0194f001-0000-7000-8000-000000000001',
      contactId: '0194f002-0000-7000-8000-000000000001',
      externalEventId: 'event',
      externalMessageId: 'message',
      text: 'hola',
    })).resolves.toEqual(result);

    expect(database.withTenantTransaction).toHaveBeenCalledTimes(1);
    expect(result.duplicate).toBe(false);
  });
});
