import { DeterministicUnderstandingProvider } from "./deterministic-understanding.provider";

describe("DeterministicUnderstandingProvider", () => {
  const provider = new DeterministicUnderstandingProvider();
  const base = {
    configuredLocale: "en-US",
    handoffKeywords: [],
    timezone: "America/Bogota",
  };

  it("returns a stable structured order command", async () => {
    const result = await provider.understand({
      ...base,
      message: "Cambiar cantidad a tres tacos",
      configuredLocale: "es-CO",
    });
    expect(result).toMatchObject({
      locale: "es-CO",
      intent: "order",
      requestedAction: "change_quantity",
      confidence: 0.9,
      entities: { command: "change_quantity", quantity: 3 },
      provider: "deterministic",
    });
  });

  it("preserves a greeting signal when the same message starts an order", async () => {
    const result = await provider.understand({
      ...base,
      message: "Hola, quiero hacer un pedido",
      configuredLocale: "es-CO",
    });
    expect(result).toMatchObject({
      intent: "order",
      requestedAction: "start_order",
      entities: { hasGreeting: true },
    });
  });

  it("keeps an explicit purchase intent even when the customer asks which item to choose", async () => {
    const result = await provider.understand({
      ...base,
      message: "Quiero pedir, pero no sé cuál taco elegir",
      configuredLocale: "es-CO",
    });

    expect(result).toMatchObject({
      intent: "order",
      requestedAction: "start_order",
      entities: { explicitPurchase: true },
    });
  });

  it("does not read a question about an existing order as a request to place one (D-078 follow-up)", async () => {
    // Found live testing D-078: "purchase" matched the bare noun "pedido"
    // ("an order") the same as the verb "pedir" ("to order"), so "¿Cuánto
    // tarda un pedido?" read as an explicit purchase start instead of a
    // preparation-time question. "pedido"/"orden" were removed from the
    // pattern — only the action verbs (pedir/ordenar/comprar) count, since
    // those unambiguously signal intent regardless of question words (see
    // the "keeps an explicit purchase intent..." test above).
    const result = await provider.understand({
      ...base,
      message: "¿Cuánto tarda un pedido?",
      configuredLocale: "es-CO",
    });

    expect(result.requestedAction).not.toBe("start_order");
    expect(result.intent).not.toBe("order");
    expect(result.entities.explicitPurchase).toBeUndefined();
  });

  it("recognizes an explicit request for a recommendation with no product named", async () => {
    const result = await provider.understand({
      ...base,
      message: "Quisiera que me recomendaras una entrada y un plato fuerte",
      configuredLocale: "es-CO",
    });
    expect(result).toMatchObject({
      intent: "order",
      requestedAction: "request_recommendation",
    });
  });

  it("recognizes an English request for a recommendation", async () => {
    const result = await provider.understand({
      ...base,
      message: "Can you suggest something for me?",
    });
    expect(result).toMatchObject({
      intent: "order",
      requestedAction: "request_recommendation",
    });
  });

  it("recognizes an appointment without tenant-specific rules", async () => {
    const result = await provider.understand({
      ...base,
      message: "I need to book an appointment",
    });
    expect(result).toMatchObject({
      intent: "appointment",
      requestedAction: "book_appointment",
      requiresHuman: false,
    });
  });

  it("gives stable interactive actions precedence over visible copy", async () => {
    const eventId = "0194f000-0000-7000-8000-000000000001";
    const result = await provider.understand({
      ...base,
      message: "anything",
      configuredLocale: "en",
      interactiveSelectionId: `rec:add:${eventId}`,
    });
    expect(result).toMatchObject({
      intent: "order",
      requestedAction: "recommendation.add",
      confidence: 1,
      entities: { recommendationEventId: eventId },
    });
  });

  it("resolves confirm:yes/confirm:no button taps to affirmative/negative even when the title text alone wouldn't match (D-046)", async () => {
    const yes = await provider.understand({
      ...base,
      message: "Sí",
      configuredLocale: "es-CO",
      interactiveSelectionId: "confirm:yes",
    });
    expect(yes.entities.response).toBe("affirmative");

    const no = await provider.understand({
      ...base,
      message: "No",
      configuredLocale: "es-CO",
      interactiveSelectionId: "confirm:no",
    });
    expect(no.entities.response).toBe("negative");
  });

  it("resolves a tapped list row's id to selectionIndex the same way a typed number would (D-046)", async () => {
    const result = await provider.understand({
      ...base,
      message: "9:00 a.m.",
      configuredLocale: "es-CO",
      interactiveSelectionId: "3",
    });
    expect(result.entities.selectionIndex).toBe(3);
  });

  it("marks unknown messages with zero confidence", async () => {
    const result = await provider.understand({
      ...base,
      message: "xyzzy plugh",
      configuredLocale: "fr-FR",
    });
    expect(result).toMatchObject({
      locale: "fr-FR",
      intent: "fallback",
      confidence: 0,
      requestedAction: null,
    });
  });

  it("normalizes confirmation and fulfillment answers", async () => {
    const confirmation = await provider.understand({
      ...base,
      message: "Sí, confirmo",
      configuredLocale: "es-CO",
    });
    const fulfillment = await provider.understand({
      ...base,
      message: "Delivery",
    });
    expect(confirmation.entities.response).toBe("affirmative");
    expect(fulfillment).toMatchObject({
      intent: "order",
      requestedAction: "fulfillment.delivery",
    });
  });

  it("understands natural English pickup phrasing", async () => {
    const result = await provider.understand({
      ...base,
      message: "I will pick it up",
    });
    expect(result).toMatchObject({
      intent: "order",
      requestedAction: "fulfillment.pickup",
    });
  });

  // Found writing the naturalness eval suite (D-111): "delivery" only
  // appears here to decline it — fulfillmentDelivery matched on bare
  // keyword presence and won before fulfillmentPickup was even checked,
  // the opposite of what the customer asked for.
  it("does not read a declined delivery mention as a delivery request when pickup is named instead", async () => {
    const english = await provider.understand({
      ...base,
      message: "No delivery please, I will pick it up instead",
    });
    expect(english).toMatchObject({ intent: "order", requestedAction: "fulfillment.pickup" });
    const spanish = await provider.understand({
      ...base,
      configuredLocale: "es-CO",
      message: "No quiero domicilio, prefiero recogerlo en el local",
    });
    expect(spanish).toMatchObject({ intent: "order", requestedAction: "fulfillment.pickup" });
  });

  // Found in the same session: the imperative "Agrega una bebida" (how a
  // customer actually phrases it) didn't match addItem, only the infinitive
  // "agregar" did — fell through to fallback instead of add_item.
  it("recognizes the imperative form of 'add an item' in Spanish, not only the infinitive", async () => {
    const result = await provider.understand({
      ...base,
      configuredLocale: "es-CO",
      message: "Agrega también una bebida",
    });
    expect(result).toMatchObject({ intent: "order", requestedAction: "add_item" });
  });

  it("extracts selection and catalog-search entities before domain routing", async () => {
    const selection = await provider.understand({ ...base, message: "3" });
    const product = await provider.understand({
      ...base,
      message: "Quiero pedir tacos de birria",
      configuredLocale: "es-CO",
    });
    expect(selection.entities.selectionIndex).toBe(3);
    expect(product.entities.searchTerms).toEqual(
      expect.arrayContaining(["tacos", "birria"]),
    );
    expect(product.entities.searchTerms).not.toContain("quiero");
  });
});
