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
