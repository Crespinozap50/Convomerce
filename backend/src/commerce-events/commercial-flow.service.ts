import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { DeterministicReply } from "./deterministic-reply.service";
import { RecommendationService } from "../recommendations/recommendation.service";
import { catalogFor, ConversationLocale, formatMoney } from "../localization/localization";
import {
  commercialCopy,
  CommercialCopyKey,
  matchesConversationRule,
  mergedLanguageMap,
  mergedLanguageTerms,
} from "../localization/conversation-copy";
import { UnderstoodFlowInput } from "./understood-flow-input";
import { ResponsePlan } from "../response-composition/response-plan.types";
import { InteractiveMessage } from "../interactive-messages/interactive-message.types";
import { unprocessable } from "../observability/http-errors";
import { OperationalRequirementsService } from "../operational-requirements/operational-requirements.service";
import {
  extractPendingRequirementValues,
  isAddressDetailedEnough,
  nextPendingStep,
  PendingRequirement,
  resolveBooleanRequirementValue,
  validateRequirementValue,
} from "./requirement-loop";
export { isAddressDetailedEnough } from "./requirement-loop";

type Locale = ConversationLocale;
type Workflow = {
  id: string;
  commercial_request_id: string;
  step: string;
  context: Record<string, unknown>;
};
type Item = {
  item_id: string;
  variant_id: string;
  name: string;
  variant_name: string;
  price_minor: string;
  currency: string;
  // Only ever populated by catalogItems() (used to group catalogChoiceReply
  // into a category picker past WhatsApp's 10-row cap — D-102) — optional
  // so the several places that build an Item by hand (e.g. accepting a
  // recommendation) or select it from cartItems()/matchCartItemCandidates()
  // don't need to carry a category they never use.
  category?: string | null;
};
type ModifierOption = {
  option_id: string;
  group_id: string;
  selection_type: "single" | "multiple";
  name: string;
  price_delta_minor: string;
  currency: string;
  // How many of this option are already on the line ("0" from itemModifiers,
  // where nothing has been picked yet). Tapping a 'multiple' option again
  // increments this instead of removing it from what's offered — see
  // remainingModifiers and addModifier.
  quantity: string;
  // Group-level "pick exactly N" constraints (e.g. Santos Tacos' "elige tus
  // 3 tacos" package) — 0/null for every group before D-099, so existing
  // groups are unaffected. group_picked is the total quantity already
  // picked across the whole group (not just this option), always "0" from
  // itemModifiers since the line was just created.
  min_selections: string;
  max_selections: string | null;
  group_name: string;
  group_picked: string;
};
type CommercialSegment =
  | {
      kind: "template";
      template: { namespace: "commercial"; key: CommercialCopyKey };
      values?: Record<string, string | number>;
    }
  | { kind: "verified_text"; text: string }
  | { kind: "line_break" };
type PlannedContent = {
  body: string;
  plan: Omit<Extract<ResponsePlan, { kind: "composite" }>, "segments"> & {
    segments: CommercialSegment[];
  };
};
type FlowCommand =
  | "catalog"
  | "view_order"
  | "add_item"
  | "remove_item"
  | "change_quantity"
  | "finish_items"
  | "help"
  | "handoff"
  | "cancel"
  | "back"
  | "change_product"
  | "change_fulfillment"
  | "change_address"
  | "change"
  | null;
const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// The "informational" rule (saber/cu\u00e1l/cu\u00e1nto/precio/gluten/tiene/tienen...)
// is a hand-picked keyword list \u2014 the same pattern that made D-078's shared
// global vocabulary keep colliding with tenant-specific content, just here
// for "is this a question" instead of "which FAQ". Any literal "?" is a far
// more general, keyword-free signal that doesn't need to enumerate every
// possible question word ("\u00bfLos tacos pican?", "\u00bfCu\u00e1nto tarda un pedido?")
// \u2014 checked on the raw body since norm() strips punctuation. Kept alongside
// the keyword rule to still catch a punctuation-less question ("cuanto
// cuesta la birria", common with real customers).
const looksLikeQuestion = (rawBody: string) =>
  rawBody.includes("?") || matchesConversationRule(norm(rawBody), "informational");
// Naive Spanish singularizer so "quesadillas" matches a catalog item named
// "Quesadilla" in matchItem's token scoring; menu items are stored singular
// but customers naturally order in plural ("quiero 2 quesadillas").
const singularize = (word: string) => {
  if (word.length <= 3) return word;
  if (/[aeiou]s$/.test(word)) return word.slice(0, -1);
  if (/[^aeiou]es$/.test(word)) return word.slice(0, -2);
  return word;
};
export const classifyFlowCommand = (value: string): FlowCommand => {
  const text = norm(value);
  if (matchesConversationRule(text, "viewOrder")) return "view_order";
  if (matchesConversationRule(text, "addItem")) return "add_item";
  if (matchesConversationRule(text, "removeItem")) return "remove_item";
  if (matchesConversationRule(text, "changeQuantity")) return "change_quantity";
  if (matchesConversationRule(text, "finishItems")) return "finish_items";
  if (matchesConversationRule(text, "catalog")) return "catalog";
  if (matchesConversationRule(text, "handoff")) return "handoff";
  if (matchesConversationRule(text, "cancel")) return "cancel";
  if (matchesConversationRule(text, "changeProduct")) return "change_product";
  if (matchesConversationRule(text, "changeFulfillment"))
    return "change_fulfillment";
  if (matchesConversationRule(text, "changeAddress")) return "change_address";
  if (matchesConversationRule(text, "back")) return "back";
  if (matchesConversationRule(text, "help")) return "help";
  if (matchesConversationRule(text, "change")) return "change";
  return null;
};
// A number right after "de"/"of" ("agua fresca de 16 oz") names a size, not
// a quantity — the catalog's own variant names use exactly this
// "de <number> <unit>" shape (Vaso de 16 oz, Ritual de 50 minutos), and a
// customer naming a size in the same message phrases it the same way. A
// real quantity is never phrased "de 2 tacos" — it's "2 tacos" — so this
// never excludes an actual requested quantity. Found live: "Quiero una
// agua fresca de 16 oz" added 16 of them instead of 1, once the variant
// scoring fix below started actually resolving this message to an item
// instead of leaving it as an unresolved tie.
const SIZE_QUALIFIER_NUMBER = /\b(?:de|of)\s+(\d{1,2})\b/;
export const parseQuantity = (value: string) => {
  const text = norm(value);
  const sizeQualifier = text.match(SIZE_QUALIFIER_NUMBER);
  const withoutSize = sizeQualifier
    ? text.slice(0, sizeQualifier.index) + text.slice(sizeQualifier.index! + sizeQualifier[0].length)
    : text;
  const numeric = withoutSize.match(/\b(\d{1,2})\b/);
  if (numeric) return Math.min(99, Math.max(1, Number(numeric[1])));
  for (const [word, quantity] of Object.entries(
    mergedLanguageMap("quantityWords"),
  ))
    if (new RegExp(`\\b${word}\\b`).test(text)) return quantity;
  return 1;
};
// parseQuantity (and DeterministicUnderstandingProvider.explicitQuantity,
// which feeds it) reads a number anywhere in the message with no idea which
// catalog item it will eventually resolve to — a product whose own name
// carries a number ("Orden x 3 Tacos", a package deal) gets read as
// "quantity 3", tripling its price for a single package. Found live
// testing Santos Tacos' own package feature. Applied once the matched
// item's name is known, right before addItem() — generic across any
// catalog item whose name embeds a digit, not specific to one tenant or
// product: a genuinely repeated number ("Quiero 3 Orden x 3 Tacos") still
// isn't caught by this (parseQuantity only ever returns the first number it
// finds), so it's deliberately conservative — it only suppresses the
// single-number case, never invents a lower quantity than what
// parseQuantity actually found once a second, distinct number is present.
export const quantityExcludingItemName = (
  requestedQuantity: number,
  itemName: string,
): number => {
  if (requestedQuantity <= 1) return requestedQuantity;
  const nameNumbers: string[] = itemName.match(/\d{1,2}/g) ?? [];
  return nameNumbers.includes(String(requestedQuantity)) ? 1 : requestedQuantity;
};
export const parseRecommendationAction = (
  value?: string,
): { action: "add" | "reject"; eventId: string } | null => {
  const match = value?.match(/^rec:(add|reject):([0-9a-f-]{36})$/i);
  return match
    ? { action: match[1] as "add" | "reject", eventId: match[2] }
    : null;
};

@Injectable()
export class CommercialFlowService {
  constructor(
    private readonly recommendations: RecommendationService,
    private readonly requirements: OperationalRequirementsService,
  ) {}

  async resolve(
    client: PoolClient,
    input: UnderstoodFlowInput,
  ): Promise<DeterministicReply | null> {
    // A category tapped from categoryPickerReply() (D-102) — checked before
    // any workflow/command routing so it works the same whether it was
    // shown mid-order ("Otro producto") or from the very first unmatched-
    // product prompt, which deliberately creates no workflow row at all
    // (D-095). Resolved by id, not by reprocessing the tapped title as
    // text, since this file's normal item-matching never considers
    // category (only deterministic-reply.service.ts's sibling menu picker
    // needs the text-based trick, because it has no id-based dispatch of
    // its own to hook into).
    if (input.interactiveSelectionId?.startsWith("category:")) {
      const category = input.interactiveSelectionId.slice("category:".length);
      const reply = await this.categoryItemsReply(client, input.locale, input.timezone ?? "UTC", category);
      if (reply) return reply;
    }
    const active = await client.query<Workflow>(
      `select id,commercial_request_id,step,context from app.conversation_workflows where conversation_id=$1 and status='active'`,
      [input.conversationId],
    );
    const flow = active.rows[0];
    const recommendationAction = this.recommendationAction(input);
    if (flow && recommendationAction?.action === "add") {
      const accepted = await this.recommendations.accept(
        client,
        recommendationAction.eventId,
      );
      if (!accepted)
        return this.localizedReply(input.locale, "recommendationExpired");
      await this.addItem(client, input.tenantId, flow.commercial_request_id, {
        item_id: "",
        variant_id: accepted.variantId,
        name: accepted.itemName,
        variant_name: accepted.variantName,
        price_minor: accepted.priceMinor,
        currency: accepted.currency,
      });
      return this.afterCartChange(client, input, flow.commercial_request_id);
    }
    if (flow && recommendationAction?.action === "reject") {
      await this.recommendations.reject(client, recommendationAction.eventId);
      return this.moreItemsReply(input.locale, "recommendationRejected");
    }
    const command = this.command(input);
    const affirmative = input.understanding.entities.response === "affirmative";
    const negative = input.understanding.entities.response === "negative";
    // Checked before any command/step routing so an explicit "recommend me
    // something" is never swallowed by whichever item-matching step happens
    // to be active (e.g. selecting_item, which used to answer it with
    // itemUnknown — see the "S" conversation review).
    if (input.understanding.requestedAction === "request_recommendation") {
      return this.recommendationRequestReply(client, input.locale);
    }
    if (command === "handoff") return null;
    if (command === "help") return this.helpReply(input.locale);
    if (command === "catalog") return null;
    if (!flow && command === "cancel")
      return this.localizedReply(input.locale, "nothingToCancel");
    if (!flow) return this.startNewOrder(client, input);
    const globalResult = await this.handleGlobalCommand(client, input, flow, command, negative);
    if (globalResult !== undefined) return globalResult;
    if (flow.step === "selecting_replace_target") return this.handleSelectingReplaceTarget(client, input, flow);
    if (flow.step === "selecting_item") return this.handleSelectingItem(client, input, flow);
    if (flow.step === "awaiting_more_items") return this.handleAwaitingMoreItems(client, input, flow, affirmative);
    if (flow.step === "removing_item") return this.handleRemovingItem(client, input, flow);
    if (flow.step === "selecting_modifiers") return this.handleSelectingModifiers(client, input, flow, command);
    if (flow.step === "changing_quantity_item") return this.handleChangingQuantityItem(client, input, flow);
    if (flow.step === "awaiting_fulfillment") return this.handleAwaitingFulfillment(client, input, flow);
    if (flow.step.startsWith("awaiting_requirement:")) return this.handleAwaitingRequirement(client, input, flow, affirmative, negative);
    if (flow.step === "awaiting_confirmation") return this.handleAwaitingConfirmation(client, input, flow, affirmative, negative);
    return null;
  }

  private async startNewOrder(
    client: PoolClient,
    input: UnderstoodFlowInput,
  ): Promise<DeterministicReply | null> {
    const starts = input.understanding.requestedAction === "start_order";
    // Tried before the single-item match below and NOT gated behind the
    // bareNameStart eligibility check that follows — a product name can
    // itself collide with an unrelated word classifyMessage happens to
    // recognize (e.g. "3 tacos vegetarianos" contains "vegetarianos").
    // matchItemMentions() only ever returns non-null when 2+ segments each
    // carry real signal (a confident match or a genuine tie) — that's a
    // strong enough signal of ordering intent on its own, regardless of
    // what the rest of the message also mentions.
    const multi = await this.matchItemMentions(client, input.body, input.timezone ?? "UTC");
    if (multi) {
      const requestId = uuidv7(),
        flowId = uuidv7();
      // matches.length can be 0 here (a tie can be the *only* confident
      // signal — see matchItemMentions), so the currency falls back to the
      // tied candidates: matches.length + tied-segment count >= 2 is what
      // gates a non-null result, and every tied segment collapses to at
      // most one `tie`, so at least one of the two is always populated.
      const currency = multi.matches[0]?.item.currency ?? multi.tie?.candidates[0]?.currency;
      await client.query(
        `insert into app.commercial_requests(id,tenant_id,conversation_id,contact_id,request_type,status,currency) values($1,$2,$3,$4,'order','draft',$5)`,
        [requestId, input.tenantId, input.conversationId, input.contactId, currency],
      );
      await client.query(
        `insert into app.conversation_workflows(id,tenant_id,conversation_id,contact_id,commercial_request_id,operation_type,step) values($1,$2,$3,$4,$5,'order','awaiting_more_items')`,
        [flowId, input.tenantId, input.conversationId, input.contactId, requestId],
      );
      for (const { item, quantity } of multi.matches) {
        await this.addItem(client, input.tenantId, requestId, item, quantity);
      }
      const reply = await this.afterMultiItemMatch(client, input, requestId, flowId, {}, multi);
      return input.understanding.entities.hasGreeting === true
        ? this.prependGreeting(
            reply,
            input.locale,
            input.assistantName ?? "Commerce Assistant",
            input.businessName ?? "Commerce",
          )
        : reply;
    }
    const { match, tied } = await this.matchItemCandidates(client, input);
    // Found live testing D-078: a generic shared word ("tacos" across
    // every "Tacos ..." item) ties multiple catalog items just as easily
    // from a genuine question ("¿Los tacos pican?") as from a bare product
    // mention — this never checked whether the message reads as a
    // question at all. Same guard as bareNameStart below: an explicit
    // purchase start always proceeds; otherwise only a message that
    // doesn't carry question words does. A question falls through (match
    // is always null here, so it lands on the bareNameStart check below
    // and returns null), letting the knowledge layer answer it instead.
    if (tied.length > 1 && (starts || !looksLikeQuestion(input.body))) {
      // Persists the tie so a tap next turn can resolve it directly by
      // index (see selecting_item's tiedItems handling) — re-matching the
      // tapped text by name alone can never break a tie between two
      // variants of the same catalog item.
      const requestId = uuidv7(),
        flowId = uuidv7();
      await client.query(
        `insert into app.commercial_requests(id,tenant_id,conversation_id,contact_id,request_type,status,currency) values($1,$2,$3,$4,'order','draft',$5)`,
        [requestId, input.tenantId, input.conversationId, input.contactId, tied[0].currency],
      );
      await client.query(
        `insert into app.conversation_workflows(id,tenant_id,conversation_id,contact_id,commercial_request_id,operation_type,step) values($1,$2,$3,$4,$5,'order','selecting_item')`,
        [flowId, input.tenantId, input.conversationId, input.contactId, requestId],
      );
      // Captures the quantity from *this* message ("quiero 2 aguas") so
      // resolving the tie via a tap still applies it — not the tap's own
      // reconstructed title text, which can itself contain a number from
      // the disambiguating variant label ("Agua fresca (Vaso de 12 oz)")
      // and would otherwise be misread as "add 12", not "add 1 of the
      // 12oz one". Found live testing this exact fix.
      await this.step(client, flowId, "selecting_item", {
        tiedItems: tied,
        pendingQuantity: this.quantity(input),
      });
      return this.itemChoiceReply(input.locale, tied);
    }
    // A bare, unambiguous product mention (no "quiero"/"pedir") is enough
    // to start an order, as long as it doesn't itself read as a question
    // (looksLikeQuestion above) — which would make it a genuine question
    // about the product instead ("...no tiene gluten" still correctly
    // requires an explicit purchase verb, since "tiene" is a question
    // word).
    //
    // Found live: "Tacos vegetarianos" (no purchase verb, no question
    // words either) matched the catalog item by name but also used to trip
    // classifyMessage's old "vegetarian" FAQ intent purely because the
    // word "vegetarianos" appears in both — so the customer got an
    // ingredients FAQ answer instead of the item being added. This no
    // longer depends on which (if any) fixed intent classifyMessage
    // happened to assign — see D-078 — only on whether the message itself
    // reads as a question.
    const bareNameStart =
      !starts && match !== null && !looksLikeQuestion(input.body);
    if (!starts && !bareNameStart) return null;
    // Reaching here with `match` still null always means `starts` was true
    // (the `!starts && !bareNameStart` guard above already returned
    // otherwise, and bareNameStart requires match !== null) — the customer
    // explicitly asked to order something, but nothing in the catalog
    // matched it. Whether they actually named a (nonexistent) product, as
    // opposed to a vague "quiero hacer un pedido" naming nothing at all,
    // decides which reply fits: "itemUnknown" says plainly that the named
    // product wasn't found (found live: "Quiero pedir una hamburguesa" used
    // to get the generic "¿Qué producto deseas pedir?" as if nothing had
    // been said); a genuinely empty request still gets that generic prompt.
    // Deliberately creates no commercial_request/workflow row here — found
    // live that the old code parked every unmatched attempt in
    // "selecting_item" with nothing actually offered to select from,
    // permanently trapping every later message in that dead-end step
    // instead of letting a fresh order attempt through normally.
    if (!match) {
      const namedSomething = this.searchTerms(input).length > 0;
      const key: CommercialCopyKey = namedSomething
        ? input.understanding.entities.hasGreeting === true
          ? "greetingItemUnknown"
          : "itemUnknown"
        : input.understanding.entities.hasGreeting === true
          ? "greetingItem"
          : "item";
      const values = {
        assistant: input.assistantName ?? "Commerce Assistant",
        business: input.businessName ?? "Commerce",
      };
      // Shows the actual catalog as a tappable list instead of just telling
      // the customer to type "ver menú" — falls back to a "Ver menú" button
      // (never bare text asking them to type a command) only when there's
      // nothing to list or it exceeds WhatsApp's 10-row limit (see
      // catalogChoiceReply).
      return (
        this.catalogChoiceReply(input.locale, await this.catalogItems(client, input.timezone ?? "UTC"), key, values) ??
        this.catalogButtonReply(input.locale, key, values)
      );
    }
    const requestId = uuidv7(),
      flowId = uuidv7();
    await client.query(
      `insert into app.commercial_requests(id,tenant_id,conversation_id,contact_id,request_type,status,currency) values($1,$2,$3,$4,'order','draft',$5)`,
      [requestId, input.tenantId, input.conversationId, input.contactId, match.currency],
    );
    await client.query(
      `insert into app.conversation_workflows(id,tenant_id,conversation_id,contact_id,commercial_request_id,operation_type,step) values($1,$2,$3,$4,$5,'order','awaiting_more_items')`,
      [flowId, input.tenantId, input.conversationId, input.contactId, requestId],
    );
    await this.addItem(
      client,
      input.tenantId,
      requestId,
      match,
      quantityExcludingItemName(this.quantity(input), match.name),
    );
    const reply = await this.afterAddItem(client, input, requestId, flowId, match);
    return input.understanding.entities.hasGreeting === true
      ? this.prependGreeting(
          reply,
          input.locale,
          input.assistantName ?? "Commerce Assistant",
          input.businessName ?? "Commerce",
        )
      : reply;
  }

  // Global command overrides checked before any per-step handling — a
  // command like "cancelar" or "cambiar producto" always takes over
  // regardless of which step the flow is currently on. Returns `undefined`
  // (not `null` — a valid reply on its own) when no override matched, so
  // resolve() knows to fall through to the step-specific dispatch instead.
  private async handleGlobalCommand(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
    command: FlowCommand,
    negative: boolean,
  ): Promise<DeterministicReply | null | undefined> {
    if (command === "cancel") {
      await client.query(
        `update app.commercial_requests set status='cancelled',updated_at=now() where id=$1`,
        [flow.commercial_request_id],
      );
      await client.query(
        `update app.conversation_workflows set status='cancelled',updated_at=now() where id=$1`,
        [flow.id],
      );
      return this.localizedReply(input.locale, "cancelled");
    }
    if (command === "change") return this.changeWhatReply(input.locale);
    if (command === "view_order")
      return this.plannedReply(
        await this.cart(client, flow.commercial_request_id, input.locale),
      );
    if (command === "add_item") {
      await this.step(client, flow.id, "selecting_item", {
        ...flow.context,
        returnToCart: true,
      });
      return (
        this.catalogChoiceReply(input.locale, await this.catalogItems(client, input.timezone ?? "UTC")) ??
        this.localizedReply(input.locale, "item")
      );
    }
    if (command === "remove_item") {
      const { match, tied } = await this.matchCartItemCandidates(
        client,
        flow.commercial_request_id,
        input,
      );
      if (tied.length > 1) {
        // Persists the tie so a tap next turn resolves by index instead of
        // re-matching text — two variants of the same cart item (e.g. "Agua
        // fresca" 12oz/16oz both in the cart) share every name token and
        // would tie again forever otherwise. See selecting_item/D-051.
        await this.step(client, flow.id, "removing_item", {
          ...flow.context,
          tiedItems: tied,
        });
        return this.itemChoiceReply(input.locale, tied, "itemChoice", true);
      }
      if (!match) return this.removeWhichReply(client, flow, input.locale);
      return this.removeItem(client, flow, input.locale, match);
    }
    if (command === "change_quantity") {
      const { match, tied } = await this.matchCartItemCandidates(
        client,
        flow.commercial_request_id,
        input,
      );
      const pendingQuantity =
        typeof input.understanding.entities.quantity === "number"
          ? input.understanding.entities.quantity
          : null;
      if (tied.length > 1) {
        // Only persisted when a quantity was already given alongside the
        // tied mention ("cambia el agua a 3") — resolving identity alone
        // via a later tap wouldn't complete the action anyway, and without
        // a captured quantity a bare-digit tap is ambiguous between
        // "this is my answer to the tie" and "this is the new quantity".
        if (pendingQuantity !== null) {
          await this.step(client, flow.id, "changing_quantity_item", {
            ...flow.context,
            tiedItems: tied,
            pendingQuantity,
          });
        }
        return this.itemChoiceReply(input.locale, tied);
      }
      if (!match) return this.changeQuantityWhichReply(client, flow, input.locale);
      if (pendingQuantity === null) {
        // The product is known but no number came with it — persist it as
        // quantityTarget so the bare number the customer types next (no
        // product name attached to match against) applies to this item
        // instead of re-asking which product. See handleChangingQuantityItem.
        await this.step(client, flow.id, "changing_quantity_item", {
          ...flow.context,
          quantityTarget: match,
        });
        return this.localizedReply(input.locale, "quantityHowMany", { item: match.name });
      }
      return this.changeQuantity(
        client,
        flow,
        input.locale,
        match,
        pendingQuantity,
      );
    }
    if (command === "change_product") {
      // A cart with more than one line is ambiguous — "replace" used to
      // always target whichever line was added first, silently changing
      // the wrong product. Ask which one first; a single-item cart has
      // nothing to disambiguate, so it goes straight to picking the
      // replacement like before.
      const cartItems = await this.cartItems(client, flow.commercial_request_id);
      if (cartItems.length > 1) {
        await this.step(client, flow.id, "selecting_replace_target", {
          replaceCandidates: cartItems,
        });
        return this.itemChoiceReply(input.locale, cartItems, "changeWhichItem");
      }
      await client.query(
        `update app.commercial_requests set fulfillment_type=null,updated_at=now() where id=$1`,
        [flow.commercial_request_id],
      );
      await this.step(client, flow.id, "selecting_item", { replaceItem: true });
      return (
        this.catalogChoiceReply(input.locale, await this.catalogItems(client, input.timezone ?? "UTC")) ??
        this.localizedReply(input.locale, "item")
      );
    }
    if (command === "change_fulfillment") {
      await client.query(
        `update app.commercial_requests set fulfillment_type=null,updated_at=now() where id=$1`,
        [flow.commercial_request_id],
      );
      await this.step(client, flow.id, "awaiting_fulfillment", {});
      return this.fulfillmentReply(client, flow.commercial_request_id, input.locale);
    }
    if (command === "change_address") {
      if (flow.context.fulfillment !== "delivery")
        return this.localizedReply(input.locale, "addressNotRequired");
      await this.step(client, flow.id, "awaiting_requirement:delivery_address:value", {
        ...flow.context,
        address: undefined,
        addressId: undefined,
      });
      return this.localizedReply(input.locale, "address");
    }
    if (command === "back") return this.goBack(client, flow, input.locale);
    if (
      (command === "finish_items" &&
        ["awaiting_more_items", "selecting_item"].includes(flow.step)) ||
      (["awaiting_more_items", "selecting_item"].includes(flow.step) && negative)
    ) {
      const lines = await client.query<{ exists: boolean }>(
        `select exists(select 1 from app.request_lines where commercial_request_id=$1 and status='active') as exists`,
        [flow.commercial_request_id],
      );
      if (!lines.rows[0]?.exists) {
        await this.step(client, flow.id, "selecting_item", {});
        return this.localizedReply(input.locale, "emptyCartContinue");
      }
      // 'name' is the only requirement that can be pending before the
      // fulfillment modality is known (its wildcard fulfillment_type='*' row
      // matches regardless of modality). Anything modality-specific, like
      // delivery_address, is only ever evaluated after awaiting_fulfillment.
      const alreadyFilled = input.displayName ? ["name"] : [];
      const pending = await this.requirements.getPendingRequirements(
        client,
        input.tenantId,
        "order",
        null,
        alreadyFilled,
        input.locale,
      );
      const next = nextPendingStep(pending, alreadyFilled);
      if (next) {
        await this.step(client, flow.id, `awaiting_requirement:${next.fieldKey}`, {});
        return this.requirementPrompt(input.locale, next);
      }
      await this.step(client, flow.id, "awaiting_fulfillment", {});
      return this.fulfillmentReply(client, flow.commercial_request_id, input.locale);
    }
    return undefined;
  }

  private async handleSelectingReplaceTarget(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
  ): Promise<DeterministicReply | null> {
    const candidates = (flow.context.replaceCandidates as Item[] | undefined) ?? [];
    const selectionIndex = input.understanding.entities.selectionIndex;
    const tapped =
      typeof selectionIndex === "number"
        ? candidates[selectionIndex - 1]
        : undefined;
    const { match, tied } = tapped
      ? { match: tapped, tied: [] }
      : this.scoreCandidates(candidates, input);
    if (tied.length > 1) {
      await this.step(client, flow.id, "selecting_replace_target", {
        replaceCandidates: candidates,
      });
      return this.itemChoiceReply(input.locale, tied, "changeWhichItem");
    }
    if (!match)
      return this.itemChoiceReply(input.locale, candidates, "changeWhichItem");
    await client.query(
      `update app.commercial_requests set fulfillment_type=null,updated_at=now() where id=$1`,
      [flow.commercial_request_id],
    );
    await this.step(client, flow.id, "selecting_item", {
      replaceItem: true,
      replaceItemId: match.variant_id,
    });
    return (
      this.catalogChoiceReply(input.locale, await this.catalogItems(client, input.timezone ?? "UTC")) ??
      this.localizedReply(input.locale, "item")
    );
  }

  private async handleSelectingItem(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
  ): Promise<DeterministicReply | null> {
    // Resolves a tap against the tied options shown on the *previous*
    // turn (persisted below when the tie was first offered) — required
    // because re-matching by name can never break a tie between two
    // variants of the same catalog item ("Agua fresca" 12oz/16oz share
    // every name token) and would just show the identical tie again,
    // forever. See itemChoiceReply for the id/selectionIndex convention.
    const tiedItems = flow.context.tiedItems as Item[] | undefined;
    const selectionIndex = input.understanding.entities.selectionIndex;
    const tiedChoice =
      tiedItems && typeof selectionIndex === "number"
        ? tiedItems[selectionIndex - 1]
        : undefined;
    if (tiedChoice) {
      // Uses the quantity captured when the tie was first shown, not
      // this.quantity(input) — the tap's reconstructed title can itself
      // contain a number from the disambiguating variant label ("Agua
      // fresca (Vaso de 12 oz)") that would otherwise be misread as the
      // requested quantity. Found live.
      const tiedQuantity =
        typeof flow.context.pendingQuantity === "number"
          ? flow.context.pendingQuantity
          : 1;
      await this.addItem(
        client,
        input.tenantId,
        flow.commercial_request_id,
        tiedChoice,
        quantityExcludingItemName(tiedQuantity, tiedChoice.name),
        flow.context.replaceItem === true ? "replace" : "add",
        flow.context.replaceItem === true
          ? (flow.context.replaceItemId as string | undefined)
          : undefined,
      );
      return this.afterAddItem(
        client,
        input,
        flow.commercial_request_id,
        flow.id,
        tiedChoice,
      );
    }
    // "Cambiar producto" (replaceItem) swaps one specific line, not a
    // batch of new ones — multi-item extraction doesn't apply there.
    const multi =
      flow.context.replaceItem !== true
        ? await this.matchItemMentions(client, input.body, input.timezone ?? "UTC")
        : null;
    if (multi) {
      for (const { item, quantity } of multi.matches) {
        await this.addItem(client, input.tenantId, flow.commercial_request_id, item, quantity);
      }
      return this.afterMultiItemMatch(
        client,
        input,
        flow.commercial_request_id,
        flow.id,
        flow.context,
        multi,
      );
    }
    const { match, tied } = await this.matchItemCandidates(client, input);
    if (tied.length > 1) {
      await this.step(client, flow.id, "selecting_item", {
        ...flow.context,
        tiedItems: tied,
        pendingQuantity: this.quantity(input),
      });
      return this.itemChoiceReply(input.locale, tied);
    }
    if (!match) return this.localizedReply(input.locale, "itemUnknown");
    await this.addItem(
      client,
      input.tenantId,
      flow.commercial_request_id,
      match,
      quantityExcludingItemName(this.quantity(input), match.name),
      flow.context.replaceItem === true ? "replace" : "add",
      flow.context.replaceItem === true
        ? (flow.context.replaceItemId as string | undefined)
        : undefined,
    );
    return this.afterAddItem(client, input, flow.commercial_request_id, flow.id, match);
  }

  private async handleAwaitingMoreItems(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
    affirmative: boolean,
  ): Promise<DeterministicReply | null> {
    if (affirmative) {
      await this.step(client, flow.id, "selecting_item", {});
      return (
        this.catalogChoiceReply(input.locale, await this.catalogItems(client, input.timezone ?? "UTC")) ??
        this.localizedReply(input.locale, "item")
      );
    }
    const multi = await this.matchItemMentions(client, input.body, input.timezone ?? "UTC");
    if (multi) {
      for (const { item, quantity } of multi.matches) {
        await this.addItem(client, input.tenantId, flow.commercial_request_id, item, quantity);
      }
      return this.afterMultiItemMatch(
        client,
        input,
        flow.commercial_request_id,
        flow.id,
        flow.context,
        multi,
      );
    }
    const { match, tied } = await this.matchItemCandidates(client, input);
    // An ambiguous product mention used to die here as "no entendí tu
    // respuesta": matchItem() collapses a tie into a bare null, and this
    // step — unlike startNewOrder, which asks "which one?" for the exact
    // same message — had nothing left to say. Found live with "Quiero una
    // Sopa MX" while a cart was already open: "Sopa MX" ties against
    // "Sandwich de queso y Sopa MX" and "Sandwich de queso y birria y Sopa
    // MX" (every token of the shorter name appears in the longer ones), so
    // a product named exactly as the menu spells it looked unrecognized.
    // Same tie-persisting mechanism startNewOrder uses (tiedItems +
    // pendingQuantity read back by handleSelectingItem), minus the
    // request/workflow inserts — this order already has both. The question
    // guard is startNewOrder's too: "¿los tacos pican?" ties just as
    // easily and must still fall through to the knowledge layer.
    if (tied.length > 1 && !looksLikeQuestion(input.body)) {
      await this.step(client, flow.id, "selecting_item", {
        ...flow.context,
        tiedItems: tied,
        pendingQuantity: this.quantity(input),
      });
      return this.itemChoiceReply(input.locale, tied);
    }
    if (match) {
      await this.addItem(
        client,
        input.tenantId,
        flow.commercial_request_id,
        match,
        quantityExcludingItemName(this.quantity(input), match.name),
      );
      return this.afterAddItem(client, input, flow.commercial_request_id, flow.id, match);
    }
    // D-095 already set the rule ("no debería aparecer nada entre
    // comillas... no hagamos más respuestas de ese tipo") for item/
    // greetingItem/itemUnknown/greetingItemUnknown, but missed this
    // fallback — found live still showing the quoted "sí"/"ver menú"/
    // "listo" instruction instead of the real buttons those very actions
    // already have (moreItemsButtons). moreItemsReply attaches them the
    // same way every other "what's next" moment in this flow does.
    return this.moreItemsReply(input.locale, "moreItemsAnswer");
  }

  private async handleRemovingItem(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
  ): Promise<DeterministicReply | null> {
    const tiedItems = flow.context.tiedItems as Item[] | undefined;
    const selectionIndex = input.understanding.entities.selectionIndex;
    // "Todas" is offered as one option past the real ones (see
    // itemChoiceReply's allOption) — only reachable here when the tie was
    // actually between same-named variants, since that's the only case
    // it was offered in.
    if (tiedItems && selectionIndex === tiedItems.length + 1)
      return this.removeItems(client, flow, input.locale, tiedItems);
    const tiedChoice =
      tiedItems && typeof selectionIndex === "number"
        ? tiedItems[selectionIndex - 1]
        : undefined;
    if (tiedChoice) return this.removeItem(client, flow, input.locale, tiedChoice);
    const { match, tied } = await this.matchCartItemCandidates(
      client,
      flow.commercial_request_id,
      input,
    );
    if (tied.length > 1) {
      await this.step(client, flow.id, "removing_item", {
        ...flow.context,
        tiedItems: tied,
      });
      return this.itemChoiceReply(input.locale, tied, "itemChoice", true);
    }
    if (!match)
      return this.removeWhichReply(client, flow, input.locale);
    return this.removeItem(client, flow, input.locale, match);
  }

  private async handleSelectingModifiers(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
    command: FlowCommand,
  ): Promise<DeterministicReply | null> {
    const requestLineId =
      typeof flow.context.requestLineId === "string" ? flow.context.requestLineId : null;
    const finish = async () => {
      await this.step(client, flow.id, "awaiting_more_items", {});
      return this.afterCartChange(client, input, flow.commercial_request_id);
    };
    if (!requestLineId) return finish();
    const remaining = await this.remainingModifiers(client, requestLineId);
    // "Listo" is normally free to tap early — extras are optional. A group
    // with min_selections>0 (Santos Tacos' "elige tus 3 tacos" package,
    // D-099) is the one exception: tapping "Listo" before reaching the
    // minimum re-shows the same choices instead of finishing, so the
    // package can't be added to the cart with 0-2 flavors picked. Reaching
    // max_selections (also enforced, in remainingModifiers) always finishes
    // automatically below without ever needing this check, since the data
    // constraint max_selections>=min_selections guarantees the minimum is
    // already met by then.
    if (command === "finish_items") {
      const unmet = this.unmetRequiredGroup(remaining);
      return unmet ? this.modifierChoiceReply(input.locale, remaining, undefined, unmet) : finish();
    }
    // A tapped option's title becomes this inbound message (see
    // moreItemsButtons/itemChoiceReply for the same convention); "Listo"
    // is also matched here via the finishItems rule (command check above).
    // Same latent bug class as D-066: modifierChoiceReply()'s button
    // titles are truncated to 20 chars ("Queso extra (+$ 3.000)"-length
    // names would be cut with "…"), which would never exact-match
    // norm(option.name) again — an unrecoverable loop for any modifier
    // option whose name is long enough to truncate. Resolving the tap's
    // own id first avoids relying on the reconstructed (and possibly
    // truncated) title at all.
    const picked =
      remaining.find((option) => option.option_id === input.interactiveSelectionId) ??
      remaining.find((option) => norm(option.name) === norm(input.body));
    if (!picked) return remaining.length > 0 ? this.modifierChoiceReply(input.locale, remaining) : finish();
    await this.addModifier(
      client,
      input.tenantId,
      flow.commercial_request_id,
      requestLineId,
      picked,
    );
    const next = await this.remainingModifiers(client, requestLineId);
    return next.length > 0
      ? this.modifierChoiceReply(input.locale, next, picked.name)
      : finish();
  }

  private async handleChangingQuantityItem(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
  ): Promise<DeterministicReply | null> {
    const tiedItems = flow.context.tiedItems as Item[] | undefined;
    const selectionIndex = input.understanding.entities.selectionIndex;
    const pendingQuantity =
      typeof flow.context.pendingQuantity === "number"
        ? flow.context.pendingQuantity
        : null;
    const tiedChoice =
      tiedItems && typeof selectionIndex === "number"
        ? tiedItems[selectionIndex - 1]
        : undefined;
    if (tiedChoice && pendingQuantity !== null) {
      return this.changeQuantity(client, flow, input.locale, tiedChoice, pendingQuantity);
    }
    if (tiedChoice) {
      // Tapped from changeQuantityWhichReply, which offers the cart without
      // asking for a number first (D-105) — so the row identifies the
      // product and the count is still missing. Same landing place as
      // naming the product in free text below: persist it and ask how many.
      // tiedItems is dropped on the way out so the bare number typed next
      // ("5") is read as a quantity, never as a row index.
      const { tiedItems: _shown, ...rest } = flow.context;
      await this.step(client, flow.id, "changing_quantity_item", {
        ...rest,
        quantityTarget: tiedChoice,
      });
      return this.localizedReply(input.locale, "quantityHowMany", { item: tiedChoice.name });
    }
    const newPendingQuantity =
      typeof input.understanding.entities.quantity === "number"
        ? input.understanding.entities.quantity
        : null;
    // A product was already pinned down — either tapped from
    // changeQuantityWhichReply, or named in an earlier message with no
    // number attached (see the "pendingQuantity === null" branch below and
    // its top-level "change_quantity" twin) — and we're only waiting on the
    // new count now. A bare "3" carries no product name to run through
    // matchCartItemCandidates, so it's read against the item persisted in
    // context instead.
    const quantityTarget = flow.context.quantityTarget as Item | undefined;
    if (quantityTarget && newPendingQuantity !== null)
      return this.changeQuantity(client, flow, input.locale, quantityTarget, newPendingQuantity);
    const { match, tied } = await this.matchCartItemCandidates(
      client,
      flow.commercial_request_id,
      input,
    );
    if (tied.length > 1) {
      if (newPendingQuantity !== null) {
        await this.step(client, flow.id, "changing_quantity_item", {
          ...flow.context,
          tiedItems: tied,
          pendingQuantity: newPendingQuantity,
        });
      }
      return this.itemChoiceReply(input.locale, tied);
    }
    if (!match)
      return this.changeQuantityWhichReply(client, flow, input.locale);
    if (newPendingQuantity === null) {
      await this.step(client, flow.id, "changing_quantity_item", {
        ...flow.context,
        quantityTarget: match,
      });
      return this.localizedReply(input.locale, "quantityHowMany", { item: match.name });
    }
    return this.changeQuantity(
      client,
      flow,
      input.locale,
      match,
      newPendingQuantity,
    );
  }

  private async handleAwaitingFulfillment(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
  ): Promise<DeterministicReply | null> {
    const fulfillment =
      input.understanding.requestedAction === "fulfillment.delivery"
        ? "delivery"
        : input.understanding.requestedAction === "fulfillment.pickup"
          ? "pickup"
          : input.understanding.requestedAction === "fulfillment.on_site"
            ? "on_site"
            : null;
    if (!fulfillment) return this.fulfillmentReply(client, flow.commercial_request_id, input.locale);
    const context: Record<string, unknown> = { ...flow.context, fulfillment };
    await client.query(
      `update app.commercial_requests set fulfillment_type=$2,updated_at=now() where id=$1`,
      [flow.commercial_request_id, fulfillment],
    );
    // syncPackagingFee() reads fulfillment_type fresh from the row (D-104)
    // — choosing pickup/delivery here is the one moment that can turn
    // packaging on (or, choosing on_site after having chosen pickup via
    // "Corregir", turn it back off) with no cart change involved, so it
    // can't wait for an addItem/removeItem to pick it up. Deliberately not
    // folded into recalculate() itself — that runs on every single
    // addItem/removeItem/changeQuantity/addModifier call, and syncing
    // packaging on every one of those would mean two more queries per cart
    // edit for every tenant, including the (overwhelming majority) that
    // never configure a packaging fee at all. Calling it explicitly just
    // here and at final confirmation (see handleAwaitingConfirmation) is
    // enough: nothing about the packaging line depends on being live
    // mid-build, only on being correct by the time the customer sees the
    // review and the moment the order is actually confirmed.
    await this.syncPackagingFee(client, flow.commercial_request_id);
    await this.recalculate(client, flow.commercial_request_id);
    return this.afterRequirementFilled(client, flow, input, context);
  }

  private async handleAwaitingRequirement(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
    affirmative: boolean,
    negative: boolean,
  ): Promise<DeterministicReply | null> {
    const [, fieldKey, subStep] = flow.step.split(":");
    if (fieldKey === "name") {
      const name = input.body.trim().slice(0, 120);
      if (name.length < 2) return this.localizedReply(input.locale, "name");
      await client.query(
        `update app.contacts set display_name=$2,updated_at=now() where id=$1`,
        [input.contactId, name],
      );
      return this.afterRequirementFilled(client, flow, input, flow.context);
    }
    if (fieldKey === "delivery_address" && subStep === "saved") {
      if (affirmative)
        return this.afterRequirementFilled(client, flow, input, flow.context);
      if (negative) {
        const context = { ...flow.context };
        delete context.address;
        delete context.addressId;
        await this.step(
          client,
          flow.id,
          "awaiting_requirement:delivery_address:value",
          context,
        );
        return this.localizedReply(input.locale, "address");
      }
      return this.yesNoReply(input.locale, "yesNo");
    }
    if (fieldKey === "delivery_address" && subStep === "value") {
      const address = input.body.trim().slice(0, 500);
      const requirement = await this.findRequirement(
        client,
        input,
        this.fulfillmentTypeOf(flow.context),
        "delivery_address",
      );
      const valid = isAddressDetailedEnough(
        address,
        requirement?.validationRule,
      );
      if (!valid)
        return requirement
          ? this.requirementPrompt(input.locale, requirement)
          : this.localizedReply(input.locale, "address");
      const context = { ...flow.context, address };
      await this.step(
        client,
        flow.id,
        "awaiting_requirement:delivery_address:consent",
        context,
      );
      return this.yesNoReply(input.locale, "saveAddress");
    }
    if (fieldKey === "delivery_address" && subStep === "consent") {
      if (!affirmative && !negative)
        return this.yesNoReply(input.locale, "yesNo");
      if (affirmative) {
        const addressId = uuidv7();
        await client.query(
          `insert into app.contact_addresses(id,tenant_id,contact_id,label,address_line,is_default,consented_at) values($1,$2,$3,'principal',$4,not exists(select 1 from app.contact_addresses where contact_id=$3 and status='active'),now())`,
          [
            addressId,
            input.tenantId,
            input.contactId,
            String(flow.context.address),
          ],
        );
        flow.context.addressId = addressId;
      }
      return this.afterRequirementFilled(client, flow, input, flow.context);
    }
    if (subStep === "confirm") {
      if (!affirmative && !negative)
        return this.yesNoReply(input.locale, "yesNo");
      const pendingConfirmations = {
        ...((flow.context.pendingConfirmations as Record<string, string>) ??
          {}),
      };
      const value = pendingConfirmations[fieldKey];
      delete pendingConfirmations[fieldKey];
      const context: Record<string, unknown> = {
        ...flow.context,
        pendingConfirmations,
      };
      if (affirmative && value !== undefined)
        context.values = {
          ...((flow.context.values as Record<string, string>) ?? {}),
          [fieldKey]: value,
        };
      return this.afterRequirementFilled(client, flow, input, context);
    }
    // Generic custom requirement (e.g. vehicle_type, professional preference)
    // configured entirely through the admin panel — no bespoke persistence,
    // the answer is stored in flow.context.values (or queued for
    // confirmation, see applyRequirementValue) and surfaced in the
    // summary/handoff without further processing.
    const requirement = await this.findRequirement(
      client,
      input,
      this.fulfillmentTypeOf(flow.context),
      fieldKey,
    );
    if (!requirement) return null;
    if (requirement.dataType === "boolean") {
      const value = resolveBooleanRequirementValue(
        input.understanding.entities,
      );
      if (value === null)
        return this.requirementPrompt(input.locale, requirement);
      return this.afterRequirementFilled(
        client,
        flow,
        input,
        this.applyRequirementValue(requirement, value, flow.context),
      );
    }
    // A tapped select option's list/button id is the option's 1-based
    // index, matching validateRequirementValue's byIndex path — checked
    // ahead of the raw body text so a truncated (long) option label still
    // resolves correctly instead of failing an exact-text match.
    const selectionText =
      typeof input.understanding.entities.selectionIndex === "number"
        ? String(input.understanding.entities.selectionIndex)
        : input.body;
    const validation = validateRequirementValue(selectionText, requirement);
    if (!validation.valid)
      return this.requirementPrompt(input.locale, requirement);
    return this.afterRequirementFilled(
      client,
      flow,
      input,
      this.applyRequirementValue(requirement, validation.value, flow.context),
    );
  }

  private async handleAwaitingConfirmation(
    client: PoolClient,
    input: UnderstoodFlowInput,
    flow: Workflow,
    affirmative: boolean,
    negative: boolean,
  ): Promise<DeterministicReply | null> {
    if (affirmative) {
      // Safety net for the rarer path — cart changed (e.g. "Corregir" ->
      // added another item) after fulfillment was already chosen, so the
      // packaging line synced back in handleAwaitingFulfillment could be
      // stale by the time the customer actually confirms (D-104).
      await this.syncPackagingFee(client, flow.commercial_request_id);
      await this.recalculate(client, flow.commercial_request_id);
      await client.query(
        `update app.commercial_requests set status='ready',confirmed_at=now(),updated_at=now() where id=$1`,
        [flow.commercial_request_id],
      );
      await client.query(
        `update app.conversation_workflows set status='completed',updated_at=now() where id=$1`,
        [flow.id],
      );
      return this.localizedReply(input.locale, "confirmed", {
        reference: flow.commercial_request_id.slice(-8).toUpperCase(),
      });
    }
    if (negative) {
      // "No" at the final review means "that's not right", not "cancel
      // everything" — reuses the same prompt the generic 'change' command
      // shows elsewhere. Cancelling now requires the explicit
      // "Cancelar pedido" button (or typing "cancelar"), handled by the
      // already-global 'cancel' command, same as at any other step.
      return this.changeWhatReply(input.locale);
    }
    return this.confirmOrderReply(input.locale);
  }
  // Applied after matchItemMentions() finds a decomposition — its matched
  // items are already in the cart (addItem already ran on multi.matches) by
  // the time this runs. A pending tie needs the exact same persist-and-ask
  // treatment as every single-item tie in this file (tiedItems +
  // pendingQuantity on the workflow, resolved by index in
  // handleSelectingItem's tiedChoice branch) — but framed around what was
  // already matched, so "un Birria Bowl y una Chelita" shows the Bowl
  // already in the cart alongside the question about which Chelita,
  // instead of a bare disambiguation prompt that makes the Bowl look like
  // it never happened.
  private async afterMultiItemMatch(
    client: PoolClient,
    input: { tenantId: string; conversationId: string; locale: Locale },
    requestId: string,
    flowId: string,
    existingContext: Record<string, unknown>,
    multi: {
      matches: { item: Item; quantity: number }[];
      unmatched: string[];
      tie?: { candidates: Item[]; quantity: number };
    },
  ): Promise<DeterministicReply> {
    if (!multi.tie) return this.afterCartChange(client, input, requestId, multi.unmatched);
    await this.step(client, flowId, "selecting_item", {
      ...existingContext,
      tiedItems: multi.tie.candidates,
      pendingQuantity: multi.tie.quantity,
    });
    const cart = await this.cart(client, requestId, input.locale);
    const interactive = this.itemChoiceInteractive(input.locale, multi.tie.candidates);
    const withCart = multi.unmatched.length
      ? this.content(input.locale, [
          {
            kind: "template",
            template: { namespace: "commercial", key: "itemsNotFound" },
            values: { items: multi.unmatched.join(", ") },
          },
          { kind: "line_break" },
          { kind: "line_break" },
          ...cart.plan.segments,
        ])
      : cart;
    return this.plannedReply(
      this.append(
        input.locale,
        withCart,
        [
          { kind: "line_break" },
          { kind: "template", template: { namespace: "commercial", key: "itemChoice" } },
        ],
        interactive,
      ),
    );
  }
  private async afterCartChange(
    client: PoolClient,
    input: { tenantId: string; conversationId: string; locale: Locale },
    requestId: string,
    unmatchedMentions: string[] = [],
  ): Promise<DeterministicReply> {
    const rawCart = await this.cart(client, requestId, input.locale);
    const cart = unmatchedMentions.length
      ? this.content(input.locale, [
          {
            kind: "template",
            template: { namespace: "commercial", key: "itemsNotFound" },
            values: { items: unmatchedMentions.join(", ") },
          },
          { kind: "line_break" },
          { kind: "line_break" },
          ...rawCart.plan.segments,
        ])
      : rawCart;
    const suggestion = await this.recommendations.suggest(client, {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      requestId,
      locale: input.locale,
    });
    if (!suggestion)
      return this.plannedReply(
        this.append(
          input.locale,
          cart,
          [
            { kind: "line_break" },
            {
              kind: "template",
              template: { namespace: "commercial", key: "moreItems" },
            },
          ],
          this.moreItemsButtons(input.locale),
        ),
      );
    const content = this.append(
      input.locale,
      cart,
      [
        { kind: "line_break" },
        { kind: "verified_text", text: suggestion.interactive.body },
      ],
      suggestion.interactive,
    );
    return {
      ...this.plannedReply(content),
      sources: ["commercial_request", `item_variant:${suggestion.variantId}`],
    };
  }
  private async matchItem(
    client: PoolClient,
    input: UnderstoodFlowInput,
  ): Promise<Item | null> {
    return (await this.matchItemCandidates(client, input)).match;
  }
  // Exposes the tied candidates a plain matchItem() swallows into a single
  // null, so callers that can meaningfully ask "which one?" (starting an
  // order, or explicitly choosing an item) don't have to silently give up on
  // an otherwise-recognized but ambiguous product mention (e.g. "tacos"
  // matching every item whose name starts with "Tacos").
  private async matchItemCandidates(
    client: PoolClient,
    input: UnderstoodFlowInput,
  ): Promise<{ match: Item | null; tied: Item[] }> {
    const rows = await this.catalogItems(client, input.timezone ?? "UTC");
    // Tapping a row from catalogChoiceReply()/the "Ver menú" list already
    // identifies one exact variant unambiguously (its id IS the
    // variant_id) — but the tap gets reprocessed as a normal inbound
    // message carrying only the row's *title* (selectionAsNaturalText(),
    // no description), so a same-named tie (e.g. "Agua fresca" 12oz/16oz)
    // re-matched by name alone. Found live: tapping "Agua fresca" (12oz)
    // from the menu still showed the disambiguation tie instead of adding
    // the exact variant tapped. Resolving interactiveSelectionId against
    // the fetched rows first — before any name-based scoring — uses the
    // precise information the tap already carried instead of discarding
    // it.
    const direct = input.interactiveSelectionId
      ? rows.find((row) => row.variant_id === input.interactiveSelectionId)
      : undefined;
    if (direct) return { match: direct, tied: [] };
    return this.scoreCandidates(rows, input);
  }
  // A null time window means always available (every item before D-097, and
  // most items still) — an item with both bounds set is only offered while
  // the tenant's local clock (its own timezone, not server/UTC time) falls
  // inside them, e.g. a lunch-only dish outside lunch hours. Outside its
  // window an item is excluded here entirely — the same as it not existing
  // in the catalog right now — rather than matched-but-refused, so a
  // customer asking for it gets the same "not found, here's what we do
  // have" reply as any other nonexistent product, always showing only what
  // the kitchen can actually make at this moment.
  private async catalogItems(client: PoolClient, timezone: string): Promise<Item[]> {
    const result = await client.query<Item>(
      `select item.id item_id,variant.id variant_id,item.name,item.category,variant.name variant_name,variant.price_minor::text,variant.currency
       from app.catalog_items item join app.item_variants variant on variant.tenant_id=item.tenant_id and variant.catalog_item_id=item.id
       where item.status='active' and item.customer_orderable and variant.status='active' and variant.availability_status='available'
         and (item.available_from_time is null or item.available_until_time is null
              or (now() at time zone $1)::time between item.available_from_time and item.available_until_time)
       order by item.name`,
      [timezone],
    );
    return result.rows;
  }
  // Removing an item or changing its quantity should only ever match against
  // what is actually in the cart, not the whole catalog — otherwise
  // mentioning "agua" ties between every catalog variant of "Agua fresca"
  // (e.g. 12oz/16oz) even when only one of them is in this cart, and the
  // customer can never remove it (see the Wendy Muñoz conversation review).
  private async matchCartItemCandidates(
    client: PoolClient,
    requestId: string,
    input: UnderstoodFlowInput,
  ): Promise<{ match: Item | null; tied: Item[] }> {
    const rows = await this.cartItems(client, requestId);
    return this.scoreCandidates(rows, input);
  }
  private async cartItems(client: PoolClient, requestId: string): Promise<Item[]> {
    const result = await client.query<Item>(
      // A packaging-fee line (D-104) is derived from the cart, never chosen:
      // syncPackagingFee() recomputes its quantity on every fulfillment
      // choice and again before confirming. Offering it among the cart's own
      // options let the customer ask for "7 empaques" and have that silently
      // overwritten back to the computed 2 one step later (found live), so
      // it is excluded from every cart picker and cart match — removing it
      // or changing its quantity by hand is never a real choice.
      `select item.id item_id,variant.id variant_id,item.name,variant.name variant_name,variant.price_minor::text,variant.currency
       from app.request_lines line
       join app.item_variants variant on variant.tenant_id=line.tenant_id and variant.id=line.item_variant_id
       join app.catalog_items item on item.tenant_id=variant.tenant_id and item.id=variant.catalog_item_id
       where line.commercial_request_id=$1 and line.status='active' and item.is_packaging_fee=false`,
      [requestId],
    );
    return result.rows;
  }
  private scoreCandidates(
    rows: Item[],
    input: UnderstoodFlowInput,
  ): { match: Item | null; tied: Item[] } {
    return this.scoreCandidatesByTokens(
      rows,
      new Set(this.searchTerms(input).map(singularize)),
    );
  }
  private scoreCandidatesByTokens(
    rows: Item[],
    tokens: Set<string>,
  ): { match: Item | null; tied: Item[] } {
    const scored = rows
      .map((item) => ({
        item,
        score: norm(item.name)
          .split(" ")
          .map(singularize)
          .filter((x) => tokens.has(x)).length,
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score === 0) return { match: null, tied: [] };
    const equallyRelevant = scored.filter(
      (candidate) => candidate.score === best.score,
    );
    if (equallyRelevant.length === 1) return { match: best.item, tied: [] };
    // Scoring above only ever looks at item.name, so two variants of the
    // same product ("Agua fresca" 12oz/16oz) always tie on it — even when
    // the customer already named the size ("...de 16 oz"). Re-score just
    // the tied candidates against variant_name and resolve automatically
    // when exactly one is a strictly better match; otherwise the tie
    // genuinely wasn't broken by anything the customer said, and stays a
    // tie rather than guessing. Found live.
    const byVariant = equallyRelevant
      .map((candidate) => ({
        item: candidate.item,
        variantScore: norm(candidate.item.variant_name)
          .split(" ")
          .map(singularize)
          .filter((x) => tokens.has(x)).length,
      }))
      .sort((a, b) => b.variantScore - a.variantScore);
    const bestVariant = byVariant[0];
    const tiedByVariant = byVariant.filter(
      (candidate) => candidate.variantScore === bestVariant.variantScore,
    );
    return bestVariant.variantScore > 0 && tiedByVariant.length === 1
      ? { match: tiedByVariant[0].item, tied: [] }
      : { match: null, tied: equallyRelevant.map((candidate) => candidate.item) };
  }
  // Splits "nachos y 3 tacos vegetarianos" into ["nachos", "3 tacos
  // vegetarianos"] so each product mention can be matched and quantified on
  // its own — scoring the whole message as one flat token bag (searchTerms)
  // silently picked whichever catalog item scored highest and dropped every
  // other product the customer mentioned in the same message.
  private static readonly ITEM_MENTION_SEPARATOR =
    /\s*,\s*|\s+(?:y|e|tambien|ademas|and|also)\s+/;
  private splitItemMentions(text: string): string[] {
    // Split on the comma BEFORE norm() strips it (norm()'s punctuation
    // removal would otherwise erase the very separator being split on) —
    // only accents/case are normalized here so "también" still matches the
    // unaccented separator list; each resulting segment is fully norm()ed
    // afterwards for matching.
    const accentless = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return accentless
      .split(CommercialFlowService.ITEM_MENTION_SEPARATOR)
      .map((segment) => norm(segment))
      .filter(Boolean);
  }
  // Only worth acting on when the message actually decomposes into 2+
  // segments each carrying real signal — a single segment (no separator
  // found) is left to the existing single-item flow, which already has
  // better handling for ties and "I didn't understand" replies. A segment
  // matching nothing in the catalog at all is weak evidence (could just be
  // a stray word), but a segment that *ties* between two-or-more catalog
  // items is strong evidence it names a real product — found live: "un
  // Birria Bowl y una Chelita" ties "Chelita" against "Chelita Envenenada"
  // (a name-prefix tie, same class matchItemCandidates already resolves
  // for a single-item message), so the old "matches.length >= 2" gate
  // rejected the whole decomposition over one ambiguous word and fell back
  // to scoring the entire message as a single bag of tokens — which silently
  // matched only the Bowl and dropped "Chelita" with no trace, not even a
  // "not found". Matches and ties now count together toward the 2+ gate,
  // and only a segment that matched nothing at all is weak enough to stay
  // excluded from it.
  private async matchItemMentions(
    client: PoolClient,
    message: string,
    timezone: string,
  ): Promise<{
    matches: { item: Item; quantity: number }[];
    unmatched: string[];
    // Only the first tie found is ever surfaced for disambiguation — the
    // rest of this flow (selecting_item's tiedItems) only ever tracks one
    // pending tie at a time, the same as every other tie in this file. A
    // second simultaneously-ambiguous segment in the same message is rare
    // enough that queuing it for a follow-up disambiguation would be a
    // genuinely bigger design change (flagged as out of scope in D-100);
    // it's reported as unmatched instead, same as a segment naming nothing
    // at all — never silently guessed, never silently dropped.
    tie?: { candidates: Item[]; quantity: number };
  } | null> {
    const segments = this.splitItemMentions(message);
    if (segments.length < 2) return null;
    const catalog = await this.catalogItems(client, timezone);
    const ignored = new Set(mergedLanguageTerms("itemStopWords"));
    const matches: { item: Item; quantity: number }[] = [];
    const unmatched: string[] = [];
    const tied: { segment: string; candidates: Item[]; quantity: number }[] = [];
    for (const segment of segments) {
      // A pure number survives even at 1-2 digits ("16", "12") — same fix
      // as DeterministicUnderstandingProvider.searchTerms(), otherwise a
      // named size never reaches item/variant scoring at all.
      const tokens = new Set(
        segment
          .split(" ")
          .filter((term) => (term.length > 2 || /^\d+$/.test(term)) && !ignored.has(term))
          .map(singularize),
      );
      const { match, tied: candidates } = this.scoreCandidatesByTokens(catalog, tokens);
      if (match) {
        matches.push({
          item: match,
          quantity: quantityExcludingItemName(parseQuantity(segment), match.name),
        });
      } else if (candidates.length > 1) {
        tied.push({ segment, candidates, quantity: parseQuantity(segment) });
      } else {
        unmatched.push(segment);
      }
    }
    if (matches.length + tied.length < 2) return null;
    const [tie, ...extraTies] = tied;
    for (const extra of extraTies) unmatched.push(extra.segment);
    return {
      matches,
      unmatched,
      ...(tie ? { tie: { candidates: tie.candidates, quantity: tie.quantity } } : {}),
    };
  }
  // Mirrors requirementPrompt's select-options rendering: buttons for up to
  // 3 tied candidates, a list beyond that. Ids are the option's 1-based
  // index (same convention as requirementPrompt/resourcePrompt), not
  // item.variant_id — a tap's title still becomes the next inbound message
  // as a robustness fallback (moreItemsButtons' same title-as-command
  // pattern), but callers that persist the tied items themselves (see
  // selecting_item's tiedItems context) resolve the tap directly via
  // entities.selectionIndex, which text-matching alone cannot do: two
  // variants of the same catalog item ("Agua fresca" 12oz/16oz) share every
  // name token, so re-matching by name always ties again — a real dead-end
  // loop found live. Titles disambiguate same-named items with the variant
  // in parentheses; a tie between distinct item names keeps the bare name
  // (unambiguous and shorter).
  // Extracted from itemChoiceReply so afterMultiItemMatch can build the
  // exact same tappable options for a tie found mid-multi-item extraction,
  // composed alongside cart/unmatched text instead of itemChoiceReply's own
  // fixed body.
  private itemChoiceInteractive(
    locale: Locale,
    items: Item[],
    allowRemoveAll = false,
  ): InteractiveMessage {
    const nameCounts = new Map<string, number>();
    for (const item of items)
      nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
    const labelFor = (item: Item) =>
      (nameCounts.get(item.name) ?? 0) > 1 && item.variant_name
        ? `${item.name} (${item.variant_name})`
        : item.name;
    // Meta rejects `buttons` outright when two options share the exact same
    // title ("(#131009) Parameter value is not valid: Duplicate button
    // title") — found live when a tie between same-named variants kept the
    // bare name for both. `list` rows only need unique ids, not unique
    // titles, and give more room (24 vs. 20 chars) to fit the
    // disambiguating variant, so any such tie always uses list regardless
    // of count.
    const hasDuplicateNames = [...nameCounts.values()].some((count) => count > 1);
    // Same reasoning extended to a single long name, not just a tie: found
    // live disambiguating "Orden x 3 Tacos" against "Orden x 3 Tacos Birria
    // de Camarón o Güerito" — with only 2 options this used `buttons`
    // (20-char cap), truncating the second one to "Orden x 3 Tacos Bir…"
    // and silently dropping the exact words that told the customer the two
    // options apart. `list` rows get 24 chars for the title *and* a
    // separate 72-char `description` — see descriptionFor below — so a name
    // that wouldn't survive a button never has to lose its meaning here.
    const hasLongName = items.some((item) => labelFor(item).length > 20);
    // "Todas" only makes sense — and is only offered — when the tie is
    // between variants of the same product ("Agua fresca" 12oz/16oz): the
    // customer asked to remove "agua fresca" without specifying which, so
    // removing every matching line is a reasonable reading of that request.
    // Not offered for a tie between genuinely different products (e.g.
    // "tacos" matching both "Tacos al pastor" and "Tacos de birria"), where
    // guessing "remove both kinds" would be a much riskier assumption. Its
    // id is items.length+1, one past the real options — see removing_item.
    const offerRemoveAll = allowRemoveAll && hasDuplicateNames;
    const optionFor = (item: Item, index: number, max: number) => {
      const label = labelFor(item);
      return {
        id: String(index + 1),
        title: this.truncate(label, max),
        // A label that doesn't even fit the list's own 24-char title cap
        // still isn't lost — the full text goes in `description` (72
        // chars), so "Orden x 3 Tacos Birria de Camarón o Güerito" reads in
        // full instead of ending at "Orden x 3 Tacos Bir…".
        ...(label.length > max ? { description: this.truncate(label, 72) } : {}),
      };
    };
    const allOption = (max: number) => ({
      id: String(items.length + 1),
      title: this.truncate(this.copy(locale, "removeAllOption"), max),
    });
    return items.length <= 3 && !hasDuplicateNames && !hasLongName
      ? {
          type: "buttons",
          body: "",
          options: [
            ...items.map((item, index) => optionFor(item, index, 20)),
            ...(offerRemoveAll ? [allOption(20)] : []),
          ],
        }
      : {
          type: "list",
          body: "",
          buttonLabel: this.copy(locale, "chooseButtonLabel"),
          options: [
            ...items.map((item, index) => optionFor(item, index, 24)),
            ...(offerRemoveAll ? [allOption(24)] : []),
          ],
        };
  }
  private itemChoiceReply(
    locale: Locale,
    items: Item[],
    bodyKey: CommercialCopyKey = "itemChoice",
    allowRemoveAll = false,
  ): DeterministicReply {
    const interactive = this.itemChoiceInteractive(locale, items, allowRemoveAll);
    return {
      ...this.reply(this.copy(locale, bodyKey)),
      responsePlan: {
        kind: "verified_content",
        body: this.copy(locale, bodyKey),
        interactive,
      },
    };
  }
  // "Otro producto" used to just ask "¿Qué producto deseas pedir?" as bare
  // text, with no way to browse — the customer had to already know what to
  // type. Shows the full catalog as a tappable list instead, same shape as
  // the "Ver menú" listing (name, variant, price per row). Falls back to
  // the bare text prompt when there's nothing to list or the catalog
  // exceeds WhatsApp's 10-row list limit (no pagination).
  private catalogChoiceReply(
    locale: Locale,
    items: Item[],
    bodyKey: CommercialCopyKey = "item",
    values: Record<string, string | number> = {},
  ): DeterministicReply | null {
    if (items.length === 0) return null;
    // A catalog bigger than WhatsApp's 10-row list cap used to fall all the
    // way through to `null` here, and every caller's `?? catalogButtonReply`
    // fallback then showed a bare "Ver menú" button with nothing tappable
    // behind it — found live once Santos Tacos' real 41-item menu replaced
    // the small demo one (D-102). Grouping into a category picker first
    // (same mechanism as deterministic-reply.service.ts's
    // menuCategoriesReply, see its own comment for the full reasoning and
    // the ">10 categories" caveat) means only a genuinely empty catalog
    // still needs that plain-button fallback.
    if (items.length > 10) return this.categoryPickerReply(locale, items);
    const labels = catalogFor(locale).labels;
    // Found live: reaching a single-item (or otherwise short) list — e.g.
    // "Extras" after picking it from the category picker — offered no way
    // out except typing something else; "Cancelar pedido" or "Volver" still
    // worked as global commands, but neither was ever shown as an option,
    // so the customer had to already know to type it (D-104). "Ver menú"
    // reuses the exact same button/id (cart:view_catalog) catalogButtonReply
    // already uses, and resolves to `command === "catalog"` — resolve()
    // returns null for that, which lets the knowledge layer's own menu/
    // category reply handle it — an escape hatch that works identically
    // whether or not an order is even in progress. Capped to 9 real items
    // (not 10) so this extra row never pushes a full list past WhatsApp's
    // own 10-row cap.
    const shown = items.slice(0, 9);
    const interactive: InteractiveMessage = {
      type: "list",
      body: "",
      buttonLabel: this.copy(locale, "chooseButtonLabel"),
      options: [
        ...shown.map((item) => {
          const price = formatMoney(item.price_minor, item.currency, locale);
          const variantLabel =
            item.variant_name === labels.unit || item.variant_name.startsWith(labels.orderPrefix)
              ? ""
              : item.variant_name;
          const detail = variantLabel ? `${variantLabel} · ${price}` : price;
          return {
            id: item.variant_id,
            title: this.truncate(item.name, 24),
            // Same rule as itemChoiceReply (D-101/D-102), applied to the
            // catalog list too: a name past the 24-char title cap keeps its
            // distinguishing words in the description instead of losing them
            // to "…" — found live on "Sandwich de queso y Sopa MX" vs.
            // "Sandwich de queso y birria y Sopa MX", which rendered as two
            // near-identical rows. Variant/price stay after the full name.
            description: this.truncate(
              item.name.length > 24 ? `${item.name} · ${detail}` : detail,
              72,
            ),
          };
        }),
        { id: "cart:view_catalog", title: this.copy(locale, "viewMenuButton") },
      ],
    };
    return {
      ...this.reply(this.copy(locale, bodyKey, values)),
      responsePlan: {
        kind: "verified_content",
        body: this.copy(locale, bodyKey, values),
        interactive,
      },
    };
  }
  // Groups items by category and offers the categories themselves as a
  // tappable list — id carries "category:{name}" so the *next* inbound tap
  // is resolved directly by id in resolve() (see the interactiveSelectionId
  // check near the top), unlike deterministic-reply.service.ts's sibling
  // menuCategoriesReply(), which has no id-based dispatch available to it
  // and has to rely on the tapped title's text instead. Same >10-categories
  // cap and the same documented gap (the smallest categories are dropped
  // from the picker, not merged) as that sibling implementation — see its
  // comment for the full reasoning.
  private categoryPickerReply(locale: Locale, items: Item[]): DeterministicReply {
    const counts = new Map<string, number>();
    for (const item of items) {
      const category = item.category ?? this.copy(locale, "categoryUncategorized");
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    // Sorted by item count purely to decide which categories survive the
    // 10-row cap — never shown to the customer, per the project owner's own
    // call: "Ese 3 productos ... no debería salir".
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const body = this.copy(locale, "categoriesHeading");
    const interactive: InteractiveMessage = {
      type: "list",
      body: "",
      buttonLabel: this.copy(locale, "chooseButtonLabel"),
      options: top.map(([category]) => ({
        id: `category:${category}`,
        title: this.truncate(`${this.copy(locale, "categoryPrefix")} ${category}`, 24),
      })),
    };
    return {
      ...this.reply(body),
      responsePlan: { kind: "verified_content", body, interactive },
    };
  }
  // Resolves a category picked from categoryPickerReply() (id
  // "category:{name}") straight back to that category's own items, via
  // catalogChoiceReply() — never re-shows the picker even if this category
  // still has more than 10 items, since that would loop back into a picker
  // with just one row and go nowhere; the plain catalogButtonReply fallback
  // (called by whichever caller of catalogChoiceReply this ends up
  // reaching) already covers that rare case.
  private async categoryItemsReply(
    client: PoolClient,
    locale: Locale,
    timezone: string,
    category: string,
  ): Promise<DeterministicReply | null> {
    const uncategorizedLabel = this.copy(locale, "categoryUncategorized");
    const items = (await this.catalogItems(client, timezone)).filter(
      (item) => (item.category ?? uncategorizedLabel) === category,
    );
    if (items.length === 0 || items.length > 10) return null;
    return this.catalogChoiceReply(locale, items, "categoryItemsHeading", { category });
  }
  // Final fallback when catalogChoiceReply() can't show the list itself
  // (an empty catalog, or a single category somehow still over WhatsApp's
  // 10-row limit) — a tappable "Ver
  // menú" button instead of telling the customer to type a command in
  // quotes. Tapping it reconstructs as its own title text, which already
  // matches the existing "catalog" pattern rule the same as if the
  // customer had typed it, so no new dispatch plumbing is needed. Found
  // live: a customer would never be told to *type* something when every
  // other prompt in this flow already answers with real buttons.
  private catalogButtonReply(
    locale: Locale,
    bodyKey: CommercialCopyKey,
    values: Record<string, string | number> = {},
  ): DeterministicReply {
    const interactive: InteractiveMessage = {
      type: "buttons",
      body: "",
      options: [{ id: "cart:view_catalog", title: this.copy(locale, "viewMenuButton") }],
    };
    return {
      ...this.reply(this.copy(locale, bodyKey, values)),
      responsePlan: {
        kind: "verified_content",
        body: this.copy(locale, bodyKey, values),
        interactive,
      },
    };
  }
  // "/help" used to list every global command as ten quoted phrases in one
  // paragraph ("...puedes escribir \"ver menú\", \"ver pedido\"..."). Same
  // rule D-095 already set for item/greetingItem/itemUnknown/
  // greetingItemUnknown ("no debería aparecer nada entre comillas... para
  // eso tenemos las opciones que hemos creado") applies here too — found
  // live still showing it. Exactly ten commands fit WhatsApp's own 10-row
  // list cap, one row each, titled with the same phrasing already used as
  // a button elsewhere in this flow (or, for the three that had no
  // existing button — view order/back/handoff — a new short copy key) so a
  // tap round-trips through the identical rule match a typed command
  // would.
  private helpReply(locale: Locale): DeterministicReply {
    const optionKeys: CommercialCopyKey[] = [
      "viewMenuButton",
      "viewOrderOption",
      "addItemButton",
      "changeRemoveOption",
      "changeQuantityOption",
      "backOption",
      "changeFulfillmentOption",
      "changeAddressOption",
      "cancelOrderButton",
      "handoffOption",
    ];
    const interactive: InteractiveMessage = {
      type: "list",
      body: "",
      buttonLabel: this.copy(locale, "chooseButtonLabel"),
      options: optionKeys.map((key, index) => ({
        id: String(index + 1),
        title: this.copy(locale, key),
      })),
    };
    return {
      ...this.reply(this.copy(locale, "help")),
      responsePlan: {
        kind: "verified_content",
        body: this.copy(locale, "help"),
        interactive,
      },
    };
  }
  // Only counts lines that stayed on a *confirmed* order ('ready' is the
  // post-confirmation status — see commercial_requests' check constraint
  // tying it to confirmed_at) so an abandoned/cancelled draft never inflates
  // a variant's popularity.
  private async mostOrderedItems(client: PoolClient, limit = 5): Promise<Item[]> {
    const result = await client.query<Item>(
      `select item.id item_id,variant.id variant_id,item.name,variant.name variant_name,variant.price_minor::text,variant.currency
       from app.request_lines line
       join app.commercial_requests request on request.tenant_id=line.tenant_id and request.id=line.commercial_request_id
       join app.item_variants variant on variant.tenant_id=line.tenant_id and variant.id=line.item_variant_id
       join app.catalog_items item on item.tenant_id=variant.tenant_id and item.id=variant.catalog_item_id
       where request.status='ready' and line.status='active'
         and item.status='active' and item.customer_orderable and variant.status='active' and variant.availability_status='available'
       group by item.id,variant.id,item.name,variant.name,variant.price_minor,variant.currency
       order by count(*) desc,item.name
       limit $1`,
      [limit],
    );
    return result.rows;
  }
  // A customer explicitly asking to be recommended something ("recomiéndame
  // algo") has no cart-based pairwise context to draw on yet (that's what
  // RecommendationService.suggest() is for, triggered reactively after an
  // item is added) — falls back to the tenant's best-sellers instead of
  // falling through to item-name matching and failing with itemUnknown.
  private async recommendationRequestReply(
    client: PoolClient,
    locale: Locale,
  ): Promise<DeterministicReply> {
    const items = await this.mostOrderedItems(client);
    return (
      this.catalogChoiceReply(locale, items, "recommendationSuggestion") ??
      // Same "no quoted instruction, use the real button" rule D-095 set
      // for the empty/oversized-catalog case — this is the same situation
      // (nothing to show as a tappable list), so it reuses the identical
      // catalogButtonReply fallback instead of the "ver menú" text.
      this.catalogButtonReply(locale, "recommendationNone")
    );
  }
  // Shows the customer's own cart as tappable options instead of leaving
  // them to retype a product name from memory (see the Wendy Muñoz
  // conversation review — typos/paraphrases of an in-cart item repeatedly
  // failed to match). Falls back to the plain-text prompt when the cart is
  // empty or exceeds WhatsApp's 10-row list limit.
  private async removeWhichReply(
    client: PoolClient,
    flow: Workflow,
    locale: Locale,
  ): Promise<DeterministicReply> {
    const items = await this.cartItems(client, flow.commercial_request_id);
    const listable = items.length > 0 && items.length <= 10;
    // Persisting the exact lines offered means the tap that follows is
    // resolved by index (handleRemovingItem's tiedChoice branch) instead of
    // being re-matched by name — the same reason startNewOrder persists its
    // ties. Found live in this reply's change-quantity twin: "Sopa MX" is a
    // token-subset of "Sandwich de queso y Sopa MX", so tapping that very
    // row re-tied against the other line and the conversation looped with
    // no way to ever pick it.
    await this.step(client, flow.id, "removing_item", {
      ...flow.context,
      ...(listable ? { tiedItems: items } : {}),
    });
    return listable
      ? this.itemChoiceReply(locale, items, "removeWhich")
      : this.localizedReply(locale, "removeWhich");
  }
  // Used to ask "indicate the product and new quantity" as one bare-text
  // prompt with a quoted example ("3 tacos de birria") — the customer had to
  // already know the exact product name and type it themselves, with no way
  // to see what was actually in the cart. Mirrors removeWhichReply: shows
  // the cart as tappable options when it's short enough for a WhatsApp list,
  // falls back to the plain question (no interactive) only for the
  // degenerate cases — an empty cart, or one long enough to blow the 10-row
  // cap. A tapped option's title becomes the next inbound message (same
  // convention as itemChoiceReply everywhere else), which resolves to a
  // `match` with no quantity yet — see handleChangingQuantityItem, which
  // then asks quantityHowMany next instead of re-showing this list.
  private async changeQuantityWhichReply(
    client: PoolClient,
    flow: Workflow,
    locale: Locale,
  ): Promise<DeterministicReply> {
    const items = await this.cartItems(client, flow.commercial_request_id);
    const listable = items.length > 0 && items.length <= 10;
    // Same tie-persisting reason as removeWhichReply above — found live
    // here first: tapping "Sopa MX" from this very list re-matched by name,
    // tied against "Sandwich de queso y birria y Sopa MX", and every answer
    // after it (including the bare number) came back to this same question.
    await this.step(client, flow.id, "changing_quantity_item", {
      ...flow.context,
      ...(listable ? { tiedItems: items } : {}),
    });
    return listable
      ? this.itemChoiceReply(locale, items, "quantityWhich")
      : this.localizedReply(locale, "quantityWhich");
  }
  // Runs right after an item lands in the cart, from all three "an item was
  // just added" call sites (top-level order start, selecting_item step,
  // free-text match in awaiting_more_items). Offers the item's configured
  // extras (app.item_modifier_groups) before falling through to the normal
  // "anything else?" prompt when it has none.
  private async afterAddItem(
    client: PoolClient,
    input: { tenantId: string; conversationId: string; locale: Locale },
    requestId: string,
    flowId: string,
    item: Item,
  ): Promise<DeterministicReply> {
    const modifiers = await this.itemModifiers(client, item.item_id);
    if (modifiers.length === 0) {
      await this.step(client, flowId, "awaiting_more_items", {});
      return this.afterCartChange(client, input, requestId);
    }
    const line = await client.query<{ id: string }>(
      `select id from app.request_lines where commercial_request_id=$1 and item_variant_id=$2 and status='active' order by created_at desc limit 1`,
      [requestId, item.variant_id],
    );
    await this.step(client, flowId, "selecting_modifiers", {
      requestLineId: line.rows[0]?.id ?? null,
    });
    return this.modifierChoiceReply(input.locale, modifiers);
  }
  // First still-unmet group among the offered options (there is only ever
  // one on Santos Tacos' current setup, but this holds for an item with
  // several required groups too). Options are already deduped by group_id
  // only in the sense that every option of the same group carries the same
  // group_picked/min_selections, so checking the first occurrence per group
  // is enough.
  private unmetRequiredGroup(
    options: ModifierOption[],
  ): { groupId: string; groupName: string; needed: number } | null {
    const seen = new Set<string>();
    for (const option of options) {
      if (seen.has(option.group_id)) continue;
      seen.add(option.group_id);
      const min = Number(option.min_selections ?? 0);
      const picked = Number(option.group_picked ?? 0);
      if (min > picked)
        return {
          groupId: option.group_id,
          groupName: option.group_name,
          needed: min - picked,
        };
    }
    return null;
  }
  private async itemModifiers(client: PoolClient, catalogItemId: string): Promise<ModifierOption[]> {
    const result = await client.query<ModifierOption>(
      `select opt.id as option_id,opt.modifier_group_id as group_id,grp.selection_type,
              opt.name,opt.price_delta_minor::text,opt.currency,'0' as quantity,
              grp.min_selections::text as min_selections,grp.max_selections::text as max_selections,
              grp.name as group_name,'0' as group_picked
         from app.item_modifier_groups link
         join app.modifier_groups grp on grp.tenant_id=link.tenant_id and grp.id=link.modifier_group_id
         join app.modifier_options opt on opt.tenant_id=grp.tenant_id and opt.modifier_group_id=grp.id
        where link.catalog_item_id=$1 and grp.status='active' and opt.status='active'
        order by link.sort_order,opt.sort_order`,
      [catalogItemId],
    );
    return result.rows;
  }
  // Options still offerable for a line. A 'multiple' (checkbox) option stays
  // offered even after being picked — tapping it again increments its
  // quantity (see addModifier) rather than being removed, per the customer's
  // "cómo indico 2 porciones" ask — until the group's max_selections (if
  // any) is reached, e.g. Santos Tacos' "elige tus 3 tacos" package group
  // (min=max=3, see D-099): once the 3rd taco is picked, group_totals.picked
  // hits max_selections and the whole group stops being offered, same as a
  // 'single' group after its one pick. A 'single' (radio-button) option's
  // whole group disappears once any option in it has been picked, which is
  // what gives single-select semantics without a separate "replace the
  // previous pick" step.
  private async remainingModifiers(
    client: PoolClient,
    requestLineId: string,
  ): Promise<ModifierOption[]> {
    const result = await client.query<ModifierOption>(
      `select opt.id as option_id,opt.modifier_group_id as group_id,grp.selection_type,
              opt.name,opt.price_delta_minor::text,opt.currency,
              coalesce(picked.quantity::text,'0') as quantity,
              grp.min_selections::text as min_selections,grp.max_selections::text as max_selections,
              grp.name as group_name,coalesce(group_totals.picked,0)::text as group_picked
         from app.item_modifier_groups link
         join app.modifier_groups grp on grp.tenant_id=link.tenant_id and grp.id=link.modifier_group_id
         join app.modifier_options opt on opt.tenant_id=grp.tenant_id and opt.modifier_group_id=grp.id
         left join app.request_line_modifiers picked
           on picked.tenant_id=opt.tenant_id and picked.request_line_id=$1 and picked.modifier_option_id=opt.id
         left join (
           select mo.modifier_group_id as group_id,sum(rlm.quantity) as picked
             from app.request_line_modifiers rlm
             join app.modifier_options mo on mo.tenant_id=rlm.tenant_id and mo.id=rlm.modifier_option_id
            where rlm.request_line_id=$1
            group by mo.modifier_group_id
         ) group_totals on group_totals.group_id=grp.id
        where grp.status='active' and opt.status='active'
          and link.catalog_item_id=(
            select variant.catalog_item_id from app.item_variants variant
              join app.request_lines rl on rl.tenant_id=variant.tenant_id and rl.item_variant_id=variant.id
             where rl.id=$1
          )
          and (
            (
              grp.selection_type='multiple'
              and (grp.max_selections is null or coalesce(group_totals.picked,0)<grp.max_selections)
            )
            or (
              grp.selection_type='single'
              and grp.id not in (
                select mg2.id from app.request_line_modifiers rlm
                  join app.modifier_options mo2 on mo2.tenant_id=rlm.tenant_id and mo2.id=rlm.modifier_option_id
                  join app.modifier_groups mg2 on mg2.tenant_id=mo2.tenant_id and mg2.id=mo2.modifier_group_id
                 where rlm.request_line_id=$1 and mg2.selection_type='single'
              )
            )
          )
        order by link.sort_order,opt.sort_order`,
      [requestLineId],
    );
    return result.rows;
  }
  private async addModifier(
    client: PoolClient,
    tenantId: string,
    requestId: string,
    requestLineId: string,
    option: ModifierOption,
  ) {
    const existing = await client.query<{ id: string; quantity: string }>(
      `select id,quantity::text from app.request_line_modifiers where request_line_id=$1 and modifier_option_id=$2`,
      [requestLineId, option.option_id],
    );
    if (existing.rows[0]) {
      const nextQuantity = Number(existing.rows[0].quantity) + 1;
      await client.query(
        `update app.request_line_modifiers set quantity=$2,total_delta_minor=$3::bigint where id=$1`,
        [existing.rows[0].id, nextQuantity, String(Number(option.price_delta_minor) * nextQuantity)],
      );
    } else {
      await client.query(
        `insert into app.request_line_modifiers
          (id,tenant_id,request_line_id,modifier_option_id,description_snapshot,unit_price_delta_minor_snapshot,quantity,total_delta_minor)
         values($1,$2,$3,$4,$5,$6::bigint,1,$6::bigint)`,
        [uuidv7(), tenantId, requestLineId, option.option_id, option.name, option.price_delta_minor],
      );
    }
    await this.recalculate(client, requestId);
  }
  // Same buttons-for-3-or-fewer / list-beyond pattern as itemChoiceReply,
  // plus an always-present "Listo" row so extras stay genuinely optional —
  // see D-046/D-040 conservative-fallback precedent. Capped at 9 real
  // options so "Listo" never pushes a tenant-configured list past WhatsApp's
  // 10-row limit.
  private modifierChoiceReply(
    locale: Locale,
    options: ModifierOption[],
    justAdded?: string,
    unmetGroup?: { groupId: string; groupName: string; needed: number } | null,
  ): DeterministicReply {
    // A group the customer *must* answer is offered on its own. Mixing it
    // with the optional groups both buried the choice that actually blocks
    // the order and pushed real options past WhatsApp's 10-row cap — found
    // live on "Orden x 3 Tacos": 5 taco choices + 3 salsas + 2 adiciones +
    // "Listo" is 11 rows, so "Queso extra" was silently unreachable, and
    // the prompt read "¿Quieres agregar alguna adición?" over a list whose
    // first five rows were the mandatory flavors. The optional groups come
    // back in full the moment the required one is satisfied (its options
    // stop being offered at max_selections, see remainingModifiers).
    const unmet = unmetGroup ?? this.unmetRequiredGroup(options);
    const offered = unmet
      ? options.filter((option) => option.group_id === unmet.groupId)
      : options;
    const shown = offered.slice(0, 9);
    // Name-plus-price routinely exceeds WhatsApp's 20-char button-title
    // limit ("Queso extra (+$ 3.000)" alone is 22) — buttons show the name
    // only, list rows carry the price (and running quantity, so a tenant can
    // tap the same 'multiple' option again to add more — see addModifier) in
    // `description` instead, which has room to spare (72 chars). The title
    // itself is always the bare option name, in both formats: a tap's title
    // becomes the next inbound message, matched back via norm(option.name)
    // in the selecting_modifiers step, so it can never carry a suffix.
    const priceText = (option: ModifierOption) =>
      Number(option.price_delta_minor) > 0
        ? `+${formatMoney(option.price_delta_minor, option.currency, locale)}`
        : undefined;
    // A name longer than the list row's own 24-char title cap (e.g. "Salsa
    // de Mermelada de Jalapeño", 31 chars) used to just lose everything past
    // "Salsa de Mermelada de J…" with no fallback — descriptionFor only ever
    // carried quantity/price, never the name itself. Found live testing
    // Santos Nachos' own Salsas group (D-102) — same class of bug already
    // fixed for itemChoiceReply in D-101, missed here.
    const descriptionFor = (option: ModifierOption) => {
      const parts = [
        option.name.length > 24 ? option.name : null,
        Number(option.quantity) > 0 ? `x${Number(option.quantity)}` : null,
        priceText(option) ?? null,
      ].filter((part): part is string => part !== null);
      return parts.length ? this.truncate(parts.join(" · "), 72) : undefined;
    };
    const finishTitle = this.copy(locale, "finishButton");
    // Same D-101 reasoning as itemChoiceReply: a name that wouldn't survive
    // a button's 20-char cap forces `list` regardless of how few options
    // there are, so it gets the list's extra room (24 chars + description)
    // instead of being silently cut short.
    const hasLongName = shown.some((option) => option.name.length > 20);
    const interactive: InteractiveMessage =
      shown.length < 3 && !hasLongName
        ? {
            type: "buttons",
            body: "",
            options: [
              ...shown.map((option) => ({
                id: option.option_id,
                title: this.truncate(option.name, 20),
              })),
              { id: "modifier:finish", title: this.truncate(finishTitle, 20) },
            ],
          }
        : {
            type: "list",
            body: "",
            buttonLabel: this.copy(locale, "chooseButtonLabel"),
            options: [
              ...shown.map((option) => ({
                id: option.option_id,
                title: this.truncate(option.name, 24),
                ...(descriptionFor(option) ? { description: descriptionFor(option) } : {}),
              })),
              { id: "modifier:finish", title: this.truncate(finishTitle, 24) },
            ],
          };
    // Buttons render bare option names with no room for a running quantity
    // (only the list format's description can show "x1" — and this tenant's
    // 2-option group always renders as buttons, never a list) — so picking
    // "Guacamole" was met with the exact same "¿Quieres agregar algo
    // extra?" prompt as before, with no visible sign it was added. Found
    // live: a real customer picked two different extras in a row and got
    // an identical, unchanged message both times. The body itself now
    // acknowledges what was just added instead of relying on the
    // interactive alone.
    // Both signals matter and used to be mutually exclusive: what was just
    // added (D-066 — a customer picking two extras in a row saw the same
    // unchanged prompt twice and couldn't tell either had landed) and what
    // is still required before the package can be finished. When both
    // apply they are said in one sentence rather than one silencing the
    // other.
    const body =
      unmet && justAdded
        ? this.copy(locale, "modifierAddedMinRequired", {
            item: justAdded,
            needed: unmet.needed,
            group: unmet.groupName,
          })
        : unmet
          ? this.copy(locale, "modifierMinRequired", {
              needed: unmet.needed,
              group: unmet.groupName,
            })
          : justAdded
            ? this.copy(locale, "modifierAdded", { item: justAdded })
            : this.copy(locale, "modifierChoice");
    return {
      ...this.reply(body),
      responsePlan: {
        kind: "verified_content",
        body,
        interactive,
      },
    };
  }
  private async addItem(
    client: PoolClient,
    tenantId: string,
    requestId: string,
    item: Item,
    quantity = 1,
    mode: "add" | "replace" = "add",
    // "Cambiar producto" on a cart with more than one line needs to know
    // exactly which line the customer picked (selectingReplaceTargetReply)
    // — without it, "replace" fell back to the single-item shortcut of
    // always swapping whichever line happened to be added first, silently
    // changing the wrong product on any multi-item cart. Found live.
    replaceTargetVariantId?: string,
  ) {
    const current = await client.query<{ id: string; quantity: string }>(
      mode === "replace"
        ? replaceTargetVariantId
          ? `select id,quantity::text from app.request_lines where commercial_request_id=$1 and item_variant_id=$2 and status='active' order by created_at limit 1`
          : `select id,quantity::text from app.request_lines where commercial_request_id=$1 and status='active' order by created_at limit 1`
        : `select id,quantity::text from app.request_lines where commercial_request_id=$1 and item_variant_id=$2 and status='active' order by created_at limit 1`,
      mode === "replace"
        ? replaceTargetVariantId
          ? [requestId, replaceTargetVariantId]
          : [requestId]
        : [requestId, item.variant_id],
    );
    if (current.rows[0]) {
      const next =
        mode === "replace"
          ? quantity
          : Number(current.rows[0].quantity) + quantity;
      await client.query(
        `update app.request_lines set item_variant_id=$2,description_snapshot=$3,unit_price_minor_snapshot=$4::bigint,currency=$5,quantity=$6::numeric,line_total_minor=round($4::bigint*$6::numeric)::bigint,updated_at=now() where id=$1`,
        [
          current.rows[0].id,
          item.variant_id,
          `${item.name} (${item.variant_name})`,
          item.price_minor,
          item.currency,
          next,
        ],
      );
    } else
      await client.query(
        `insert into app.request_lines(id,tenant_id,commercial_request_id,item_variant_id,description_snapshot,unit_price_minor_snapshot,currency,quantity,line_total_minor) values($1,$2,$3,$4,$5,$6::bigint,$7,$8::numeric,round($6::bigint*$8::numeric)::bigint)`,
        [
          uuidv7(),
          tenantId,
          requestId,
          item.variant_id,
          `${item.name} (${item.variant_name})`,
          item.price_minor,
          item.currency,
          quantity,
        ],
      );
    await this.recalculate(client, requestId);
  }
  private async removeItem(
    client: PoolClient,
    flow: Workflow,
    locale: Locale,
    item: Item,
  ) {
    return this.removeItems(client, flow, locale, [item]);
  }
  // Backs both a single removal and the "Todas" option offered when a
  // remove-item tie is between variants of the same product — see
  // itemChoiceReply's allowRemoveAll.
  private async removeItems(
    client: PoolClient,
    flow: Workflow,
    locale: Locale,
    items: Item[],
  ) {
    let anyRemoved = false;
    for (const item of items) {
      const removed = await client.query<{ id: string }>(
        `update app.request_lines set status='removed',removed_at=now(),updated_at=now() where commercial_request_id=$1 and item_variant_id=$2 and status='active' returning id`,
        [flow.commercial_request_id, item.variant_id],
      );
      if (removed.rows[0]) anyRemoved = true;
    }
    if (!anyRemoved) return this.localizedReply(locale, "itemNotInCart");
    await this.recalculate(client, flow.commercial_request_id);
    await this.step(client, flow.id, "awaiting_more_items", {});
    return this.withMoreItems(client, flow.commercial_request_id, locale);
  }
  private async changeQuantity(
    client: PoolClient,
    flow: Workflow,
    locale: Locale,
    item: Item,
    quantity: number,
  ) {
    const changed = await client.query<{ id: string }>(
      `update app.request_lines set quantity=$3::numeric,line_total_minor=round(unit_price_minor_snapshot*$3::numeric)::bigint,updated_at=now() where commercial_request_id=$1 and item_variant_id=$2 and status='active' returning id`,
      [flow.commercial_request_id, item.variant_id, quantity],
    );
    if (!changed.rows[0]) return this.localizedReply(locale, "itemNotInCart");
    await this.recalculate(client, flow.commercial_request_id);
    await this.step(client, flow.id, "awaiting_more_items", {});
    return this.withMoreItems(client, flow.commercial_request_id, locale);
  }
  private recalculate(client: PoolClient, requestId: string) {
    return client.query(
      `update app.commercial_requests request set subtotal_minor=totals.value,total_minor=totals.value,updated_at=now()
       from (
         select coalesce(sum(line.line_total_minor),0)
              + coalesce((select sum(modifier.total_delta_minor) from app.request_line_modifiers modifier
                          join app.request_lines ml on ml.tenant_id=modifier.tenant_id and ml.id=modifier.request_line_id
                          where ml.commercial_request_id=$1 and ml.status='active'),0) as value
         from app.request_lines line where line.commercial_request_id=$1 and line.status='active'
       ) totals
       where request.id=$1`,
      [requestId],
    );
  }
  // Automatic "1 packaging fee per N food items, minimum 1 whenever the
  // order has anything at all, only for pickup/delivery" (D-104) — entirely
  // data-driven per tenant (app.catalog_items.is_packaging_fee/
  // packaging_ratio/counts_toward_packaging), never hardcoded to one
  // product name or one tenant. A tenant with no packaging-fee item
  // configured is a no-op here, same as before this feature existed.
  private async syncPackagingFee(client: PoolClient, requestId: string) {
    // One query for both the request's own fulfillment_type and its
    // tenant's packaging-fee config (left join — most tenants configure
    // none, so this stays a single round trip either way, not two).
    const request = await client.query<{
      tenant_id: string; fulfillment_type: string | null;
      variant_id: string | null; item_name: string | null; price_minor: string | null; currency: string | null; ratio: number | null;
    }>(
      `select request.tenant_id,request.fulfillment_type,
              variant.id as variant_id,item.name as item_name,variant.price_minor::text,variant.currency,item.packaging_ratio as ratio
         from app.commercial_requests request
         left join app.catalog_items item
           on item.tenant_id=request.tenant_id and item.is_packaging_fee=true and item.status='active'
         left join app.item_variants variant
           on variant.tenant_id=item.tenant_id and variant.catalog_item_id=item.id and variant.status='active'
        where request.id=$1`,
      [requestId],
    );
    const requestRow = request.rows[0];
    if (!requestRow || !requestRow.variant_id) return;
    const config = requestRow as {
      tenant_id: string; variant_id: string; item_name: string; price_minor: string; currency: string; ratio: number | null;
    };
    const wantsPackaging =
      !!config.ratio &&
      (requestRow.fulfillment_type === "pickup" || requestRow.fulfillment_type === "delivery");
    const existing = await client.query<{ id: string }>(
      `select id from app.request_lines where commercial_request_id=$1 and item_variant_id=$2 and status='active'`,
      [requestId, config.variant_id],
    );
    if (!wantsPackaging) {
      if (existing.rows[0]) {
        await client.query(
          `update app.request_lines set status='removed',removed_at=now(),updated_at=now() where id=$1`,
          [existing.rows[0].id],
        );
      }
      return;
    }
    const counts = await client.query<{ food: string; total: string }>(
      `select
         coalesce(sum(line.quantity) filter (where item.counts_toward_packaging),0)::text as food,
         coalesce(sum(line.quantity),0)::text as total
       from app.request_lines line
       join app.item_variants variant on variant.tenant_id=line.tenant_id and variant.id=line.item_variant_id
       join app.catalog_items item on item.tenant_id=variant.tenant_id and item.id=variant.catalog_item_id
      where line.commercial_request_id=$1 and line.status='active' and item.is_packaging_fee=false`,
      [requestId],
    );
    // "no se puede quitar si hay mínimo un item, sin importar si es comida
    // o gaseosa" — the floor of 1 applies once *anything* real is in the
    // cart, even an order of drinks alone (which count toward `total` but
    // not `food`, per the separate counts_toward_packaging flag).
    if (Number(counts.rows[0].total) === 0) {
      if (existing.rows[0]) {
        await client.query(
          `update app.request_lines set status='removed',removed_at=now(),updated_at=now() where id=$1`,
          [existing.rows[0].id],
        );
      }
      return;
    }
    const packages = Math.max(1, Math.ceil(Number(counts.rows[0].food) / (config.ratio as number)));
    const lineTotal = String(Number(config.price_minor) * packages);
    if (existing.rows[0]) {
      await client.query(
        `update app.request_lines set quantity=$2::numeric,line_total_minor=$3::bigint,updated_at=now() where id=$1`,
        [existing.rows[0].id, packages, lineTotal],
      );
    } else {
      await client.query(
        `insert into app.request_lines(id,tenant_id,commercial_request_id,item_variant_id,description_snapshot,unit_price_minor_snapshot,currency,quantity,line_total_minor)
         values($1,$2,$3,$4,$5,$6::bigint,$7,$8::numeric,$9::bigint)`,
        [
          uuidv7(),
          requestRow.tenant_id,
          requestId,
          config.variant_id,
          config.item_name,
          config.price_minor,
          config.currency,
          packages,
          lineTotal,
        ],
      );
    }
  }
  private async goBack(client: PoolClient, flow: Workflow, locale: Locale) {
    // 'name' is the only requirement asked before fulfillment; any other
    // awaiting_requirement:* step (delivery_address's sub-steps included, and
    // any custom field configured via the admin panel) is only reached after
    // a modality was chosen, so going back resets the modality — matching
    // the pre-refactor behavior for the address sub-steps exactly.
    if (flow.step === "awaiting_requirement:name") {
      await this.step(client, flow.id, "awaiting_more_items", {});
      return this.withMoreItems(client, flow.commercial_request_id, locale);
    }
    if (flow.step.startsWith("awaiting_requirement:")) {
      await client.query(
        `update app.commercial_requests set fulfillment_type=null,updated_at=now() where id=$1`,
        [flow.commercial_request_id],
      );
      await this.step(client, flow.id, "awaiting_fulfillment", {});
      return this.fulfillmentReply(client, flow.commercial_request_id, locale);
    }
    if (flow.step === "awaiting_confirmation") {
      await this.step(client, flow.id, "awaiting_fulfillment", {});
      return this.fulfillmentReply(client, flow.commercial_request_id, locale);
    }
    if (flow.step === "awaiting_fulfillment") {
      await this.step(client, flow.id, "awaiting_more_items", {});
      return this.withMoreItems(client, flow.commercial_request_id, locale);
    }
    if (flow.step === "selecting_item") {
      await this.step(client, flow.id, "awaiting_more_items", {});
      return this.withMoreItems(client, flow.commercial_request_id, locale);
    }
    return this.localizedReply(locale, "alreadyFirstStep");
  }
  private step(
    client: PoolClient,
    id: string,
    step: string,
    context: Record<string, unknown>,
  ) {
    return client.query(
      `update app.conversation_workflows set step=$2,context=$3::jsonb,updated_at=now() where id=$1`,
      [id, step, JSON.stringify(context)],
    );
  }
  // Looks up the currently-filled field keys from context, asks for the next
  // configured requirement for this fulfillment modality if any remain, or
  // moves on to the order summary/confirmation when the list is exhausted.
  // Applies a captured requirement value: queued for explicit confirmation
  // when the tenant marked the field sensitive, merged straight into
  // context.values otherwise. Shared by the single-field answer path and the
  // D-040 multi-entity extraction path so requiresConfirmation is honored
  // identically regardless of how the value was captured.
  private applyRequirementValue(
    requirement: PendingRequirement,
    value: string,
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    if (requirement.requiresConfirmation)
      return {
        ...context,
        pendingConfirmations: {
          ...((context.pendingConfirmations as Record<string, string>) ?? {}),
          [requirement.fieldKey]: value,
        },
      };
    return {
      ...context,
      values: {
        ...((context.values as Record<string, string>) ?? {}),
        [requirement.fieldKey]: value,
      },
    };
  }
  private confirmationPrompt(
    locale: Locale,
    requirement: PendingRequirement,
    value: string,
  ): DeterministicReply {
    return this.yesNoReply(locale, "requirementConfirm", {
      label: requirement.label ?? requirement.fieldKey,
      value,
    });
  }
  private async afterRequirementFilled(
    client: PoolClient,
    flow: Workflow,
    input: UnderstoodFlowInput,
    context: Record<string, unknown>,
  ): Promise<DeterministicReply> {
    const pendingConfirmations = {
      ...((context.pendingConfirmations as Record<string, string>) ?? {}),
    };
    const confirmationKeys = Object.keys(pendingConfirmations);
    if (confirmationKeys.length) {
      // D-040: resolve queued sensitive auto-fills one at a time, in
      // configured display order. Deliberately skips a fresh extraction pass
      // this turn — a bare "sí"/"no" reply here must resolve THIS
      // confirmation, not be reinterpreted as an answer to some other
      // pending boolean field.
      const requirementsInOrder = await this.requirements.getPendingRequirements(
        client,
        input.tenantId,
        "order",
        this.fulfillmentTypeOf(context),
        [],
        input.locale,
      );
      const fieldKey = confirmationKeys.sort(
        (a, b) =>
          (requirementsInOrder.find((r) => r.fieldKey === a)?.displayOrder ??
            0) -
          (requirementsInOrder.find((r) => r.fieldKey === b)?.displayOrder ??
            0),
      )[0];
      const requirement = requirementsInOrder.find(
        (r) => r.fieldKey === fieldKey,
      );
      await this.step(
        client,
        flow.id,
        `awaiting_requirement:${fieldKey}:confirm`,
        context,
      );
      return requirement
        ? this.confirmationPrompt(
            input.locale,
            requirement,
            pendingConfirmations[fieldKey],
          )
        : this.yesNoReply(input.locale, "yesNo");
    }
    // Fulfillment (the modality discriminator: delivery/pickup/on_site) is
    // resolved via its own cabled awaiting_fulfillment step, not a
    // PendingRequirement (D-039 decision 6) — but modality-specific
    // requirements and the confirmation summary both need it known first.
    // Reached with it still unset right after the pre-fulfillment 'name'
    // field is answered (name has no fulfillment dependency, see the
    // wildcard '*' row); ask for it now instead of silently skipping past it
    // to confirmation. Found via live conversation testing — no unit test
    // caught this because the mocked getPendingRequirements never reflected
    // what a real fulfillment_type=null query actually returns.
    if (typeof context.fulfillment !== "string") {
      await this.step(client, flow.id, "awaiting_fulfillment", context);
      return this.fulfillmentReply(client, flow.commercial_request_id, input.locale);
    }
    const filledKeys = ["name", ...Object.keys((context.values as Record<string, string>) ?? {})];
    if (context.address) filledKeys.push("delivery_address");
    const pending = await this.requirements.getPendingRequirements(
      client,
      input.tenantId,
      "order",
      this.fulfillmentTypeOf(context),
      filledKeys,
      input.locale,
    );
    // D-040: opportunistically fill other still-pending custom fields
    // mentioned in the same message (never name/delivery_address, which keep
    // their bespoke sub-flows above). If anything is extracted, recurse once:
    // the recursive call will either pick up a queued confirmation (handled
    // by the branch above) or continue straight to nextPendingStep below —
    // either way the "compute pending, decide next" logic only lives once.
    const customPending = pending.filter((r) => r.fieldKey !== "delivery_address");
    const extracted = extractPendingRequirementValues(
      input.body,
      input.understanding.entities,
      customPending,
    );
    if (extracted.length) {
      let updatedContext = context;
      for (const { fieldKey, value } of extracted) {
        const requirement = customPending.find((r) => r.fieldKey === fieldKey);
        if (requirement)
          updatedContext = this.applyRequirementValue(
            requirement,
            value,
            updatedContext,
          );
      }
      return this.afterRequirementFilled(client, flow, input, updatedContext);
    }
    const next = nextPendingStep(pending, filledKeys);
    if (next) {
      if (next.fieldKey === "delivery_address" && next.reuseFromContactMemory) {
        const address = await client.query<{
          id: string;
          label: string;
          address_line: string;
        }>(
          `select id,label,address_line from app.contact_addresses where contact_id=$1 and status='active' order by is_default desc,last_used_at desc nulls last limit 1`,
          [input.contactId],
        );
        if (address.rows[0]) {
          const withSavedAddress = {
            ...context,
            addressId: address.rows[0].id,
            address: address.rows[0].address_line,
          };
          await this.step(
            client,
            flow.id,
            "awaiting_requirement:delivery_address:saved",
            withSavedAddress,
          );
          return this.yesNoReply(input.locale, "savedAddress", {
            label: address.rows[0].label,
            address: address.rows[0].address_line,
          });
        }
        await this.step(
          client,
          flow.id,
          "awaiting_requirement:delivery_address:value",
          context,
        );
        return this.requirementPrompt(input.locale, next);
      }
      await this.step(client, flow.id, `awaiting_requirement:${next.fieldKey}`, context);
      return this.requirementPrompt(input.locale, next);
    }
    await this.step(client, flow.id, "awaiting_confirmation", context);
    return this.plannedReply(
      await this.summary(client, flow.commercial_request_id, context, input.locale),
    );
  }
  // context.fulfillment is unset until awaiting_fulfillment resolves it.
  // String(undefined) silently produces the 3-character string "undefined"
  // instead of null, which getPendingRequirements's SQL treats as a real
  // (non-matching) fulfillment_type value instead of "not yet known" —
  // this previously made the pending-requirements query wrongly return []
  // whenever fulfillment hadn't been asked yet, skipping straight to
  // confirmation without ever asking for delivery/pickup/on-site. Found via
  // live conversation testing, not caught by unit tests (which mock
  // getPendingRequirements and never exercise the real SQL null-handling).
  private fulfillmentTypeOf(context: Record<string, unknown>): string | null {
    return typeof context.fulfillment === "string" ? context.fulfillment : null;
  }
  private async findRequirement(
    client: PoolClient,
    input: UnderstoodFlowInput,
    fulfillmentType: string | null,
    fieldKey: string,
  ): Promise<PendingRequirement | null> {
    const list = await this.requirements.getPendingRequirements(
      client,
      input.tenantId,
      "order",
      fulfillmentType,
      [],
      input.locale,
    );
    return list.find((item) => item.fieldKey === fieldKey) ?? null;
  }
  // Custom requirements need an admin-configured localization (enforced by
  // OperationalRequirementsService.setActive); 'name' and 'delivery_address'
  // fall back to the historical static copy when no localization was added,
  // so tenants that never touch the new panel keep seeing identical text.
  private requirementPrompt(
    locale: Locale,
    requirement: PendingRequirement,
  ): DeterministicReply {
    const builtinFallbackKey: CommercialCopyKey | null =
      requirement.fieldKey === "name"
        ? "name"
        : requirement.fieldKey === "delivery_address"
          ? "address"
          : null;
    if (!requirement.label) {
      if (!builtinFallbackKey)
        throw unprocessable(
          "REQUIREMENT_MISSING_LOCALIZATION",
          `Active requirement ${requirement.fieldKey} has no localization for locale ${locale}`,
        );
      return this.localizedReply(locale, builtinFallbackKey);
    }
    if (requirement.dataType === "boolean")
      return {
        ...this.reply(requirement.label),
        responsePlan: {
          kind: "verified_content",
          body: requirement.label,
          interactive: this.yesNoButtons(locale),
        },
      };
    // A tenant could in principle configure more options than WhatsApp
    // supports in a single list (10); fall back to plain enumerated text
    // rather than send a request Meta would reject.
    if (
      requirement.dataType === "select" &&
      requirement.options.length &&
      requirement.options.length <= 10
    ) {
      const interactive: InteractiveMessage =
        requirement.options.length <= 3
          ? {
              type: "buttons",
              body: "",
              options: requirement.options.map((option, index) => ({
                id: String(index + 1),
                title: this.truncate(option.label, 20),
              })),
            }
          : {
              type: "list",
              body: "",
              buttonLabel: this.copy(locale, "chooseButtonLabel"),
              options: requirement.options.map((option, index) => ({
                id: String(index + 1),
                title: this.truncate(option.label, 24),
              })),
            };
      return {
        ...this.reply(requirement.label),
        responsePlan: {
          kind: "verified_content",
          body: requirement.label,
          interactive,
        },
      };
    }
    const text =
      requirement.dataType === "select" && requirement.options.length
        ? `${requirement.label}\n${requirement.options
            .map((option, index) => `${index + 1}) ${option.label}`)
            .join("\n")}`
        : requirement.label;
    return { ...this.reply(text), responsePlan: { kind: "verified_content", body: text } };
  }
  private async cart(
    client: PoolClient,
    requestId: string,
    locale: Locale,
  ): Promise<PlannedContent> {
    const result = await client.query<{
      id: string;
      description_snapshot: string;
      quantity: string;
      line_total_minor: string;
      total_minor: string;
      currency: string;
    }>(
      `select line.id,line.description_snapshot,line.quantity::text,line.line_total_minor::text,request.total_minor::text,request.currency from app.commercial_requests request join app.request_lines line on line.tenant_id=request.tenant_id and line.commercial_request_id=request.id where request.id=$1 and line.status='active' order by line.created_at`,
      [requestId],
    );
    if (!result.rows.length)
      return this.content(locale, [
        {
          kind: "template",
          template: { namespace: "commercial", key: "emptyCart" },
        },
      ]);
    const modifierRows = await client.query<{
      request_line_id: string;
      description_snapshot: string;
      quantity: string;
      total_delta_minor: string;
    }>(
      `select modifier.request_line_id,modifier.description_snapshot,modifier.quantity::text,modifier.total_delta_minor::text
         from app.request_line_modifiers modifier
         join app.request_lines line on line.tenant_id=modifier.tenant_id and line.id=modifier.request_line_id
        where line.commercial_request_id=$1 and line.status='active'
        order by modifier.created_at`,
      [requestId],
    );
    const money = (value: string) =>
      formatMoney(value, result.rows[0].currency, locale);
    const segments: CommercialSegment[] = [
      { kind: "verified_text", text: "*" },
      {
        kind: "template",
        template: { namespace: "commercial", key: "cartHeading" },
      },
      { kind: "verified_text", text: "*" },
      { kind: "line_break" },
    ];
    result.rows.forEach((row, index) => {
      if (index) segments.push({ kind: "line_break" });
      segments.push({
        kind: "verified_text",
        text: `• ${Number(row.quantity)} × ${row.description_snapshot}: ${money(row.line_total_minor)}`,
      });
      for (const modifier of modifierRows.rows) {
        if (modifier.request_line_id !== row.id) continue;
        const modifierQuantity = Number(modifier.quantity);
        segments.push(
          { kind: "line_break" },
          {
            kind: "verified_text",
            text: `   + ${modifierQuantity > 1 ? `${modifierQuantity} × ` : ""}${modifier.description_snapshot}: ${money(modifier.total_delta_minor)}`,
          },
        );
      }
    });
    segments.push(
      { kind: "line_break" },
      { kind: "verified_text", text: "*" },
      {
        kind: "template",
        template: { namespace: "commercial", key: "totalLabel" },
      },
      {
        kind: "verified_text",
        text: `: ${money(result.rows[0].total_minor)}*`,
      },
    );
    return this.content(locale, segments);
  }
  private async summary(
    client: PoolClient,
    requestId: string,
    context: Record<string, unknown>,
    locale: Locale,
  ): Promise<PlannedContent> {
    const cart = await this.cart(client, requestId, locale);
    const mode: CommercialCopyKey =
      context.fulfillment === "delivery"
        ? "delivery"
        : context.fulfillment === "pickup"
          ? "pickup"
          : "onSite";
    const segments: CommercialSegment[] = [
      { kind: "line_break" },
      { kind: "verified_text", text: "• " },
      {
        kind: "template",
        template: { namespace: "commercial", key: "fulfillmentLabel" },
      },
      { kind: "verified_text", text: ": " },
      { kind: "template", template: { namespace: "commercial", key: mode } },
    ];
    if (context.address)
      segments.push(
        { kind: "line_break" },
        { kind: "verified_text", text: "• " },
        {
          kind: "template",
          template: { namespace: "commercial", key: "addressLabel" },
        },
        { kind: "verified_text", text: `: ${String(context.address)}` },
      );
    segments.push(
      { kind: "line_break" },
      {
        kind: "template",
        template: { namespace: "commercial", key: "confirmOrder" },
      },
    );
    return this.append(
      locale,
      cart,
      segments,
      this.confirmOrderButtons(locale),
      "commercial.orderConfirmation",
    );
  }
  private reply(body: string): DeterministicReply {
    return {
      intent: "order",
      body,
      handoff: false,
      sources: ["commercial_request"],
    };
  }
  private plannedReply(content: PlannedContent): DeterministicReply {
    return {
      ...this.reply(content.body),
      interactive: content.plan.interactive,
      responsePlan: content.plan,
    };
  }
  private prependGreeting(
    reply: DeterministicReply,
    locale: Locale,
    assistant: string,
    business: string,
  ): DeterministicReply {
    if (reply.responsePlan?.kind !== "composite") return reply;
    return this.plannedReply(
      this.content(
        locale,
        [
          {
            kind: "template",
            template: { namespace: "commercial", key: "assistantGreeting" },
            values: { assistant, business },
          },
          { kind: "line_break" },
          ...(reply.responsePlan.segments as CommercialSegment[]),
        ],
        reply.responsePlan.interactive,
      ),
    );
  }
  private async withMoreItems(
    client: PoolClient,
    requestId: string,
    locale: Locale,
  ): Promise<DeterministicReply> {
    const cart = await this.cart(client, requestId, locale);
    return this.plannedReply(
      this.append(
        locale,
        cart,
        [
          { kind: "line_break" },
          {
            kind: "template",
            template: { namespace: "commercial", key: "moreItems" },
          },
        ],
        this.moreItemsButtons(locale),
      ),
    );
  }
  // Mirrors yesNoButtons: body is a placeholder LocalizedResponseComposer
  // overwrites with the plan's rendered "moreItems" text. Titles double as
  // the recognized command text (see classifyFlowCommand/es.rules.json),
  // since a tapped button's title becomes the inbound message body.
  //
  // "Ver menú" used to sit here too, but in this exact context (right after
  // a cart change) it showed the same tappable catalog as "Otro producto"
  // and led to the same place — a second button for an identical result.
  // Dropped per the project owner's call to unify rather than keep both.
  // "ver menú" as a standalone catalog lookup is still reachable any time
  // by typing it — only the redundant button here is gone.
  private moreItemsButtons(locale: Locale): InteractiveMessage {
    return {
      type: "buttons",
      body: "",
      options: [
        { id: "cart:add_item", title: this.copy(locale, "addItemButton") },
        { id: "cart:finish_items", title: this.copy(locale, "finishButton") },
      ],
    };
  }
  // Same idea as yesNoReply, but attaches the cart-action buttons instead —
  // for a localized_template reply that leaves the customer at a "what's
  // next" moment without changing the cart (e.g. declining a recommendation),
  // so they get the same tappable options as every other such moment instead
  // of only the plain-text nudge. See the recommendationRejected regression.
  private moreItemsReply(
    locale: Locale,
    key: CommercialCopyKey,
    values: Record<string, string | number> = {},
  ): DeterministicReply {
    return {
      ...this.reply(this.copy(locale, key, values)),
      responsePlan: {
        kind: "localized_template",
        template: { namespace: "commercial", key },
        values,
        interactive: this.moreItemsButtons(locale),
      },
    };
  }
  private content(
    locale: Locale,
    segments: CommercialSegment[],
    interactive?: Extract<ResponsePlan, { kind: "composite" }>["interactive"],
    rewriteKey?: string,
  ): PlannedContent {
    const body = segments
      .map((segment) =>
        segment.kind === "line_break"
          ? "\n"
          : segment.kind === "verified_text"
            ? segment.text
            : this.copy(locale, segment.template.key, segment.values),
      )
      .join("");
    return {
      body,
      plan: {
        kind: "composite",
        segments,
        ...(interactive ? { interactive } : {}),
        ...(rewriteKey ? { rewriteKey } : {}),
      },
    };
  }
  private append(
    locale: Locale,
    content: PlannedContent,
    segments: CommercialSegment[],
    interactive?: Extract<ResponsePlan, { kind: "composite" }>["interactive"],
    rewriteKey?: string,
  ): PlannedContent {
    return this.content(
      locale,
      [...content.plan.segments, ...segments],
      interactive,
      rewriteKey,
    );
  }
  private localizedReply(
    locale: Locale,
    key: CommercialCopyKey,
    values: Record<string, string | number> = {},
  ): DeterministicReply {
    return {
      ...this.reply(this.copy(locale, key, values)),
      responsePlan: {
        kind: "localized_template",
        template: { namespace: "commercial", key },
        values,
      },
    };
  }
  // Reusable WhatsApp reply buttons for any yes/no question this flow asks.
  // The id is checked directly by DeterministicUnderstandingProvider ahead
  // of matching the tapped title's reconstructed text, so it stays correct
  // even if the button label copy changes.
  private yesNoButtons(locale: Locale): InteractiveMessage {
    return {
      type: "buttons",
      // LocalizedResponseComposer.compose() always overwrites this with the
      // plan's own rendered text; the placeholder only satisfies the type.
      body: "",
      options: [
        { id: "confirm:yes", title: this.copy(locale, "yesButton") },
        { id: "confirm:no", title: this.copy(locale, "noButton") },
      ],
    };
  }
  // The final order review used plain yes/no — tapping "No" cancelled the
  // whole order outright, with no way to tell "that's wrong, let me fix it"
  // apart from "I don't want this at all". Reuses the same confirm:yes/
  // confirm:no ids (so DeterministicUnderstandingProvider's existing
  // affirmative/negative mapping keeps working unchanged) but "No" now reads
  // as "Corregir" and, at the awaiting_confirmation step, shows the same
  // changeWhat prompt the generic 'change' command already uses — cancelling
  // is now its own explicit third button, whose title matches the existing
  // 'cancel' rule pattern and routes through the already-global cancel
  // command, same as typing "cancelar pedido".
  private confirmOrderButtons(locale: Locale): InteractiveMessage {
    return {
      type: "buttons",
      body: "",
      options: [
        { id: "confirm:yes", title: this.copy(locale, "confirmButton") },
        { id: "confirm:no", title: this.copy(locale, "correctButton") },
        { id: "cart:cancel_order", title: this.copy(locale, "cancelOrderButton") },
      ],
    };
  }
  // "¿Qué deseas cambiar?" used to be plain text asking the customer to
  // type an answer — four tappable options instead (WhatsApp caps buttons
  // at 3, so this uses a list). Each title is worded to match the existing
  // changeProduct/changeQuantity/changeFulfillment/changeAddress rule
  // patterns exactly (see classifyFlowCommand/es.rules.json), so a tap
  // resolves through those already-global commands — no new routing logic
  // needed, same "title doubles as recognized command text" convention used
  // throughout this file.
  private changeWhatReply(locale: Locale): DeterministicReply {
    const interactive: InteractiveMessage = {
      type: "list",
      body: "",
      buttonLabel: this.copy(locale, "chooseButtonLabel"),
      options: [
        // Reuses addItemButton's exact copy ("Otro producto") — its title is
        // what actually resolves the tap (see the comment above this
        // method), and that title already matches the global addItem rule
        // (es.rules.json), so a tenant with an active order can add more
        // items from this menu the same way they would right after any
        // other cart change, instead of "Corregir" only ever offering to
        // change what's already in the cart. Found live: no way to add a
        // product from here, only to modify existing lines.
        { id: "cart:add_item", title: this.copy(locale, "addItemButton") },
        { id: "change:product", title: this.copy(locale, "changeProductOption") },
        { id: "change:remove", title: this.copy(locale, "changeRemoveOption") },
        { id: "change:quantity", title: this.copy(locale, "changeQuantityOption") },
        { id: "change:fulfillment", title: this.copy(locale, "changeFulfillmentOption") },
        { id: "change:address", title: this.copy(locale, "changeAddressOption") },
      ],
    };
    return {
      ...this.reply(this.copy(locale, "changeWhat")),
      responsePlan: {
        kind: "localized_template",
        template: { namespace: "commercial", key: "changeWhat" },
        values: {},
        interactive,
      },
    };
  }
  private confirmOrderReply(locale: Locale): DeterministicReply {
    return {
      ...this.reply(this.copy(locale, "confirmOrder")),
      responsePlan: {
        kind: "localized_template",
        template: { namespace: "commercial", key: "confirmOrder" },
        values: {},
        interactive: this.confirmOrderButtons(locale),
      },
    };
  }
  private yesNoReply(
    locale: Locale,
    key: CommercialCopyKey,
    values: Record<string, string | number> = {},
  ): DeterministicReply {
    return {
      ...this.reply(this.copy(locale, key, values)),
      responsePlan: {
        kind: "localized_template",
        template: { namespace: "commercial", key },
        values,
        interactive: this.yesNoButtons(locale),
      },
    };
  }
  private copy(
    locale: Locale,
    key: CommercialCopyKey,
    values: Record<string, string | number> = {},
  ) {
    return commercialCopy(locale, key, values);
  }
  // WhatsApp list row titles are capped at 24 characters by Meta.
  private truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }
  // Offering "Domicilio" here regardless of the tenant's delivery capability
  // was live-tested against CrediCel Store (orders enabled, delivery
  // disabled) and let a customer pick a fulfillment modality the business
  // never advertised as supported. Santos Tacos was the only order-capable
  // tenant until now and always had delivery enabled, so this never showed.
  private async fulfillmentReply(
    client: PoolClient,
    requestId: string,
    locale: Locale,
  ): Promise<DeterministicReply> {
    const deliveryEnabled = await this.deliveryCapabilityEnabled(client, requestId);
    const options: InteractiveMessage["options"] = [
      ...(deliveryEnabled
        ? [{ id: "fulfillment:delivery", title: this.copy(locale, "delivery") }]
        : []),
      { id: "fulfillment:pickup", title: this.copy(locale, "pickup") },
      { id: "fulfillment:on_site", title: this.copy(locale, "onSite") },
    ];
    const bodyKey: CommercialCopyKey = deliveryEnabled
      ? "fulfillment"
      : "fulfillmentNoDelivery";
    return {
      ...this.reply(this.copy(locale, bodyKey)),
      responsePlan: {
        kind: "localized_template",
        template: { namespace: "commercial", key: bodyKey },
        values: {},
        interactive: { type: "buttons", body: "", options },
      },
    };
  }
  // Found writing packaging-fee.integration-spec.ts (D-108): this used to
  // query app.tenant_capabilities (a genuinely per-tenant table — Santos
  // Tacos has delivery=true, every other seeded tenant has it false) with
  // no tenant_id filter and no order by, so which tenant's row rows[0]
  // returned was undefined — any tenant's "¿domicilio, recogida o local?"
  // question could show or hide "Domicilio" based on an unrelated tenant's
  // config. Joined through the commercial_request instead of threading a
  // tenantId param everywhere: every one of fulfillmentReply's 6 call sites
  // already has a Workflow in scope with commercial_request_id, but not all
  // of them carry the tenantId-bearing UnderstoodFlowInput (goBack only has
  // `flow` + `locale`).
  private async deliveryCapabilityEnabled(client: PoolClient, requestId: string): Promise<boolean> {
    const result = await client.query<{ enabled: boolean }>(
      `select capability.enabled from app.tenant_capabilities capability
         join app.commercial_requests request on request.tenant_id=capability.tenant_id
        where request.id=$1 and capability.capability='delivery'`,
      [requestId],
    );
    return result.rows[0]?.enabled ?? false;
  }
  private command(input: UnderstoodFlowInput): FlowCommand {
    const value = input.understanding.entities.command;
    return typeof value === "string" ? (value as FlowCommand) : null;
  }
  private quantity(input: UnderstoodFlowInput): number {
    const value = input.understanding.entities.quantity;
    return typeof value === "number" ? value : 1;
  }
  private recommendationAction(
    input: UnderstoodFlowInput,
  ): { action: "add" | "reject"; eventId: string } | null {
    const action = input.understanding.entities.recommendationAction,
      eventId = input.understanding.entities.recommendationEventId;
    return (action === "add" || action === "reject") &&
      typeof eventId === "string"
      ? { action, eventId }
      : null;
  }
  private searchTerms(input: UnderstoodFlowInput): string[] {
    const value = input.understanding.entities.searchTerms;
    return Array.isArray(value)
      ? value.filter((term): term is string => typeof term === "string")
      : [];
  }
}
