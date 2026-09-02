import { ConversationUnderstanding } from "../conversation-understanding/conversation-understanding.types";

export interface UnderstoodFlowInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  body: string;
  locale: string;
  displayName: string | null;
  assistantName?: string;
  businessName?: string;
  interactiveSelectionId?: string;
  understanding: ConversationUnderstanding;
}
