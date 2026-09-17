import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PoolClient } from "pg";
import {
  AiRewriteContext,
  AiUsageBudgetService,
} from "../response-composition/ai-usage-budget.service";
import { FlowCommand } from "./commercial-flow.service";

// D-207 (docs/decisions.md D-206): a customer's message can fail to match
// anything not because they wanted a product, but because they typed a
// perfectly ordinary control word ("editar") that classifyFlowCommand's
// hand-maintained regex lists (es.rules.json/en.rules.json) never happened
// to include — D-206 fixed one instance of this (editar -> change) by hand
// after it caused two real duplicate orders, but the same shape of bug is
// unbounded: any of the 13 known commands can be phrased in a way the
// regex misses. Same safety shape as ConsultativeRecommendationService
// (D-128): the model NEVER free-types an answer — it picks one value from
// the exact closed FlowCommand set already wired into
// commercial-flow.service.ts (plus "none"), so a hallucinated command is
// structurally impossible, and the caller always re-enters the SAME
// existing deterministic dispatch code the regex path would have used —
// this service never mutates state itself.
const RECOVERABLE_COMMANDS: Exclude<FlowCommand, null>[] = [
  "catalog",
  "view_order",
  "add_item",
  "remove_item",
  "change_quantity",
  "finish_items",
  "help",
  "handoff",
  "cancel",
  "back",
  "change_product",
  "change_fulfillment",
  "change_address",
  "change",
];
const NONE = "none" as const;
type RecoveryOutput = Exclude<FlowCommand, null> | typeof NONE;

@Injectable()
export class CommandRecoveryService {
  constructor(
    private readonly config: ConfigService,
    private readonly budgets: AiUsageBudgetService,
  ) {}

  async recover(
    context: AiRewriteContext,
    customerMessage: string,
    locale: string,
    // D-128's own comment applies identically here: this always runs
    // inside CommercialFlowService.resolve()'s already-open transaction,
    // so a caller mid-transaction must pass its client to avoid the D-041
    // deadlock (a second connection blocking on the still-open outer one).
    client?: PoolClient,
  ): Promise<FlowCommand | null> {
    if (
      this.config.get<string>("OPENAI_COMMAND_RECOVERY_ENABLED", "false") !==
      "true"
    )
      return null;
    const apiKey = this.config.get<string>("OPENAI_API_KEY", "").trim();
    if (!apiKey) return null;
    // Per-tenant capability gate ('command_recovery' on
    // app.tenant_capabilities) is checked by the caller
    // (CommercialFlowService.recoverCommand) before this is ever invoked —
    // same split as ConsultativeRecommendationService, whose own tenant
    // capability check lives in commercial-flow.service.ts's
    // consultativeRecommend(), not inside the service itself, since only
    // the caller already has the open transaction `client` guaranteed.
    // Classifying a handful of words as one of 14 fixed labels is a much
    // cheaper task than ConsultativeRecommendationService's open-ended
    // product selection — same model tier (mini) is still overkill here,
    // but reusing the already-configured/tested model avoids provisioning
    // a third OpenAI model setting for this one extra capability.
    const model = this.config.get<string>(
      "OPENAI_RECOMMENDATION_MODEL",
      "gpt-5.4-mini",
    );
    const timeoutMs = this.config.get<number>(
      "OPENAI_RESPONSE_TIMEOUT_MS",
      8000,
    );
    const budget = await this.budgets.reserve(context, "command_recovery", client);
    if (!budget.allowed || !budget.reservation) return null;
    const reservation = budget.reservation;
    const startedAt = Date.now();
    const instructions =
      "You classify a customer's WhatsApp message for a commerce bot. Given the message, decide if it is asking to do ONE of the listed actions, even if phrased unusually, misspelled, or abbreviated. Rules: " +
      "(1) Only pick an action if the message is clearly asking to do it as a control/navigation request (e.g. cancel, view the order, add/remove/change something in an existing order, ask for the menu, ask for help, ask for a human). " +
      '(2) If the message is naming or describing a product to buy, asking a factual question about a product, a greeting, small talk, or anything that is not one of the listed actions, return "none" — do not force a fit. ' +
      "(3) Never invent an action outside the given list. Return JSON only.";
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
          // D-207 follow-up (live testing, docs/decisions.md): the same
          // exact message ("sácame los tacos de birria porfa") returned
          // remove_item once and add_item the next time — without this,
          // the model's default sampling temperature makes a 14-way
          // closed classification non-deterministic, which can silently
          // reintroduce the exact bug this service exists to fix.
          temperature: 0,
          max_output_tokens: 50,
          instructions,
          input: JSON.stringify({
            locale,
            customerMessage,
            actions: RECOVERABLE_COMMANDS,
          }),
          text: {
            format: {
              type: "json_schema",
              name: "command_recovery",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  command: { type: "string", enum: [...RECOVERABLE_COMMANDS, NONE] },
                },
                required: ["command"],
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
      const rawCommand =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { command?: unknown }).command
          : undefined;
      // Defense in depth: the json_schema enum already makes an
      // out-of-list value structurally impossible, but never trust a
      // single layer alone — same discipline as
      // ConsultativeRecommendationService's own index re-check.
      const recovered: RecoveryOutput | undefined =
        typeof rawCommand === "string" &&
        (RECOVERABLE_COMMANDS as string[]).includes(rawCommand)
          ? (rawCommand as RecoveryOutput)
          : rawCommand === NONE
            ? NONE
            : undefined;
      await this.settle(reservation, model, startedAt, true, undefined, payload, client);
      if (!recovered || recovered === NONE) return null;
      return recovered;
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
    const inputTokens = payload?.usage?.input_tokens ?? 0;
    const outputTokens = payload?.usage?.output_tokens ?? 0;
    const inputRate = this.config.get<number>("OPENAI_RECOMMENDATION_INPUT_COST_MINOR_PER_MILLION", 100);
    const outputRate = this.config.get<number>("OPENAI_RECOMMENDATION_OUTPUT_COST_MINOR_PER_MILLION", 400);
    const calculated = Math.ceil((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000);
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
