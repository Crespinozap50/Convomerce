import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SECRET_PROVIDER, SecretProvider } from '../secrets/secret-provider';
import { CredentialEncryptionService } from '../secrets/credential-encryption.service';
import {
  OutboundMessageContent,
  validateInteractiveMessage,
} from '../interactive-messages/interactive-message.types';

export interface SendMessageCommand {
  idempotencyKey: string;
  messageId: string;
  content: OutboundMessageContent;
  phoneNumberId: string;
  recipient: string;
  secretReference: string;
}

export interface SendTextResult {
  externalMessageId: string;
}

export interface WhatsAppAdapter {
  send(command: SendMessageCommand): Promise<SendTextResult>;
}

export const WHATSAPP_ADAPTER = Symbol('WHATSAPP_ADAPTER');

// secretReference holds the tenant's WhatsApp access token, encrypted at
// rest by ChannelConnectionsService.connect() before it ever reaches
// Postgres — see database/sql/020_configure_channel_connection.sql. This is
// the only place that ever decrypts it back into a usable token.
@Injectable()
export class EncryptedChannelSecretProvider implements SecretProvider {
  constructor(private readonly credentials: CredentialEncryptionService) {}

  resolve(secretReference: string): string {
    return this.credentials.decrypt(secretReference);
  }
}

@Injectable()
export class MetaWhatsAppAdapter implements WhatsAppAdapter {
  constructor(
    private readonly config: ConfigService,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
  ) {}

  async send(command: SendMessageCommand): Promise<SendTextResult> {
    const version = this.config.getOrThrow<string>('WHATSAPP_GRAPH_API_VERSION');
    const token = this.secrets.resolve(command.secretReference);
    const response = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(command.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(toMetaPayload(command)),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        // best-effort diagnostic detail only; still throw below either way
      }
      throw new Error(`Meta rejected the request with HTTP ${response.status}: ${body}`);
    }
    const payload = await response.json() as { messages?: Array<{ id?: string }> };
    const externalMessageId = payload.messages?.[0]?.id;
    if (!externalMessageId?.startsWith('wamid')) {
      throw new Error('Meta responded without a valid wamid');
    }
    return { externalMessageId };
  }
}

@Injectable()
export class FixtureWhatsAppAdapter implements WhatsAppAdapter {
  async send(command: SendMessageCommand): Promise<SendTextResult> {
    // Deterministic per event: redelivery simulates adapter idempotency without
    // network access, credentials, phone numbers, or external effects.
    const suffix = createHash('sha256').update(command.idempotencyKey).digest('hex').slice(0, 32);
    return { externalMessageId: `wamid.fixture.${suffix}` };
  }
}

export function toMetaPayload(command: SendMessageCommand): Record<string, unknown> {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: command.recipient,
  };
  if (command.content.type === 'text') {
    return { ...base, type: 'text', text: { preview_url: false, body: command.content.body } };
  }

  const message = command.content.interactive;
  validateInteractiveMessage(message);
  const common = {
    body: { text: message.body },
    ...(message.footer ? { footer: { text: message.footer } } : {}),
  };
  if (message.type === 'buttons') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...common,
        action: {
          buttons: message.options.map((option) => ({
            type: 'reply', reply: { id: option.id, title: option.title },
          })),
        },
      },
    };
  }
  return {
    ...base,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...common,
      action: {
        button: message.buttonLabel,
        sections: [{
          title: message.buttonLabel,
          rows: message.options.map((option) => ({
            id: option.id, title: option.title, ...(option.description ? { description: option.description } : {}),
          })),
        }],
      },
    },
  };
}
