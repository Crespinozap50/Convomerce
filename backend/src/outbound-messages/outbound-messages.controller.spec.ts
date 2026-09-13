import { NotFoundException } from '@nestjs/common';
import { OutboundMessagesController } from './outbound-messages.controller';

// D-154 (docs/decisions.md): same finding/fix as
// inbound-messages.controller.spec.ts — this dev-only fixture/send-request
// endpoint used to gate itself on NODE_ENV!=='production' alone, which the
// live pilot server's own .env (NODE_ENV=development) never actually
// closed. Now gated on DEV_HARNESS_ENABLED, closed by default.
describe('OutboundMessagesController', () => {
  const validFixture = {
    tenantId: '0194f000-0000-7000-8000-000000000001',
    channelId: '0194f001-0000-7000-8000-000000000001',
    conversationId: '0194f003-0000-7000-8000-000000000001',
    externalMessageId: 'message-1',
    text: 'hola',
  };
  const validSendRequest = {
    tenantId: '0194f000-0000-7000-8000-000000000001',
    channelId: '0194f001-0000-7000-8000-000000000001',
    conversationId: '0194f003-0000-7000-8000-000000000001',
    text: 'hola',
  };

  it.each([undefined, 'false', 'TRUE', '1'])(
    "closes both endpoints when DEV_HARNESS_ENABLED is %p (anything but the exact string 'true')",
    (value) => {
      const messages = { createFixture: jest.fn(), requestSend: jest.fn() };
      const config = { get: jest.fn().mockReturnValue(value) };
      const controller = new OutboundMessagesController(messages as never, config as never);

      expect(() => controller.create(validFixture as never)).toThrow(NotFoundException);
      expect(() => controller.requestSend(validSendRequest as never)).toThrow(NotFoundException);
      expect(messages.createFixture).not.toHaveBeenCalled();
      expect(messages.requestSend).not.toHaveBeenCalled();
    },
  );

  it('proceeds to the real handlers once explicitly opted in', () => {
    const messages = {
      createFixture: jest.fn().mockReturnValue({ ok: true }),
      requestSend: jest.fn().mockReturnValue({ ok: true }),
    };
    const config = { get: jest.fn().mockReturnValue('true') };
    const controller = new OutboundMessagesController(messages as never, config as never);

    expect(controller.create(validFixture as never)).toEqual({ ok: true });
    expect(messages.createFixture).toHaveBeenCalledWith(validFixture);
  });
});
