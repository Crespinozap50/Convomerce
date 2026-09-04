import { Inject, Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { DatabaseService } from "../database/database.service";
import {
  ConsumeEventResult,
  MessageReceivedEvent,
} from "./commerce-event.types";
import { ConfigService } from "@nestjs/config";
import { catalogFor, isPlausibleName, normalizeForMatching } from "../localization/localization";
import { ConversationLanguageService } from "../localization/conversation-language.service";
import {
  CONVERSATION_UNDERSTANDING_PROVIDER,
  ConversationUnderstanding,
  ConversationUnderstandingProvider,
} from "../conversation-understanding/conversation-understanding.types";
import { ConversationDecisionEngine } from "../conversation-decisions/conversation-decision.engine";
import { ConversationDecision } from "../conversation-decisions/conversation-decision.types";
import { LocalizedResponseComposer } from "../response-composition/localized-response.composer";
import { NaturalResponseRewriter } from "../response-composition/natural-response.rewriter";
import { ComposedResponse } from "../response-composition/response-plan.types";

type PendingReply = {
  channelId: string;
  decision: ConversationDecision;
  deterministicResponse: ComposedResponse;
  understanding: ConversationUnderstanding;
};

type DomainOutcome = { duplicate: boolean; pending: PendingReply | null };

@Injectable()
export class MessageReceivedConsumer {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly decisions: ConversationDecisionEngine,
    private readonly responseComposer: LocalizedResponseComposer,
    private readonly naturalResponseRewriter: NaturalResponseRewriter,
    private readonly conversationLanguage: ConversationLanguageService,
    @Inject(CONVERSATION_UNDERSTANDING_PROVIDER)
    private readonly understandingProvider: ConversationUnderstandingProvider,
  ) {}

  async consume(event: MessageReceivedEvent): Promise<ConsumeEventResult> {
    const outcome = await this.resolveDomain(event);
    if (outcome.duplicate || !outcome.pending)
      return { duplicate: outcome.duplicate };

    const { channelId, decision, deterministicResponse, understanding } =
      outcome.pending;
    // Deliberately outside any open transaction: the domain transaction above
    // already committed, so AiUsageBudgetService.reserve() (called from
    // rewrite()) can insert its own row referencing this conversation/message
    // without racing a still-open transaction on the same rows. Moving this
    // call back inside a transaction reintroduces a real deadlock — see the
    // D-041 finding in docs/decisions.md, reproduced against the live DB with
    // pg_locks evidence before this fix.
    const rewritten = await this.naturalResponseRewriter.rewrite(
      decision.responsePlan,
      deterministicResponse,
      {
        tenantId: event.tenantId,
        conversationId: event.conversationId,
        messageId: event.messageId,
      },
    );
    await this.persistReply(
      event,
      channelId,
      decision,
      understanding,
      deterministicResponse,
      rewritten,
    );
    return { duplicate: false };
  }

  private resolveDomain(event: MessageReceivedEvent): Promise<DomainOutcome> {
    return this.database.withTenantTransaction(
      event.tenantId,
      async (client): Promise<DomainOutcome> => {
        const claimed = await client.query(
          `insert into app.processed_events
          (id, tenant_id, consumer_name, event_id)
         values ($1, $2, 'message-received-v1', $3)
         on conflict (tenant_id, consumer_name, event_id) do nothing
         returning id`,
          [uuidv7(), event.tenantId, event.eventId],
        );

        if (claimed.rowCount === 0) return { duplicate: true, pending: null };

        const message = await client.query<{
          channel_id: string;
          body: string;
          interactive_selection_id: string | null;
          handling_mode: string;
          display_name: string | null;
          contact_id: string;
        }>(
          `select message.channel_id, message.content->>'body' as body,
                message.content#>>'{interactiveSelection,id}' as interactive_selection_id,
                conversation.handling_mode,contact.display_name,contact.id as contact_id
           from app.messages message join app.conversations conversation
             on conversation.tenant_id=message.tenant_id and conversation.id=message.conversation_id
           join app.contacts contact on contact.tenant_id=conversation.tenant_id and contact.id=conversation.contact_id
         where message.tenant_id = $1 and message.id = $2 and message.conversation_id = $3`,
          [event.tenantId, event.messageId, event.conversationId],
        );
        if (message.rowCount !== 1) {
          throw new Error(
            "message.received references a missing message or a message from another tenant",
          );
        }

        // Neither query depends on the other's result — issued together so
        // node-postgres pipelines them on this connection instead of paying
        // two sequential round trips on every inbound message.
        const [, botResult] = await Promise.all([
          client.query(
            `insert into app.audit_events
            (id, tenant_id, actor_type, action, subject_type, subject_id,
             correlation_id, metadata)
           values ($1, $2, 'service', 'message.processed', 'message', $3, $4,
                   jsonb_build_object('consumer', 'message-received-v1', 'conversationId', ($5::uuid)::text))`,
            [
              uuidv7(),
              event.tenantId,
              event.messageId,
              event.eventId,
              event.conversationId,
            ],
          ),
          client.query<{
            enabled: boolean;
            assistant_name: string;
            business_name: string;
            locale: string;
            welcome_message: string;
            fallback_message: string;
            handoff_keywords: string[];
            timezone: string;
          }>(
            `select bot.enabled,bot.assistant_name,tenant.display_name as business_name,bot.locale,bot.welcome_message,bot.fallback_message,bot.handoff_keywords,tenant.timezone
             from app.tenants tenant left join app.bot_configurations bot on bot.tenant_id=tenant.id
            where tenant.id=app.current_tenant_id() limit 1`,
          ),
        ]);
        const bot = botResult.rows[0];
        const temporaryEnabled =
          this.config.get<string>("WHATSAPP_AUTO_REPLY_ENABLED", "false") ===
          "true";
        if (
          !(
            (bot?.enabled || temporaryEnabled) &&
            message.rows[0].handling_mode === "bot"
          )
        ) {
          return { duplicate: false, pending: null };
        }

        const configuredLocale = bot?.locale ?? "en";
        const conversationLocale = await this.conversationLanguage.resolve(
          client,
          event.conversationId,
          message.rows[0].body,
          configuredLocale,
        );
        const understanding = await this.understandingProvider.understand({
          message: message.rows[0].body,
          configuredLocale: conversationLocale.locale,
          localeSource: conversationLocale.source,
          handoffKeywords: bot?.handoff_keywords ?? [],
          interactiveSelectionId:
            message.rows[0].interactive_selection_id ?? undefined,
          timezone: bot?.timezone ?? "UTC",
        });
        const plausibleDisplayName = isPlausibleName(
          message.rows[0].display_name,
        )
          ? message.rows[0].display_name
          : null;
        const flowInput = {
          tenantId: event.tenantId,
          conversationId: event.conversationId,
          contactId: message.rows[0].contact_id,
          body: message.rows[0].body,
          locale: understanding.locale,
          displayName: plausibleDisplayName,
          assistantName: bot?.assistant_name ?? "Commerce Assistant",
          businessName: bot?.business_name ?? "Commerce",
          interactiveSelectionId:
            message.rows[0].interactive_selection_id ?? undefined,
          timezone: bot?.timezone ?? "UTC",
          understanding,
        };
        const decision = await this.decisions.decide(client, flowInput, {
          locale: understanding.locale,
          welcomeMessage:
            bot?.welcome_message ?? catalogFor("en").bot.defaultWelcome,
          fallbackMessage:
            bot?.fallback_message ?? catalogFor("en").bot.defaultFallback,
          handoffKeywords: bot?.handoff_keywords ?? [],
          customerName: plausibleDisplayName,
          timezone: bot?.timezone ?? "UTC",
        });
        const deterministicResponse = this.responseComposer.compose(
          decision.responsePlan,
          understanding.locale,
        );

        // 'fallback' alone doesn't mean the bot had nothing to say — a
        // knowledge_entries match can still answer it (D-077, D-078). Only
        // log it as genuinely unresolved when nothing answered it either.
        if (decision.intent === "fallback" && decision.sources.length === 0) {
          const normalizedQuestion = normalizeForMatching(message.rows[0].body).slice(0, 500);
          const contextResult = await client.query<{
            context_messages: unknown[];
          }>(
            `select coalesce(jsonb_agg(
               jsonb_build_object('direction',history.direction,'body',history.content->>'body','occurredAt',history.occurred_at)
               order by history.occurred_at,history.id
             ),'[]'::jsonb) as context_messages
               from (
                 select previous.id,previous.direction,previous.content,previous.occurred_at
                   from app.messages previous
                   join app.messages current_message
                     on current_message.tenant_id=previous.tenant_id and current_message.id=$3
                  where previous.tenant_id=$1 and previous.conversation_id=$2
                    and (previous.occurred_at,previous.id)<(current_message.occurred_at,current_message.id)
                  order by previous.occurred_at desc,previous.id desc limit 4
               ) history`,
            [event.tenantId, event.conversationId, event.messageId],
          );
          if (normalizedQuestion)
            await client.query(
              `insert into app.unresolved_customer_questions
              (id,tenant_id,normalized_question,sample_question,last_conversation_id,last_message_id,context_messages)
             values ($1,$2,$3,$4,$5,$6,$7::jsonb)
             on conflict (tenant_id,normalized_question) do update
               set occurrence_count=app.unresolved_customer_questions.occurrence_count+1,
                   sample_question=excluded.sample_question,last_conversation_id=excluded.last_conversation_id,
                   last_message_id=excluded.last_message_id,context_messages=excluded.context_messages,
                   last_seen_at=now(),status='pending'`,
              [
                uuidv7(),
                event.tenantId,
                normalizedQuestion,
                message.rows[0].body.slice(0, 1000),
                event.conversationId,
                event.messageId,
                JSON.stringify(contextResult.rows[0]?.context_messages ?? []),
              ],
            );
        }

        await client.query(
          `update app.conversations
              set current_intent=$3, status=case when $4::boolean then 'waiting_human' else status end,
                  updated_at=now()
            where tenant_id=$1 and id=$2`,
          [
            event.tenantId,
            event.conversationId,
            decision.intent,
            decision.outcome === "handoff",
          ],
        );
        if (decision.outcome === "handoff")
          await client.query(
            `update app.conversations set handling_mode='human',updated_at=now() where tenant_id=$1 and id=$2`,
            [event.tenantId, event.conversationId],
          );

        return {
          duplicate: false,
          pending: {
            channelId: message.rows[0].channel_id,
            decision,
            deterministicResponse,
            understanding,
          },
        };
      },
    );
  }

  private persistReply(
    event: MessageReceivedEvent,
    channelId: string,
    decision: ConversationDecision,
    understanding: ConversationUnderstanding,
    deterministicResponse: ComposedResponse,
    rewritten: Awaited<ReturnType<NaturalResponseRewriter["rewrite"]>>,
  ): Promise<void> {
    return this.database.withTenantTransaction(event.tenantId, async (client) => {
      const composed = rewritten.response;
      const reply = {
        intent: decision.intent,
        body: composed.body,
        handoff: decision.outcome === "handoff",
        sources: decision.sources,
        interactive: composed.interactive,
      };
      const replyMessageId = uuidv7();
      const correlationId = uuidv7();
      const messageType = reply.interactive ? "interactive" : "text";
      await client.query(
        `insert into app.messages
            (id, tenant_id, conversation_id, channel_id, direction, sender_type,
             message_type, content, delivery_status, occurred_at)
           values ($1, $2, $3, $4, 'outbound', 'ai', $5,
                   jsonb_strip_nulls(jsonb_build_object(
                     'body', $6::text,
                     'interactive', $7::jsonb,
                     'automation', $12::text,
                     'intent', $8::text,
                     'sources', $9::jsonb,
                     'understanding', $10::jsonb,
                     'decision', $11::jsonb)),
                   'queued', now())`,
        [
          replyMessageId,
          event.tenantId,
          event.conversationId,
          channelId,
          messageType,
          reply.body,
          reply.interactive ? JSON.stringify(reply.interactive) : null,
          reply.intent,
          JSON.stringify(reply.sources),
          JSON.stringify(understanding),
          JSON.stringify({
            outcome: decision.outcome,
            capability: decision.capability,
            requestedAction: decision.requestedAction,
            confidence: decision.confidence,
            reason: decision.reason,
            composition: composed.composition,
            locale: composed.locale,
            rewriting: {
              mode: rewritten.mode,
              ...(rewritten.model ? { model: rewritten.model } : {}),
              ...(rewritten.variantId
                ? { variantId: rewritten.variantId }
                : {}),
              ...(rewritten.fallbackReason
                ? { fallbackReason: rewritten.fallbackReason }
                : {}),
              ...(["openai", "library"].includes(rewritten.mode)
                ? {
                    deterministicBody: deterministicResponse.body,
                    protectedFacts: this.naturalResponseRewriter.protectedFacts(
                      decision.responsePlan,
                    ),
                  }
                : {}),
            },
          }),
          rewritten.mode === "openai"
            ? "openai-response-rewrite"
            : rewritten.mode === "library"
              ? "approved-response-variant"
              : "deterministic-response",
        ],
      );
      await client.query(
        `insert into app.outbox_events
            (id, tenant_id, event_type, aggregate_type, aggregate_id, correlation_id,
             payload_schema_version, payload)
           values ($1, $2, 'message.send_requested', 'message', $3, $4, 1,
                   jsonb_build_object('messageId', ($3::uuid)::text))`,
        [uuidv7(), event.tenantId, replyMessageId, correlationId],
      );
    });
  }
}
