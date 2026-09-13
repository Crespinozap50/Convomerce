import { NotFoundException } from "@nestjs/common";
import { InboundMessagesController } from "./inbound-messages.controller";

// D-154 (docs/decisions.md): this dev-only message-injection endpoint used
// to gate itself on NODE_ENV!=='production' alone — the live pilot
// server's own .env has NODE_ENV=development (required elsewhere, no
// HTTPS yet), so it was reachable, unauthenticated, against real tenant
// data. Now gated on DEV_HARNESS_ENABLED, closed by default.
describe("InboundMessagesController", () => {
  const validBody = {
    tenantId: "0194f000-0000-7000-8000-000000000001",
    channelId: "0194f001-0000-7000-8000-000000000001",
    providerSubject: "573000000000",
    externalEventId: "event-1",
    externalMessageId: "message-1",
    text: "hola",
  };

  it.each([undefined, "false", "TRUE", "1"])(
    "closes the endpoint when DEV_HARNESS_ENABLED is %p (anything but the exact string 'true')",
    async (value) => {
      const messages = { receive: jest.fn(), reprocess: jest.fn() };
      const config = { get: jest.fn().mockReturnValue(value) };
      const controller = new InboundMessagesController(messages as never, config as never);

      await expect(controller.receive(validBody as never)).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.reprocess({} as never)).rejects.toBeInstanceOf(NotFoundException);
      expect(messages.receive).not.toHaveBeenCalled();
      expect(messages.reprocess).not.toHaveBeenCalled();
    },
  );

  it("proceeds to the real handler once explicitly opted in", async () => {
    const messages = { receive: jest.fn().mockResolvedValue({ ok: true }), reprocess: jest.fn() };
    const config = { get: jest.fn().mockReturnValue("true") };
    const controller = new InboundMessagesController(messages as never, config as never);

    await expect(controller.receive(validBody as never)).resolves.toEqual({ ok: true });
    expect(messages.receive).toHaveBeenCalledWith(validBody);
  });
});
