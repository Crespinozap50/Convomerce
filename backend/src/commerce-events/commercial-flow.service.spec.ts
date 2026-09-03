import {
  classifyFlowCommand,
  CommercialFlowService,
  isAddressDetailedEnough,
  parseQuantity,
  parseRecommendationAction,
  quantityExcludingItemName,
} from "./commercial-flow.service";
import { DeterministicUnderstandingProvider } from "../conversation-understanding/deterministic-understanding.provider";
import { PendingRequirement } from "./requirement-loop";

describe("CommercialFlowService", () => {
  const addressRequirement: PendingRequirement = {
    id: "req-address",
    fieldKey: "delivery_address",
    dataType: "address",
    isRequired: true,
    displayOrder: 10,
    validationRule: {},
    sensitivity: "pii",
    requiresConfirmation: false,
    reuseFromContactMemory: true,
    label: null,
    helpText: null,
    options: [],
  };
  const service = (
    pending: PendingRequirement[] = [],
    requirementsOverride?: { getPendingRequirements: jest.Mock },
  ) =>
    new CommercialFlowService(
      { suggest: jest.fn().mockResolvedValue(null) } as never,
      (requirementsOverride ?? {
        getPendingRequirements: jest.fn().mockResolvedValue(pending),
      }) as never,
    );
  const understand = (message: string) =>
    new DeterministicUnderstandingProvider().understand({
      message,
      configuredLocale: "es",
      handoffKeywords: [],
      timezone: "America/Bogota",
    });
  const input = {
    tenantId: "0194f000-0000-7000-8000-000000000001",
    conversationId: "0194f003-0000-7000-8000-000000000001",
    contactId: "0194f002-0000-7000-8000-000000000001",
    locale: "es" as const,
    displayName: "Carlos",
  };

  it.each([
    ["Ver menú", "catalog"],
    // Regression: only the exact words "menu"/"catalogo"/"productos"/etc
    // were recognized here — natural phrasings that already worked for a
    // fresh "what's on the menu" question (deterministic-reply.service's
    // separate 'menu' intent) silently broke once an order was in progress,
    // because this command classifier is checked first and has its own,
    // narrower word list. See the Carlos conversation review.
    ["Quiero ver la carta", "catalog"],
    ["¿Qué venden?", "catalog"],
    ["¿Qué tienen?", "catalog"],
    ["Necesito ayuda", "help"],
    ["Quiero hablar con una persona", "handoff"],
    ["Cancelar pedido", "cancel"],
    ["Cambiar producto", "change_product"],
    ["Cambiar entrega", "change_fulfillment"],
    ["Cambiar dirección", "change_address"],
    ["Ver pedido", "view_order"],
    ["Agregar otro producto", "add_item"],
    ["Quitar producto", "remove_item"],
    ["Quitar tacos de birria", "remove_item"],
    ["Cambiar cantidad", "change_quantity"],
    ["Cambia la cantidad a tres", "change_quantity"],
    ["Listo", "finish_items"],
    ["Volver", "back"],
  ])("classifies the global command “%s”", (message, command) => {
    expect(classifyFlowCommand(message)).toBe(command);
  });

  it.each([
    ["2 tacos", 2],
    ["tres aguas", 3],
    ["un combo", 1],
    ["producto", 1],
    // Regression: a size named "de <number> <unit>" ("de 16 oz") isn't a
    // requested quantity — found live when "Quiero una agua fresca de 16
    // oz" added 16 of them instead of 1.
    ["una agua fresca de 16 oz", 1],
    ["2 tacos al pastor y una agua fresca de 16 oz", 2],
  ])("extracts quantity from “%s”", (message, quantity) => {
    expect(parseQuantity(message)).toBe(quantity);
  });

  // Found live testing Santos Tacos' "Orden x 3 Tacos" package (D-099):
  // parseQuantity has no idea which catalog item the message resolves to,
  // so "Quiero Orden x 3 Tacos" read the package's own "3" as a requested
  // quantity of 3 — tripling the price of a single package to $76.500
  // instead of $25.500. Generic across any product whose name embeds a
  // number, not specific to this one item.
  it.each([
    [3, "Orden x 3 Tacos", 1],
    [1, "Orden x 3 Tacos", 1],
    // A genuinely repeated number (a real quantity distinct from the one in
    // the name) is left untouched — parseQuantity only ever returns the
    // first number it finds, so this only guards against the single-number
    // case actually seen live.
    [2, "Orden x 3 Tacos", 2],
    [3, "Combo parceros", 3],
  ])("quantityExcludingItemName(%i, %s) -> %i", (requested, itemName, expected) => {
    expect(quantityExcludingItemName(requested, itemName)).toBe(expected);
  });

  it.each([
    ["Robledo", false],
    ["Calle 65", false],
    ["Robledo sector 2", false],
    ["Sector Robledo norte", false],
    ["Calle 65 # 88-20, portería azul", true],
    ["120 Main Street", true],
    ["Main Street 120, apartment 4", true],
  ])("validates whether “%s” is a sufficiently detailed address", (address, expected) => {
    expect(isAddressDetailedEnough(address)).toBe(expected);
  });

  it.each([
    ["123 Main St Apt 4", { structure_pattern: "generic_numbered" as const }, true],
    ["Downtown, no number", { structure_pattern: "generic_numbered" as const }, false],
    [
      "Frente al parque central sin numero",
      { structure_pattern: "none" as const, require_number: false },
      true,
    ],
  ])(
    "validates “%s” against a configurable structure_pattern",
    (address, rule, expected) => {
      expect(isAddressDetailedEnough(address, rule)).toBe(expected);
    },
  );

  it("does not start an order from an informational product question", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Tacos de camarón",
              variant_name: "Orden",
              price_minor: "2490000",
              currency: "COP",
            },
          ],
        }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Pero quiero saber cuál taco no tiene gluten",
      understanding: await understand(
        "Pero quiero saber cuál taco no tiene gluten",
      ),
    });

    expect(reply).toBeNull();
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.commercial_requests"),
      ),
    ).toBe(false);
  });

  it("orders one package, not three, when the package's own name embeds a number (regression, D-099 live finding)", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Orden x 3 Tacos",
              variant_name: "Unidad",
              price_minor: "2550000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    await service().resolve(client as never, {
      ...input,
      body: "Quiero Orden x 3 Tacos",
      understanding: await understand("Quiero Orden x 3 Tacos"),
    });

    const insertLine = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into app.request_lines"),
    );
    // quantity is the 8th positional param; line_total is computed from it
    // by the query itself, so this is the one place a tripled price would
    // actually originate.
    expect((insertLine?.[1] as unknown[])?.[7]).toBe(1);
  });

  it("starts a global order flow from a clear purchase intent", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Tacos de birria",
              variant_name: "Orden de 3",
              price_minor: "2290000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quiero pedir tacos de birria",
      understanding: await understand("Quiero pedir tacos de birria"),
    });

    expect(reply).toEqual(
      expect.objectContaining({
        intent: "order",
        sources: ["commercial_request"],
        responsePlan: expect.objectContaining({ kind: "composite" }),
      }),
    );
    expect(reply?.body).toContain("¿Quieres agregar algo más?");
    expect(reply?.interactive).toEqual({
      type: "buttons",
      body: "",
      options: [
        { id: "cart:add_item", title: "Otro producto" },
        { id: "cart:finish_items", title: "Listo" },
      ],
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.commercial_requests"),
      ),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.request_lines"),
      ),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("round($6::bigint*$8::numeric)::bigint"),
      ),
    ).toBe(true);
  });

  it("resolves a same-named variant tie automatically when the customer already named the size, instead of asking again (regression)", async () => {
    // Found live: "Quiero una agua fresca de 16 oz" still asked which size
    // — scoreCandidatesByTokens only ever looked at item.name (identical
    // for both variants), and the "16"/"oz" tokens were silently dropped by
    // the length>2 filter before they could even be compared.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "agua",
              variant_id: "agua-16",
              name: "Agua fresca",
              variant_name: "Vaso de 16 oz",
              price_minor: "900000",
              currency: "COP",
            },
            {
              item_id: "agua",
              variant_id: "agua-12",
              name: "Agua fresca",
              variant_name: "Vaso de 12 oz",
              price_minor: "700000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };
    const message = "Quiero una agua fresca de 16 oz";

    const reply = await service().resolve(client as never, {
      ...input,
      body: message,
      understanding: await understand(message),
    });

    expect(reply?.body).not.toContain("Encontré varias opciones");
    // The 16oz variant was resolved and inserted directly — not the 12oz
    // one, and not left as an unresolved tie.
    expect(
      client.query.mock.calls.some(([, params]) =>
        (params as unknown[])?.includes?.("agua-16"),
      ),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([, params]) =>
        (params as unknown[])?.includes?.("agua-12"),
      ),
    ).toBe(false);
  });

  it("starts an order from a bare, unambiguous product name with no purchase verb", async () => {
    // Regression: a customer typing the exact catalog item name ("Nachos
    // Santos") with no "quiero"/"pedir" got silently dropped to the generic
    // FAQ fallback — see the Wendy Muñoz conversation review.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Nachos Santos",
              variant_name: "Porción para compartir",
              price_minor: "1590000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Nachos Santos",
      understanding: await understand("Nachos Santos"),
    });

    expect(reply?.intent).toBe("order");
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.commercial_requests"),
      ),
    ).toBe(true);
  });

  it("starts an order from a bare product name even when it collides with an FAQ keyword (regression)", async () => {
    // Bug reported live: a real customer typed "Tacos vegetarianos" right
    // after completing an unrelated order — no purchase verb, no question
    // words either. classifyMessage reads "vegetarianos" as the FAQ intent
    // "vegetarian" before commerce ever sees the message, so requestedAction
    // wasn't null — but this isn't a question ("¿tienen tacos
    // vegetarianos?" would be), it's just the product's own name.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Tacos vegetarianos",
              variant_name: "Orden de 3 tacos",
              price_minor: "1690000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Tacos vegetarianos",
      understanding: await understand("Tacos vegetarianos"),
    });

    expect(reply?.intent).toBe("order");
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.commercial_requests"),
      ),
    ).toBe(true);
  });

  it("does not start an order from a genuine question that happens to name-collide with a catalog item (D-078 regression)", async () => {
    // Found live testing D-078: the "informational" rule only listed "tiene"
    // (singular), not "tienen" (plural — the everyday "¿Tienen algo X?"
    // phrasing) — so a real question like "¿Tienen algo vegetariano?" fell
    // through the same bareNameStart gate as a bare product name, matched
    // "Tacos vegetarianos" by the shared word "vegetariano", and incorrectly
    // started an order instead of letting the knowledge layer answer it.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Tacos vegetarianos",
              variant_name: "Orden de 3 tacos",
              price_minor: "1690000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "¿Tienen algo vegetariano?",
      understanding: await understand("¿Tienen algo vegetariano?"),
    });

    expect(reply).toBeNull();
  });

  it("does not start item disambiguation from a genuine question that ties multiple products by a shared word (D-078 follow-up)", async () => {
    // Found live testing D-078: "¿Los tacos pican?" tied "Tacos al pastor",
    // "Tacos de birria", etc. by the shared word "tacos" and jumped straight
    // to "¿cuál prefieres?" instead of letting the knowledge layer answer
    // the spicy FAQ — the tie path never checked whether the message reads
    // as a question at all, unlike the single-match bareNameStart path.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { item_id: "item-1", variant_id: "variant-1", name: "Tacos al pastor", variant_name: "Orden", price_minor: "1890000", currency: "COP" },
            { item_id: "item-2", variant_id: "variant-2", name: "Tacos de birria", variant_name: "Orden", price_minor: "2290000", currency: "COP" },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "¿Los tacos pican?",
      understanding: await understand("¿Los tacos pican?"),
    });

    expect(reply).toBeNull();
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.commercial_requests"),
      ),
    ).toBe(false);
  });

  it("keeps a long modifier option's full name readable via description instead of silently truncating it (regression, D-102 live finding)", async () => {
    // Found live testing Santos Nachos' "Salsas" group: "Salsa de Mermelada
    // de Jalapeño" (31 chars) truncated to "Salsa de Mermelada de J…" with
    // no fallback anywhere — descriptionFor only ever carried quantity/
    // price, never the option's own name. Same bug class D-101 already
    // fixed for itemChoiceReply, missed here.
    const longName = "Salsa de Mermelada de Jalapeño";
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // active workflow lookup
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Santos Nachos",
              variant_name: "Unidad",
              price_minor: "1900000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // insert commercial_requests
        .mockResolvedValueOnce({ rows: [] }) // insert conversation_workflows
        .mockResolvedValueOnce({ rows: [] }) // addItem: existing-line lookup
        .mockResolvedValueOnce({ rows: [] }) // addItem: insert request_lines
        .mockResolvedValueOnce({ rows: [] }) // addItem: recalculate()
        .mockResolvedValueOnce({
          rows: [
            { option_id: "salsa-tamarindo", group_id: "salsas", selection_type: "multiple", name: "Salsa de Tamarindo", price_delta_minor: "0", currency: "COP" },
            { option_id: "salsa-jalapeno", group_id: "salsas", selection_type: "multiple", name: longName, price_delta_minor: "0", currency: "COP" },
          ],
        }) // afterAddItem: itemModifiers
        .mockResolvedValueOnce({ rows: [{ id: "line-1" }] }) // afterAddItem: line lookup
        .mockResolvedValueOnce({ rows: [] }), // step() -> selecting_modifiers
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quiero Santos Nachos",
      understanding: await understand("Quiero Santos Nachos"),
    });

    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "salsa-tamarindo", title: "Salsa de Tamarindo" },
        { id: "salsa-jalapeno", title: "Salsa de Mermelada de J…", description: longName },
        { id: "modifier:finish", title: "Listo" },
      ],
    });
  });

  it("offers configured extras after adding an item instead of jumping straight to 'anything else'", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // active workflow lookup
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Nachos Santos",
              variant_name: "Porción para compartir",
              price_minor: "1590000",
              currency: "COP",
            },
          ],
        }) // matchItemCandidates
        .mockResolvedValueOnce({ rows: [] }) // insert commercial_requests
        .mockResolvedValueOnce({ rows: [] }) // insert conversation_workflows
        .mockResolvedValueOnce({ rows: [] }) // addItem: existing-line lookup
        .mockResolvedValueOnce({ rows: [] }) // addItem: insert request_lines
        .mockResolvedValueOnce({ rows: [] }) // addItem: recalculate()
        .mockResolvedValueOnce({
          rows: [
            { option_id: "queso", group_id: "extras", selection_type: "multiple", name: "Queso extra", price_delta_minor: "300000", currency: "COP" },
            { option_id: "guac", group_id: "extras", selection_type: "multiple", name: "Guacamole", price_delta_minor: "500000", currency: "COP" },
            { option_id: "aguacate", group_id: "extras", selection_type: "multiple", name: "Aguacate", price_delta_minor: "0", currency: "COP" },
          ],
        }) // afterAddItem: itemModifiers — 3 options forces the list format (buttons cap at 3 including "Listo")
        .mockResolvedValueOnce({ rows: [{ id: "line-1" }] }) // afterAddItem: line lookup
        .mockResolvedValueOnce({ rows: [] }), // step() -> selecting_modifiers
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quiero Nachos Santos",
      understanding: await understand("Quiero Nachos Santos"),
    });

    expect(reply?.body).toContain("¿Quieres agregar alguna adición?");
    expect(
      reply?.responsePlan?.kind === "verified_content" &&
        reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "queso", title: "Queso extra", description: "+$ 3.000" },
        { id: "guac", title: "Guacamole", description: "+$ 5.000" },
        { id: "aguacate", title: "Aguacate" },
        { id: "modifier:finish", title: "Listo" },
      ],
    });
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("update app.conversation_workflows") &&
          (params as unknown[])?.[1] === "selecting_modifiers",
      ),
    ).toBe(true);
  });

  it("increments an already-picked 'multiple' extra's quantity instead of adding a duplicate line", async () => {
    // Tapping the same checkbox-style extra again is how the customer says
    // "2 porciones" — see the customer's own question about indicating a
    // quantity for an extra.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_modifiers",
              context: { requestLineId: "line-1" },
            },
          ],
        }) // active workflow lookup
        .mockResolvedValueOnce({
          rows: [
            {
              option_id: "queso",
              group_id: "extras",
              selection_type: "multiple",
              name: "Queso extra",
              price_delta_minor: "300000",
              currency: "COP",
              quantity: "1",
            },
          ],
        }) // remainingModifiers: already picked once
        .mockResolvedValueOnce({ rows: [{ id: "mod-1", quantity: "1" }] }) // addModifier: existing row lookup
        .mockResolvedValueOnce({ rows: [] }) // addModifier: update quantity/total_delta_minor
        .mockResolvedValueOnce({ rows: [] }) // addModifier: recalculate()
        .mockResolvedValueOnce({
          rows: [
            {
              option_id: "queso",
              group_id: "extras",
              selection_type: "multiple",
              name: "Queso extra",
              price_delta_minor: "300000",
              currency: "COP",
              quantity: "2",
            },
          ],
        }), // remainingModifiers (2nd call): still offered, now at quantity 2
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Queso extra",
      understanding: await understand("Queso extra"),
    });

    const updateCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("update app.request_line_modifiers set quantity"),
    );
    expect(updateCall?.[1]).toEqual(["mod-1", 2, "600000"]);
    // Bug found live: this reply used to be byte-for-byte identical to the
    // one that offered the extra in the first place, giving no visible sign
    // "Queso extra" had actually been added — the body now acknowledges it.
    expect(reply?.body).toBe("Agregué Queso extra. ¿Quieres agregar otra adición?");
    // Still offered (not removed) so a third tap would add a third portion.
    expect(
      reply?.responsePlan?.kind === "verified_content" &&
        reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [
        { id: "queso", title: "Queso extra" },
        { id: "modifier:finish", title: "Listo" },
      ],
    });
  });

  it("adds a picked extra to the cart and returns to the normal flow once none remain", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_modifiers",
              context: { requestLineId: "line-1" },
            },
          ],
        }) // active workflow lookup
        .mockResolvedValueOnce({
          rows: [
            { option_id: "queso", group_id: "extras", selection_type: "multiple", name: "Queso extra", price_delta_minor: "300000", currency: "COP" },
          ],
        }) // remainingModifiers
        .mockResolvedValueOnce({ rows: [] }) // addModifier: insert request_line_modifiers
        .mockResolvedValueOnce({ rows: [] }) // addModifier: recalculate
        .mockResolvedValueOnce({ rows: [] }) // remainingModifiers (2nd call): none left
        .mockResolvedValueOnce({ rows: [] }) // step() -> awaiting_more_items
        .mockResolvedValueOnce({
          rows: [
            {
              id: "line-1",
              description_snapshot: "Nachos Santos (Porción para compartir)",
              quantity: "1",
              line_total_minor: "1590000",
              total_minor: "1890000",
              currency: "COP",
            },
          ],
        }) // afterCartChange -> cart() lines
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Queso extra",
      understanding: await understand("Queso extra"),
    });

    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.request_line_modifiers"),
      ),
    ).toBe(true);
    expect(reply?.body).toContain("¿Quieres agregar algo más?");
  });

  it("resolves a tapped modifier option by its id, not the (possibly truncated) reconstructed title (regression)", async () => {
    // Same bug class as D-066: a WhatsApp button title is capped at 20
    // chars — a modifier option name longer than that gets truncated with
    // "…" when tapped, which would never exact-match norm(option.name)
    // again, an unrecoverable loop. Long name chosen specifically to
    // exceed the cap.
    const longName = "Salsa especial de la casa picante";
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_modifiers",
              context: { requestLineId: "line-1" },
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { option_id: "salsa", group_id: "extras", selection_type: "multiple", name: longName, price_delta_minor: "200000", currency: "COP" },
          ],
        }) // remainingModifiers
        .mockResolvedValueOnce({ rows: [] }) // addModifier: insert request_line_modifiers
        .mockResolvedValueOnce({ rows: [] }) // addModifier: recalculate
        .mockResolvedValueOnce({ rows: [] }) // remainingModifiers (2nd call): none left
        .mockResolvedValueOnce({ rows: [] }) // step() -> awaiting_more_items
        .mockResolvedValueOnce({ rows: [] }) // afterCartChange -> cart() lines
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: `${longName.slice(0, 19)}…`, // the tap's truncated, reconstructed title
      interactiveSelectionId: "salsa",
      understanding: await understand(`${longName.slice(0, 19)}…`),
    });

    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.request_line_modifiers"),
      ),
    ).toBe(true);
    expect(reply?.body).toContain("¿Quieres agregar algo más?");
  });

  it("blocks 'Listo' before a package's minimum selections are met (D-099, Santos Tacos' 'elige tus 3 tacos')", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_modifiers",
              context: { requestLineId: "line-1" },
            },
          ],
        }) // active workflow lookup
        .mockResolvedValueOnce({
          rows: [
            {
              option_id: "birria",
              group_id: "tacos-group",
              selection_type: "multiple",
              name: "Birria",
              price_delta_minor: "0",
              currency: "COP",
              quantity: "1",
              min_selections: "3",
              max_selections: "3",
              group_name: "Elige tus 3 tacos",
              group_picked: "1",
            },
          ],
        }), // remainingModifiers: only 1 of the required 3 picked so far
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Listo",
      understanding: await understand("Listo"),
    });

    expect(reply?.body).toBe('Elige 2 más de "Elige tus 3 tacos" antes de continuar.');
    // Never reached finish(): no step transition back to awaiting_more_items.
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("update app.conversation_workflows") &&
          (params as unknown[])?.[1] === "awaiting_more_items",
      ),
    ).toBe(false);
  });

  it("lets 'Listo' finish a package once its minimum selections are already met (D-099)", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_modifiers",
              context: { requestLineId: "line-1" },
            },
          ],
        }) // active workflow lookup
        .mockResolvedValueOnce({
          rows: [
            {
              option_id: "birria",
              group_id: "tacos-group",
              selection_type: "multiple",
              name: "Birria",
              price_delta_minor: "0",
              currency: "COP",
              quantity: "3",
              min_selections: "3",
              max_selections: null,
              group_name: "Elige tus 3 tacos",
              group_picked: "3",
            },
          ],
        }) // remainingModifiers: the 3 required tacos are already picked
        .mockResolvedValueOnce({ rows: [] }) // step() -> awaiting_more_items
        .mockResolvedValueOnce({
          rows: [
            {
              id: "line-1",
              description_snapshot: "Orden x 3 Tacos",
              quantity: "1",
              line_total_minor: "2550000",
              total_minor: "2550000",
              currency: "COP",
            },
          ],
        }) // afterCartChange -> cart() lines
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Listo",
      understanding: await understand("Listo"),
    });

    expect(reply?.body).toContain("¿Quieres agregar algo más?");
  });

  it("matches a plural order against a singular catalog item name (regression)", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Quesadilla norteña",
              variant_name: "Orden",
              price_minor: "1290000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quiero 2 quesadillas norteñas",
      understanding: await understand("Quiero 2 quesadillas norteñas"),
    });

    expect(reply).toEqual(
      expect.objectContaining({
        intent: "order",
        sources: ["commercial_request"],
      }),
    );
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("insert into app.commercial_requests"),
      ),
    ).toBe(true);
  });

  it("answers a greeting and introduces the configured assistant before asking for an item", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const message = "Hola, quiero hacer un pedido";

    const reply = await service().resolve(client as never, {
      ...input,
      assistantName: "Santos",
      businessName: "Santos Tacos Robledo",
      body: message,
      understanding: await understand(message),
    });

    expect(reply?.body).toBe(
      "¡Hola! Soy Santos, el asistente virtual de Santos Tacos Robledo. ¿Qué producto deseas pedir?",
    );
    // Empty catalog (mocked) falls back to a tappable "Ver menú" button —
    // never bare text asking the customer to type a command.
    expect(reply?.responsePlan).toEqual({
      kind: "verified_content",
      body: "¡Hola! Soy Santos, el asistente virtual de Santos Tacos Robledo. ¿Qué producto deseas pedir?",
      interactive: {
        type: "buttons",
        body: "",
        options: [{ id: "cart:view_catalog", title: "Ver menú" }],
      },
    });
  });

  it("says the named product wasn't found instead of the generic prompt, when one was actually named (regression)", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const message = "Quiero pedir una hamburguesa";

    const reply = await service().resolve(client as never, {
      ...input,
      body: message,
      understanding: await understand(message),
    });

    expect(reply?.body).toBe("No encontré ese producto. Estas son nuestras opciones:");
    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [{ id: "cart:view_catalog", title: "Ver menú" }],
    });
  });

  it("shows the catalog as a tappable list instead of a bare text prompt when a named product wasn't found, and creates no request/workflow row", async () => {
    const catalogRows = {
      rows: [
        { item_id: "item-1", variant_id: "pastor-variant", name: "Tacos al pastor", variant_name: "Unidad", price_minor: "1890000", currency: "COP" },
        { item_id: "item-2", variant_id: "agua-variant", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // no active workflow
        .mockResolvedValueOnce(catalogRows) // matchItemCandidates() -> catalogItems()
        .mockResolvedValueOnce(catalogRows), // catalogChoiceReply() -> catalogItems()
    };
    const message = "Quiero pedir una hamburguesa";

    const reply = await service().resolve(client as never, {
      ...input,
      body: message,
      understanding: await understand(message),
    });

    expect(reply?.body).toBe("No encontré ese producto. Estas son nuestras opciones:");
    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "pastor-variant", title: "Tacos al pastor", description: "$ 18.900" },
        { id: "agua-variant", title: "Agua fresca", description: "Vaso de 12 oz · $ 7.000" },
        { id: "cart:view_catalog", title: "Ver menú" },
      ],
    });
    // Only the workflow lookup and two catalog lookups happen — no
    // commercial_request/workflow insert, so the next message isn't trapped
    // answering a tie that was never actually offered (regression, found
    // live).
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it("shows the catalog while an order is waiting for a product", async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            id: "workflow-1",
            commercial_request_id: "request-1",
            step: "selecting_item",
            context: {},
          },
        ],
      }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Dame el menú por favor",
      understanding: await understand("Dame el menú por favor"),
    });

    expect(reply).toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("shows the catalog as a tappable list when the customer taps 'Otro producto' instead of asking a bare text question", async () => {
    const catalogRows = {
      rows: [
        { item_id: "item-1", variant_id: "pastor-variant", name: "Tacos al pastor", variant_name: "Unidad", price_minor: "1890000", currency: "COP" },
        { item_id: "item-2", variant_id: "agua-variant", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_confirmation",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // step() -> selecting_item
        .mockResolvedValueOnce(catalogRows), // catalogItems()
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Agregar otro producto",
      understanding: await understand("Agregar otro producto"),
    });

    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "pastor-variant", title: "Tacos al pastor", description: "$ 18.900" },
        { id: "agua-variant", title: "Agua fresca", description: "Vaso de 12 oz · $ 7.000" },
        { id: "cart:view_catalog", title: "Ver menú" },
      ],
    });
    expect(
      client.query.mock.calls.some(
        ([, params]) => (params as unknown[])?.[1] === "selecting_item",
      ),
    ).toBe(true);
  });

  it("offers a tappable category picker instead of a bare 'Ver menú' button when 'Otro producto' matches more than 10 items (D-102)", async () => {
    // Found live testing Santos Tacos' real 41-item menu: catalogChoiceReply
    // returned null for >10 items, and every caller's `?? catalogButtonReply`
    // fallback then showed a bare button with nothing tappable behind it.
    const filler = Array.from({ length: 9 }, (_, index) => ({
      item_id: `filler-${index}`, variant_id: `filler-${index}-v`, name: `Relleno ${index}`,
      category: "Otros", variant_name: "Unidad", price_minor: "100000", currency: "COP",
    }));
    const catalogRows = {
      rows: [
        { item_id: "item-1", variant_id: "pastor-variant", name: "Tacos al pastor", category: "Tacos", variant_name: "Unidad", price_minor: "1890000", currency: "COP" },
        { item_id: "item-2", variant_id: "birria-variant", name: "Tacos de birria", category: "Tacos", variant_name: "Unidad", price_minor: "2290000", currency: "COP" },
        ...filler,
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            { id: "workflow-1", commercial_request_id: "request-1", step: "awaiting_confirmation", context: {} },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // step() -> selecting_item
        .mockResolvedValueOnce(catalogRows), // catalogItems()
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Agregar otro producto",
      understanding: await understand("Agregar otro producto"),
    });

    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "category:Otros", title: "Menú Otros" },
        { id: "category:Tacos", title: "Menú Tacos" },
      ],
    });
  });

  it("resolves a tapped category (from the picker above) straight to that category's own items, by id, without touching workflow state (D-102)", async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          { item_id: "item-1", variant_id: "pastor-variant", name: "Tacos al pastor", category: "Tacos", variant_name: "Unidad", price_minor: "1890000", currency: "COP" },
          { item_id: "item-2", variant_id: "birria-variant", name: "Tacos de birria", category: "Tacos", variant_name: "Unidad", price_minor: "2290000", currency: "COP" },
        ],
      }), // catalogItems() — the only query this path ever needs
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Menú Tacos",
      interactiveSelectionId: "category:Tacos",
      understanding: await understand("Menú Tacos"),
    });

    expect(reply?.body).toBe("Estas son las opciones de Tacos:");
    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "pastor-variant", title: "Tacos al pastor", description: "$ 18.900" },
        { id: "birria-variant", title: "Tacos de birria", description: "$ 22.900" },
        { id: "cart:view_catalog", title: "Ver menú" },
      ],
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("answers an explicit recommendation request with the tenant's best sellers instead of failing item-matching", async () => {
    const bestSellers = {
      rows: [
        { item_id: "item-1", variant_id: "pastor-variant", name: "Tacos al pastor", variant_name: "Unidad", price_minor: "1890000", currency: "COP" },
        { item_id: "item-2", variant_id: "nachos-variant", name: "Nachos", variant_name: "Orden", price_minor: "1500000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // no active workflow
        .mockResolvedValueOnce(bestSellers), // mostOrderedItems()
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quisiera que me recomendaras una entrada y un plato fuerte",
      understanding: await understand(
        "Quisiera que me recomendaras una entrada y un plato fuerte",
      ),
    });

    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "pastor-variant", title: "Tacos al pastor", description: "$ 18.900" },
        { id: "nachos-variant", title: "Nachos", description: "Orden · $ 15.000" },
        { id: "cart:view_catalog", title: "Ver menú" },
      ],
    });
    expect(reply?.body).toBe("Esto es lo más pedido, ¿quieres agregar alguno?");
  });

  it("falls back to a plain message when a recommendation is requested but the tenant has no order history yet", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // no active workflow
        .mockResolvedValueOnce({ rows: [] }), // mostOrderedItems() -> nothing yet
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Recomiéndame algo",
      understanding: await understand("Recomiéndame algo"),
    });

    expect(reply?.body).toBe("Aún no tengo suficientes pedidos para recomendarte algo.");
    // D-100: no quoted "escribe ver menú" instruction — a real button instead.
    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [{ id: "cart:view_catalog", title: "Ver menú" }],
    });
  });

  it("shows the catalog as a tappable list when the customer answers 'sí' to adding another item", async () => {
    const catalogRows = {
      rows: [
        { item_id: "item-1", variant_id: "pastor-variant", name: "Tacos al pastor", variant_name: "Unidad", price_minor: "1890000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // step() -> selecting_item
        .mockResolvedValueOnce(catalogRows), // catalogItems()
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Sí",
      understanding: await understand("Sí"),
    });

    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "pastor-variant", title: "Tacos al pastor", description: "$ 18.900" },
        { id: "cart:view_catalog", title: "Ver menú" },
      ],
    });
  });

  it("offers real buttons instead of a quoted \"sí\"/\"ver menú\"/\"listo\" instruction when the answer to 'anything else?' isn't understood (D-100, D-095 rule)", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-1",
              variant_id: "variant-1",
              name: "Quesadilla",
              variant_name: "Unidad",
              price_minor: "2500000",
              currency: "COP",
            },
          ],
        }), // matchItem() -> catalogItems(), nothing scores a match
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "asdf",
      understanding: await understand("asdf"),
    });

    expect(reply?.body).toBe(
      "No entendí tu respuesta. Escribe el nombre de otro producto o elige una opción.",
    );
    expect(
      reply?.responsePlan?.kind === "localized_template" && reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [
        { id: "cart:add_item", title: "Otro producto" },
        { id: "cart:finish_items", title: "Listo" },
      ],
    });
  });

  it("answers /help with a tappable list of every command instead of ten quoted phrases in one paragraph (D-100, D-095 rule)", async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) }; // no active workflow

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Ayuda",
      understanding: await understand("Ayuda"),
    });

    expect(reply?.body).toBe("Puedes elegir cualquiera de estas opciones:");
    const interactive =
      reply?.responsePlan?.kind === "verified_content" ? reply.responsePlan.interactive : undefined;
    expect(interactive?.type).toBe("list");
    expect(
      interactive?.type === "list" ? interactive.options.map((o) => o.title) : [],
    ).toEqual([
      "Ver menú",
      "Ver pedido",
      "Otro producto",
      "Quitar producto",
      "Cambiar cantidad",
      "Volver",
      "Cambiar entrega",
      "Cambiar dirección",
      "Cancelar pedido",
      "Hablar con una persona",
    ]);
  });

  it("adds every product mentioned in one message instead of dropping all but the highest-scoring one (D-050)", async () => {
    // Regression: "Quisiera unos nachos y 3 tacos vegetarianos" scored both
    // catalog items against one flat token bag from the whole message —
    // "Tacos vegetarianos" won (2 matching tokens vs. 1) and "Nachos Santos"
    // was silently dropped, never added to the cart. Reported live against
    // Santos Tacos.
    const catalogRows = {
      rows: [
        { item_id: "item-1", variant_id: "nachos-variant", name: "Nachos Santos", variant_name: "Porción para compartir", price_minor: "1590000", currency: "COP" },
        { item_id: "item-2", variant_id: "vegetarianos-variant", name: "Tacos vegetarianos", variant_name: "Unidad", price_minor: "1690000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce(catalogRows) // matchItemMentions: catalogItems()
        .mockResolvedValue({ rows: [] }), // addItem x2 (select+insert+recalculate each) and cart()
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quisiera unos nachos y 3 tacos vegetarianos",
      understanding: await understand("Quisiera unos nachos y 3 tacos vegetarianos"),
    });

    const insertCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("insert into app.request_lines"),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toEqual(
      expect.arrayContaining(["request-1", "nachos-variant"]),
    );
    expect(insertCalls[1][1]).toEqual(
      expect.arrayContaining(["request-1", "vegetarianos-variant"]),
    );
    expect(reply).not.toBeNull();
  });

  it("treats a plain decline ('ninguno') while selecting an item the same as finishing, instead of an unknown-product dead end", async () => {
    // Regression: "Ninguno" while the bot is asking "¿qué producto deseas
    // pedir?" fell through to matchItem (which of course found nothing) and
    // replied "no encontré ese producto" — a dead end that pushed the
    // customer to type "cancelar" out of frustration. See the Carlos
    // conversation review.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_item",
              context: {},
            },
          ],
        }) // active workflow lookup
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // cart has an active line
        .mockResolvedValueOnce({ rows: [] }) // step() -> awaiting_fulfillment
        .mockResolvedValueOnce({ rows: [{ enabled: true }] }), // fulfillmentReply: delivery capability
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Ninguno",
      understanding: await understand("Ninguno"),
    });

    expect(reply?.body).toContain(
      "¿Lo deseas para domicilio, recogida o consumo en el local?",
    );
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes(
          "select item.id item_id,variant.id variant_id,item.name",
        ),
      ),
    ).toBe(false);
  });

  it("removes an item by matching only what is in the cart, not the whole catalog", async () => {
    // Regression: the catalog has two "Agua fresca" variants (12oz/16oz), but
    // only the 12oz one is in this cart. Matching against the full catalog
    // ties between both variants and the customer can never remove it — see
    // the Wendy Muñoz conversation review.
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "removing_item",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "agua",
              variant_id: "agua-12oz",
              name: "Agua fresca",
              variant_name: "Vaso de 12 oz",
              price_minor: "700000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "line-1" }] })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Agua Fresca",
      understanding: await understand("Agua Fresca"),
    });

    expect(reply?.body).not.toContain("¿Qué producto deseas quitar");
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes(
          "update app.request_lines set status='removed'",
        ),
      ),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(
        ([sql]) => String(sql).includes("from app.catalog_items"),
      ),
    ).toBe(false);
  });

  it("resolves a remove-item tie between same-named cart variants by the option index (D-051 follow-up)", async () => {
    // Same structural bug as the add-item case (D-050/D-051): two "Agua
    // fresca" variants both active in the cart share every name token, so
    // re-matching the tapped option's text can never break the tie.
    const tiedItems = [
      { item_id: "agua", variant_id: "agua-12oz", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      { item_id: "agua", variant_id: "agua-16oz", name: "Agua fresca", variant_name: "Vaso de 16 oz", price_minor: "900000", currency: "COP" },
    ];
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "removing_item",
              context: { tiedItems },
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "line-1" }] }) // update request_lines set status='removed'
        .mockResolvedValue({ rows: [] }), // recalculate(), step(), cart()
    };

    await service().resolve(client as never, {
      ...input,
      body: "2",
      understanding: await understand("2"),
    });

    const removeCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("update app.request_lines set status='removed'"),
    );
    expect(removeCall?.[1]).toEqual(
      expect.arrayContaining(["request-1", "agua-16oz"]),
    );
  });

  it("offers a 'Todas' option when a remove-item tie is between variants of the same product (D-051 follow-up)", async () => {
    // Suggested by the project owner after watching this exact tie live:
    // asking to remove "agua fresca" without saying which variant is
    // reasonably read as "get rid of all of it", not just one arbitrary
    // variant — so it's offered as an explicit option, one past the real
    // ones (see itemChoiceReply's allOption/allowRemoveAll).
    const cartRows = {
      rows: [
        { item_id: "agua", variant_id: "agua-12oz", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
        { item_id: "agua", variant_id: "agua-16oz", name: "Agua fresca", variant_name: "Vaso de 16 oz", price_minor: "900000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce(cartRows) // matchCartItemCandidates: cartItems()
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quitar agua fresca",
      understanding: await understand("Quitar agua fresca"),
    });

    const interactive =
      reply?.responsePlan?.kind === "verified_content"
        ? reply.responsePlan.interactive
        : undefined;
    expect(interactive?.type).toBe("list");
    expect(interactive?.options).toEqual([
      // "Agua fresca (Vaso de 12 oz)" is 27 chars — longer than a list
      // row's 24-char title cap, so the full label now also carries over
      // into `description` instead of being silently lost to truncation.
      { id: "1", title: expect.stringContaining("12"), description: "Agua fresca (Vaso de 12 oz)" },
      { id: "2", title: expect.stringContaining("16"), description: "Agua fresca (Vaso de 16 oz)" },
      { id: "3", title: "Todas" },
    ]);
  });

  it("removes every tied line when the customer taps 'Todas' (D-051 follow-up)", async () => {
    const tiedItems = [
      { item_id: "agua", variant_id: "agua-12oz", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      { item_id: "agua", variant_id: "agua-16oz", name: "Agua fresca", variant_name: "Vaso de 16 oz", price_minor: "900000", currency: "COP" },
    ];
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "removing_item",
              context: { tiedItems },
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "line-1" }] }) // update request_lines (agua-12oz)
        .mockResolvedValueOnce({ rows: [{ id: "line-2" }] }) // update request_lines (agua-16oz)
        .mockResolvedValue({ rows: [] }), // recalculate(), step(), cart()
    };

    await service().resolve(client as never, {
      ...input,
      body: "3",
      understanding: await understand("3"),
    });

    const removeCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("update app.request_lines set status='removed'"),
    );
    expect(removeCalls).toHaveLength(2);
    expect(removeCalls[0][1]).toEqual(
      expect.arrayContaining(["request-1", "agua-12oz"]),
    );
    expect(removeCalls[1][1]).toEqual(
      expect.arrayContaining(["request-1", "agua-16oz"]),
    );
  });

  it("resolves a change-quantity tie between same-named cart variants when a quantity was given alongside it (D-051 follow-up)", async () => {
    const tiedItems = [
      { item_id: "agua", variant_id: "agua-12oz", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      { item_id: "agua", variant_id: "agua-16oz", name: "Agua fresca", variant_name: "Vaso de 16 oz", price_minor: "900000", currency: "COP" },
    ];
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "changing_quantity_item",
              context: { tiedItems, pendingQuantity: 3 },
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "line-1" }] }) // update request_lines set quantity=...
        .mockResolvedValue({ rows: [] }), // recalculate(), step(), cart()
    };

    await service().resolve(client as never, {
      ...input,
      body: "2",
      understanding: await understand("2"),
    });

    const updateCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("update app.request_lines set quantity="),
    );
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining(["request-1", "agua-16oz", 3]),
    );
  });

  it("shows the current cart as tappable options when asking which product to remove", async () => {
    const cartRows = {
      rows: [
        {
          item_id: "pollo",
          variant_id: "pollo-variant",
          name: "Tacos de pollo",
          variant_name: "Orden de 3 tacos",
          price_minor: "1790000",
          currency: "COP",
        },
        {
          item_id: "agua",
          variant_id: "agua-variant",
          name: "Agua fresca",
          variant_name: "Vaso de 12 oz",
          price_minor: "700000",
          currency: "COP",
        },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        // matchCartItemCandidates: nothing in the cart matches "el pastel"
        .mockResolvedValueOnce(cartRows)
        // step() marking the workflow as removing_item
        .mockResolvedValueOnce({ rows: [] })
        // removeWhichReply's own cartItems() lookup for the option list
        .mockResolvedValueOnce(cartRows),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Quitar el pastel",
      understanding: await understand("Quitar el pastel"),
    });

    expect(reply?.body).toContain("¿Qué producto deseas quitar del pedido?");
    expect(
      reply?.responsePlan?.kind === "verified_content" &&
        reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [
        { id: "1", title: "Tacos de pollo" },
        { id: "2", title: "Agua fresca" },
      ],
    });
  });

  it("shows the current cart as tappable options when asking which product's quantity to change, instead of a bare-text example prompt (live finding)", async () => {
    const cartRows = {
      rows: [
        {
          item_id: "pollo",
          variant_id: "pollo-variant",
          name: "Tacos de pollo",
          variant_name: "Orden de 3 tacos",
          price_minor: "1790000",
          currency: "COP",
        },
        {
          item_id: "agua",
          variant_id: "agua-variant",
          name: "Agua fresca",
          variant_name: "Vaso de 12 oz",
          price_minor: "700000",
          currency: "COP",
        },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        // matchCartItemCandidates: no product named at all
        .mockResolvedValueOnce(cartRows)
        // step() marking the workflow as changing_quantity_item
        .mockResolvedValueOnce({ rows: [] })
        // changeQuantityWhichReply's own cartItems() lookup for the option list
        .mockResolvedValueOnce(cartRows),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Cambiar cantidad",
      understanding: await understand("Cambiar cantidad"),
    });

    expect(reply?.body).toContain("¿Qué producto deseas cambiar de cantidad?");
    expect(
      reply?.responsePlan?.kind === "verified_content" &&
        reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [
        { id: "1", title: "Tacos de pollo" },
        { id: "2", title: "Agua fresca" },
      ],
    });
  });

  it("asks how many units once the product is picked but no quantity was given, then applies the number typed next to that same product (live finding)", async () => {
    const item = {
      item_id: "pollo",
      variant_id: "pollo-variant",
      name: "Tacos de pollo",
      variant_name: "Orden de 3 tacos",
      price_minor: "1790000",
      currency: "COP",
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        // matchCartItemCandidates: "tacos de pollo" matches the cart line, no number in the message
        .mockResolvedValueOnce({ rows: [item] })
        // step() persisting quantityTarget
        .mockResolvedValueOnce({ rows: [] }),
    };

    const firstReply = await service().resolve(client as never, {
      ...input,
      body: "Cambiar la cantidad de tacos de pollo",
      understanding: await understand("Cambiar la cantidad de tacos de pollo"),
    });

    expect(firstReply?.body).toBe("¿Cuántas unidades de Tacos de pollo quieres?");
    const stepCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("update app.conversation_workflows"),
    );
    expect(JSON.parse(stepCall?.[1]?.[2] as string)).toEqual(
      expect.objectContaining({ quantityTarget: item }),
    );

    const client2 = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "changing_quantity_item",
              context: { quantityTarget: item },
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "line-1" }] }) // update request_lines set quantity=...
        .mockResolvedValue({ rows: [] }), // recalculate(), step(), cart()
    };

    await service().resolve(client2 as never, {
      ...input,
      body: "5",
      understanding: await understand("5"),
    });

    const updateCall = client2.query.mock.calls.find(([sql]) =>
      String(sql).includes("update app.request_lines set quantity="),
    );
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining(["request-1", "pollo-variant", 5]),
    );
  });

  it("asks which product when catalog matches are tied instead of picking arbitrarily", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_item",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "pastor",
              variant_id: "pastor-variant",
              name: "Tacos al pastor",
              variant_name: "Orden de 3",
              price_minor: "1890000",
              currency: "COP",
            },
            {
              item_id: "birria",
              variant_id: "birria-variant",
              name: "Tacos de birria",
              variant_name: "Orden de 3",
              price_minor: "2290000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }), // step(): persists tiedItems for next turn
    };
    const message = "Quiero dos órdenes de tacos de biria";

    const reply = await service().resolve(client as never, {
      ...input,
      body: message,
      understanding: await understand(message),
    });

    expect(reply?.body).toContain("¿cuál prefieres?");
    expect(
      reply?.responsePlan?.kind === "verified_content" &&
        reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [
        { id: "1", title: "Tacos al pastor" },
        { id: "2", title: "Tacos de birria" },
      ],
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it("uses a list instead of buttons when a tied product's name would otherwise be truncated unreadable (regression, D-100 live finding)", async () => {
    // Found live testing Santos Tacos' packages: with only 2 tied options
    // this used `buttons` (20-char cap, since neither name repeats and
    // there are ≤3 candidates), truncating "Orden x 3 Tacos Birria de
    // Camarón o Güerito" to "Orden x 3 Tacos Bir…" — losing exactly the
    // words that told the two options apart, right next to the other
    // option's untruncated, identical-looking prefix "Orden x 3 Tacos".
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_item",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "package-regular",
              variant_id: "package-regular-variant",
              name: "Orden x 3 Tacos",
              variant_name: "Unidad",
              price_minor: "2550000",
              currency: "COP",
            },
            {
              item_id: "package-premium",
              variant_id: "package-premium-variant",
              name: "Orden x 3 Tacos Birria de Camarón o Güerito",
              variant_name: "Unidad",
              price_minor: "2950000",
              currency: "COP",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const message = "Quiero Orden x 3 Tacos";

    const reply = await service().resolve(client as never, {
      ...input,
      body: message,
      understanding: await understand(message),
    });

    expect(
      reply?.responsePlan?.kind === "verified_content" &&
        reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        { id: "1", title: "Orden x 3 Tacos" },
        {
          id: "2",
          title: "Orden x 3 Tacos Birria …",
          description: "Orden x 3 Tacos Birria de Camarón o Güerito",
        },
      ],
    });
  });

  it("resolves a tapped catalog/menu list item by its exact variant id instead of re-matching the tied name (regression)", async () => {
    // Bug reported live: tapping "Agua fresca" (12oz) from the "Ver menú"
    // list still showed the disambiguation tie instead of adding the exact
    // variant tapped. catalogChoiceReply()/offeringReply() list options use
    // the variant_id as their id, but selectionAsNaturalText() reconstructs
    // the tap as just the row's title (no description) — "Agua fresca",
    // indistinguishable by name from its 16oz sibling. The tap's id is
    // resolved directly against the catalog before falling back to
    // name-based scoring.
    const catalogRows = {
      rows: [
        { item_id: "agua", variant_id: "agua-12", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
        { item_id: "agua", variant_id: "agua-16", name: "Agua fresca", variant_name: "Vaso de 16 oz", price_minor: "900000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // no active workflow
        .mockResolvedValueOnce(catalogRows) // catalogItems() for matchItemCandidates
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Agua fresca",
      interactiveSelectionId: "agua-12",
      understanding: await understand("Agua fresca"),
    });

    const insertCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into app.request_lines"),
    );
    expect(insertCall?.[1]).toEqual(expect.arrayContaining(["agua-12"]));
    expect(reply?.body).not.toContain("Encontré varias opciones");
  });

  it("shows the catalog as a tappable list when 'Cambiar producto' is used on a single-item cart (regression)", async () => {
    // Bug reported live: picking "Cambiar producto" fell back to the plain
    // "¿Qué producto deseas pedir?" text prompt with nothing to tap, unlike
    // "Otro producto" (add_item), which already shows the catalog list.
    const catalogRows = {
      rows: [
        { item_id: "item-2", variant_id: "variant-2", name: "Tacos de birria", variant_name: "Orden de 3", price_minor: "2290000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { item_id: "item-1", variant_id: "variant-1", name: "Tacos al pastor", variant_name: "Orden de 3 tacos", price_minor: "1890000", currency: "COP" },
          ],
        }) // cartItems() -> single item, no disambiguation needed
        .mockResolvedValueOnce({ rows: [] }) // update fulfillment_type=null
        .mockResolvedValueOnce({ rows: [] }) // step() -> selecting_item
        .mockResolvedValueOnce(catalogRows) // catalogItems() for the replacement picker
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Cambiar producto",
      understanding: await understand("Cambiar producto"),
    });

    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual(
      expect.objectContaining({
        type: "list",
        options: expect.arrayContaining([
          expect.objectContaining({ id: "variant-2", title: "Tacos de birria" }),
        ]),
      }),
    );
  });

  it("asks which product to change when the cart has more than one item, instead of guessing (regression)", async () => {
    // Bug reported live: "Cambiar producto" on a multi-item cart always
    // silently replaced whichever line was added first, regardless of what
    // the customer actually meant to change.
    const cartRows = {
      rows: [
        { item_id: "item-1", variant_id: "variant-1", name: "Tacos al pastor", variant_name: "Orden de 3 tacos", price_minor: "1890000", currency: "COP" },
        { item_id: "item-2", variant_id: "variant-2", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_more_items",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce(cartRows) // cartItems()
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Cambiar producto",
      understanding: await understand("Cambiar producto"),
    });

    expect(reply?.body).toBe("¿Qué producto deseas cambiar?");
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("update app.conversation_workflows") &&
          (params as unknown[])?.[1] === "selecting_replace_target",
      ),
    ).toBe(true);
  });

  it("targets the exact product tapped when resolving which one to change, and shows the catalog to pick the replacement (regression)", async () => {
    const replaceCandidates = [
      { item_id: "item-1", variant_id: "variant-1", name: "Tacos al pastor", variant_name: "Orden de 3 tacos", price_minor: "1890000", currency: "COP" },
      { item_id: "item-2", variant_id: "variant-2", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
    ];
    const catalogRows = {
      rows: [
        { item_id: "item-3", variant_id: "variant-3", name: "Tacos de birria", variant_name: "Orden de 3", price_minor: "2290000", currency: "COP" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_replace_target",
              context: { replaceCandidates },
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // update fulfillment_type=null
        .mockResolvedValueOnce({ rows: [] }) // step() -> selecting_item
        .mockResolvedValueOnce(catalogRows) // catalogItems() for the replacement picker
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "2",
      understanding: await understand("2"),
    });

    const stepCall = client.query.mock.calls.find(
      ([sql, params]) =>
        String(sql).includes("update app.conversation_workflows") &&
        (params as unknown[])?.[1] === "selecting_item",
    );
    expect(stepCall?.[1]?.[2]).toContain('"replaceItemId":"variant-2"');
    // Bug reported live: this used to fall back to a plain "¿Qué producto
    // deseas pedir?" text prompt with no way to tap a replacement.
    expect(
      reply?.responsePlan?.kind === "verified_content" && reply.responsePlan.interactive,
    ).toEqual(
      expect.objectContaining({
        type: "list",
        options: expect.arrayContaining([
          expect.objectContaining({ id: "variant-3", title: "Tacos de birria" }),
        ]),
      }),
    );
  });

  it("replaces the specific cart line targeted, not just the first one added (regression)", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_item",
              context: { replaceItem: true, replaceItemId: "variant-2" },
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              item_id: "item-3",
              variant_id: "variant-3",
              name: "Tacos de birria",
              variant_name: "Orden de 3",
              price_minor: "2290000",
              currency: "COP",
            },
          ],
        }) // catalogItems() for matchItemCandidates
        .mockResolvedValueOnce({ rows: [{ id: "line-2", quantity: "1" }] }) // addItem's targeted "replace" lookup
        .mockResolvedValue({ rows: [] }),
    };

    await service().resolve(client as never, {
      ...input,
      body: "Tacos de birria",
      understanding: await understand("Tacos de birria"),
    });

    const replaceLookup = client.query.mock.calls.find(([sql]) =>
      String(sql).includes(
        "select id,quantity::text from app.request_lines where commercial_request_id=$1 and item_variant_id=$2",
      ),
    );
    expect(replaceLookup?.[1]).toEqual(["request-1", "variant-2"]);
  });

  it("resolves a tie between same-named variants by the option index instead of re-matching text (D-050 follow-up)", async () => {
    // "Agua fresca" 12oz vs 16oz share every name token — re-matching the
    // tapped option's text by name alone can never break this tie; it
    // would show the exact same two options again, forever. Found live
    // (also the same bug that made itemChoiceReply's buttons collide on
    // Meta's "Duplicate button title" rejection, fixed separately).
    const tiedItems = [
      { item_id: "agua", variant_id: "agua-12", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      { item_id: "agua", variant_id: "agua-16", name: "Agua fresca", variant_name: "Vaso de 16 oz", price_minor: "900000", currency: "COP" },
    ];
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_item",
              context: { tiedItems },
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "2",
      understanding: await understand("2"),
    });

    const insertCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into app.request_lines"),
    );
    expect(insertCall?.[1]).toEqual(expect.arrayContaining(["request-1", "agua-16"]));
    expect(reply).not.toBeNull();
  });

  it("does not misread the disambiguating variant number as the requested quantity when a tie is tapped (D-051 follow-up)", async () => {
    // Regression: a tapped tie option's title includes the variant label to
    // disambiguate ("Agua fresca (Vaso de 12 oz)" — see itemChoiceReply).
    // That title becomes the next inbound message, and parseQuantity reads
    // ANY bare 1-2 digit number in the message as the requested quantity —
    // so tapping this option previously added 12 units instead of 1. Found
    // live immediately after building the itemChoiceReply disambiguation
    // fix. The quantity from the *original* message that produced the tie
    // (here: none given, so it defaults to 1) is now captured in
    // context.pendingQuantity at tie time and reused, instead of
    // re-parsing the tapped title.
    const tiedItems = [
      { item_id: "agua", variant_id: "agua-12", name: "Agua fresca", variant_name: "Vaso de 12 oz", price_minor: "700000", currency: "COP" },
      { item_id: "agua", variant_id: "agua-16", name: "Agua fresca", variant_name: "Vaso de 16 oz", price_minor: "900000", currency: "COP" },
    ];
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "selecting_item",
              context: { tiedItems, pendingQuantity: 1 },
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    // The tap's reconstructed body is the tapped option's title text, which
    // contains "12" — exactly what previously got misread as the quantity.
    await service().resolve(client as never, {
      ...input,
      body: "Agua fresca (Vaso de 12 oz)",
      understanding: {
        ...(await understand("Agua fresca (Vaso de 12 oz)")),
        entities: {
          ...(await understand("Agua fresca (Vaso de 12 oz)")).entities,
          selectionIndex: 1,
        },
      },
    });

    const insertCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into app.request_lines"),
    );
    expect(insertCall?.[1]).toEqual(
      expect.arrayContaining(["request-1", "agua-12"]),
    );
    // quantity is the 8th positional value bound in the insert — asserting
    // it directly (not just arrayContaining) is what actually catches the
    // "12" misparse regression.
    expect(insertCall?.[1][7]).toBe(1);
  });

  it("cancels an active process from any workflow step", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_address",
              context: { fulfillment: "delivery" },
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Cancelar pedido",
      understanding: await understand("Cancelar pedido"),
    });

    expect(reply?.body).toBe("Proceso cancelado. No se realizó ningún cobro.");
    expect(reply?.responsePlan).toEqual({
      kind: "localized_template",
      template: { namespace: "commercial", key: "cancelled" },
      values: {},
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("status='cancelled'"),
      ),
    ).toBe(true);
  });

  const fulfillmentUnderstanding = (requestedAction: string) => ({
    locale: "es" as const,
    localeSource: "tenant_default" as const,
    intent: "order",
    confidence: 1,
    entities: {},
    requestedAction,
    missingInformation: [],
    requiresHuman: false,
    provider: "deterministic" as const,
    providerVersion: "test",
  });

  it("still asks for a delivery address after choosing delivery (regression)", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_fulfillment",
              context: {},
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service([addressRequirement]).resolve(client as never, {
      ...input,
      body: "Domicilio",
      understanding: fulfillmentUnderstanding("fulfillment.delivery"),
    });

    expect(reply?.responsePlan).toEqual({
      kind: "localized_template",
      template: { namespace: "commercial", key: "address" },
      values: {},
    });
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("update app.conversation_workflows") &&
          (params as unknown[])?.[1] === "awaiting_requirement:delivery_address:value",
      ),
    ).toBe(true);
  });

  it("adds an automatic packaging line (1 per N food items, rounded up) once pickup is chosen, when the tenant has one configured (D-104)", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("from app.conversation_workflows where conversation_id"))
          return {
            rows: [
              { id: "workflow-1", commercial_request_id: "request-1", step: "awaiting_fulfillment", context: {} },
            ],
          };
        if (sql.includes("left join app.catalog_items item"))
          // 7 food items in the cart, ratio 3 -> ceil(7/3) = 3 packages.
          return {
            rows: [
              {
                tenant_id: "tenant-1",
                fulfillment_type: "pickup",
                variant_id: "packaging-variant",
                item_name: "Empaque para llevar",
                price_minor: "100000",
                currency: "COP",
                ratio: 3,
              },
            ],
          };
        if (sql.includes("select id from app.request_lines where commercial_request_id"))
          return { rows: [] }; // no existing packaging line yet
        if (sql.includes("food") && sql.includes("counts_toward_packaging"))
          return { rows: [{ food: "7", total: "8" }] }; // 7 food + 1 drink
        return { rows: [] };
      }),
    };

    await service([]).resolve(client as never, {
      ...input,
      body: "Recogida",
      understanding: fulfillmentUnderstanding("fulfillment.pickup"),
    });

    const insert = queries.find(({ sql }) => sql.includes("insert into app.request_lines"));
    expect(insert).toBeDefined();
    expect(insert?.params).toEqual([
      expect.any(String),
      "tenant-1",
      "request-1",
      "packaging-variant",
      "Empaque para llevar",
      "100000",
      "COP",
      3, // packages: ceil(7/3)
      "300000", // 3 * 100000
    ]);
  });

  it("charges the packaging floor of 1 even for a drinks-only order (0 food items still counts as 'has something')", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("from app.conversation_workflows where conversation_id"))
          return {
            rows: [
              { id: "workflow-1", commercial_request_id: "request-1", step: "awaiting_fulfillment", context: {} },
            ],
          };
        if (sql.includes("left join app.catalog_items item"))
          return {
            rows: [
              {
                tenant_id: "tenant-1",
                fulfillment_type: "delivery",
                variant_id: "packaging-variant",
                item_name: "Empaque para llevar",
                price_minor: "100000",
                currency: "COP",
                ratio: 3,
              },
            ],
          };
        if (sql.includes("select id from app.request_lines where commercial_request_id"))
          return { rows: [] };
        if (sql.includes("food") && sql.includes("counts_toward_packaging"))
          return { rows: [{ food: "0", total: "2" }] }; // 2 drinks, 0 food
        return { rows: [] };
      }),
    };

    await service([]).resolve(client as never, {
      ...input,
      body: "Domicilio",
      understanding: fulfillmentUnderstanding("fulfillment.delivery"),
    });

    const insert = queries.find(({ sql }) => sql.includes("insert into app.request_lines"));
    expect(insert?.params[7]).toBe(1); // max(1, ceil(0/3)) = 1, never 0
  });

  it("removes an existing packaging line when the cart ends up with nothing in it (D-104)", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("from app.conversation_workflows where conversation_id"))
          return {
            rows: [
              { id: "workflow-1", commercial_request_id: "request-1", step: "awaiting_fulfillment", context: {} },
            ],
          };
        if (sql.includes("left join app.catalog_items item"))
          return {
            rows: [
              {
                tenant_id: "tenant-1",
                fulfillment_type: "pickup",
                variant_id: "packaging-variant",
                item_name: "Empaque para llevar",
                price_minor: "100000",
                currency: "COP",
                ratio: 3,
              },
            ],
          };
        if (sql.includes("select id from app.request_lines where commercial_request_id"))
          return { rows: [{ id: "packaging-line-1" }] }; // a stale line from before the cart was emptied
        if (sql.includes("food") && sql.includes("counts_toward_packaging"))
          return { rows: [{ food: "0", total: "0" }] }; // cart is empty
        return { rows: [] };
      }),
    };

    await service([]).resolve(client as never, {
      ...input,
      body: "Recogida",
      understanding: fulfillmentUnderstanding("fulfillment.pickup"),
    });

    const removal = queries.find(
      ({ sql, params }) =>
        sql.includes("update app.request_lines set status='removed'") && params[0] === "packaging-line-1",
    );
    expect(removal).toBeDefined();
  });

  it("skips the address entirely when it is not configured as required for the chosen modality (regression)", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_fulfillment",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // update commercial_requests.fulfillment_type
        .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1", fulfillment_type: "pickup", variant_id: null }] }) // syncPackagingFee: no packaging fee configured (D-104)
        .mockResolvedValueOnce({ rows: [] }) // recalculate(): totals update
        .mockResolvedValueOnce({ rows: [] }) // step() -> awaiting_confirmation
        .mockResolvedValueOnce({
          rows: [
            {
              description_snapshot: "Tacos de birria (Orden de 3)",
              quantity: "1",
              line_total_minor: "2290000",
              total_minor: "2290000",
              currency: "COP",
            },
          ],
        }) // cart() select for the summary
        .mockResolvedValueOnce({ rows: [] }), // cart() modifiers select
    };

    const reply = await service([]).resolve(client as never, {
      ...input,
      body: "Recoger en el local",
      understanding: fulfillmentUnderstanding("fulfillment.pickup"),
    });

    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("update app.conversation_workflows") &&
          (params as unknown[])?.[1] === "awaiting_confirmation",
      ),
    ).toBe(true);
    expect(reply?.body).toContain("¿Confirmas el pedido?");
    // D-046: order confirmation ships as tappable WhatsApp buttons, not
    // just text asking the customer to type sí/no.
    expect(reply?.responsePlan).toEqual(
      expect.objectContaining({
        kind: "composite",
        interactive: expect.objectContaining({
          type: "buttons",
          options: [
            expect.objectContaining({ id: "confirm:yes", title: "Sí, confirmar" }),
            expect.objectContaining({ id: "confirm:no", title: "Corregir" }),
            expect.objectContaining({ id: "cart:cancel_order", title: "Cancelar pedido" }),
          ],
        }),
      }),
    );
  });

  it("does not cancel the order when the customer taps 'Corregir' at the final review — offers to change something instead", async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            id: "workflow-1",
            commercial_request_id: "request-1",
            step: "awaiting_confirmation",
            context: {},
          },
        ],
      }),
    };
    const understanding = await new DeterministicUnderstandingProvider().understand({
      message: "Corregir",
      configuredLocale: "es",
      handoffKeywords: [],
      timezone: "America/Bogota",
      interactiveSelectionId: "confirm:no",
    });

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Corregir",
      understanding,
    });

    expect(reply?.body).toBe("¿Qué deseas cambiar?");
    // "esto debería ser opciones" — this used to be plain text asking the
    // customer to type an answer; now it's a tappable list, same "title
    // matches the existing change* rule pattern" convention as every other
    // interactive in this file.
    expect(
      reply?.responsePlan?.kind === "localized_template" &&
        reply.responsePlan.interactive,
    ).toEqual({
      type: "list",
      body: "",
      buttonLabel: "Elegir",
      options: [
        // "debió darme la opción de agregar más productos" — live finding,
        // "Corregir" used to only offer to modify what was already in the
        // cart, with no way back to adding another item.
        { id: "cart:add_item", title: "Otro producto" },
        { id: "change:product", title: "Cambiar producto" },
        { id: "change:remove", title: "Quitar producto" },
        { id: "change:quantity", title: "Cambiar cantidad" },
        { id: "change:fulfillment", title: "Cambiar entrega" },
        { id: "change:address", title: "Cambiar dirección" },
      ],
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("status='cancelled'"),
      ),
    ).toBe(false);
  });

  it("cancels the order when the customer taps 'Cancelar pedido' at the final review", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_confirmation",
              context: {},
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };
    const understanding = await new DeterministicUnderstandingProvider().understand({
      message: "Cancelar pedido",
      configuredLocale: "es",
      handoffKeywords: [],
      timezone: "America/Bogota",
    });

    const reply = await service().resolve(client as never, {
      ...input,
      body: "Cancelar pedido",
      understanding,
    });

    expect(reply?.body).toBe("Proceso cancelado. No se realizó ningún cobro.");
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("status='cancelled'"),
      ),
    ).toBe(true);
  });

  it("asks for the fulfillment modality after the name is answered, instead of skipping straight to confirmation (regression)", async () => {
    // Regression guard: context.fulfillment is unset right after answering
    // the name step. A prior bug passed String(context.fulfillment) to
    // getPendingRequirements, which silently turned `undefined` into the
    // 3-character string "undefined" instead of `null` — the real SQL then
    // failed to match the wildcard '*' rows and returned [], so the flow
    // skipped straight to awaiting_confirmation without ever asking for
    // delivery/pickup/on-site. Found via live conversation testing.
    // The fix resolves fulfillment before ever consulting pending
    // requirements, so getPendingRequirements should not be called at all
    // for this turn — asserted below via toHaveBeenCalledTimes(0).
    const getPendingRequirements = jest.fn().mockResolvedValue([]);
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_requirement:name",
              context: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // update contacts.display_name
        .mockResolvedValueOnce({ rows: [] }) // step() -> awaiting_fulfillment
        .mockResolvedValueOnce({ rows: [{ enabled: true }] }) // fulfillmentReply: delivery capability
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service(
      [],
      { getPendingRequirements } as never,
    ).resolve(client as never, {
      ...input,
      body: "Carlos Ramírez",
      understanding: fulfillmentUnderstanding(null as never),
    });

    expect(getPendingRequirements).not.toHaveBeenCalled();
    // D-046 phase 2: fulfillment modality is now tappable buttons.
    expect(reply?.responsePlan).toEqual(
      expect.objectContaining({
        kind: "localized_template",
        template: { namespace: "commercial", key: "fulfillment" },
        values: {},
        interactive: expect.objectContaining({
          type: "buttons",
          options: [
            expect.objectContaining({ id: "fulfillment:delivery" }),
            expect.objectContaining({ id: "fulfillment:pickup" }),
            expect.objectContaining({ id: "fulfillment:on_site" }),
          ],
        }),
      }),
    );
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("update app.conversation_workflows") &&
          (params as unknown[])?.[1] === "awaiting_fulfillment",
      ),
    ).toBe(true);
  });

  it("asks for a custom configured requirement after fulfillment is chosen", async () => {
    const vehicleRequirement: PendingRequirement = {
      id: "req-vehicle",
      fieldKey: "vehicle_type",
      dataType: "select",
      isRequired: true,
      displayOrder: 20,
      validationRule: {},
      sensitivity: "none",
      requiresConfirmation: false,
      reuseFromContactMemory: false,
      label: "¿Qué tipo de vehículo tienes?",
      helpText: null,
      options: [
        { value: "car", label: "Carro" },
        { value: "motorcycle", label: "Moto" },
      ],
    };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "workflow-1",
              commercial_request_id: "request-1",
              step: "awaiting_fulfillment",
              context: {},
            },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    const reply = await service([vehicleRequirement]).resolve(client as never, {
      ...input,
      body: "Domicilio",
      understanding: fulfillmentUnderstanding("fulfillment.delivery"),
    });

    // D-046 phase 2: a select requirement with <=3 options ships as
    // tappable WhatsApp buttons, not enumerated text.
    expect(reply?.body).toBe("¿Qué tipo de vehículo tienes?");
    expect(reply?.responsePlan).toEqual(
      expect.objectContaining({
        kind: "verified_content",
        body: reply?.body,
        interactive: expect.objectContaining({
          type: "buttons",
          options: [
            expect.objectContaining({ id: "1", title: "Carro" }),
            expect.objectContaining({ id: "2", title: "Moto" }),
          ],
        }),
      }),
    );
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("update app.conversation_workflows") &&
          (params as unknown[])?.[1] === "awaiting_requirement:vehicle_type",
      ),
    ).toBe(true);
  });

  describe("D-040 multi-entity extraction", () => {
    const filteringRequirements = (all: PendingRequirement[]) =>
      ({
        getPendingRequirements: jest.fn(
          (
            _client: unknown,
            _tenantId: string,
            _operationType: string,
            _fulfillmentType: string,
            alreadyFilled: string[],
          ) =>
            Promise.resolve(
              all.filter((r) => !alreadyFilled.includes(r.fieldKey)),
            ),
        ),
      }) as never;

    it("fills two custom requirements from one message during fulfillment resolution", async () => {
      const vehicleRequirement: PendingRequirement = {
        id: "req-vehicle",
        fieldKey: "vehicle_type",
        dataType: "select",
        isRequired: true,
        displayOrder: 20,
        validationRule: {},
        sensitivity: "none",
        requiresConfirmation: false,
        reuseFromContactMemory: false,
        label: "¿Qué tipo de vehículo tienes?",
        helpText: null,
        options: [
          { value: "car", label: "Carro" },
          { value: "truck", label: "Camioneta" },
        ],
      };
      const waxRequirement: PendingRequirement = {
        id: "req-wax",
        fieldKey: "wants_wax",
        dataType: "boolean",
        isRequired: true,
        displayOrder: 30,
        validationRule: {},
        sensitivity: "none",
        requiresConfirmation: false,
        reuseFromContactMemory: false,
        label: "¿Deseas encerado?",
        helpText: null,
        options: [],
      };
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "workflow-1",
                commercial_request_id: "request-1",
                step: "awaiting_fulfillment",
                context: {},
              },
            ],
          })
          .mockResolvedValue({ rows: [] }),
      };

      const reply = await service(
        [],
        filteringRequirements([vehicleRequirement, waxRequirement]),
      ).resolve(client as never, {
        ...input,
        body: "domicilio, camioneta, sin cera",
        understanding: {
          ...fulfillmentUnderstanding("fulfillment.delivery"),
          entities: { response: "negative" },
        },
      });

      // Both custom fields were resolved from one message; nothing left to
      // ask, so the flow proceeds straight to the order confirmation.
      expect(reply?.body).toContain("¿Confirmas el pedido?");
      expect(
        client.query.mock.calls.some(
          ([sql, params]) =>
            String(sql).includes("update app.conversation_workflows") &&
            (params as unknown[])?.[1] === "awaiting_confirmation",
        ),
      ).toBe(true);
    });

    it("does not auto-fill an ambiguous custom requirement, falls back to asking", async () => {
      const vehicleRequirement: PendingRequirement = {
        id: "req-vehicle",
        fieldKey: "vehicle_type",
        dataType: "select",
        isRequired: true,
        displayOrder: 20,
        validationRule: {},
        sensitivity: "none",
        requiresConfirmation: false,
        reuseFromContactMemory: false,
        label: "¿Qué tipo de vehículo tienes?",
        helpText: null,
        options: [
          { value: "car", label: "Carro" },
          { value: "truck", label: "Camioneta" },
        ],
      };
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "workflow-1",
                commercial_request_id: "request-1",
                step: "awaiting_fulfillment",
                context: {},
              },
            ],
          })
          .mockResolvedValue({ rows: [] }),
      };

      const reply = await service([vehicleRequirement]).resolve(
        client as never,
        {
          ...input,
          body: "no se, tal vez carro o camioneta",
          understanding: fulfillmentUnderstanding("fulfillment.delivery"),
        },
      );

      expect(reply?.body).toBe("¿Qué tipo de vehículo tienes?");
      expect(
        client.query.mock.calls.some(
          ([sql, params]) =>
            String(sql).includes("update app.conversation_workflows") &&
            (params as unknown[])?.[1] === "awaiting_requirement:vehicle_type",
        ),
      ).toBe(true);
    });

    it("routes an auto-filled sensitive requirement through explicit confirmation instead of accepting it directly", async () => {
      const sensitiveRequirement: PendingRequirement = {
        id: "req-allergy",
        fieldKey: "allergy_flag",
        dataType: "boolean",
        isRequired: true,
        displayOrder: 20,
        validationRule: {},
        sensitivity: "sensitive",
        requiresConfirmation: true,
        reuseFromContactMemory: false,
        label: "¿Tiene alguna alergia declarada?",
        helpText: null,
        options: [],
      };
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "workflow-1",
                commercial_request_id: "request-1",
                step: "awaiting_fulfillment",
                context: {},
              },
            ],
          })
          .mockResolvedValue({ rows: [] }),
      };

      const reply = await service([sensitiveRequirement]).resolve(
        client as never,
        {
          ...input,
          body: "domicilio",
          understanding: {
            ...fulfillmentUnderstanding("fulfillment.delivery"),
            entities: { response: "affirmative" },
          },
        },
      );

      expect(reply?.body).toBe(
        "¿Tiene alguna alergia declarada? true. ¿Es correcto?",
      );
      expect(
        client.query.mock.calls.some(
          ([sql, params]) =>
            String(sql).includes("update app.conversation_workflows") &&
            (params as unknown[])?.[1] ===
              "awaiting_requirement:allergy_flag:confirm",
        ),
      ).toBe(true);
    });

    it("moves a confirmed sensitive value into context.values on an affirmative reply", async () => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "workflow-1",
                commercial_request_id: "request-1",
                step: "awaiting_requirement:allergy_flag:confirm",
                context: { fulfillment: "delivery", pendingConfirmations: { allergy_flag: "true" } },
              },
            ],
          })
          .mockResolvedValue({ rows: [] }),
      };

      const reply = await service([]).resolve(client as never, {
        ...input,
        body: "si",
        understanding: {
          ...fulfillmentUnderstanding("fulfillment.delivery"),
          requestedAction: null,
          entities: { response: "affirmative" },
        },
      });

      expect(reply?.body).toContain("¿Confirmas el pedido?");
      const stepCall = client.query.mock.calls.find(
        ([sql]) => typeof sql === "string" && sql.includes("update app.conversation_workflows"),
      );
      expect(JSON.parse(stepCall?.[1][2] as string)).toMatchObject({
        values: { allergy_flag: "true" },
      });
    });
  });

  it("parses recommendation actions only from stable interactive identifiers", () => {
    const id = "0194f100-0000-7000-8000-000000000001";
    expect(parseRecommendationAction(`rec:add:${id}`)).toEqual({
      action: "add",
      eventId: id,
    });
    expect(parseRecommendationAction("Sí, agregar")).toBeNull();
  });

  it("offers the same cart-action buttons after declining a recommendation as after any other cart change", async () => {
    const reject = jest.fn().mockResolvedValue(true);
    const flowService = new CommercialFlowService(
      { suggest: jest.fn().mockResolvedValue(null), reject, accept: jest.fn() } as never,
      { getPendingRequirements: jest.fn().mockResolvedValue([]) } as never,
    );
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            id: "workflow-1",
            commercial_request_id: "request-1",
            step: "awaiting_more_items",
            context: {},
          },
        ],
      }),
    };
    const eventId = "0194f100-0000-7000-8000-000000000001";
    const understanding = await new DeterministicUnderstandingProvider().understand({
      message: "No, gracias",
      configuredLocale: "es",
      handoffKeywords: [],
      timezone: "America/Bogota",
      interactiveSelectionId: `rec:reject:${eventId}`,
    });

    const reply = await flowService.resolve(client as never, {
      ...input,
      body: "No, gracias",
      understanding,
    });

    expect(reject).toHaveBeenCalledWith(client, eventId);
    expect(reply?.body).toBe("Perfecto, no la agregaré. ¿Quieres agregar algo más?");
    expect(
      reply?.responsePlan?.kind === "localized_template" && reply.responsePlan.interactive,
    ).toEqual({
      type: "buttons",
      body: "",
      options: [
        { id: "cart:add_item", title: "Otro producto" },
        { id: "cart:finish_items", title: "Listo" },
      ],
    });
  });
});
