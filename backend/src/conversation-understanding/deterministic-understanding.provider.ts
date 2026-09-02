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
    const selectionIndex =
      input.interactiveSelectionId?.match(/^(\d{1,2})$/)?.[1] ??
      text.match(/^\s*(\d{1,2})\s*$/)?.[1];
    if (selectionIndex) entities.selectionIndex = Number(selectionIndex);
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
    if (matchesConversationRule(text, "fulfillmentDelivery"))
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
    return [
      ...new Set(
        text.split(" ").filter((term) => term.length > 2 && !ignored.has(term)),
      ),
    ];
  }
}
