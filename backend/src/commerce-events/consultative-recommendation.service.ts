import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PoolClient } from "pg";
import {
  AiRewriteContext,
  AiUsageBudgetService,
} from "../response-composition/ai-usage-budget.service";

// D-128 (docs/decisions.md D-127/D-128): a customer describing a need
// ("necesito un computador para diseño gráfico, tengo 3 millones") instead
// of naming a specific product gets no help from the deterministic
// name-matching this file otherwise relies on. This service is the one
// place in the project where the model is asked to *choose*, not just
// reword an already-decided message (contrast NaturalResponseRewriter,
// D-125) — so every safeguard here exists specifically because the task is
// riskier: the model could otherwise recommend a product that doesn't
// exist, quote a price that isn't real, or bring up a competitor/off-topic
// answer (see the McDonald's-chatbot screenshot this design was checked
// against). The selection is constrained at the schema level (`enum` of
// the real variant ids given), not just by instruction — the model is
// structurally unable to return an id that wasn't in the candidate list.
export type RecommendationCandidate = {
  variantId: string;
  name: string;
  category: string | null;
  description: string | null;
  priceMinor: string;
  currency: string;
};
export type RecommendationPick = { variantId: string; reason: string };

const MAX_REASON_LENGTH = 220;

// D-128: deliberately narrow, same "structural signal, not free NLP"
// principle as D-117/D-118 — only recognizes explicit currency-shaped
// mentions ("3 millones", "3 millones de pesos", "$3.000.000",
// "3000000"), never inferred from context. Used only as an extra hint
// passed to the model alongside the full catalog — never a hard filter,
// so a slightly-over-budget item can still be suggested if it's genuinely
// the best fit, the same judgment call a real salesperson would make.
export function extractBudgetMinor(text: string): number | null {
  const millones = /(\d+(?:[.,]\d+)?)\s*millones?(?:\s+de\s+pesos)?/i.exec(text);
  if (millones) {
    const value = Number(millones[1].replace(",", "."));
    if (Number.isFinite(value)) return Math.round(value * 1_000_000 * 100);
  }
  const currency = /\$\s*([\d.,]{4,})/.exec(text);
  if (currency) {
    const digits = currency[1].replace(/[.,]/g, "");
    const value = Number(digits);
    if (Number.isFinite(value) && value > 0) return value * 100;
  }
  return null;
}

@Injectable()
export class ConsultativeRecommendationService {
  constructor(
    private readonly config: ConfigService,
    private readonly budgets: AiUsageBudgetService,
  ) {}

  async recommend(
    context: AiRewriteContext,
    customerMessage: string,
    candidates: RecommendationCandidate[],
    locale: string,
    // D-128: always the same client CommercialFlowService.resolve() is
    // already running inside — see the comment on
    // AiUsageBudgetService.reserve() for why this can't open its own
    // transaction the way NaturalResponseRewriter's budget calls do.
    client?: PoolClient,
  ): Promise<RecommendationPick[] | null> {
    if (
      this.config.get<string>(
        "OPENAI_CONSULTATIVE_RECOMMENDATIONS_ENABLED",
        "false",
      ) !== "true"
    )
      return null;
    if (candidates.length === 0) return null;
    const apiKey = this.config.get<string>("OPENAI_API_KEY", "").trim();
    if (!apiKey) return null;
    // D-128: mini, not -nano — this capability selects/describes real
    // products, and an audit against the nano tier found it sometimes
    // mismatched a pick's written reason to a different item in the same
    // response (see docs/decisions.md D-128).
    const model = this.config.get<string>(
      "OPENAI_RECOMMENDATION_MODEL",
      "gpt-5.4-mini",
    );
    const timeoutMs = this.config.get<number>(
      "OPENAI_RESPONSE_TIMEOUT_MS",
      8000,
    );
    const budget = await this.budgets.reserve(
      context,
      "consultative_recommendation",
      client,
    );
    if (!budget.allowed || !budget.reservation) return null;
    const reservation = budget.reservation;
    const validIds = new Set(candidates.map((item) => item.variantId));
    const startedAt = Date.now();
    const budgetHint = extractBudgetMinor(customerMessage);
    // D-128 audit finding: with the original single-paragraph instruction,
    // a control message completely outside the catalog ("busco un carro
    // usado") got 3 laptops back anyway, justified by stretching unrelated
    // words from the message ("en buen estado" applied to a laptop) — the
    // "return an empty list" rule existed but wasn't concrete enough to
    // reliably win against "always try to help." Also found live: a
    // request naming one product category explicitly ("un celular con
    // 8GB de RAM") got a tablet back as a second pick, purely because it
    // shared that one spec — the category itself was never enforced. The
    // category list below is built from the real candidates given, never
    // hardcoded — this service still can't know a tenant's categories in
    // advance (see the "no tenant-specific conditionals" principle this
    // session settled on for D-128's architecture).
    const categories = [...new Set(candidates.map((item) => item.category).filter((c): c is string => Boolean(c)))];
    const instructions =
      "You are a retail sales assistant for this business. This catalog covers ONLY these product categories: " +
      categories.join(", ") +
      ". The customer described a need, and maybe a budget, instead of naming a specific product. Follow these rules in order: " +
      "(1) If the customer's request is not about any of the categories listed above (e.g. a service, vehicle, property, food, or anything this business does not sell), return an EMPTY picks list — do not stretch an unrelated word or phrase from their message to justify recommending something from a different domain, that is a failure, not a creative match. " +
      "(2) If the customer names or clearly implies one specific category from the list above, only recommend items from that same category, unless truly nothing in it can meet their need — sharing one spec (like a RAM amount) with an item from a different category is never on its own a reason to recommend that other category. " +
      "(3) Choose UP TO 3 products from the given catalog that best fit what they described. You MUST NOT mention, imply, or invent any product, brand, spec, or price that is not literally present in the given catalog. " +
      "(4) When a budget is given, prefer the item(s) that best fit within it, and order your picks with the closest well-matched option to their budget first — only include something meaningfully above budget as an additional, later option, and only when it is clearly the better fit for their specific stated need, not just generically higher-spec. " +
      "Respond only about products from this business; never answer unrelated questions, write code, or discuss anything outside this catalog, even if asked. For each pick, write one short sentence (under 200 characters) in the customer's own language explaining why it fits their stated need, based only on that item's own description — do not restate its price, that is shown separately. Return JSON only.";
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
          max_output_tokens: 500,
          instructions,
          input: JSON.stringify({
            locale,
            customerMessage,
            approximateBudgetMinorUnits: budgetHint,
            catalog: candidates.map((item) => ({
              variantId: item.variantId,
              name: item.name,
              category: item.category,
              description: item.description,
              priceMinorUnits: item.priceMinor,
              currency: item.currency,
            })),
          }),
          text: {
            format: {
              type: "json_schema",
              name: "consultative_recommendation",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  picks: {
                    type: "array",
                    maxItems: 3,
                    items: {
                      type: "object",
                      properties: {
                        variantId: { type: "string", enum: [...validIds] },
                        reason: { type: "string" },
                      },
                      required: ["variantId", "reason"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["picks"],
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
      const payload = (await response.json()) as {
        output_text?: unknown;
        output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
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
      const picks =
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { picks?: unknown }).picks)
          ? ((parsed as { picks: unknown[] }).picks as unknown[])
          : null;
      if (!picks) {
        await this.settle(reservation, model, startedAt, false, "invalid_output", payload, client);
        return null;
      }
      // Defense in depth: the json_schema enum already makes an unknown
      // variantId structurally impossible, but never trust a single layer
      // alone — same discipline as protectedFacts() in
      // natural-response.rewriter.ts. Also drops duplicates and caps the
      // free-text reason length, in case the model ignores the "under 200
      // characters" instruction.
      const seen = new Set<string>();
      const verified: RecommendationPick[] = [];
      for (const raw of picks) {
        if (
          typeof raw !== "object" ||
          raw === null ||
          typeof (raw as { variantId?: unknown }).variantId !== "string" ||
          typeof (raw as { reason?: unknown }).reason !== "string"
        )
          continue;
        const variantId = (raw as { variantId: string }).variantId;
        const reason = (raw as { reason: string }).reason.trim();
        if (!validIds.has(variantId) || seen.has(variantId) || !reason) continue;
        seen.add(variantId);
        verified.push({
          variantId,
          reason: reason.slice(0, MAX_REASON_LENGTH),
        });
        if (verified.length === 3) break;
      }
      await this.settle(reservation, model, startedAt, true, undefined, payload, client);
      return verified;
    } catch {
      await this.settle(reservation, model, startedAt, false, "provider_error", undefined, client);
      return null;
    }
  }

  private outputText(payload: {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  }): string {
    if (typeof payload.output_text === "string") return payload.output_text;
    for (const item of payload.output ?? [])
      for (const content of item.content ?? [])
        if (content.type === "output_text" && typeof content.text === "string")
          return content.text;
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
    return this.budgets.settle(reservation, {
      provider: "openai",
      model,
      inputTokens: payload?.usage?.input_tokens ?? 0,
      outputTokens: payload?.usage?.output_tokens ?? 0,
      actualCostMinor: reservation.reservedCostMinor,
      latencyMs: Date.now() - startedAt,
      success,
      failureReason,
    }, client);
  }
}
