import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PoolClient } from "pg";
import {
  AiRewriteContext,
  AiUsageBudgetService,
} from "../response-composition/ai-usage-budget.service";
import { ConversationLocale, languageFor } from "../localization/localization";

// D-164 (docs/decisions.md): classifyMessage()'s hours/location/payments/
// price intents (deterministic-reply.service.ts) only ever match a fixed,
// hardcoded keyword list — "en qué barrio queda la tienda?" or "¿aceptan
// Davivienda?" missed it entirely and fell through to the generic "no sé"
// fallback, even though the real answer (or something close enough to
// derive it from) already exists in app.business_profiles/knowledge_entries.
// Growing that keyword list forever isn't scalable (the project owner's own
// live finding: no fixed bank/app list ever covers every real payment
// method) — this is the AI-backed alternative, used only as knowledgeReply()'s
// last resort, never as the primary path: a message that already matches a
// fixed intent or a specific knowledge_entry never reaches this at all.
// Grounded ONLY in the tenant's own real business data given below —
// instructed to say it doesn't know rather than invent anything not in that
// context, the same anti-hallucination discipline ConsultativeRecommendationService
// (D-128) already established for product recommendations, applied here to
// business facts instead of products.
export type BusinessFaqAnswer = { answered: boolean; response: string };

type OpenAIResponse = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

@Injectable()
export class BusinessFaqService {
  constructor(
    private readonly config: ConfigService,
    private readonly budgets: AiUsageBudgetService,
  ) {}

  async answer(
    client: PoolClient,
    context: AiRewriteContext,
    question: string,
    locale: ConversationLocale,
  ): Promise<BusinessFaqAnswer | null> {
    if (this.config.get<string>("OPENAI_BUSINESS_FAQ_ENABLED", "false") !== "true")
      return null;
    const apiKey = this.config.get<string>("OPENAI_API_KEY", "").trim();
    if (!apiKey) return null;
    const businessContext = await this.gatherContext(client, locale);
    // Nothing real to ground an answer in — never worth spending an AI
    // call (or budget) only to have the model say "I don't know" every
    // time; the caller's existing generic fallback already does that for
    // free.
    if (!businessContext) return null;
    const model = this.config.get<string>("OPENAI_BUSINESS_FAQ_MODEL", "gpt-5.4-nano");
    const timeoutMs = this.config.get<number>("OPENAI_RESPONSE_TIMEOUT_MS", 8000);
    const budget = await this.budgets.reserve(context, "business_faq", client);
    if (!budget.allowed || !budget.reservation) return null;
    const reservation = budget.reservation;
    const startedAt = Date.now();
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          store: false,
          max_output_tokens: 300,
          instructions:
            "You answer a customer's question about a business, using ONLY the business information given to you. Rules, in order: " +
            "(1) If the answer is not contained in the given business information, or you are not fully certain, respond with answered=false and an empty response — never guess, infer, or use outside knowledge about this business or businesses in general. " +
            "(2) Never invent a fact, price, policy, or detail that is not explicitly present in the given information. " +
            "(3) Never discuss or recommend specific products — that is handled elsewhere; if the question is really about products, respond with answered=false. " +
            "(4) When you can answer, write one short, direct, friendly answer (under 300 characters) in the customer's own language, using only the given facts. Return JSON only.",
          input: JSON.stringify({
            locale,
            customerQuestion: question,
            businessInformation: businessContext,
          }),
          text: {
            format: {
              type: "json_schema",
              name: "business_faq_answer",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  answered: { type: "boolean" },
                  response: { type: "string" },
                },
                required: ["answered", "response"],
                additionalProperties: false,
              },
            },
          },
        }),
      });
      if (!response.ok) {
        await this.settle(reservation, model, startedAt, false, "provider_error", undefined, client);
        return null;
      }
      const payload = (await response.json()) as OpenAIResponse;
      const outputText = this.outputText(payload);
      if (!outputText) {
        await this.settle(reservation, model, startedAt, false, "invalid_output", payload, client);
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(outputText);
      } catch {
        await this.settle(reservation, model, startedAt, false, "invalid_output", payload, client);
        return null;
      }
      const answered =
        typeof parsed === "object" && parsed !== null && (parsed as { answered?: unknown }).answered === true;
      const text =
        typeof parsed === "object" && parsed !== null && typeof (parsed as { response?: unknown }).response === "string"
          ? (parsed as { response: string }).response.trim()
          : "";
      await this.settle(reservation, model, startedAt, true, undefined, payload, client);
      if (!answered || !text) return { answered: false, response: "" };
      return { answered: true, response: text };
    } catch {
      await this.settle(reservation, model, startedAt, false, "provider_error", undefined, client);
      return null;
    }
  }

  // Real business facts only — the same fields deterministic-reply.
  // service.ts's profileReply()/knowledgeReply() already surface
  // individually, gathered together here so the model has everything a
  // fixed keyword classifier would have picked between. Returns null when
  // there is truly nothing on file, so the caller never spends an AI call
  // grounding an answer in nothing.
  private async gatherContext(client: PoolClient, locale: ConversationLocale): Promise<string | null> {
    const profileResult = await client.query<{
      address: string | null;
      phone: string | null;
      business_hours: string | null;
      fulfillment_options: string | null;
      payment_methods: string | null;
    }>(
      `select coalesce(localized.address,profile.address) as address,
              profile.phone as phone,
              coalesce(localized.business_hours,profile.business_hours) as business_hours,
              coalesce(localized.fulfillment_options,profile.fulfillment_options) as fulfillment_options,
              coalesce(localized.payment_methods,profile.payment_methods) as payment_methods
         from app.business_profiles profile
         left join app.business_profile_localizations localized
           on localized.tenant_id=profile.tenant_id and localized.locale=$1
        limit 1`,
      [languageFor(locale)],
    );
    const entriesResult = await client.query<{ title: string; content: string }>(
      `select coalesce(loc.title,entry.title) as title,
              coalesce(loc.content,entry.content) as content
         from app.knowledge_entries entry
         left join app.knowledge_entry_localizations loc
           on loc.tenant_id=entry.tenant_id and loc.knowledge_entry_id=entry.id and loc.locale=$1
        where entry.status='published' order by entry.title`,
      [languageFor(locale)],
    );
    const profile = profileResult.rows[0];
    const facts: Record<string, string> = {};
    if (profile?.business_hours) facts.hours = profile.business_hours;
    if (profile?.address) facts.address = profile.address;
    if (profile?.phone) facts.phone = profile.phone;
    if (profile?.fulfillment_options) facts.deliveryAndPickup = profile.fulfillment_options;
    if (profile?.payment_methods) facts.paymentMethods = profile.payment_methods;
    const knowledgeEntries = entriesResult.rows.map((row) => ({ topic: row.title, details: row.content }));
    if (Object.keys(facts).length === 0 && knowledgeEntries.length === 0) return null;
    return JSON.stringify({ ...facts, knowledgeEntries });
  }

  private outputText(payload: OpenAIResponse): string {
    if (typeof payload.output_text === "string") return payload.output_text;
    for (const item of payload.output ?? [])
      for (const content of item.content ?? [])
        if (content.type === "output_text" && typeof content.text === "string") return content.text;
    return "";
  }

  private settle(
    reservation: Parameters<AiUsageBudgetService["settle"]>[0],
    model: string,
    startedAt: number,
    success: boolean,
    failureReason?: string,
    payload?: { usage?: { input_tokens?: number; output_tokens?: number } },
    client?: PoolClient,
  ) {
    const inputTokens = payload?.usage?.input_tokens ?? 0;
    const outputTokens = payload?.usage?.output_tokens ?? 0;
    // Reuses the nano-tier rate already measured/verified for
    // NaturalResponseRewriter (D-160) — this purpose uses the same model
    // tier by default, so a second, separately-configured rate would just
    // be the same numbers duplicated under a new name.
    const inputRate = this.config.get<number>("OPENAI_INPUT_COST_MINOR_PER_MILLION", 20);
    const outputRate = this.config.get<number>("OPENAI_OUTPUT_COST_MINOR_PER_MILLION", 125);
    const calculated = Math.ceil((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000);
    // Same D-160 rule as the other two AI purposes: only floor to the
    // minimum when a payload actually came back (even a malformed one) —
    // a pure network/timeout failure with no payload is recorded at its
    // real, computed cost of 0.
    const actualCostMinor = payload ? Math.max(1, calculated) : calculated;
    return this.budgets.settle(reservation, {
      provider: "openai",
      model,
      inputTokens,
      outputTokens,
      actualCostMinor,
      latencyMs: Date.now() - startedAt,
      success,
      failureReason,
    }, client);
  }
}
