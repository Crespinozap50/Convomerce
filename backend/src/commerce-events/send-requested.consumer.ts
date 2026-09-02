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
}

@Injectable()
export class SendRequestedConsumer {
  constructor(
    private readonly database: DatabaseService,
    @Inject(WHATSAPP_ADAPTER) private readonly adapter: WhatsAppAdapter,
  ) {}

  async consume(event: SendRequestedEvent): Promise<ConsumeEventResult> {
    const prepared = await this.database.withTenantTransaction(event.tenantId, async (client) => {
      const duplicate = await client.query(
        `select 1 from app.processed_events
         where tenant_id = $1 and consumer_name = 'message-send-requested-v1' and event_id = $2`,
        [event.tenantId, event.eventId],
      );
      if (duplicate.rowCount === 1) return null;

      const message = await client.query<{
        content: OutboundMessageContent;
        phone_number_id: string;
        recipient: string;
        secret_reference: string;
      }>(
        `select case
                  when message.message_type = 'interactive'
                    then jsonb_build_object('type','interactive','interactive',message.content->'interactive')
                  else jsonb_build_object('type','text','body',message.content->>'body')
                end as content,
                channel.external_account_id as phone_number_id,
                identity.provider_subject as recipient,
                channel.secret_reference
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
           and message.direction = 'outbound'
           and message.delivery_status = 'queued'
           and message.external_message_id is null`,
        [event.tenantId, event.messageId],
      );
      if (message.rowCount !== 1) throw new Error('Send request is not available in the tenant');
      return message.rows[0];
    });
    if (!prepared) return { duplicate: true };

    // No PostgreSQL transaction remains open during this external call.
    const sent = await this.adapter.send({
      idempotencyKey: event.eventId,
      messageId: event.messageId,
      content: prepared.content,
      phoneNumberId: prepared.phone_number_id,
      recipient: prepared.recipient,
      secretReference: prepared.secret_reference,
    });

    return this.database.withTenantTransaction(event.tenantId, async (client) => {
      const claimed = await client.query(
        `insert into app.processed_events
          (id, tenant_id, consumer_name, event_id)
         values ($1, $2, 'message-send-requested-v1', $3)
         on conflict (tenant_id, consumer_name, event_id) do nothing
         returning id`,
        [uuidv7(), event.tenantId, event.eventId],
      );
      if (claimed.rowCount === 0) return { duplicate: true };

      const marked = await client.query<{ marked: boolean }>(
        'select app.mark_outbound_message_sent($1, $2) as marked',
        [event.messageId, sent.externalMessageId],
      );
      if (!marked.rows[0].marked) throw new Error('Outbound message could not be confirmed');

      await client.query(
        `insert into app.audit_events
          (id, tenant_id, actor_type, action, subject_type, subject_id,
           correlation_id, metadata)
         values ($1, $2, 'service', 'message.sent', 'message', $3, $4,
                 jsonb_build_object('adapter', 'fixture-whatsapp-v1'))`,
        [uuidv7(), event.tenantId, event.messageId, event.eventId],
      );
      return { duplicate: false };
    });
  }

  markFailed(event: SendRequestedEvent, error: Error): Promise<void> {
    const code = /HTTP 401/.test(error.message) ? 'meta_unauthorized'
      : /HTTP 4\d\d/.test(error.message) ? 'meta_request_rejected'
      : /HTTP 5\d\d/.test(error.message) ? 'meta_unavailable'
      : 'delivery_failed';
    return this.database.withTenantTransaction(event.tenantId, async (client) => {
      await client.query(
        `update app.messages set delivery_status='failed',delivery_error_code=$3
          where tenant_id=$1 and id=$2 and delivery_status='queued'`,
        [event.tenantId,event.messageId,code],
      );
    });
  }
}
