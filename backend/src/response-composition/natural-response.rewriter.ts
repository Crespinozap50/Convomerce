import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ComposedResponse, ResponsePlan } from "./response-plan.types";
import {
  AiRewriteContext,
  AiUsageBudgetService,
  AiBudgetReservation,
} from "./ai-usage-budget.service";
import { ApprovedResponseVariantService } from "./approved-response-variant.service";

// Intl currency formatting (formatMoney) inserts a non-breaking space
// (U+00A0) between the symbol and the amount. A model asked to reproduce
// that text verbatim reliably types a plain space instead — invisible in
// any terminal/UI diff, but enough to fail a raw substring check. Collapse
// all whitespace variants before comparing so fact protection isn't
// defeated by formatting a human can't see.
const normalizeSpaces = (value: string) => value.replace(/\s+/g, " ");

export type NaturalResponseResult = {
  response: ComposedResponse;
  mode: "deterministic" | "openai" | "library";
  model?: string;
  variantId?: string;
  fallbackReason?:
    | "disabled"
    | "ineligible"
    | "policy_excluded"
    | "tenant_disabled"
    | "rollout_excluded"
    | "daily_limit"
    | "monthly_budget"
    | "provider_error"
    | "invalid_output"
    | "fact_mismatch"
    | "variant_pending"
    | "variant_rejected";
};

type OpenAIResponse = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

@Injectable()
export class NaturalResponseRewriter {
  constructor(
    private readonly config: ConfigService,
    private readonly budgets: AiUsageBudgetService,
    private readonly variants?: ApprovedResponseVariantService,
  ) {}

  async rewrite(
    plan: ResponsePlan,
    response: ComposedResponse,
    context: AiRewriteContext,
  ): Promise<NaturalResponseResult> {
    if (
      this.config.get<string>("OPENAI_RESPONSE_REWRITING_ENABLED", "false") !==
      "true"
    )
      return this.fallback(response, "disabled");
    // Carrying `interactive` (buttons/list) no longer disqualifies a plan on
    // its own — only the yes/no confirmation templates/composites below
    // (confirmHold, confirmReschedule, commercial.orderConfirmation) ever
    // combine eligibility with interactive, so this stays scoped to exactly
    // those without a separate allowlist. Rewriting only ever touches
    // `body`/`interactive.body` (see withRewrittenBody below) — the button
    // options themselves are never touched by the model.
    if (plan.kind === "localized_template") {
      if (!this.isEligibleTemplate(plan.template.namespace, plan.template.key))
        return this.fallback(response, "policy_excluded");
    } else if (plan.kind === "composite") {
      if (!plan.rewriteKey || !this.isEligibleComposite(plan.rewriteKey))
        return this.fallback(
          response,
          plan.rewriteKey ? "policy_excluded" : "ineligible",
        );
    } else {
      return this.fallback(response, "ineligible");
    }
    const protectedFacts = this.protectedFacts(plan);
    const variant = await this.variants?.find(
      context,
      plan,
      response,
      protectedFacts,
    );
    if (variant?.status === "approved") {
      return {
        response: this.withRewrittenBody(response, variant.body),
        mode: "library",
        variantId: variant.variantId,
      };
    }
    if (variant?.status === "candidate")
      return this.fallback(response, "variant_pending");
    if (variant?.status === "rejected")
      return this.fallback(response, "variant_rejected");
    const apiKey = this.config.get<string>("OPENAI_API_KEY", "").trim();
    if (!apiKey) return this.fallback(response, "provider_error");
    const model = this.config.get<string>(
      "OPENAI_RESPONSE_MODEL",
      "gpt-5.4-nano",
    );
    const timeoutMs = this.config.get<number>(
      "OPENAI_RESPONSE_TIMEOUT_MS",
      8000,
    );
    const budget = await this.budgets.reserve(context);
    if (!budget.allowed || !budget.reservation)
      return this.fallback(response, budget.reason ?? "tenant_disabled");
    const startedAt = Date.now();
    try {
      const providerResponse = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model,
            store: false,
            max_output_tokens: 180,
            instructions:
              "Rewrite the supplied customer-service message so it reads like it was typed by a warm, friendly person, not a template or receipt. This message is the middle of an ongoing conversation, not a first contact — do not open with a greeting like 'Hola' or introduce yourself, the customer was already greeted earlier. You MUST materially change the wording, phrasing, and framing versus the input — returning the input unchanged or nearly unchanged is a failure. Every value listed in factTokens must still appear in the rewrite, in the same relative order and exactly as given (do not alter names, quantities, prices, addresses, dates, or reference numbers). Everything else — connecting words, sentence structure, a short closing line — is yours to rewrite freely. Do not add facts, promises, discounts, products, prices, dates, or identifiers that are not in factTokens. Return JSON only.",
            input: JSON.stringify({
              locale: response.locale,
              message: response.body,
              factTokens: this.protectedFacts(plan),
            }),
            text: {
              format: {
                type: "json_schema",
                name: "natural_response",
                strict: true,
                schema: {
                  type: "object",
                  properties: { body: { type: "string" } },
                  required: ["body"],
                  additionalProperties: false,
                },
              },
            },
          }),
        },
      );
      if (!providerResponse.ok)
        return this.failed(
          response,
          budget.reservation,
          model,
          startedAt,
          "provider_error",
        );
      const payload = (await providerResponse.json()) as OpenAIResponse;
      const output = this.outputText(payload);
      if (!output)
        return this.failed(
          response,
          budget.reservation,
          model,
          startedAt,
          "invalid_output",
          payload,
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(output);
      } catch {
        return this.failed(
          response,
          budget.reservation,
          model,
          startedAt,
          "invalid_output",
          payload,
        );
      }
      const body =
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { body?: unknown }).body === "string"
          ? (parsed as { body: string }).body.trim()
          : "";
      const maximumLength = Math.min(
        4096,
        Math.max(
          response.body.length + 120,
          Math.ceil(response.body.length * 1.6),
        ),
      );
      if (!body || body.length > maximumLength)
        return this.failed(
          response,
          budget.reservation,
          model,
          startedAt,
          "invalid_output",
          payload,
        );
      const facts = this.protectedFacts(plan);
      const normalizedBody = normalizeSpaces(body);
      if (!facts.every((token) => normalizedBody.includes(normalizeSpaces(token))))
        return this.failed(
          response,
          budget.reservation,
          model,
          startedAt,
          "fact_mismatch",
          payload,
        );
      if (
        plan.kind === "composite" &&
        !this.preservesFactOrder(
          normalizedBody,
          facts.map((token) => normalizeSpaces(token)),
        )
      )
        return this.failed(
          response,
          budget.reservation,
          model,
          startedAt,
          "fact_mismatch",
          payload,
        );
      if (!this.sameNumericTokens(response.body, body))
        return this.failed(
          response,
          budget.reservation,
          model,
          startedAt,
          "fact_mismatch",
          payload,
        );
      await this.settle(
        budget.reservation,
        model,
        startedAt,
        true,
        undefined,
        payload,
      );
      await this.variants
        ?.remember(context, plan, response, body, protectedFacts)
        .catch(() => undefined);
      return {
        response: this.withRewrittenBody(response, body),
        mode: "openai",
        model,
      };
    } catch {
      return this.failed(
        response,
        budget.reservation,
        model,
        startedAt,
        "provider_error",
      );
    }
  }

  // whatsapp-adapter.ts sends `interactive.body`, not the top-level `body`,
  // for any message that carries buttons/a list — so a rewrite that only
  // replaced `body` would be invisible to the customer on those messages.
  // Keeps `interactive.options` (the buttons themselves) untouched.
  private withRewrittenBody(
    response: ComposedResponse,
    body: string,
  ): ComposedResponse {
    return {
      ...response,
      body,
      ...(response.interactive
        ? { interactive: { ...response.interactive, body } }
        : {}),
    };
  }

  protectedFacts(plan: ResponsePlan): string[] {
    const raw =
      plan.kind === "localized_template"
        ? Object.values(plan.values ?? {})
        : plan.kind === "composite" && plan.rewriteKey
          ? plan.segments.flatMap((segment) =>
              segment.kind === "template"
                ? Object.values(segment.values ?? {})
                : segment.kind === "verified_text"
                  ? this.factFragments(segment.text)
                  : [],
            )
          : [];
    return [
      ...new Set(
        raw
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
  }

  // verified_text segments mix real facts (quantities, item names, prices,
  // addresses) with pure markdown/connector punctuation ("*", "• ", " × ",
  // ": ") used to lay the line out. Protecting the whole segment as one
  // literal string means any natural rewrite of that connective wording
  // fails fact preservation even when every real fact survives intact —
  // this was near-100% fallback in practice for order confirmations. Split
  // on the connectors so only the substantive fragments are protected; a
  // rewrite is still checked against every fact appearing in order.
  private factFragments(text: string): string[] {
    return text
      .split(/[*•×:]/g)
      .map((fragment) => fragment.trim())
      .filter((fragment) => /[a-z0-9]/i.test(fragment));
  }

  // Composite facts include whole rendered cart lines (from verified_text
  // segments), so substring presence alone would let a rewrite silently
  // reorder them (e.g. total before line items) without tripping the
  // fact-mismatch check. This verifies each protected fact still appears
  // strictly after the previous one, without requiring contiguous text
  // between them (natural connective phrasing is still allowed).
  private preservesFactOrder(body: string, tokens: string[]): boolean {
    let cursor = 0;
    for (const token of tokens) {
      const index = body.indexOf(token, cursor);
      if (index === -1) return false;
      cursor = index + token.length;
    }
    return true;
  }

  private isEligibleTemplate(namespace: string, key: string): boolean {
    const eligibleTemplates: Record<string, Set<string>> = {
      commercial: new Set([
        "itemUnknown",
        "emptyCartContinue",
        "nothingToCancel",
        "addressNotRequired",
        "recommendationExpired",
      ]),
      appointment: new Set([
        "dateNotRecognized",
        "noUpcoming",
        "noReschedulable",
        "noCancellable",
        "noAvailability",
        "confirmHold",
        "confirmed",
        "rescheduled",
        "confirmReschedule",
      ]),
    };
    return eligibleTemplates[namespace]?.has(key) ?? false;
  }

  // Composite plans have no {namespace,key} the way localized_template does
  // (see ResponsePlan in response-plan.types.ts), so eligibility is keyed by
  // the rewriteKey the flow service opts a specific composite into — a flat
  // set rather than folding into isEligibleTemplate's Record.
  private isEligibleComposite(rewriteKey: string): boolean {
    const eligibleComposites = new Set<string>(["commercial.orderConfirmation"]);
    return eligibleComposites.has(rewriteKey);
  }

  private outputText(payload: OpenAIResponse): string {
    if (typeof payload.output_text === "string") return payload.output_text;
    for (const item of payload.output ?? [])
      for (const content of item.content ?? [])
        if (content.type === "output_text" && typeof content.text === "string")
          return content.text;
    return "";
  }

  private sameNumericTokens(original: string, candidate: string): boolean {
    const tokens = (value: string) =>
      (value.match(/\b\d+(?:[.,]\d+)*(?:%|[a-z]{3})?\b/gi) ?? [])
        .map((token) => token.toLowerCase())
        .sort();
    return (
      JSON.stringify(tokens(original)) === JSON.stringify(tokens(candidate))
    );
  }

  private fallback(
    response: ComposedResponse,
    fallbackReason: NaturalResponseResult["fallbackReason"],
  ): NaturalResponseResult {
    return { response, mode: "deterministic", fallbackReason };
  }

  private async failed(
    response: ComposedResponse,
    reservation: AiBudgetReservation,
    model: string,
    startedAt: number,
    reason: NaturalResponseResult["fallbackReason"],
    payload?: OpenAIResponse,
  ): Promise<NaturalResponseResult> {
    await this.settle(reservation, model, startedAt, false, reason, payload);
    return this.fallback(response, reason);
  }

  private async settle(
    reservation: AiBudgetReservation,
    model: string,
    startedAt: number,
    success: boolean,
    failureReason?: string,
    payload?: OpenAIResponse,
  ): Promise<void> {
    const inputTokens = payload?.usage?.input_tokens ?? 0,
      outputTokens = payload?.usage?.output_tokens ?? 0;
    const inputRate = this.config.get<number>(
      "OPENAI_INPUT_COST_MINOR_PER_MILLION",
      100,
    );
    const outputRate = this.config.get<number>(
      "OPENAI_OUTPUT_COST_MINOR_PER_MILLION",
      400,
    );
    const calculated = Math.ceil(
      (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
    );
    const actualCostMinor = Math.max(1, calculated);
    try {
      await this.budgets.settle(reservation, {
        provider: "openai",
        model,
        inputTokens,
        outputTokens,
        actualCostMinor,
        latencyMs: Date.now() - startedAt,
        success,
        failureReason,
      });
    } catch {
      // Best-effort usage/cost accounting: a settle() failure must not
      // surface to the caller and block or fail the response that was
      // already produced.
    }
  }
}
