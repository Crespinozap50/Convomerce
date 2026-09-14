import { BusinessFaqService } from "./business-faq.service";

describe("BusinessFaqService (D-164)", () => {
  const context = {
    tenantId: "tenant-1",
    conversationId: "conversation-1",
    messageId: "message-1",
  };
  const enabledConfig = (overrides: Record<string, string> = {}) => ({
    get: jest.fn((key: string, fallback: unknown) =>
      key === "OPENAI_BUSINESS_FAQ_ENABLED"
        ? "true"
        : key === "OPENAI_API_KEY"
          ? "test-key"
          : (overrides[key] ?? fallback),
    ),
  });
  const businessProfileRow = {
    address: "Centro Comercial demo, Medellín.",
    phone: "+57 300 000 0202",
    business_hours: "Lunes a sábado de 10:00 a. m. a 8:00 p. m.",
    fulfillment_options: "Solo recogida en tienda.",
    payment_methods: "Efectivo, transferencia, datáfono y crédito directo CrediCel.",
  };
  const clientWithContext = () => ({
    query: jest.fn((sql: string) =>
      sql.includes("from app.business_profiles")
        ? Promise.resolve({ rows: [businessProfileRow] })
        : Promise.resolve({ rows: [] }),
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
        purpose: "business_faq",
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
    const service = new BusinessFaqService(
      { get: jest.fn((_: string, fallback: unknown) => fallback) } as never,
      budgets as never,
    );
    const result = await service.answer(clientWithContext() as never, context, "¿aceptan Davivienda?", "es");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(budgets.reserve).not.toHaveBeenCalled();
  });

  // D-164 live finding basis: no point spending a real AI call (or budget)
  // grounding an answer in nothing — a tenant with no business_profile
  // fields set and no published knowledge_entries can never be answered by
  // this path, so it must never even try.
  it("returns null without calling OpenAI when there is no real business data to ground an answer in", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    const emptyClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const service = new BusinessFaqService(enabledConfig() as never, budgets as never);
    const result = await service.answer(emptyClient as never, context, "¿aceptan Davivienda?", "es");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(budgets.reserve).not.toHaveBeenCalled();
  });

  it("answers using the real business data as grounding context, and settles at the real token-based cost", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({ answered: true, response: "Sí, aceptamos Davivienda." }),
        usage: { input_tokens: 220, output_tokens: 18 },
      }),
    }) as never;
    const service = new BusinessFaqService(enabledConfig() as never, budgets as never);
    const result = await service.answer(clientWithContext() as never, context, "¿aceptan Davivienda?", "es");

    expect(result).toEqual({ answered: true, response: "Sí, aceptamos Davivienda." });
    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.input).toContain("Davivienda");
    expect(body.input).toContain(businessProfileRow.payment_methods);
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ inputTokens: 220, outputTokens: 18, success: true }),
      expect.anything(),
    );
  });

  // The core anti-hallucination guarantee: the model saying it doesn't know
  // must be honored as a real "not answered" result (not silently treated
  // as null/failure), so the caller falls back to its own generic message
  // instead of ever being handed an invented answer.
  it("honors the model's own 'answered: false' instead of ever inventing something", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({ answered: false, response: "" }),
        usage: { input_tokens: 200, output_tokens: 5 },
      }),
    }) as never;
    const service = new BusinessFaqService(enabledConfig() as never, budgets as never);
    const result = await service.answer(clientWithContext() as never, context, "¿venden carros usados?", "es");

    expect(result).toEqual({ answered: false, response: "" });
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: true }),
      expect.anything(),
    );
  });

  it("returns null and settles at zero cost on a provider failure with no payload at all", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never;
    const service = new BusinessFaqService(enabledConfig() as never, budgets as never);
    const result = await service.answer(clientWithContext() as never, context, "¿aceptan Davivienda?", "es");

    expect(result).toBeNull();
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: false, failureReason: "provider_error", actualCostMinor: 0 }),
      expect.anything(),
    );
  });

  it("returns null without calling OpenAI when the tenant's AI budget is not allowed", async () => {
    const deniedBudgets = {
      reserve: jest.fn().mockResolvedValue({ allowed: false, reason: "monthly_budget" }),
      settle: jest.fn(),
    };
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    const service = new BusinessFaqService(enabledConfig() as never, deniedBudgets as never);
    const result = await service.answer(clientWithContext() as never, context, "¿aceptan Davivienda?", "es");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
