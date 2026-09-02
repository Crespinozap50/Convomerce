import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { DatabaseService } from "../database/database.service";
import {
  ReceiveInboundMessageCommand,
  ReceiveInboundMessageResult,
  ReprocessInboundMessageCommand,
} from "./inbound-message.types";

@Injectable()
export class InboundMessagesService {
  constructor(private readonly database: DatabaseService) {}

  reprocess(command: ReprocessInboundMessageCommand) {
    return this.database.withTenantTransaction(
      command.tenantId,
      async (client) => {
        const message = await client.query(
          `select 1 from app.messages
          where tenant_id = $1 and id = $2 and conversation_id = $3
            and direction = 'inbound'`,
          [command.tenantId, command.messageId, command.conversationId],
        );
        if (message.rowCount !== 1) {
          throw new Error(
            "Inbound message was not found in the requested conversation",
          );
        }

        const outboxEventId = uuidv7();
        await client.query(
          `insert into app.outbox_events
          (id, tenant_id, event_type, aggregate_type, aggregate_id, correlation_id,
           payload_schema_version, payload)
         values ($1::uuid, $2::uuid, 'message.received', 'message', $3::uuid, $4::uuid, 1,
                 jsonb_build_object(
                   'messageId', ($3::uuid)::text,
                   'conversationId', ($5::uuid)::text
                 ))`,
          [
            outboxEventId,
            command.tenantId,
            command.messageId,
            uuidv7(),
            command.conversationId,
          ],
        );
        return { requeued: true, outboxEventId };
      },
    );
  }

  receive(
    command: ReceiveInboundMessageCommand,
  ): Promise<ReceiveInboundMessageResult> {
    return this.database.withTenantTransaction(
      command.tenantId,
      async (client) => {
        let contactId = command.contactId;
        if (!contactId && command.providerSubject) {
          await client.query(
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [
              `${command.tenantId}:${command.channelId}:${command.providerSubject}`,
            ],
          );
          const identity = await client.query<{ contact_id: string }>(
            `select contact_id from app.contact_identities
           where tenant_id = $1 and channel_id = $2 and provider_subject = $3`,
            [command.tenantId, command.channelId, command.providerSubject],
          );
          contactId = identity.rows[0]?.contact_id;
          if (!contactId) {
            contactId = uuidv7();
            await client.query(
              `insert into app.contacts (id, tenant_id, display_name, consent_status, last_interaction_at)
             values ($1, $2, $3, 'unknown', now())`,
              [contactId, command.tenantId, command.contactDisplayName ?? null],
            );
            await client.query(
              `insert into app.contact_identities
              (id, tenant_id, contact_id, channel_id, provider_subject)
             values ($1, $2, $3, $4, $5)`,
              [
                uuidv7(),
                command.tenantId,
                contactId,
                command.channelId,
                command.providerSubject,
              ],
            );
          }
        }
        if (!contactId)
          throw new Error("Message has no contact or provider identity");

        const eventId = uuidv7();
        const correlationId = uuidv7();
        const claimed = await client.query<{ id: string }>(
          `insert into app.processing_events
          (id, tenant_id, source, external_event_id, correlation_id, status)
         values ($1, $2, 'development_harness', $3, $4, 'processing')
         on conflict (tenant_id, source, external_event_id) do nothing
         returning id`,
          [eventId, command.tenantId, command.externalEventId, correlationId],
        );

        if (claimed.rowCount === 0) {
          const existing = await client.query<{
            conversation_id: string;
            id: string;
          }>(
            `select conversation_id, id from app.messages
           where tenant_id = $1 and channel_id = $2 and external_message_id = $3`,
            [command.tenantId, command.channelId, command.externalMessageId],
          );
          if (existing.rowCount !== 1) {
            throw new Error(
              "Duplicate event without a persisted message; controlled retry required",
            );
          }
          return {
            duplicate: true,
            conversationId: existing.rows[0].conversation_id,
            messageId: existing.rows[0].id,
          };
        }

        const active = await client.query<{ id: string }>(
          `select id from app.conversations
         where tenant_id = $1 and channel_id = $2 and contact_id = $3 and status <> 'closed'
         limit 1`,
          [command.tenantId, command.channelId, contactId],
        );

        let conversationId = active.rows[0]?.id;
        if (!conversationId) {
          // A closed conversation is an internal handling state (e.g. the
          // D-052 inactivity timeout), not the end of the relationship — the
          // customer only ever sees one continuous WhatsApp thread. Reopening
          // the most recently closed conversation keeps their next message
          // in that same thread instead of silently starting a new, empty
          // one and fragmenting the history across two conversations. Only
          // a contact with no conversation at all yet falls through to the
          // insert below. Safe from races because the advisory lock above
          // already serializes all message processing for this contact.
          const reopened = await client.query<{ id: string }>(
            `update app.conversations
             set status = 'open', closed_at = null, close_reason = null,
                 closing_warning_sent_at = null, updated_at = now()
             where id = (
               select id from app.conversations
               where tenant_id = $1 and channel_id = $2 and contact_id = $3 and status = 'closed'
               order by closed_at desc nulls last, created_at desc
               limit 1
             )
             returning id`,
            [command.tenantId, command.channelId, contactId],
          );
          conversationId = reopened.rows[0]?.id;
        }
        if (!conversationId) {
          const candidateId = uuidv7();
          const created = await client.query<{ id: string }>(
            `insert into app.conversations
            (id, tenant_id, channel_id, contact_id, status)
           values ($1, $2, $3, $4, 'open')
           on conflict (tenant_id, channel_id, contact_id) where status <> 'closed'
           do nothing returning id`,
            [candidateId, command.tenantId, command.channelId, contactId],
          );
          conversationId = created.rows[0]?.id;
          if (!conversationId) {
            const concurrent = await client.query<{ id: string }>(
              `select id from app.conversations
             where tenant_id = $1 and channel_id = $2 and contact_id = $3 and status <> 'closed'`,
              [command.tenantId, command.channelId, contactId],
            );
            conversationId = concurrent.rows[0].id;
          }
        }

        const messageId = uuidv7();
        await client.query(
          `insert into app.messages
          (id, tenant_id, conversation_id, channel_id, direction, sender_type,
           external_message_id, message_type, content, delivery_status, occurred_at, received_at)
         values ($1, $2, $3, $4, 'inbound', 'contact', $5, $6,
                 jsonb_strip_nulls(jsonb_build_object(
                   'body', $7::text,
                   'interactiveSelection', $8::jsonb
                 )), 'received',
                 coalesce($9::timestamptz, now()), now())`,
          [
            messageId,
            command.tenantId,
            conversationId,
            command.channelId,
            command.externalMessageId,
            command.interactiveSelection ? "interactive" : "text",
            command.text,
            command.interactiveSelection
              ? JSON.stringify(command.interactiveSelection)
              : null,
            command.occurredAt ?? null,
          ],
        );

        await client.query(
          `update app.conversations
         set last_message_at = now(), last_activity_at = now(), updated_at = now(),
             status = case when status = 'waiting_customer' then 'open' else status end,
             closing_warning_sent_at = null,
             version = version + 1
         where tenant_id = $1 and id = $2`,
          [command.tenantId, conversationId],
        );

        const outboxEventId = uuidv7();
        await client.query(
          `insert into app.outbox_events
          (id, tenant_id, event_type, aggregate_type, aggregate_id, correlation_id,
           payload_schema_version, payload)
         values ($1::uuid, $2::uuid, 'message.received', 'message', $3::uuid, $4::uuid, 1,
                 jsonb_build_object(
                   'messageId', ($3::uuid)::text,
                   'conversationId', ($5::uuid)::text
                 ))`,
          [
            outboxEventId,
            command.tenantId,
            messageId,
            correlationId,
            conversationId,
          ],
        );

        await client.query(
          `update app.processing_events set status = 'processed', processed_at = now()
         where tenant_id = $1 and id = $2`,
          [command.tenantId, eventId],
        );

        return { duplicate: false, conversationId, messageId, outboxEventId };
      },
    );
  }
}
