import { Inject, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { ConsumeEventResult } from './commerce-event.types';
import { WHATSAPP_ADAPTER, WhatsAppAdapter } from './whatsapp-adapter';
import { OutboundMessageContent } from '../interactive-messages/interactive-message.types';

export interface SendRequestedEvent {
  eventId: string;
  tenantId: string;
  messageId: string;
  // D-146 (docs/decisions.md) live finding: a reply that sends more than
  // one message (DeterministicReply.additionalMessages, D-144's "Ficha
  // técnica" split) used to get one outbox event — and therefore one
  // BullMQ job — per message. With the worker's default concurrency (5),
  // two jobs for the same reply could be picked up and sent to Meta at
  // the same time, with no guarantee the network calls complete in the
  // order they were queued — found live: the tappable list arrived before
  // the technical text it was supposed to follow. Message ids listed here
  // are sent strictly in order, sequentially, inside this SAME job
  // (never a separate job of their own), so ordering can't race no matter
  // how many other jobs run concurrently.
  followUpMessageIds?: string[];
}

@Injectable()
export class SendRequestedConsumer {
  constructor(
    private readonly database: DatabaseService,
    @Inject(WHATSAPP_ADAPTER) private readonly adapter: WhatsAppAdapter,
  ) {}

  async consume(event: SendRequestedEvent): Promise<ConsumeEventResult> {
    const alreadyProcessed = await this.database.withTenantTransaction(event.tenantId, async (client) => {
      const duplicate = await client.query(
        `select 1 from app.processed_events
         where tenant_id = $1 and consumer_name = 'message-send-requested-v1' and event_id = $2`,
        [event.tenantId, event.eventId],
      );
      return duplicate.rowCount === 1;
    });
    if (alreadyProcessed) return { duplicate: true };

    // Each message is individually guarded by its own delivery_status
    // ('queued' and no external_message_id yet) — a job retried after
    // throwing partway through (e.g. the 2nd of 3 messages) picks up
    // exactly where it left off: already-sent messages are skipped, never
    // resent, instead of the whole job failing outright.
    for (const messageId of [event.messageId, ...(event.followUpMessageIds ?? [])]) {
      await this.sendOne(event.tenantId, messageId, event.eventId);
    }

    return this.database.withTenantTransaction(event.tenantId, async (client) => {
      const claimed = await client.query(
        `insert into app.processed_events
          (id, tenant_id, consumer_name, event_id)
         values ($1, $2, 'message-send-requested-v1', $3)
         on conflict (tenant_id, consumer_name, event_id) do nothing
         returning id`,
        [uuidv7(), event.tenantId, event.eventId],
      );
      return { duplicate: claimed.rowCount === 0 };
    });
  }

  private async sendOne(tenantId: string, messageId: string, eventId: string): Promise<void> {
    const prepared = await this.database.withTenantTransaction(tenantId, async (client) => {
      const message = await client.query<{
        content: OutboundMessageContent;
        phone_number_id: string;
        recipient: string;
        secret_reference: string;
        delivery_status: string;
        external_message_id: string | null;
      }>(
        `select case
                  when message.message_type = 'interactive'
                    then jsonb_build_object('type','interactive','interactive',message.content->'interactive')
                  else jsonb_build_object('type','text','body',message.content->>'body')
                end as content,
                channel.external_account_id as phone_number_id,
                identity.provider_subject as recipient,
                channel.secret_reference,
                message.delivery_status,
                message.external_message_id
         from app.messages as message
         join app.conversations as conversation
           on conversation.tenant_id = message.tenant_id
          and conversation.id = message.conversation_id
         join app.channels as channel
           on channel.tenant_id = message.tenant_id
          and channel.id = message.channel_id
         join app.contact_identities as identity
           on identity.tenant_id = message.tenant_id
          and identity.contact_id = conversation.contact_id
          and identity.channel_id = message.channel_id
         where message.tenant_id = $1 and message.id = $2
           and message.direction = 'outbound'`,
        [tenantId, messageId],
      );
      // Genuinely doesn't exist for this tenant (wrong tenant context, or
      // a bogus id) — a real problem, not a retry-skip case; kept as a
      // hard failure exactly like the pre-D-146 single-message check did.
      if (message.rowCount !== 1) throw new Error('Send request is not available in the tenant');
      return message.rows[0];
    });
    // Already sent by an earlier attempt at this same job (D-146: a job
    // retried after throwing partway through a group of messages) —
    // not an error, just nothing left to do for this particular message.
    if (prepared.delivery_status !== 'queued' || prepared.external_message_id !== null) return;

    // No PostgreSQL transaction remains open during this external call.
    const sent = await this.adapter.send({
      idempotencyKey: messageId,
      messageId,
      content: prepared.content,
      phoneNumberId: prepared.phone_number_id,
      recipient: prepared.recipient,
      secretReference: prepared.secret_reference,
    });

    await this.database.withTenantTransaction(tenantId, async (client) => {
      const marked = await client.query<{ marked: boolean }>(
        'select app.mark_outbound_message_sent($1, $2) as marked',
        [messageId, sent.externalMessageId],
      );
      if (!marked.rows[0].marked) throw new Error('Outbound message could not be confirmed');

      await client.query(
        `insert into app.audit_events
          (id, tenant_id, actor_type, action, subject_type, subject_id,
           correlation_id, metadata)
         values ($1, $2, 'service', 'message.sent', 'message', $3, $4,
                 jsonb_build_object('adapter', 'fixture-whatsapp-v1'))`,
        [uuidv7(), tenantId, messageId, eventId],
      );
    });
  }

  markFailed(event: SendRequestedEvent, error: Error): Promise<void> {
    const code = /HTTP 401/.test(error.message) ? 'meta_unauthorized'
      : /HTTP 4\d\d/.test(error.message) ? 'meta_request_rejected'
      : /HTTP 5\d\d/.test(error.message) ? 'meta_unavailable'
      : 'delivery_failed';
    const messageIds = [event.messageId, ...(event.followUpMessageIds ?? [])];
    return this.database.withTenantTransaction(event.tenantId, async (client) => {
      await client.query(
        `update app.messages set delivery_status='failed',delivery_error_code=$3
          where tenant_id=$1 and id=any($2::uuid[]) and delivery_status='queued'`,
        [event.tenantId, messageIds, code],
      );
    });
  }
}
