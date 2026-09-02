import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { DatabaseService } from "../database/database.service";
import { forbidden, notFound } from "../observability/http-errors";

export type ConversationAction = "take" | "bot" | "close";

interface ConversationRow {
  id: string;
  status: string;
  handling_mode: string;
  current_intent: string | null;
  assigned_user_id: string | null;
  last_message_at: string | Date | null;
  opened_at: string | Date | null;
  display_name: string | null;
  provider_subject: string | null;
  last_message: string | null;
  channel_status: string | null;
  ai_enabled: boolean | null;
  last_direction: string | null;
  last_delivery_status: string | null;
  unread_count: string | number | null;
  oldest_unread_at: string | Date | null;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly db: DatabaseService) {}

  list(tenantId: string, userId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const actor = await this.actor(client, userId);
      const result = await client.query(
        `select conversation.id,conversation.status,conversation.handling_mode,
                conversation.current_intent,conversation.assigned_user_id,
                conversation.last_message_at,conversation.opened_at,
                contact.display_name,identity.provider_subject,
                latest.direction as last_direction,latest.delivery_status as last_delivery_status,
                latest.content->>'body' as last_message,
                unread.unread_count,unread.oldest_unread_at
           from app.conversations conversation
           join app.contacts contact on contact.tenant_id=conversation.tenant_id and contact.id=conversation.contact_id
           left join app.contact_identities identity on identity.tenant_id=conversation.tenant_id
             and identity.contact_id=contact.id and identity.channel_id=conversation.channel_id
           left join lateral (
             select message.direction,message.delivery_status,message.content
               from app.messages message
              where message.tenant_id=conversation.tenant_id and message.conversation_id=conversation.id
              order by message.occurred_at desc,message.id desc limit 1
           ) latest on true
           left join app.conversation_reads read_state
             on read_state.tenant_id=conversation.tenant_id
            and read_state.conversation_id=conversation.id
            and read_state.user_id=$1
           left join lateral (
             select count(*)::integer as unread_count,min(message.occurred_at) as oldest_unread_at
               from app.messages message
              where message.tenant_id=conversation.tenant_id
                and message.conversation_id=conversation.id
                and message.direction='inbound'
                and message.occurred_at>coalesce(read_state.last_read_at,'-infinity'::timestamptz)
           ) unread on true
          where latest.direction is not null
          order by (coalesce(unread.unread_count,0)>0) desc,
                   unread.oldest_unread_at asc nulls last,
                   conversation.last_activity_at desc limit 100`,
        [userId],
      );
      return {
        canManage: actor.role !== "viewer",
        conversations: result.rows.map((row) => this.mapConversation(row)),
      };
    });
  }

  markRead(tenantId: string, userId: string, conversationId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await this.actor(client, userId);
      const exists = await client.query(
        "select 1 from app.conversations where id=$1",
        [conversationId],
      );
      if (!exists.rows[0])
        throw notFound("CONVERSATION_NOT_FOUND", "Conversation was not found");
      await client.query(
        `insert into app.conversation_reads(tenant_id,conversation_id,user_id,last_read_at)
         values(app.current_tenant_id(),$1,$2,now())
         on conflict(tenant_id,conversation_id,user_id) do update
           set last_read_at=greatest(app.conversation_reads.last_read_at,excluded.last_read_at),updated_at=now()`,
        [conversationId, userId],
      );
      return { read: true };
    });
  }

  messages(tenantId: string, userId: string, conversationId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const actor = await this.actor(client, userId);
      const conversation = await client.query(
        `select conversation.id,conversation.status,conversation.handling_mode,
                conversation.current_intent,conversation.assigned_user_id,
                conversation.last_message_at,conversation.opened_at,
                contact.display_name,identity.provider_subject,channel.status as channel_status,
                coalesce(ai_policy.enabled,false) as ai_enabled
           from app.conversations conversation
           join app.contacts contact on contact.tenant_id=conversation.tenant_id and contact.id=conversation.contact_id
           join app.channels channel on channel.tenant_id=conversation.tenant_id and channel.id=conversation.channel_id
           left join app.ai_response_policies ai_policy on ai_policy.tenant_id=conversation.tenant_id
           left join app.contact_identities identity on identity.tenant_id=conversation.tenant_id
             and identity.contact_id=contact.id and identity.channel_id=conversation.channel_id
          where conversation.id=$1`,
        [conversationId],
      );
      if (!conversation.rows[0])
        throw notFound("CONVERSATION_NOT_FOUND", "Conversation was not found");
      const messages = await client.query(
        `select message.id,message.direction,message.sender_type,message.message_type,message.content,
                message.delivery_status,message.delivery_error_code,message.occurred_at,
                usage.input_tokens,usage.output_tokens,usage.estimated_cost_minor,usage.cost_currency,
                usage.latency_ms,usage.success as ai_success
           from app.messages message
           -- Two-step lateral: first find the specific inbound message that
           -- triggered this outbound reply (nearest preceding inbound, full
           -- stop), THEN look up its ai_usage row, which may not exist. The
           -- previous single-step version joined ai_usage before ordering,
           -- so it silently picked "the nearest inbound that happens to
           -- have ANY ai_usage row" instead of "this reply's own trigger" —
           -- once one turn in a conversation used AI, every later fallback/
           -- ineligible/policy_excluded reply (which never calls OpenAI at
           -- all) displayed that same stale token/cost data as its own.
           -- Found live reviewing Carlos's conversation (Santos Tacos).
           left join lateral(
             select inbound.id
               from app.messages inbound
              where message.direction='outbound' and inbound.conversation_id=message.conversation_id
                and inbound.direction='inbound'
                and (inbound.occurred_at,inbound.id)<(message.occurred_at,message.id)
              order by inbound.occurred_at desc,inbound.id desc limit 1
           ) trigger_message on true
           left join app.ai_usage usage on usage.tenant_id=message.tenant_id and usage.message_id=trigger_message.id
          where message.conversation_id=$1
          order by message.occurred_at,message.id limit 500`,
        [conversationId],
      );
      return {
        canManage: actor.role !== "viewer",
        conversation: this.mapConversation(conversation.rows[0]),
        messages: messages.rows.map((row) => {
          const rewriting = row.content?.decision?.rewriting;
          const deterministicBody = rewriting?.deterministicBody ?? null;
          const generationMode = rewriting?.mode ?? null;
          return {
            id: row.id,
            direction: row.direction,
            senderType: row.sender_type,
            messageType: row.message_type,
            body: row.content?.body ?? "",
            interactive: row.content?.interactive ?? null,
            intent: row.content?.intent ?? null,
            sources: row.content?.sources ?? [],
            generationMode,
            generationModel: rewriting?.model ?? null,
            generationOutcome:
              generationMode === "openai"
                ? deterministicBody && deterministicBody !== row.content?.body
                  ? "rewritten"
                  : "reviewed"
                : generationMode === "library"
                  ? "reused"
                  : rewriting?.fallbackReason &&
                      !["ineligible", "disabled", "policy_excluded"].includes(
                        rewriting.fallbackReason,
                      )
                    ? "fallback"
                    : generationMode === "deterministic"
                      ? "deterministic"
                      : null,
            deterministicBody,
            fallbackReason: rewriting?.fallbackReason ?? null,
            aiUsage:
              row.input_tokens === null
                ? null
                : {
                    inputTokens: Number(row.input_tokens),
                    outputTokens: Number(row.output_tokens),
                    estimatedCostMinor: Number(row.estimated_cost_minor),
                    currency: row.cost_currency,
                    latencyMs: Number(row.latency_ms),
                    success: Boolean(row.ai_success),
                  },
            deliveryStatus: row.delivery_status,
            deliveryErrorCode: row.delivery_error_code,
            occurredAt: row.occurred_at,
          };
        }),
      };
    });
  }

  act(
    tenantId: string,
    userId: string,
    conversationId: string,
    action: ConversationAction,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const actor = await this.actor(client, userId, true);
      const result =
        action === "close"
          ? await client.query(
              `update app.conversations set status='closed',handling_mode='human',assigned_user_id=$2::uuid,
                  closed_at=now(),close_reason='human_resolved',updated_at=now(),version=version+1
            where id=$1 and status<>'closed' returning id`,
              [conversationId, actor.membershipId],
            )
          : await client.query(
              // No status<>'closed' guard here (unlike the close branch
              // above): "take"/"bot" are also how a closed conversation
              // gets reopened — see D-051/docs/decisions.md.
              `update app.conversations set status='open',handling_mode=$2,
                  assigned_user_id=case when $2='human' then $3::uuid else null end,
                  closed_at=null,close_reason=null,closing_warning_sent_at=null,
                  updated_at=now(),version=version+1
            where id=$1 returning id`,
              [
                conversationId,
                action === "take" ? "human" : "bot",
                actor.membershipId,
              ],
            );
      if (!result.rows[0])
        throw notFound(
          "CONVERSATION_NOT_FOUND",
          "Open conversation was not found",
        );
      if (action === "close") {
        // Same cancellation shape as commercial-flow.service.ts's own
        // 'cancel' command and app.close_inactive_conversations() (066) —
        // a manually closed conversation shouldn't leave an unfinished
        // order/appointment stuck in draft forever.
        await client.query(
          `update app.commercial_requests set status='cancelled',updated_at=now()
          where conversation_id=$1 and status in ('draft','awaiting_confirmation')`,
          [conversationId],
        );
        await client.query(
          `update app.conversation_workflows set status='cancelled',updated_at=now()
          where conversation_id=$1 and status='active'`,
          [conversationId],
        );
        // Same reasoning as 067: a recommendation the customer never
        // answered shouldn't still be tappable if they reopen this
        // conversation weeks later.
        await client.query(
          `update app.recommendation_events set status='expired',responded_at=now()
          where conversation_id=$1 and status='shown'`,
          [conversationId],
        );
      }
      return { updated: true };
    });
  }

  reply(
    tenantId: string,
    userId: string,
    conversationId: string,
    text: string,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const actor = await this.actor(client, userId, true);
      // No status<>'closed' guard: sending a message reopens a closed
      // conversation, same as the "take"/"bot" actions in act() — see
      // D-051/docs/decisions.md.
      const conversation = await client.query<{ channel_id: string }>(
        `update app.conversations set handling_mode='human',assigned_user_id=$2,status='open',
                closed_at=null,close_reason=null,closing_warning_sent_at=null,
                updated_at=now(),last_activity_at=now(),version=version+1
          where id=$1 returning channel_id`,
        [conversationId, actor.membershipId],
      );
      if (!conversation.rows[0])
        throw notFound(
          "CONVERSATION_NOT_FOUND",
          "Open conversation was not found",
        );
      const messageId = uuidv7();
      const correlationId = uuidv7();
      await client.query(
        `insert into app.messages
          (id,tenant_id,conversation_id,channel_id,direction,sender_type,message_type,content,delivery_status,occurred_at)
         values($1,$2,$3,$4,'outbound','user','text',jsonb_build_object('body',$5::text),'queued',now())`,
        [
          messageId,
          tenantId,
          conversationId,
          conversation.rows[0].channel_id,
          text,
        ],
      );
      await client.query(
        `insert into app.outbox_events
          (id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload)
         values($1,$2,'message.send_requested','message',$3,$4,1,jsonb_build_object('messageId',($3::uuid)::text))`,
        [uuidv7(), tenantId, messageId, correlationId],
      );
      return { messageId, deliveryStatus: "queued" };
    });
  }

  retry(
    tenantId: string,
    userId: string,
    conversationId: string,
    messageId: string,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await this.actor(client, userId, true);
      const reset = await client.query(
        `update app.messages set delivery_status='queued',delivery_error_code=null where id=$1 and conversation_id=$2 and direction='outbound' and delivery_status='failed' returning id`,
        [messageId, conversationId],
      );
      if (!reset.rows[0])
        throw notFound("MESSAGE_NOT_RETRYABLE", "Failed message was not found");
      await client.query(
        `insert into app.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload) values($1,$2,'message.send_requested','message',$3,$4,1,jsonb_build_object('messageId',($3::uuid)::text))`,
        [uuidv7(), tenantId, messageId, uuidv7()],
      );
      return { retried: true, deliveryStatus: "queued" };
    });
  }

  private async actor(client: PoolClient, userId: string, manage = false) {
    const result = await client.query(
      `select id,role from app.tenant_users
        where tenant_id=app.current_tenant_id() and user_id=$1 and status='active'`,
      [userId],
    );
    const row = result.rows[0];
    if (row) {
      if (manage && row.role === "viewer")
        throw forbidden(
          "CONVERSATIONS_FORBIDDEN",
          "Actor cannot manage conversations",
        );
      return { membershipId: row.id as string, role: row.role as string };
    }
    const platform = await client.query(
      `select app.can_manage_channel_connections($1) as allowed`,
      [userId],
    );
    if (!platform.rows[0]?.allowed) {
      throw forbidden(
        "CONVERSATIONS_FORBIDDEN",
        "Actor cannot manage conversations",
      );
    }
    return { membershipId: null, role: "platform_admin" };
  }

  private mapConversation(row: ConversationRow) {
    return {
      id: row.id,
      status: row.status,
      handlingMode: row.handling_mode,
      currentIntent: row.current_intent,
      assignedUserId: row.assigned_user_id,
      lastMessageAt: row.last_message_at,
      openedAt: row.opened_at,
      contactName:
        row.display_name || row.provider_subject || "Unknown contact",
      contactAddress: row.provider_subject ?? null,
      lastMessage: row.last_message ?? "",
      channelStatus: row.channel_status ?? null,
      aiEnabled: Boolean(row.ai_enabled),
      lastDirection: row.last_direction ?? null,
      lastDeliveryStatus: row.last_delivery_status ?? null,
      unreadCount: Number(row.unread_count ?? 0),
      oldestUnreadAt: row.oldest_unread_at ?? null,
    };
  }
}
