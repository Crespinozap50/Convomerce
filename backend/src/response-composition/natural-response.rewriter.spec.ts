import { NaturalResponseRewriter } from "./natural-response.rewriter";

describe("NaturalResponseRewriter", () => {
  const response = {
    locale: "es",
    body: "No encontré horarios disponibles para el 7 de agosto.",
    composition: "template" as const,
  };
  const plan = {
    kind: "localized_template" as const,
    template: {
      namespace: "appointment" as const,
      key: "noAvailability" as const,
    },
    values: { date: "7 de agosto", resourceSuffix: "" },
  };
  const context = {
    tenantId: "tenant-1",
    conversationId: "conversation-1",
    messageId: "message-1",
  };
  const budgets = {
    reserve: jest
      .fn()
      .mockResolvedValue({
        allowed: true,
        reservation: {
          id: "reservation-1",
          ...context,
          reservedCostMinor: 1,
          currency: "USD",
        },
      }),
    settle: jest.fn().mockResolvedValue(undefined),
  };
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("keeps deterministic output while disabled", async () => {
    const service = new NaturalResponseRewriter(
      { get: jest.fn((_: string, fallback: unknown) => fallback) } as never,
      budgets as never,
    );
    await expect(service.rewrite(plan, response, context)).resolves.toEqual({
      response,
      mode: "deterministic",
      fallbackReason: "disabled",
    });
  });

  it("accepts a structured rewrite that preserves fact tokens", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({
            output_text: JSON.stringify({
              body: "Lo siento, no encontré horarios disponibles para el 7 de agosto.",
            }),
          }),
      }) as never;
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED"
            ? "true"
            : key === "OPENAI_API_KEY"
              ? "test-key"
              : fallback,
        ),
      } as never,
      budgets as never,
    );
    const result = await service.rewrite(plan, response, context);
    expect(result).toMatchObject({
      mode: "openai",
      response: {
        body: "Lo siento, no encontré horarios disponibles para el 7 de agosto.",
      },
    });
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body),
    ).toMatchObject({
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
  });

  it("falls back when a rewrite changes a verified fact", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({
            output_text: JSON.stringify({
              body: "Lo siento, no encontré horarios disponibles.",
            }),
          }),
      }) as never;
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED"
            ? "true"
            : key === "OPENAI_API_KEY"
              ? "test-key"
              : fallback,
        ),
      } as never,
      budgets as never,
    );
    await expect(service.rewrite(plan, response, context)).resolves.toEqual({
      response,
      mode: "deterministic",
      fallbackReason: "fact_mismatch",
    });
  });

  it("rejects newly invented numeric claims", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({
            output_text: JSON.stringify({
              body: "No encontré horarios para el 7 de agosto, pero tengo uno con 10% de descuento.",
            }),
          }),
      }) as never;
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED"
            ? "true"
            : key === "OPENAI_API_KEY"
              ? "test-key"
              : fallback,
        ),
      } as never,
      budgets as never,
    );
    await expect(service.rewrite(plan, response, context)).resolves.toEqual({
      response,
      mode: "deterministic",
      fallbackReason: "fact_mismatch",
    });
  });

  it("does not rewrite composite or interactive responses", async () => {
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED" ? "true" : fallback,
        ),
      } as never,
      budgets as never,
    );
    await expect(
      service.rewrite(
        { kind: "verified_content", body: "Verified" },
        response,
        context,
      ),
    ).resolves.toMatchObject({
      mode: "deterministic",
      fallbackReason: "ineligible",
    });
    // A composite with no rewriteKey is never eligible, regardless of what
    // it contains — this is the regression guard for D-041.
    await expect(
      service.rewrite(
        {
          kind: "composite",
          segments: [{ kind: "verified_text", text: "Sin rewriteKey" }],
        },
        response,
        context,
      ),
    ).resolves.toMatchObject({
      mode: "deterministic",
      fallbackReason: "ineligible",
    });
  });

  it("excludes a composite whose rewriteKey is not whitelisted", async () => {
    global.fetch = jest.fn();
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED" ? "true" : fallback,
        ),
      } as never,
      budgets as never,
    );
    await expect(
      service.rewrite(
        {
          kind: "composite",
          segments: [{ kind: "verified_text", text: "Carrito" }],
          rewriteKey: "commercial.notWhitelisted",
        },
        response,
        context,
      ),
    ).resolves.toMatchObject({
      mode: "deterministic",
      fallbackReason: "policy_excluded",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still excludes an interactive plan whose template/composite is not itself eligible", async () => {
    // Carrying `interactive` no longer disqualifies a plan by itself (yes/no
    // confirmations rely on that), but it also does not grant eligibility to
    // an otherwise-ineligible template — e.g. a catalog list.
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED" ? "true" : fallback,
        ),
      } as never,
      budgets as never,
    );
    await expect(
      service.rewrite(
        {
          kind: "localized_template",
          template: { namespace: "commercial", key: "item" },
          values: {},
          interactive: { type: "list", body: "x", options: [] } as never,
        },
        response,
        context,
      ),
    ).resolves.toMatchObject({
      mode: "deterministic",
      fallbackReason: "policy_excluded",
    });
  });

  it("rewrites an eligible interactive plan's body while leaving the buttons untouched", async () => {
    // confirmHold/confirmReschedule (appointment) and commercial.orderConfirmation
    // are the only templates/composites that combine eligibility with
    // `interactive` — this confirms the yes/no buttons survive verbatim and
    // the customer-visible interactive.body (not just the top-level body,
    // which whatsapp-adapter.ts ignores for interactive sends) picks up the
    // rewrite.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output_text: JSON.stringify({
          body: "¡Tu cita para el 7 de agosto está lista para confirmar!",
        }),
      }),
    }) as never;
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED"
            ? "true"
            : key === "OPENAI_API_KEY"
              ? "test-key"
              : fallback,
        ),
      } as never,
      budgets as never,
    );
    const interactive = {
      type: "buttons" as const,
      body: "7 de agosto",
      options: [
        { id: "confirm:yes", title: "Sí" },
        { id: "confirm:no", title: "No" },
      ],
    };
    const result = await service.rewrite(
      {
        kind: "localized_template",
        template: { namespace: "appointment", key: "confirmHold" },
        values: { date: "7 de agosto" },
        interactive,
      } as never,
      { ...response, interactive },
      context,
    );
    expect(result).toMatchObject({
      mode: "openai",
      response: {
        body: "¡Tu cita para el 7 de agosto está lista para confirmar!",
        interactive: {
          body: "¡Tu cita para el 7 de agosto está lista para confirmar!",
          options: interactive.options,
        },
      },
    });
  });

  describe("order confirmation composite", () => {
    const compositePlan = {
      kind: "composite" as const,
      rewriteKey: "commercial.orderConfirmation",
      segments: [
        {
          kind: "template" as const,
          template: { namespace: "commercial" as const, key: "cartHeading" as const },
        },
        { kind: "line_break" as const },
        { kind: "verified_text" as const, text: "• 2 × Tacos al pastor: $24.000" },
        { kind: "line_break" as const },
        { kind: "verified_text" as const, text: "• 1 × Coca-Cola: $4.000" },
        { kind: "line_break" as const },
        { kind: "verified_text" as const, text: "Total: $28.000" },
      ],
    };
    const compositeResponse = {
      locale: "es" as const,
      body:
        "Tu pedido\n• 2 × Tacos al pastor: $24.000\n• 1 × Coca-Cola: $4.000\nTotal: $28.000",
      composition: "composite" as const,
    };

    it("protects the substantive fragments of verified_text lines, not their connector punctuation", () => {
      const service = new NaturalResponseRewriter(
        { get: jest.fn() } as never,
        budgets as never,
      );
      // D-043 calibration fix: the bullet ("• "), multiplication sign, and
      // colon are pure layout, not facts — protecting them verbatim made
      // any natural rewrite of a cart line fail fact preservation.
      expect(service.protectedFacts(compositePlan)).toEqual([
        "2",
        "Tacos al pastor",
        "$24.000",
        "1",
        "Coca-Cola",
        "$4.000",
        "Total",
        "$28.000",
      ]);
    });

    it("never sends the order confirmation to OpenAI — excluded outright, not just fact-checked (D-125 security hardening)", async () => {
      // D-125: commercial.orderConfirmation embeds context.address verbatim
      // (the customer's own free-text delivery address) — a security audit
      // found this non-exploitable (strict json_schema output, protectedFacts
      // below already caught any altered fact), but excluded it anyway for
      // the simpler invariant "no client-authored text ever reaches the
      // model" rather than relying on fact-checking to catch every case
      // forever. This must resolve to policy_excluded without ever calling
      // fetch — proves the exclusion happens before any network call, not
      // just before trusting the result.
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as never;
      const service = new NaturalResponseRewriter(
        {
          get: jest.fn((key: string, fallback: unknown) =>
            key === "OPENAI_RESPONSE_REWRITING_ENABLED"
              ? "true"
              : key === "OPENAI_API_KEY"
                ? "test-key"
                : fallback,
          ),
        } as never,
        budgets as never,
      );
      await expect(
        service.rewrite(compositePlan, compositeResponse, context),
      ).resolves.toMatchObject({
        mode: "deterministic",
        fallbackReason: "policy_excluded",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it.each(["confirmHold", "confirmed", "rescheduled", "confirmReschedule"])(
    "makes the appointment happy-path template %s eligible",
    async (key) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ output_text: JSON.stringify({ body: "ok" }) }),
      }) as never;
      const service = new NaturalResponseRewriter(
        {
          get: jest.fn((k: string, fallback: unknown) =>
            k === "OPENAI_RESPONSE_REWRITING_ENABLED"
              ? "true"
              : k === "OPENAI_API_KEY"
                ? "test-key"
                : fallback,
          ),
        } as never,
        budgets as never,
      );
      await service.rewrite(
        {
          kind: "localized_template",
          template: { namespace: "appointment", key: key as never },
          values: {},
        },
        { locale: "es", body: "ok", composition: "template" },
        context,
      );
      expect(global.fetch).toHaveBeenCalled();
    },
  );

  it("does not call OpenAI for short operational prompts", async () => {
    global.fetch = jest.fn();
    const service = new NaturalResponseRewriter(
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key === "OPENAI_RESPONSE_REWRITING_ENABLED" ? "true" : fallback,
        ),
      } as never,
      budgets as never,
    );
    const operationalPlan = {
      kind: "localized_template" as const,
      template: {
        namespace: "commercial" as const,
        key: "fulfillment" as const,
      },
      values: {},
    };
    await expect(
      service.rewrite(
        operationalPlan,
        {
          locale: "es",
          body: "¿Lo deseas para domicilio, recogida o consumo en el local?",
          composition: "template",
        },
        context,
      ),
    ).resolves.toEqual({
      response: {
        locale: "es",
        body: "¿Lo deseas para domicilio, recogida o consumo en el local?",
        composition: "template",
      },
      mode: "deterministic",
      fallbackReason: "policy_excluded",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(budgets.reserve).not.toHaveBeenCalled();
  });

  it("exposes only interpolated values as protected review facts", () => {
    const service = new NaturalResponseRewriter(
      { get: jest.fn() } as never,
      budgets as never,
    );
    expect(service.protectedFacts(plan)).toEqual(["7 de agosto"]);
    expect(
      service.protectedFacts({ kind: "verified_content", body: "Verified" }),
    ).toEqual([]);
  });
});
