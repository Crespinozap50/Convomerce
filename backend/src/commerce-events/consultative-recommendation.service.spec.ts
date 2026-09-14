import {
  ConsultativeRecommendationService,
  extractBudgetMinor,
  RecommendationCandidate,
} from "./consultative-recommendation.service";

describe("extractBudgetMinor (D-128)", () => {
  it("recognizes 'N millones (de pesos)'", () => {
    expect(extractBudgetMinor("tengo 3 millones de pesos")).toBe(300000000);
    expect(extractBudgetMinor("tengo 3 millones")).toBe(300000000);
  });

  it("recognizes a decimal amount of millones", () => {
    expect(extractBudgetMinor("cuento con 2.5 millones")).toBe(250000000);
  });

  it("recognizes a dollar-sign amount with thousand separators", () => {
    expect(extractBudgetMinor("mi presupuesto es de $3.000.000")).toBe(300000000);
    expect(extractBudgetMinor("tengo $2,500,000 para gastar")).toBe(250000000);
  });

  it("returns null when no currency-shaped mention is present", () => {
    expect(extractBudgetMinor("necesito un computador para diseño gráfico")).toBeNull();
  });
});

describe("ConsultativeRecommendationService (D-128)", () => {
  const context = {
    tenantId: "tenant-1",
    conversationId: "conversation-1",
    messageId: "message-1",
  };
  const candidates: RecommendationCandidate[] = [
    {
      variantId: "variant-i7",
      name: "Portátil gama alta para creativos",
      category: "computadores",
      description: "AMD Ryzen 7, 32GB RAM, tarjeta gráfica dedicada RTX 3050.",
      priceMinor: "489000000",
      currency: "COP",
    },
    {
      variantId: "variant-i3",
      name: "Portátil para ofimática",
      category: "computadores",
      description: "Intel Celeron, 8GB RAM.",
      priceMinor: "179000000",
      currency: "COP",
    },
  ];
  const enabledConfig = (overrides: Record<string, string> = {}) => ({
    get: jest.fn((key: string, fallback: unknown) =>
      key === "OPENAI_CONSULTATIVE_RECOMMENDATIONS_ENABLED"
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
        purpose: "consultative_recommendation",
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
    const service = new ConsultativeRecommendationService(
      { get: jest.fn((_: string, fallback: unknown) => fallback) } as never,
      budgets as never,
    );
    const result = await service.recommend(context, "necesito un computador", candidates, "es");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(budgets.reserve).not.toHaveBeenCalled();
  });

  it("returns null without calling OpenAI when there are no candidates to choose from", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    const service = new ConsultativeRecommendationService(enabledConfig() as never, budgets as never);
    const result = await service.recommend(context, "necesito un computador", [], "es");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when the tenant's AI budget is not allowed", async () => {
    const deniedBudgets = {
      reserve: jest.fn().mockResolvedValue({ allowed: false, reason: "monthly_budget" }),
      settle: jest.fn(),
    };
    const service = new ConsultativeRecommendationService(
      enabledConfig() as never,
      deniedBudgets as never,
    );
    const result = await service.recommend(context, "necesito un computador", candidates, "es");
    expect(result).toBeNull();
  });

  it("returns the model's verified picks, restricted to the given candidate ids", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({
          picks: [
            { id: 0, reason: "Tiene la tarjeta gráfica dedicada que necesitas para diseño." },
          ],
        }),
      }),
    }) as never;
    const service = new ConsultativeRecommendationService(enabledConfig() as never, budgets as never);
    const result = await service.recommend(
      context,
      "necesito un computador para diseño gráfico, tengo 3 millones",
      candidates,
      "es",
    );
    expect(result).toEqual([
      { variantId: "variant-i7", reason: "Tiene la tarjeta gráfica dedicada que necesitas para diseño." },
    ]);
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: true }),
      undefined,
    );
  });

  // D-160 (docs/decisions.md) live finding: this used to always settle at
  // the flat reservation placeholder (reservedCostMinor, $0.01) regardless
  // of real usage — confirmed live against CrediCel real traffic, every
  // call recorded the same cost from 0 tokens up to 13,072. Now computed
  // from the real tokens the provider returned, using a rate dedicated to
  // this (pricier) model rather than reusing the response-rewriting rate.
  it("settles at the real token-based cost, not the flat reservation placeholder", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({
          picks: [{ id: 0, reason: "Encaja con lo que buscas." }],
        }),
        usage: { input_tokens: 13072, output_tokens: 163 },
      }),
    }) as never;
    const service = new ConsultativeRecommendationService(
      enabledConfig({
        OPENAI_RECOMMENDATION_INPUT_COST_MINOR_PER_MILLION: "20",
        OPENAI_RECOMMENDATION_OUTPUT_COST_MINOR_PER_MILLION: "125",
      }) as never,
      budgets as never,
    );

    await service.recommend(context, "necesito un computador", candidates, "es");

    // ceil((13072*20 + 163*125) / 1_000_000) = ceil(0.28187) = 1
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ inputTokens: 13072, outputTokens: 163, actualCostMinor: 1 }),
      undefined,
    );
  });

  it("scales the settled cost up with real usage instead of staying flat at every volume", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({
          picks: [{ id: 0, reason: "Encaja con lo que buscas." }],
        }),
        usage: { input_tokens: 200000, output_tokens: 5000 },
      }),
    }) as never;
    const service = new ConsultativeRecommendationService(
      enabledConfig({
        OPENAI_RECOMMENDATION_INPUT_COST_MINOR_PER_MILLION: "20",
        OPENAI_RECOMMENDATION_OUTPUT_COST_MINOR_PER_MILLION: "125",
      }) as never,
      budgets as never,
    );

    await service.recommend(context, "necesito un computador", candidates, "es");

    // ceil((200000*20 + 5000*125) / 1_000_000) = ceil(4.625) = 5 — well
    // above the old flat $0.01, proving this actually tracks volume now.
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ actualCostMinor: 5 }),
      undefined,
    );
  });

  it("drops a pick whose variantId isn't one of the given candidates, even if the model somehow returned one (defense in depth)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({
          picks: [
            { id: 0, reason: "Encaja con lo que buscas." },
            { id: 99, reason: "Inventado." },
          ],
        }),
      }),
    }) as never;
    const service = new ConsultativeRecommendationService(enabledConfig() as never, budgets as never);
    const result = await service.recommend(context, "necesito un computador", candidates, "es");
    expect(result).toEqual([{ variantId: "variant-i7", reason: "Encaja con lo que buscas." }]);
  });

  it("deduplicates repeated picks and caps at 3", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({
          picks: [
            { id: 0, reason: "Razón 1." },
            { id: 0, reason: "Razón repetida." },
            { id: 1, reason: "Razón 2." },
          ],
        }),
      }),
    }) as never;
    const service = new ConsultativeRecommendationService(enabledConfig() as never, budgets as never);
    const result = await service.recommend(context, "necesito un computador", candidates, "es");
    expect(result).toEqual([
      { variantId: "variant-i7", reason: "Razón 1." },
      { variantId: "variant-i3", reason: "Razón 2." },
    ]);
  });

  // D-160 (docs/decisions.md) live finding #2: a provider_error/timeout
  // failure never returns a payload at all — there's no evidence OpenAI
  // billed anything for it, so it must not still incur the $0.01 minimum
  // that makes sense for a call that DID get a real (if unusable) response.
  it("settles a no-payload failure (provider_error / non-2xx response) at zero real cost, not the $0.01 minimum", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never;
    const service = new ConsultativeRecommendationService(enabledConfig() as never, budgets as never);
    const result = await service.recommend(context, "necesito un computador", candidates, "es");
    expect(result).toBeNull();
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: false, failureReason: "provider_error", actualCostMinor: 0 }),
      undefined,
    );
  });

  it("still floors to the $0.01 minimum for a failure that DID get a real payload back (invalid_output)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ output_text: "not json", usage: { input_tokens: 500, output_tokens: 5 } }),
    }) as never;
    const service = new ConsultativeRecommendationService(enabledConfig() as never, budgets as never);
    const result = await service.recommend(context, "necesito un computador", candidates, "es");
    expect(result).toBeNull();
    expect(budgets.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-1" }),
      expect.objectContaining({ success: false, failureReason: "invalid_output", actualCostMinor: 1 }),
      undefined,
    );
  });

  it("returns null when the model returns something that isn't valid JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ output_text: "not json" }),
    }) as never;
    const service = new ConsultativeRecommendationService(enabledConfig() as never, budgets as never);
    const result = await service.recommend(context, "necesito un computador", candidates, "es");
    expect(result).toBeNull();
  });
});
