export interface MessageReceivedEvent {
  eventId: string;
  tenantId: string;
  messageId: string;
  conversationId: string;
}

export interface ConsumeEventResult {
  duplicate: boolean;
}
