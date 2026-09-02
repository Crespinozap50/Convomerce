import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import {
  ApplyDeliveryStatusCommand,
  ApplyDeliveryStatusResult,
  MetaDeliveryStatus,
} from './delivery-status.types';

const progress: Record<Exclude<MetaDeliveryStatus, 'failed'>, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

export function canApplyDeliveryStatus(current: string, next: MetaDeliveryStatus): boolean {
  if (current === next) return false;
  if (next === 'failed') return current === 'queued' || current === 'sent';
  if (current === 'failed' || current === 'read' || current === 'received') return false;
  const currentRank = current === 'queued' ? 0 : progress[current as keyof typeof progress];
  return currentRank !== undefined && progress[next] > currentRank;
}

@Injectable()
export class DeliveryStatusesService {
  constructor(private readonly database: DatabaseService) {}

  apply(command: ApplyDeliveryStatusCommand): Promise<ApplyDeliveryStatusResult> {
    return this.database.withTenantTransaction(command.tenantId, async (client) => {
      const idempotencyKey = [
        command.externalMessageId,
        command.status,
        command.providerTimestamp?.toISOString() ?? 'without-timestamp',
      ].join(':');
      const eventId = uuidv7();
      const claimed = await client.query(
        `insert into app.processing_events
          (id, tenant_id, source, external_event_id, correlation_id, status)
         values ($1, $2, 'whatsapp_delivery_status', $3, $1, 'processing')
         on conflict (tenant_id, source, external_event_id) do nothing
         returning id`,
        [eventId, command.tenantId, idempotencyKey],
      );
      if (claimed.rowCount === 0) return { outcome: 'duplicate' };

      const message = await client.query<{ id: string; delivery_status: string }>(
        `select id, delivery_status from app.messages
         where tenant_id = $1 and channel_id = $2 and external_message_id = $3
           and direction = 'outbound'
         for update`,
        [command.tenantId, command.channelId, command.externalMessageId],
      );
      if (message.rowCount === 0) {
        await this.completeEvent(client, command.tenantId, eventId, command.errorCode);
        return { outcome: 'unknown_message' };
      }

      const currentStatus = message.rows[0].delivery_status;
      if (!canApplyDeliveryStatus(currentStatus, command.status)) {
        await this.completeEvent(client, command.tenantId, eventId, command.errorCode);
        return { outcome: 'stale' };
      }

      await client.query(
        `update app.messages set delivery_status = $1,
                delivery_error_code = case when $1='failed' then 'meta_delivery_failed' else null end
         where tenant_id = $2 and id = $3`,
        [command.status, command.tenantId, message.rows[0].id],
      );
      await client.query(
        `insert into app.audit_events
          (id, tenant_id, actor_type, action, subject_type, subject_id,
           correlation_id, metadata)
         values ($1, $2, 'service', 'message.delivery_status_changed', 'message', $3, $4,
                 jsonb_build_object(
                   'from', $5::text,
                   'to', $6::text,
                   'providerTimestamp', $7::text,
                   'errorCode', $8::text
                 ))`,
        [
          uuidv7(), command.tenantId, message.rows[0].id, eventId, currentStatus,
          command.status, command.providerTimestamp?.toISOString() ?? null,
          command.errorCode ?? null,
        ],
      );
      await this.completeEvent(client, command.tenantId, eventId, command.errorCode);
      return { outcome: 'applied' };
    });
  }

  private async completeEvent(
    client: { query: (text: string, values: unknown[]) => Promise<unknown> },
    tenantId: string,
    eventId: string,
    errorCode?: string,
  ): Promise<void> {
    await client.query(
      `update app.processing_events
       set status = 'processed', processed_at = now(), last_error_code = $1
       where tenant_id = $2 and id = $3`,
      [errorCode ?? null, tenantId, eventId],
    );
  }
}
