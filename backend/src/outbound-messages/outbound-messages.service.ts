import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import {
  CreatedOutboundMessage,
  CreateFixtureOutboundMessageCommand,
  RequestedOutboundMessage,
  RequestOutboundMessageCommand,
} from './outbound-message.types';

@Injectable()
export class OutboundMessagesService {
  constructor(private readonly database: DatabaseService) {}

  createFixture(command: CreateFixtureOutboundMessageCommand): Promise<CreatedOutboundMessage> {
    return this.database.withTenantTransaction(command.tenantId, async (client) => {
      const messageId = uuidv7();
      await client.query(
        `insert into app.messages
          (id, tenant_id, conversation_id, channel_id, direction, sender_type,
           external_message_id, message_type, content, delivery_status, occurred_at)
         values ($1, $2, $3, $4, 'outbound', 'system', $5, 'text',
                 jsonb_build_object('body', $6::text, 'fixture', true), 'sent', now())`,
        [
          messageId, command.tenantId, command.conversationId, command.channelId,
          command.externalMessageId, command.text,
        ],
      );
      return { messageId, deliveryStatus: 'sent' };
    });
  }

  requestSend(command: RequestOutboundMessageCommand): Promise<RequestedOutboundMessage> {
    return this.database.withTenantTransaction(command.tenantId, async (client) => {
      const messageId = uuidv7();
      const correlationId = uuidv7();
      await client.query(
        `insert into app.messages
          (id, tenant_id, conversation_id, channel_id, direction, sender_type,
           message_type, content, delivery_status, occurred_at)
         values ($1, $2, $3, $4, 'outbound', 'system', 'text',
                 jsonb_build_object('body', $5::text), 'queued', now())`,
        [messageId, command.tenantId, command.conversationId, command.channelId, command.text],
      );

      const outboxEventId = uuidv7();
      await client.query(
        `insert into app.outbox_events
          (id, tenant_id, event_type, aggregate_type, aggregate_id, correlation_id,
           payload_schema_version, payload)
         values ($1, $2, 'message.send_requested', 'message', $3, $4, 1,
                 jsonb_build_object('messageId', ($3::uuid)::text))`,
        [outboxEventId, command.tenantId, messageId, correlationId],
      );
      return { messageId, outboxEventId, deliveryStatus: 'queued' };
    });
  }
}
