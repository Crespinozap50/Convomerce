import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InboundMessagesService } from '../inbound-messages/inbound-messages.service';
import { DeliveryStatusesService } from '../delivery-statuses/delivery-statuses.service';
import { MetaDeliveryStatus } from '../delivery-statuses/delivery-status.types';
import { WhatsAppInteractivePayload, WhatsAppWebhookPayload } from './whatsapp-webhook.types';
import { InboundInteractiveSelection, selectionAsNaturalText } from '../interactive-messages/interactive-message.types';

@Injectable()
export class WhatsAppWebhookService {
  constructor(
    private readonly database: DatabaseService,
    private readonly inboundMessages: InboundMessagesService,
    private readonly deliveryStatuses: DeliveryStatusesService,
  ) {}

  async receive(payload: WhatsAppWebhookPayload): Promise<{
    accepted: true;
    messages: number;
    statuses: number;
  }> {
    if (payload.object !== 'whatsapp_business_account') {
      throw new UnprocessableEntityException('Unsupported webhook object');
    }

    let processed = 0;
    let statuses = 0;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) throw new UnprocessableEntityException('metadata.phone_number_id is missing');
        const channel = await this.database.resolveWhatsAppChannel(phoneNumberId);
        if (!channel) throw new UnprocessableEntityException('Unknown or inactive receiving channel');

        for (const message of value?.messages ?? []) {
          if (!message.id || !message.from) continue;
          const interactiveSelection = parseInteractiveSelection(message.interactive);
          const text = message.type === 'text' ? message.text?.body
            : interactiveSelection ? selectionAsNaturalText(interactiveSelection) : undefined;
          if (!text) continue;
          const profileName = value?.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name;
          await this.inboundMessages.receive({
            tenantId: channel.tenantId,
            channelId: channel.channelId,
            providerSubject: message.from,
            contactDisplayName: profileName,
            externalEventId: message.id,
            externalMessageId: message.id,
            text,
            interactiveSelection,
            occurredAt: parseUnixTimestamp(message.timestamp),
          });
          processed += 1;
        }

        for (const status of value?.statuses ?? []) {
          if (!status.id || !isMetaDeliveryStatus(status.status)) continue;
          await this.deliveryStatuses.apply({
            tenantId: channel.tenantId,
            channelId: channel.channelId,
            externalMessageId: status.id,
            status: status.status,
            providerTimestamp: parseUnixTimestamp(status.timestamp),
            errorCode: status.errors?.[0]?.code?.toString(),
          });
          statuses += 1;
        }
      }
    }
    return { accepted: true, messages: processed, statuses };
  }
}

export function parseInteractiveSelection(
  interactive?: WhatsAppInteractivePayload,
): InboundInteractiveSelection | undefined {
  if (interactive?.type === 'button_reply') {
    const reply = interactive.button_reply;
    if (reply?.id && reply.title) return { type: 'button', id: reply.id, title: reply.title };
  }
  if (interactive?.type === 'list_reply') {
    const reply = interactive.list_reply;
    if (reply?.id && reply.title) {
      return { type: 'list', id: reply.id, title: reply.title, description: reply.description };
    }
  }
  return undefined;
}

function isMetaDeliveryStatus(value?: string): value is MetaDeliveryStatus {
  return value === 'sent' || value === 'delivered' || value === 'read' || value === 'failed';
}

export function parseUnixTimestamp(value?: string): Date | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
