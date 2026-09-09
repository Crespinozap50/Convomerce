import { ConversationUnderstanding } from "../conversation-understanding/conversation-understanding.types";

export interface UnderstoodFlowInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  // D-128: needed by ConsultativeRecommendationService's AI budget
  // reservation, which FK-references a real app.messages row — not used
  // anywhere else in the flow today. Optional so the dozens of existing
  // test fixtures across both flow services don't all need updating just
  // to satisfy this one new, narrowly-scoped consumer; when absent, the
  // recommendation attempt simply skips (same as the capability being
  // disabled) rather than crashing.
  messageId?: string;
  body: string;
  locale: string;
  displayName: string | null;
  assistantName?: string;
  businessName?: string;
  interactiveSelectionId?: string;
  understanding: ConversationUnderstanding;
  timezone?: string;
}
