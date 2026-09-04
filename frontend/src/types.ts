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
export type BusinessProfile = {
  description: string;
  address: string;
  phone: string;
  businessHours: string;
  paymentMethods: string;
  fulfillmentOptions: string;
  translations: {
    en: {
      address: string;
      businessHours: string;
      paymentMethods: string;
      fulfillmentOptions: string;
    };
  };
};
export type CapabilityName =
  "commercial_offerings" | "inventory" | "orders" | "appointments" | "delivery";
export type ExternalSource = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
};
export type Offering = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: string;
  sourceProvider: string;
  offeringType: string;
  durationMinutes: number | null;
  bookingRequired: boolean;
  translations: { en: { name: string; description: string } };
  variants: {
    id: string;
    name: string;
    sku: string | null;
    status: string;
    priceMinor: number;
    currency: string;
    availabilityStatus: string;
    translations: { en: { name: string } };
  }[];
};
export type KnowledgePayload = {
  profile: BusinessProfile;
  entries: {
    id: string;
    kind: string;
    title: string;
    content: string;
    status: string;
    keywords: string[];
    translations: { en: { title: string; content: string } };
  }[];
  products: Offering[];
  sources: ExternalSource[];
  capabilities: CapabilityName[];
  calendarSources: ExternalSource[];
  unresolvedQuestions: {
    id: string;
    question: string;
    contextMessages: {
      direction: "inbound" | "outbound";
      body: string;
      occurredAt: string;
    }[];
    occurrenceCount: number;
    status: string;
    firstSeenAt: string;
    lastSeenAt: string;
  }[];
  responseVariants: ResponseVariant[];
  canManage: boolean;
};
export type ResponseVariant = {
  id: string;
  scope: "tenant" | "global";
  templateNamespace: string;
  templateKey: string;
  locale: string;
  deterministicBody: string;
  variantBody: string;
  status: "candidate" | "approved" | "rejected";
  source: string;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ConversationRow = {
  id: string;
  status: string;
  handlingMode: "bot" | "human";
  currentIntent: string | null;
  assignedUserId: string | null;
  lastMessageAt: string | null;
  openedAt: string;
  contactName: string;
  contactAddress: string | null;
  lastMessage: string;
  lastDirection: string | null;
  lastDeliveryStatus: string | null;
  unreadCount: number;
  oldestUnreadAt: string | null;
  channelStatus?: string | null;
  aiEnabled?: boolean;
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
