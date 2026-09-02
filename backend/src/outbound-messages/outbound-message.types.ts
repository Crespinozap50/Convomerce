export interface CreateFixtureOutboundMessageCommand {
  tenantId: string;
  channelId: string;
  conversationId: string;
  externalMessageId: string;
  text: string;
}

export interface CreatedOutboundMessage {
  messageId: string;
  deliveryStatus: 'sent';
}

export interface RequestOutboundMessageCommand {
  tenantId: string;
  channelId: string;
  conversationId: string;
  text: string;
}

export interface RequestedOutboundMessage {
  messageId: string;
  outboxEventId: string;
  deliveryStatus: 'queued';
}
