import { InboundInteractiveSelection } from "../interactive-messages/interactive-message.types";

export interface ReceiveInboundMessageCommand {
  tenantId: string;
  channelId: string;
  contactId?: string;
  providerSubject?: string;
  contactDisplayName?: string;
  externalEventId: string;
  externalMessageId: string;
  text: string;
  interactiveSelection?: InboundInteractiveSelection;
  occurredAt?: Date;
}

export interface ReceiveInboundMessageResult {
  duplicate: boolean;
  conversationId: string;
  messageId: string;
  outboxEventId?: string;
}

export interface ReprocessInboundMessageCommand {
  tenantId: string;
  conversationId: string;
  messageId: string;
}
