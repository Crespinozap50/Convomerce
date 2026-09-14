import { Injectable } from "@nestjs/common";
import {
  classifyFlowCommand,
  parseQuantity,
  parseRecommendationAction,
} from "../commerce-events/commercial-flow.service";
import { classifyMessage } from "../commerce-events/deterministic-reply.service";
import {
  matchesConversationRule,
  matchesResponse,
  mergedLanguageMap,
  mergedLanguageTerms,
} from "../localization/conversation-copy";
import { normalizeLocale } from "../localization/localization";
import { extractRequestedDate } from "./date-entity.extractor";
import {
  ConversationUnderstanding,
  ConversationUnderstandingProvider,
  UnderstandingInput,
} from "./conversation-understanding.types";

const PROVIDER_VERSION = "deterministic-v1";
const ORDINAL_WORD_INDEX: Record<string, number> = {
  primera: 1,
  primero: 1,
  primer: 1,
  segunda: 2,
  segundo: 2,
  tercera: 3,
  tercero: 3,
  cuarta: 4,
  cuarto: 4,
  quinta: 5,
  quinto: 5,
};
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

@Injectable()
export class DeterministicUnderstandingProvider implements ConversationUnderstandingProvider {
  async understand(
    input: UnderstandingInput,
  ): Promise<ConversationUnderstanding> {
    const text = normalize(input.message);
    const recommendation = parseRecommendationAction(
      input.interactiveSelectionId,
    );
    const command = classifyFlowCommand(input.message);
    const appointment = this.appointmentAction(text);
    // A tapped fulfillment button (D-046 phase 2) carries a stable id; try
    // it before falling back to matching the reconstructed title text.
    const fulfillment =
      this.fulfillmentActionFromId(input.interactiveSelectionId) ??
      this.fulfillmentAction(text);
    const explicitPurchase = matchesConversationRule(text, "purchase");
    const startsOrder =
      explicitPurchase ||
      (matchesConversationRule(text, "directDesire") &&
        !matchesConversationRule(text, "informational"));
    // A customer explicitly asking to be recommended something ("recomiéndame
    // una entrada") is not a purchase verb and doesn't name a product, so it
    // never sets startsOrder/command/fulfillment on its own — without this it
    // fell through to plain item-name matching and failed.
    const recommendationRequested = matchesConversationRule(
      text,
      "recommendationRequest",
    );
    const replyIntent = classifyMessage(
      input.message,
      input.handoffKeywords,
      input.configuredLocale,
    );
    const requestedAction = recommendation
      ? `recommendation.${recommendation.action}`
      : (appointment ??
        command ??
        fulfillment ??
        (recommendationRequested
          ? "request_recommendation"
          : startsOrder
            ? "start_order"
            : replyIntent === "fallback"
              ? null
              : replyIntent));
    const intent = appointment
      ? "appointment"
      : recommendation ||
          command ||
          fulfillment ||
          recommendationRequested ||
          startsOrder
        ? "order"
        : replyIntent;
    const entities: Record<string, unknown> = { normalizedText: text };
    if (command) entities.command = command;
    if (replyIntent === "greeting") entities.hasGreeting = true;
    if (explicitPurchase) entities.explicitPurchase = true;
    if (recommendation) {
      entities.recommendationAction = recommendation.action;
      entities.recommendationEventId = recommendation.eventId;
    }
    // A tapped WhatsApp reply button carries a stable id independent of its
    // (possibly localized) title, so it's checked before falling back to
    // matching the reconstructed message text — see selectionAsNaturalText.
    if (input.interactiveSelectionId === "confirm:yes")
      entities.response = "affirmative";
    else if (input.interactiveSelectionId === "confirm:no")
      entities.response = "negative";
    else if (matchesResponse(input.message, "affirmative"))
      entities.response = "affirmative";
    else if (matchesResponse(input.message, "negative"))
      entities.response = "negative";
    const quantity = this.explicitQuantity(text);
    if (quantity !== null) entities.quantity = quantity;
    const requestedDate = extractRequestedDate(input.message, input.timezone);
    if (requestedDate) entities.requestedDate = requestedDate;
    // Same reasoning: a tapped list row's id is the option's 1-based index
    // itself, so it's tried first, before the bare-digit-body fallback.
    // D-163 (docs/decisions.md) live finding: a customer replying to a
    // just-shown list very naturally writes "la 2", "opción 2", or "la
    // segunda" instead of a bare digit — none of those matched before,
    // silently falling through to a brand-new item-name search over the
    // whole catalog instead of resolving against the list they were just
    // shown (flow.step === "selecting_item"'s tiedItems, shared by both a
    // name-matching tie and a consultative-recommendation list — see
    // tryConsultativeRecommendation).
    const digitSelection =
      input.interactiveSelectionId?.match(/^(\d{1,2})$/)?.[1] ??
      text.match(/^\s*(?:la|el|opcion|numero|num)?\s*(\d{1,2})\s*$/)?.[1];
    const ordinalWordSelection = digitSelection
      ? null
      : text.match(
          /^\s*(?:la|el)?\s*(primera|primero|primer|segunda|segundo|tercera|tercero|cuarta|cuarto|quinta|quinto)\s*$/,
        )?.[1];
    const selectionIndex = digitSelection
      ? Number(digitSelection)
      : ordinalWordSelection
        ? ORDINAL_WORD_INDEX[ordinalWordSelection]
        : undefined;
    if (selectionIndex) entities.selectionIndex = selectionIndex;
    if (matchesConversationRule(text, "anyResource"))
      entities.anyResource = true;
    entities.searchTerms = this.searchTerms(text);
    return {
      locale: normalizeLocale(input.configuredLocale),
      localeSource: input.localeSource ?? "tenant_default",
      intent,
      confidence: intent === "fallback" ? 0 : recommendation ? 1 : 0.9,
      entities,
      requestedAction,
      missingInformation: [],
      requiresHuman: replyIntent === "handoff" || command === "handoff",
      provider: "deterministic",
      providerVersion: PROVIDER_VERSION,
    };
  }

  private appointmentAction(text: string): string | null {
    if (
      matchesConversationRule(text, "reschedule") &&
      matchesConversationRule(text, "appointmentNoun")
    )
      return "reschedule";
    if (
      matchesConversationRule(text, "appointmentCancel") &&
      matchesConversationRule(text, "appointmentNoun")
    )
      return "cancel_appointment";
    if (matchesConversationRule(text, "appointmentWant"))
      return "book_appointment";
    if (
      matchesConversationRule(text, "appointmentQuestion") &&
      matchesConversationRule(text, "appointmentNoun")
    )
      return "view_appointment";
    return null;
  }

  private fulfillmentAction(text: string): string | null {
    // Found writing the naturalness eval suite: "no delivery, I'll pick it
    // up instead" (or "no quiero domicilio, prefiero recogerlo") mentions
    // the delivery word only to decline it, but fulfillmentDelivery matched
    // on bare keyword presence and won before fulfillmentPickup ever got
    // checked — the exact opposite of what the customer asked for.
    // fulfillmentDeliveryDeclined narrowly excludes just that negated case;
    // it does not attempt general negation handling elsewhere in this file.
    if (
      !matchesConversationRule(text, "fulfillmentDeliveryDeclined") &&
      matchesConversationRule(text, "fulfillmentDelivery")
    )
      return "fulfillment.delivery";
    if (matchesConversationRule(text, "fulfillmentPickup"))
      return "fulfillment.pickup";
    if (matchesConversationRule(text, "fulfillmentOnSite"))
      return "fulfillment.on_site";
    return null;
  }
  private fulfillmentActionFromId(id?: string): string | null {
    return id === "fulfillment:delivery"
      ? "fulfillment.delivery"
      : id === "fulfillment:pickup"
        ? "fulfillment.pickup"
        : id === "fulfillment:on_site"
          ? "fulfillment.on_site"
          : null;
  }

  private explicitQuantity(text: string): number | null {
    if (/\b\d{1,2}\b/.test(text)) return parseQuantity(text);
    const hasWord = Object.keys(mergedLanguageMap("quantityWords")).some(
      (word) => new RegExp(`\\b${word}\\b`).test(text),
    );
    return hasWord ? parseQuantity(text) : null;
  }

  private searchTerms(text: string): string[] {
    const ignored = new Set(mergedLanguageTerms("itemStopWords"));
    // A pure number survives the length filter even at 1-2 digits ("16",
    // "12") — otherwise a size like "16 oz" is silently dropped before it
    // ever reaches item/variant matching, and "¿cuál de las dos aguas
    // frescas?" gets asked back even though the customer already named the
    // size. Found live: "Quiero una agua fresca de 16 oz" still tied
    // between both sizes.
    return [
      ...new Set(
        text
          .split(" ")
          .filter((term) => (term.length > 2 || /^\d+$/.test(term)) && !ignored.has(term)),
      ),
    ];
  }
}
