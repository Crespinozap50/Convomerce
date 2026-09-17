import { CommandRecoveryService } from "./command-recovery.service";

describe("CommandRecoveryService (D-207)", () => {
  const context = {
    tenantId: "tenant-1",
    conversationId: "conversation-1",
    messageId: "message-1",
  };
  const enabledConfig = (overrides: Record<string, string> = {}) => ({
    get: jest.fn((key: string, fallback: unknown) =>
      key === "OPENAI_COMMAND_RECOVERY_ENABLED"
        ? "true"
        : key === "OPENAI_API_KEY"
          ? "test-key"
          : (overrides[key] ?? fallback),
    ),
  });
  const budgets = {
    reserve: jest.fn().mockResolvedValue({
      allowed: true,
      reservation: {
        id: "reservation-1",
        ...context,
        reservedCostMinor: 1,
        currency: "USD",
        purpose: "command_recovery",
      },
    }),
    settle: jest.fn().mockResolvedValue(undefined),
  };
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("does nothing and never calls fetch when the feature flag is off", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    const service = new CommandRecoveryService(
      { get: jest.fn((_: string, fallback: unknown) => fallback) } as never,
      budgets as never,
    );
    const result = await service.recover(context, "kiero cambiar mi horden", "es");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(budgets.reserve).not.toHaveBeenCalled();
  });

  it("returns null when the tenant's AI budget is not allowed", async () => {
    const deniedBudgets = {
      reserve: jest.fn().mockResolvedValue({ allowed: false, reason: "monthly_budget" }),
      settle: jest.fn(),
    };
    const service = new CommandRecoveryService(enabledConfig() as never, deniedBudgets as never);
    const result = await service.recover(context, "kiero cambiar mi horden", "es");
    expect(result).toBeNull();
  });

  it("returns a recovered command from the closed enum", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ output_text: JSON.stringify({ command: "change" }) }),
    }) as never;
    const service = new CommandRecoveryService(enabledConfig() as never, budgets as never);
    const result = await service.recover(context, "puedo editarlo?", "es");
    expect(result).toBe("change");
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: true }),
      undefined,
    );
  });

  it('returns null when the model reports "none" (message is not a command)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ output_text: JSON.stringify({ command: "none" }) }),
    }) as never;
    const service = new CommandRecoveryService(enabledConfig() as never, budgets as never);
    const result = await service.recover(context, "quiero dos tacos al pastor", "es");
    expect(result).toBeNull();
  });

  it("treats a value outside the given enum as none (defense in depth)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ output_text: JSON.stringify({ command: "delete_everything" }) }),
    }) as never;
    const service = new CommandRecoveryService(enabledConfig() as never, budgets as never);
    const result = await service.recover(context, "algo raro", "es");
    expect(result).toBeNull();
  });

  it("returns null when the model returns something that isn't valid JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ output_text: "not json" }),
    }) as never;
    const service = new CommandRecoveryService(enabledConfig() as never, budgets as never);
    const result = await service.recover(context, "algo raro", "es");
    expect(result).toBeNull();
  });

  it("settles a no-payload failure (provider_error / non-2xx response) at zero real cost", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never;
    const service = new CommandRecoveryService(enabledConfig() as never, budgets as never);
    const result = await service.recover(context, "algo raro", "es");
    expect(result).toBeNull();
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: false, failureReason: "provider_error", actualCostMinor: 0 }),
      undefined,
    );
  });

  it("returns null and settles as failed on a network/timeout error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("timeout")) as never;
    const service = new CommandRecoveryService(enabledConfig() as never, budgets as never);
    const result = await service.recover(context, "algo raro", "es");
    expect(result).toBeNull();
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: false, failureReason: "provider_error" }),
      undefined,
    );
  });
});
