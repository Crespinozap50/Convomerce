export type Membership = { tenantId: string; tenantName?: string; role: string };
export type Session = {
  userId: string;
  email: string;
  displayName: string;
  uiLanguage: "en" | "es";
  mustChangePassword: boolean;
  platformRole: string | null;
  memberships: Membership[];
};
export type Member = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
};
export type Tenant = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  timezone: string;
  defaultLocale: string;
};
export type Connection = {
  id: string | null;
  channelId: string;
  provider: string;
  phoneNumberId: string;
  externalAddress: string;
  wabaId: string | null;
  providerAppId: string | null;
  status: string;
  secretConfigured: boolean;
  lastValidatedAt: string | null;
  lastErrorCode: string | null;
};
export type BotConfig = {
  enabled: boolean;
  assistantName: string;
  locale: string;
  welcomeMessage: string;
  fallbackMessage: string;
  handoffKeywords: string[];
  conversationTimeoutMinutes: number | null;
  messageRetentionDays: number | null;
  aiResponsePolicy: {
    enabled: boolean;
    rolloutPercentage: number;
    dailyRequestLimit: number;
    monthlyCostLimitMinor: number;
    costCurrency: string;
  };
};
export type CommercialRequest = {
  id: string;
  type: string;
  status: string;
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  fulfillmentType: string | null;
  customerNotes: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerAddress: string | null;
  lineCount: number;
  appointment: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    resource: { id: string; name: string; type: string };
  } | null;
};
