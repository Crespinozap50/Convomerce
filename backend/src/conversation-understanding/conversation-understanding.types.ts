import { ConversationLocale } from '../localization/localization';

export type UnderstandingProviderName = 'deterministic' | 'openai' | 'hybrid';

export interface ConversationUnderstanding {
  locale: ConversationLocale;
  localeSource: 'tenant_default' | 'contact_preference' | 'detected';
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  requestedAction: string | null;
  missingInformation: string[];
  requiresHuman: boolean;
  provider: UnderstandingProviderName;
  providerVersion: string;
}

export interface UnderstandingInput {
  message: string;
  configuredLocale: ConversationLocale;
  localeSource?: 'tenant_default' | 'contact_preference' | 'detected';
  handoffKeywords: string[];
  interactiveSelectionId?: string;
  timezone: string;
}

export interface ConversationUnderstandingProvider {
  understand(input: UnderstandingInput): Promise<ConversationUnderstanding>;
}

export const CONVERSATION_UNDERSTANDING_PROVIDER = Symbol('CONVERSATION_UNDERSTANDING_PROVIDER');
