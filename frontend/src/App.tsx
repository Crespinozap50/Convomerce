import { FormEvent, Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  Bot,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Link2,
  Languages,
  LogOut,
  MessageCircle,
  MessagesSquare,
  ArrowDown,
  Send,
  PackageSearch,
  ShoppingBag,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  PanelLeftClose,
  PanelLeftOpen,
  FlaskConical,
  X,
  UserPlus,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import { OperationalRequirementsPanel } from "./operational-requirements/OperationalRequirementsPanel";

type Membership = { tenantId: string; tenantName?: string; role: string };
type Session = {
  userId: string;
  email: string;
  displayName: string;
  uiLanguage: "en" | "es";
  mustChangePassword: boolean;
  platformRole: string | null;
  memberships: Membership[];
};
type Member = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
};
type Tenant = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  timezone: string;
  defaultLocale: string;
};
type Connection = {
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
type ConnectionsResponse = {
  canManage: boolean;
  webhookPath: string;
  connections: Connection[];
};
type Page =
  | "companies"
  | "team"
  | "connections"
  | "bot"
  | "knowledge"
  | "scheduling"
  | "requests"
  | "conversations";
type KnowledgeSection =
  | "profile"
  | "catalog"
  | "requirements"
  | "responses"
  | "learning"
  | "answers"
  | "sources";
const knowledgeSections: KnowledgeSection[] = [
  "profile",
  "catalog",
  "requirements",
  "responses",
  "learning",
  "answers",
  "sources",
];
const knowledgePaths: Record<KnowledgeSection, string> = {
  profile: "/knowledge/profile",
  catalog: "/knowledge/catalog",
  requirements: "/knowledge/requirements",
  responses: "/knowledge/learned-responses",
  learning: "/knowledge/learning-queue",
  answers: "/knowledge/published-answers",
  sources: "/knowledge/sources",
};
const pagePaths: Record<Page, string> = {
  companies: "/companies",
  team: "/team",
  connections: "/connections",
  bot: "/bot",
  knowledge: knowledgePaths.profile,
  scheduling: "/scheduling",
  requests: "/orders-and-bookings",
  conversations: "/conversations",
};
const knowledgeDescriptionKeys: Record<KnowledgeSection, string> = {
  profile: "pages.knowledge.description",
  catalog: "knowledge.catalogHelp",
  requirements: "requirements.description",
  responses: "knowledge.responseVariantsHelp",
  learning: "knowledge.learningHelp",
  answers: "knowledge.faqHelp",
  sources: "knowledge.sourcesHelp",
};
const formatLanguageName = (locale: string, displayLocale: string) => {
  try {
    const name =
      new Intl.DisplayNames([displayLocale], { type: "language" }).of(locale) ??
      locale;
    return name.charAt(0).toLocaleUpperCase(displayLocale) + name.slice(1);
  } catch {
    return locale;
  }
};
const dashboardPages: Page[] = [
  "companies",
  "team",
  "connections",
  "bot",
  "knowledge",
  "scheduling",
  "requests",
  "conversations",
];
const readDashboardPage = (userId: string, fallback: Page): Page => {
  const saved = window.localStorage.getItem(
    `commerce.dashboard.page.${userId}`,
  ) as Page | null;
  return saved && dashboardPages.includes(saved) ? saved : fallback;
};
const readDashboardTenant = (userId: string, fallback: string): string =>
  window.localStorage.getItem(`commerce.dashboard.tenant.${userId}`) ??
  fallback;
const readDashboardRoute = (fallback: Page) => {
  const knowledgeSection = knowledgeSections.find(
    (section) => knowledgePaths[section] === window.location.pathname,
  );
  if (knowledgeSection) return { page: "knowledge" as Page, knowledgeSection };
  const page = dashboardPages.find(
    (candidate) => pagePaths[candidate] === window.location.pathname,
  );
  return { page: page ?? fallback, knowledgeSection: null };
};
// Two quick sine tones synthesized with the Web Audio API — no asset file to
// ship/host, and it works the same on every OS. Errors are swallowed:
// playing the chime is a nice-to-have, never worth failing anything over.
function playNotificationSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [880, 1320].forEach((frequency, index) => {
      const start = now + index * 0.12;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    // Audio isn't available/allowed yet (e.g. no user gesture) — skip it.
  }
}
// Only shown when the tab isn't focused: while the admin is actively looking
// at the inbox, a new message already appears there — an OS notification on
// top would just be redundant. The sound chime (called separately) still
// plays either way, matching how chat apps like Slack behave.
function showDesktopNotification(title: string, body: string, tag: string) {
  if (typeof document !== "undefined" && !document.hidden) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag });
  } catch {
    // Some browsers/contexts (e.g. no service worker on certain mobile
    // browsers) reject the Notification constructor — never fatal here.
  }
}
type BotConfig = {
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
type BusinessProfile = {
  description: string;
  address: string;
  phone: string;
  businessHours: string;
  paymentMethods: string;
  fulfillmentOptions: string;
};
type CapabilityName =
  "commercial_offerings" | "inventory" | "orders" | "appointments" | "delivery";
type ExternalSource = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
};
type Offering = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: string;
  sourceProvider: string;
  offeringType: string;
  durationMinutes: number | null;
  bookingRequired: boolean;
  variants: {
    id: string;
    name: string;
    sku: string | null;
    status: string;
    priceMinor: number;
    currency: string;
    availabilityStatus: string;
  }[];
};
type ModifierGroup = {
  id: string;
  name: string;
  selectionType: "single" | "multiple";
  status: string;
  options: {
    id: string;
    name: string;
    priceMinor: number;
    currency: string;
    status: string;
  }[];
  assignedItemIds: string[];
};
type KnowledgePayload = {
  profile: BusinessProfile;
  entries: {
    id: string;
    kind: string;
    title: string;
    content: string;
    status: string;
    keywords: string[];
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
type ResponseVariant = {
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

function AppSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!root.current?.contains(node) && !menu.current?.contains(node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (!open || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 32);
    const left = Math.max(
      16,
      Math.min(rect.left, window.innerWidth - width - 16),
    );
    setPosition({ left, top: rect.bottom + 7, width });
    const close = () => setOpen(false);
    const closeOnExternalScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOnExternalScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnExternalScroll, true);
    };
  }, [open]);
  const popup = open
    ? createPortal(
        <div
          className="app-select-menu"
          role="listbox"
          ref={menu}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
          }}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <ShieldCheck size={16} />}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;
  return (
    <div className="app-select" ref={root}>
      <button
        type="button"
        className="app-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={17} className={open ? "rotated" : ""} />
      </button>
      {popup}
    </div>
  );
}

export default function App() {
  const { i18n } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Session>("/v1/auth/me")
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (session?.uiLanguage && i18n.language !== session.uiLanguage) {
      void i18n.changeLanguage(session.uiLanguage);
    }
  }, [session?.uiLanguage, i18n]);
  if (loading)
    return (
      <div className="center">
        <div className="loader" />
      </div>
    );
  if (!session) return <Login onLogin={setSession} />;
  if (session.mustChangePassword)
    return (
      <ChangePassword
        onChanged={() => api<Session>("/v1/auth/me").then(setSession)}
        onError={setError}
        error={error}
      />
    );
  return (
    <Dashboard
      session={session}
      onLogout={async () => {
        await api("/v1/auth/logout", { method: "POST" });
        setSession(null);
      }}
    />
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("admin@commerce.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onLogin(await api("/v1/auth/me"));
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark">
          <MessageCircle size={32} />
        </div>
        <span className="eyebrow">COMMERCE ASSISTANT</span>
        <h1>{t("login.headline")}</h1>
        <p>{t("login.description")}</p>
        <div className="trust">
          <ShieldCheck />
          <span>{t("login.trust")}</span>
        </div>
      </section>
      <section className="auth-card">
        <div>
          <LanguageSwitcher />
          <span className="eyebrow green">{t("login.eyebrow")}</span>
          <h2>{t("login.title")}</h2>
          <p>{t("login.subtitle")}</p>
        </div>
        <form onSubmit={submit}>
          <label>
            {t("login.email")}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            {t("login.password")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? t("login.busy") : t("login.submit")}
          </button>
        </form>
        <small>{t("login.secure")}</small>
      </section>
    </main>
  );
}

function ChangePassword({
  onChanged,
  error,
  onError,
}: {
  onChanged: () => void;
  error: string;
  onError: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError("");
    try {
      await api("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged();
    } catch (x) {
      onError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="center muted-bg">
      <section className="password-card">
        <div className="icon-box">
          <ShieldCheck />
        </div>
        <LanguageSwitcher persist />
        <span className="eyebrow green">{t("password.eyebrow")}</span>
        <h2>{t("password.title")}</h2>
        <p>{t("password.description")}</p>
        <form onSubmit={submit}>
          <label>
            {t("password.current")}
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label>
            {t("password.next")}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              minLength={12}
              required
            />
            <small>{t("password.hint")}</small>
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>{t("password.submit")}</button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const isSuperAdmin = session.platformRole === "owner";
  const fallbackPage = readDashboardPage(
    session.userId,
    isSuperAdmin ? "companies" : "team",
  );
  const initialRoute = readDashboardRoute(fallbackPage);
  const [page, setPage] = useState<Page>(initialRoute.page);
  const [companies, setCompanies] = useState<Tenant[]>([]);
  const [tenant, setTenant] = useState(() => {
    const fallback = session.memberships[0]?.tenantId ?? "";
    const saved = readDashboardTenant(session.userId, fallback);
    return isSuperAdmin ||
      session.memberships.some((membership) => membership.tenantId === saved)
      ? saved
      : fallback;
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [canManageConnections, setCanManageConnections] = useState(false);
  const [webhookPath, setWebhookPath] = useState("/v1/webhooks/whatsapp");
  const [editingConnection, setEditingConnection] = useState<Connection | null>(
    null,
  );
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgePayload | null>(null);
  const [knowledgeSection, setKnowledgeSection] = useState<KnowledgeSection>(
    () => {
      if (initialRoute.knowledgeSection) return initialRoute.knowledgeSection;
      const saved = window.localStorage.getItem(
        `commerce.dashboard.knowledge.${session.userId}`,
      ) as KnowledgeSection | null;
      return saved && knowledgeSections.includes(saved) ? saved : "profile";
    },
  );
  const navigate = (nextPage: Page, section?: KnowledgeSection) => {
    const nextSection = section ?? knowledgeSection;
    const path =
      nextPage === "knowledge"
        ? knowledgePaths[nextSection]
        : pagePaths[nextPage];
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
    setPage(nextPage);
    if (nextPage === "knowledge") setKnowledgeSection(nextSection);
  };
  useEffect(() => {
    const knownPath =
      Object.values(pagePaths).includes(window.location.pathname) ||
      Object.values(knowledgePaths).includes(window.location.pathname);
    if (!knownPath) {
      const canonicalPath =
        page === "knowledge"
          ? knowledgePaths[knowledgeSection]
          : pagePaths[page];
      window.history.replaceState({}, "", canonicalPath);
    }
    // Runs once on mount only, to normalize an unknown initial URL (e.g. a
    // deep link) against the current page/section state — must not re-run
    // on every navigation, which already updates the URL itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showInvite, setShowInvite] = useState(false);
  const [showCompany, setShowCompany] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Tenant | null>(null);
  // A monotonic id lets the auto-dismiss effect below reset its timer even
  // when the exact same message/type is shown twice in a row.
  const noticeIdRef = useRef(0);
  const [noticeState, setNoticeState] = useState<
    { id: number; message: string; type: "success" | "error" } | null
  >(null);
  const setNotice = (message: string, type: "success" | "error" = "success") => {
    if (!message) {
      setNoticeState(null);
      return;
    }
    noticeIdRef.current += 1;
    setNoticeState({ id: noticeIdRef.current, message, type });
  };
  useEffect(() => {
    if (!noticeState) return;
    const timer = setTimeout(() => setNoticeState(null), 5000);
    return () => clearTimeout(timer);
  }, [noticeState]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navigationCounts, setNavigationCounts] = useState({
    requests: 0,
    conversations: 0,
  });
  // Baseline for detecting *newly* unread conversations between polls (not
  // just "has unread messages"). Reset whenever the tenant changes so
  // switching businesses doesn't fire a notification storm for whatever was
  // already unread there — see the tenant-change effect below.
  const previousUnreadRef = useRef<Map<string, number>>(new Map());
  const notificationsReadyRef = useRef(false);
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") void Notification.requestPermission();
  }, []);
  const loadNavigationCounts = async () => {
    if (!tenant) return;
    const [requestResult, conversationResult] = await Promise.all([
      api<{ newCount: number; requests: CommercialRequest[] }>(
        `/v1/admin/tenants/${tenant}/commercial-requests`,
      ),
      api<{ conversations: ConversationRow[] }>(
        `/v1/admin/tenants/${tenant}/conversations`,
      ),
    ]);
    const previous = previousUnreadRef.current;
    const next = new Map<string, number>();
    let newlyUnread: ConversationRow | null = null;
    for (const row of conversationResult.conversations) {
      next.set(row.id, row.unreadCount);
      // Only nag the admin for conversations a human is already handling —
      // while the bot has it, there's nothing for a person to act on yet.
      if (
        notificationsReadyRef.current &&
        row.handlingMode === "human" &&
        row.unreadCount > (previous.get(row.id) ?? 0)
      ) {
        newlyUnread = row;
      }
    }
    previousUnreadRef.current = next;
    notificationsReadyRef.current = true;
    if (newlyUnread) {
      playNotificationSound();
      showDesktopNotification(
        t("conversations.newMessageTitle", { name: newlyUnread.contactName }),
        newlyUnread.lastMessage,
        `conversation-${newlyUnread.id}`,
      );
    }
    setNavigationCounts({
      requests: requestResult.newCount,
      conversations: conversationResult.conversations.filter(
        (row) => row.unreadCount > 0,
      ).length,
    });
  };
  async function loadCompanies() {
    if (!isSuperAdmin) return;
    const rows = await api<Tenant[]>("/v1/admin/platform/tenants");
    setCompanies(rows);
    if (!rows.some((row) => row.id === tenant)) setTenant(rows[0]?.id ?? "");
  }
  useEffect(() => {
    void loadCompanies().catch((e) => setNotice(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (
      !isSuperAdmin &&
      !session.memberships.some((membership) => membership.tenantId === tenant)
    ) {
      setTenant(session.memberships[0]?.tenantId ?? "");
    }
  }, [isSuperAdmin, session.memberships, tenant]);
  useEffect(() => {
    window.localStorage.setItem(
      `commerce.dashboard.page.${session.userId}`,
      page,
    );
  }, [page, session.userId]);
  useEffect(() => {
    const onPopState = () => {
      const route = readDashboardRoute(fallbackPage);
      setPage(route.page);
      if (route.knowledgeSection) setKnowledgeSection(route.knowledgeSection);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [fallbackPage]);
  useEffect(() => {
    window.localStorage.setItem(
      `commerce.dashboard.knowledge.${session.userId}`,
      knowledgeSection,
    );
  }, [knowledgeSection, session.userId]);
  useEffect(() => {
    if (tenant)
      window.localStorage.setItem(
        `commerce.dashboard.tenant.${session.userId}`,
        tenant,
      );
  }, [tenant, session.userId]);
  useEffect(() => {
    if (!tenant) return;
    setNotice("");
    if (page === "team")
      void api<Member[]>(`/v1/admin/tenants/${tenant}/users`)
        .then(setMembers)
        .catch((e) => setNotice(e.message, "error"));
    if (page === "connections")
      void api<ConnectionsResponse>(
        `/v1/admin/tenants/${tenant}/channel-connections`,
      )
        .then((result) => {
          setConnections(result.connections);
          setCanManageConnections(result.canManage);
          setWebhookPath(result.webhookPath);
        })
        .catch((e) => setNotice(e.message, "error"));
    if (page === "bot")
      void api<BotConfig>(`/v1/admin/tenants/${tenant}/bot`)
        .then(setBotConfig)
        .catch((e) => setNotice(e.message, "error"));
    if (page === "knowledge")
      void api<KnowledgePayload>(`/v1/admin/tenants/${tenant}/knowledge`)
        .then(setKnowledge)
        .catch((e) => setNotice(e.message, "error"));
  }, [tenant, page]);
  useEffect(() => {
    setNavigationCounts({ requests: 0, conversations: 0 });
    previousUnreadRef.current = new Map();
    notificationsReadyRef.current = false;
    if (!tenant) return;
    void loadNavigationCounts().catch(() => undefined);
    const timer = window.setInterval(
      () => void loadNavigationCounts().catch(() => undefined),
      2500,
    );
    return () => window.clearInterval(timer);
    // loadNavigationCounts is redefined every render; including it here
    // would tear down and recreate the poll interval on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  async function update(m: Member, role: string, status: string) {
    try {
      await api(`/v1/admin/tenants/${tenant}/users/${m.membershipId}`, {
        method: "PATCH",
        body: JSON.stringify({ role, status }),
      });
      setMembers(await api(`/v1/admin/tenants/${tenant}/users`));
      setNotice(t("team.permissionsUpdated"));
    } catch (e) {
      setNotice((e as Error).message, "error");
    }
  }
  const owners = members.filter(
    (m) => m.role === "owner" && m.status === "active",
  ).length;
  const options = isSuperAdmin
    ? companies.map((c) => ({ id: c.id, label: c.displayName }))
    : session.memberships.map((m) => ({
        id: m.tenantId,
        label: `${m.tenantName ?? t("tenant.currentCompany")} · ${roleName(m.role, t)}`,
      }));
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside>
        <div className="logo">
          <MessageCircle />
          <b>Commerce AI</b>
          <button
            className="sidebar-toggle"
            aria-label={
              sidebarCollapsed ? t("common.expand") : t("common.collapse")
            }
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
        <nav>
          {isSuperAdmin && (
            <button
              className={page === "companies" ? "active" : ""}
              onClick={() => navigate("companies")}
            >
              <Building2 />
              {t("nav.companies")}
            </button>
          )}
          <button
            className={page === "team" ? "active" : ""}
            onClick={() => navigate("team")}
          >
            <Users />
            {t("nav.team")}
          </button>
          <button
            className={page === "connections" ? "active" : ""}
            onClick={() => navigate("connections")}
          >
            <Link2 />
            {t("nav.connections")}
          </button>
          <button
            className={page === "bot" ? "active" : ""}
            onClick={() => navigate("bot")}
          >
            <Bot />
            {t("nav.bot")}
          </button>
          <div className={`nav-group ${page === "knowledge" ? "open" : ""}`}>
            <button
              className={page === "knowledge" ? "active" : ""}
              onClick={() => navigate("knowledge")}
            >
              <BookOpen />
              <span className="nav-label">{t("nav.knowledge")}</span>
              <ChevronDown className="nav-chevron" size={15} />
            </button>
            {page === "knowledge" && (
              <div className="nav-submenu">
                {knowledgeSections.map((section) => (
                  <button
                    key={section}
                    className={knowledgeSection === section ? "active" : ""}
                    onClick={() => navigate("knowledge", section)}
                  >
                    {t(`nav.knowledgeSections.${section}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={page === "scheduling" ? "active" : ""}
            onClick={() => navigate("scheduling")}
          >
            <CalendarDays />
            {t("nav.scheduling")}
          </button>
          <button
            className={page === "requests" ? "active" : ""}
            onClick={() => navigate("requests")}
          >
            <ShoppingBag />
            <span className="nav-label">{t("nav.requests")}</span>
            {navigationCounts.requests > 0 && (
              <span
                className="nav-count"
                aria-label={t("nav.newRequests", {
                  count: navigationCounts.requests,
                })}
              >
                {navigationCounts.requests > 99
                  ? "99+"
                  : navigationCounts.requests}
              </span>
            )}
          </button>
          <button
            className={page === "conversations" ? "active" : ""}
            onClick={() => navigate("conversations")}
          >
            <MessagesSquare />
            <span className="nav-label">{t("nav.conversations")}</span>
            {navigationCounts.conversations > 0 && (
              <span
                className="nav-count"
                aria-label={t("nav.unreadConversations", {
                  count: navigationCounts.conversations,
                })}
              >
                {navigationCounts.conversations > 99
                  ? "99+"
                  : navigationCounts.conversations}
              </span>
            )}
          </button>
        </nav>
        <div className="sidebar-language">
          <LanguageSwitcher compact persist />
        </div>
        <div className="profile">
          <div className="avatar">
            {session.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <b>{session.displayName}</b>
            <span>
              {isSuperAdmin
                ? t("common.superAdmin")
                : (session.platformRole ?? t("common.member"))}
            </span>
          </div>
          <button className="icon-button" onClick={onLogout}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main
        className={`content ${page === "knowledge" ? "knowledge-page" : ""}`}
      >
        <header>
          <div>
            <span className="eyebrow green">
              {page === "knowledge"
                ? `${t("nav.knowledge")} / ${t(`nav.knowledgeSections.${knowledgeSection}`)}`.toUpperCase()
                : t("common.administration").toUpperCase()}
            </span>
            <h1>
              {page === "companies"
                ? t("pages.companies.title")
                : page === "team"
                  ? t("pages.team.title")
                  : page === "connections"
                    ? t("pages.connections.title")
                    : page === "bot"
                      ? t("pages.bot.title")
                      : page === "knowledge"
                        ? t(`nav.knowledgeSections.${knowledgeSection}`)
                        : page === "scheduling"
                          ? t("pages.scheduling.title")
                          : page === "requests"
                            ? t("pages.requests.title")
                            : t("pages.conversations.title")}
            </h1>
            <p>
              {page === "companies"
                ? t("pages.companies.description")
                : page === "team"
                  ? t("pages.team.description")
                  : page === "connections"
                    ? t("pages.connections.description")
                    : page === "bot"
                      ? t("pages.bot.description")
                      : page === "knowledge"
                        ? t(knowledgeDescriptionKeys[knowledgeSection])
                        : page === "scheduling"
                          ? t("pages.scheduling.description")
                          : page === "requests"
                            ? t("pages.requests.description")
                            : t("pages.conversations.description")}
            </p>
          </div>
          {page !== "companies" && (
            <TenantSelector
              value={tenant}
              options={options}
              onChange={setTenant}
            />
          )}
        </header>
        {noticeState &&
          createPortal(
            <div
              className={`toast toast-${noticeState.type}`}
              role="status"
              key={noticeState.id}
            >
              {noticeState.type === "success" ? (
                <ShieldCheck size={18} />
              ) : (
                <TriangleAlert size={18} />
              )}
              <span>{noticeState.message}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => setNoticeState(null)}
                aria-label={t("common.dismiss")}
              >
                <X size={14} />
              </button>
            </div>,
            document.body,
          )}
        {page === "companies" && (
          <Companies
            companies={companies}
            onCreate={() => setShowCompany(true)}
            onEdit={setEditingCompany}
            onOpen={(id) => {
              setTenant(id);
              navigate("team");
            }}
          />
        )}
        {page === "team" && (
          <Team
            members={members}
            owners={owners}
            tenant={tenant}
            onInvite={() => setShowInvite(true)}
            onUpdate={update}
          />
        )}{" "}
        {page === "connections" && (
          <Connections
            rows={connections}
            canManage={canManageConnections}
            webhookPath={webhookPath}
            tenant={tenant}
            onConfigure={setEditingConnection}
            onNotice={setNotice}
            onChanged={async (message, type) => {
              const result = await api<ConnectionsResponse>(
                `/v1/admin/tenants/${tenant}/channel-connections`,
              );
              setConnections(result.connections);
              setNotice(message, type);
            }}
          />
        )}{" "}
        {page === "bot" && botConfig && (
          <BotSettings
            tenant={tenant}
            value={botConfig}
            onSaved={(v) => {
              setBotConfig(v);
              setNotice(t("bot.saved"));
            }}
          />
        )}
        {page === "knowledge" && knowledge && knowledgeSection === "requirements" && (
          <div className="knowledge-page-body">
            <OperationalRequirementsPanel tenant={tenant} />
          </div>
        )}
        {page === "knowledge" && knowledge && knowledgeSection !== "requirements" && (
          <div className="knowledge-page-body">
            <KnowledgeSettings
              tenant={tenant}
              value={knowledge}
              section={knowledgeSection}
              onNotice={setNotice}
              onSaved={(profile) => {
                setKnowledge({ ...knowledge, profile });
                setNotice(t("knowledge.saved"));
              }}
            />
          </div>
        )}
        {page === "conversations" && (
          <ConversationInbox
            tenant={tenant}
            onNotice={setNotice}
            onCountsChanged={loadNavigationCounts}
          />
        )}
        {page === "requests" && (
          <CommercialRequests
            tenant={tenant}
            onNotice={setNotice}
            onCountsChanged={loadNavigationCounts}
          />
        )}
        {page === "scheduling" && (
          <SchedulingSettings tenant={tenant} onNotice={setNotice} />
        )}
        {editingConnection && (
          <ConnectionModal
            tenant={tenant}
            connection={editingConnection}
            onClose={() => setEditingConnection(null)}
            onDone={async () => {
              setEditingConnection(null);
              const result = await api<ConnectionsResponse>(
                `/v1/admin/tenants/${tenant}/channel-connections`,
              );
              setConnections(result.connections);
              setNotice(t("connections.saved"));
            }}
          />
        )}
        {showInvite && (
          <InviteModal
            tenant={tenant}
            onClose={() => setShowInvite(false)}
            onDone={() => {
              setShowInvite(false);
              setNotice(t("team.invitationCreated"));
            }}
          />
        )}
        {showCompany && (
          <CompanyModal
            onClose={() => setShowCompany(false)}
            onDone={async () => {
              setShowCompany(false);
              await loadCompanies();
              setNotice(t("tenant.created"));
            }}
          />
        )}
        {editingCompany && (
          <EditCompanyModal
            company={editingCompany}
            onClose={() => setEditingCompany(null)}
            onDone={async () => {
              setEditingCompany(null);
              await loadCompanies();
              setNotice(t("companyModal.updated"));
            }}
          />
        )}
      </main>
    </div>
  );
}

function TenantSelector({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  return (
    <div className="tenant-picker">
      <button
        className="tenant-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Building2 size={20} />
        <span>{selected?.label ?? t("tenant.select")}</span>
        <ChevronDown className={open ? "rotated" : ""} size={17} />
      </button>
      {open && (
        <div
          className="tenant-menu"
          role="listbox"
          aria-label={t("tenant.selectorLabel")}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={option.id === value ? "selected" : ""}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <Building2 size={18} />
              <span>{option.label}</span>
              {option.id === value && <ShieldCheck size={17} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Companies({
  companies,
  onCreate,
  onOpen,
  onEdit,
}: {
  companies: Tenant[];
  onCreate: () => void;
  onOpen: (id: string) => void;
  onEdit: (company: Tenant) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="panel page-panel">
      <div className="panel-head">
        <div>
          <h2>{t("tenant.registered")}</h2>
          <p>{t("tenant.available", { count: companies.length })}</p>
        </div>
        <button onClick={onCreate}>
          <Plus size={18} /> {t("tenant.new")}
        </button>
      </div>
      <div className="company-grid">
        {companies.map((c) => (
          <article className="company-card" key={c.id}>
            <button className="company-card-open" onClick={() => onOpen(c.id)}>
              <Building2 />
              <span>
                <b>{c.displayName}</b>
                <small>
                  {c.slug} · {c.timezone}
                </small>
              </span>
            </button>
            <div className="company-card-actions">
              <em className={c.status}>
                {t(`common.${c.status}`, { defaultValue: c.status })}
              </em>
              <button className="company-card-edit" onClick={() => onEdit(c)}>
                <Pencil size={15} />
                {t("companyModal.edit")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
function Team({
  members,
  owners,
  tenant,
  onInvite,
  onUpdate,
}: {
  members: Member[];
  owners: number;
  tenant: string;
  onInvite: () => void;
  onUpdate: (m: Member, r: string, s: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <section className="stats">
        <div>
          <span>{t("team.members")}</span>
          <strong>{members.length}</strong>
        </div>
        <div>
          <span>{t("team.active")}</span>
          <strong>{members.filter((m) => m.status === "active").length}</strong>
        </div>
        <div>
          <span>{t("team.administrators")}</span>
          <strong>
            {members.filter((m) => ["owner", "admin"].includes(m.role)).length}
          </strong>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{t("team.title")}</h2>
            <p>{t("team.description")}</p>
          </div>
          <button onClick={onInvite} disabled={!tenant}>
            <UserPlus size={18} /> {t("team.invite")}
          </button>
        </div>
        <div className="table">
          <div className="row heading">
            <span>{t("team.user")}</span>
            <span>{t("team.role")}</span>
            <span>{t("team.status")}</span>
            <span>{t("team.actions")}</span>
          </div>
          {members.map((m) => {
            const protectedOwner =
              m.role === "owner" && m.status === "active" && owners === 1;
            return (
              <div className="row" key={m.membershipId}>
                <span className="user-cell">
                  <i>{m.displayName.slice(0, 2).toUpperCase()}</i>
                  <span>
                    <b>{m.displayName}</b>
                    <small>{m.email}</small>
                  </span>
                </span>
                <span>
                  {protectedOwner ? (
                    <span className="fixed-role">{t("roles.owner")}</span>
                  ) : (
                    <AppSelect
                      value={m.role}
                      onChange={(role) => onUpdate(m, role, m.status)}
                      options={["owner", "admin", "operator", "viewer"].map(
                        (role) => ({ value: role, label: roleName(role, t) }),
                      )}
                    />
                  )}
                </span>
                <span>
                  <em className={m.status}>
                    {t(`common.${m.status}`, { defaultValue: m.status })}
                  </em>
                </span>
                <span>
                  {protectedOwner ? (
                    <small className="protected">
                      {t("team.ownerPrimary")}
                    </small>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() =>
                        onUpdate(
                          m,
                          m.role,
                          m.status === "active" ? "disabled" : "active",
                        )
                      }
                    >
                      {m.status === "active"
                        ? t("team.disable")
                        : t("team.reactivate")}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
function BusinessHoursEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const lines = value.split("\n");
  const update = (index: number, next: string) =>
    onChange(
      lines
        .map((line, current) => (current === index ? next : line))
        .join("\n"),
    );
  const remove = (index: number) =>
    onChange(lines.filter((_, current) => current !== index).join("\n"));
  return (
    <fieldset className="business-hours-editor">
      <legend>{t("knowledge.hours")}</legend>
      <small className="field-help">{t("knowledge.hoursHelp")}</small>
      <div className="business-hours-list">
        {lines.map((line, index) => (
          <div className="business-hours-row" key={index}>
            <CalendarDays size={18} />
            <input
              aria-label={t("knowledge.hoursRow", { number: index + 1 })}
              placeholder={t("knowledge.hoursPlaceholder")}
              value={line}
              onChange={(event) => update(index, event.target.value)}
            />
            {(lines.length > 1 || line) && (
              <button
                type="button"
                className="icon-button danger-soft"
                aria-label={t("knowledge.removeHoursRow")}
                onClick={() => remove(index)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary compact-action"
        onClick={() => onChange(value ? `${value}\n` : "")}
      >
        <Plus size={15} />
        {t("knowledge.addHoursRow")}
      </button>
    </fieldset>
  );
}

function KnowledgeSettings({
  tenant,
  value,
  section,
  onNotice,
  onSaved,
}: {
  tenant: string;
  value: KnowledgePayload;
  section: KnowledgeSection;
  onNotice: (message: string, type?: "success" | "error") => void;
  onSaved: (profile: BusinessProfile) => void;
}) {
  const { t } = useTranslation();
  const normalizeHours = (hours: string) =>
    hours
      .split(/;|\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  const [form, setForm] = useState({
    ...value.profile,
    businessHours: normalizeHours(value.profile.businessHours),
  });
  const [capabilities, setCapabilities] = useState<CapabilityName[]>(
    value.capabilities,
  );
  const [busy, setBusy] = useState(false);
  const [capBusy, setCapBusy] = useState(false);
  const [error, setError] = useState("");
  const [capMessage, setCapMessage] = useState("");
  const [unresolved, setUnresolved] = useState(value.unresolvedQuestions);
  const [entries, setEntries] = useState(value.entries);
  const [products, setProducts] = useState(value.products);
  const [responseVariants, setResponseVariants] = useState(
    value.responseVariants,
  );
  const [editingOffering, setEditingOffering] = useState<
    Offering | null | "new"
  >(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierGroupsCanManage, setModifierGroupsCanManage] = useState(false);
  const loadModifierGroups = async () => {
    const result = await api<{
      groups: ModifierGroup[];
      items: { id: string; name: string }[];
    }>(`/v1/admin/tenants/${tenant}/modifier-groups`);
    setModifierGroups(result.groups);
  };
  useEffect(() => {
    setModifierGroupsCanManage(value.canManage);
    void loadModifierGroups().catch(() => undefined);
    // tenant-scoped fetch, intentionally not re-run when `value` changes
    // (only the parent tenant switch should refetch this list)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  useEffect(
    () =>
      setForm({
        ...value.profile,
        businessHours: normalizeHours(value.profile.businessHours),
      }),
    [value.profile],
  );
  useEffect(() => setCapabilities(value.capabilities), [value.capabilities]);
  useEffect(
    () => setUnresolved(value.unresolvedQuestions),
    [value.unresolvedQuestions],
  );
  useEffect(() => setEntries(value.entries), [value.entries]);
  useEffect(() => setProducts(value.products), [value.products]);
  useEffect(
    () => setResponseVariants(value.responseVariants),
    [value.responseVariants],
  );
  async function archiveOffering(offering: Offering) {
    if (!window.confirm(t("knowledge.offeringArchiveConfirm"))) return;
    try {
      await api(
        `/v1/admin/tenants/${tenant}/knowledge/offerings/${offering.id}`,
        { method: "DELETE" },
      );
      setProducts((rows) => rows.filter((row) => row.id !== offering.id));
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/knowledge/profile`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      onSaved(form);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveCapabilities() {
    setCapBusy(true);
    setCapMessage("");
    try {
      await api(`/v1/admin/tenants/${tenant}/knowledge/capabilities`, {
        method: "PUT",
        body: JSON.stringify({ capabilities }),
      });
      setCapMessage(t("knowledge.capabilitiesSaved"));
    } catch (x) {
      setCapMessage((x as Error).message);
    } finally {
      setCapBusy(false);
    }
  }
  const capabilityOptions: CapabilityName[] = [
    "commercial_offerings",
    "inventory",
    "orders",
    "appointments",
    "delivery",
  ];
  const commerceProviders = [
    { id: "shopify", name: "Shopify" },
    { id: "magento", name: "Magento / Adobe Commerce" },
    { id: "custom_api", name: t("knowledge.otherApi") },
  ];
  const calendarProviders = [
    { id: "google_calendar", name: "Google Calendar" },
    { id: "microsoft_outlook", name: "Microsoft Outlook" },
    { id: "calendly", name: "Calendly" },
    { id: "custom_api", name: t("knowledge.otherCalendar") },
  ];
  const sourceRows = (
    providers: { id: string; name: string }[],
    sources: ExternalSource[],
  ) =>
    providers.map((provider) => {
      const source = sources.find((item) => item.provider === provider.id);
      return (
        <div key={provider.id}>
          <span>
            <b>{provider.name}</b>
            <small>{source?.displayName ?? t("knowledge.adapterReady")}</small>
          </span>
          <em className={source?.status ?? "planned"}>
            {source
              ? t(`common.${source.status}`, { defaultValue: source.status })
              : t("knowledge.planned")}
          </em>
        </div>
      );
    });
  return (
    <>
      <section
        id="knowledge-profile"
        className="panel page-panel capability-panel knowledge-anchor"
        hidden={section !== "profile"}
      >
        <div className="panel-head">
          <div>
            <h2>{t("knowledge.capabilitiesTitle")}</h2>
            <p>{t("knowledge.capabilitiesHelp")}</p>
          </div>
        </div>
        <div className="capability-grid">
          {capabilityOptions.map((capability) => (
            <label key={capability} className="capability-card">
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={(event) =>
                  setCapabilities(
                    event.target.checked
                      ? [...capabilities, capability]
                      : capabilities.filter((item) => item !== capability),
                  )
                }
              />
              <span className="switch-control" aria-hidden="true">
                <span />
              </span>
              <span>
                <b>{t(`knowledge.capabilities.${capability}.title`)}</b>
                <small>{t(`knowledge.capabilities.${capability}.help`)}</small>
              </span>
            </label>
          ))}
        </div>
        {value.canManage && (
          <div className="capability-actions">
            <small>{capMessage}</small>
            <button onClick={() => void saveCapabilities()} disabled={capBusy}>
              {capBusy ? t("common.saving") : t("common.saveChanges")}
            </button>
          </div>
        )}
      </section>
      <div className="knowledge-layout">
        <section
          className="panel knowledge-profile"
          hidden={section !== "profile"}
        >
          <div className="panel-head">
            <div>
              <h2>{t("knowledge.profileTitle")}</h2>
              <p>{t("knowledge.profileHelp")}</p>
            </div>
          </div>
          <form className="knowledge-form" onSubmit={submit}>
            <label>
              {t("knowledge.description")}
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <div className="knowledge-two">
              <label>
                {t("knowledge.address")}
                <input
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.phone")}
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
            </div>
            <BusinessHoursEditor
              value={form.businessHours}
              onChange={(businessHours) => setForm({ ...form, businessHours })}
            />
            <div className="knowledge-two">
              <label>
                {t("knowledge.payments")}
                <textarea
                  value={form.paymentMethods}
                  onChange={(e) =>
                    setForm({ ...form, paymentMethods: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.fulfillment")}
                <textarea
                  value={form.fulfillmentOptions}
                  onChange={(e) =>
                    setForm({ ...form, fulfillmentOptions: e.target.value })
                  }
                />
              </label>
            </div>
            {error && <div className="form-alert">{error}</div>}
            <div className="knowledge-save">
              <small>{t("knowledge.aiHelp")}</small>
              {value.canManage && (
                <button disabled={busy}>
                  {busy ? t("common.saving") : t("common.saveChanges")}
                </button>
              )}
            </div>
          </form>
        </section>
        <div className="knowledge-side route-view">
          <section
            id="knowledge-catalog"
            className="panel knowledge-anchor"
            hidden={section !== "catalog"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.catalogTitle")}</h2>
                <p>{t("knowledge.catalogHelp")}</p>
              </div>
              {value.canManage ? (
                <button
                  className="secondary offering-add"
                  onClick={() => setEditingOffering("new")}
                >
                  <Plus size={16} /> {t("knowledge.offeringCreate")}
                </button>
              ) : (
                <PackageSearch />
              )}
            </div>
            <div className="knowledge-products">
              {products.map((p) => {
                const variant =
                  p.variants.find((item) => item.status !== "archived") ??
                  p.variants[0];
                const price = variant
                  ? new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: variant.currency,
                      maximumFractionDigits: 0,
                    }).format(variant.priceMinor / 100)
                  : t("knowledge.noPrice");
                return (
                  <div key={p.id}>
                    <span>
                      <b>{p.name}</b>
                      <small>
                        {t(`knowledge.offeringTypes.${p.offeringType}`, {
                          defaultValue: p.offeringType,
                        })}{" "}
                        · {p.category ?? t("knowledge.uncategorized")}
                      </small>
                      <small>
                        {variant?.name} · {price}
                        {p.variants.filter((item) => item.status !== "archived")
                          .length > 1
                          ? ` · ${t("knowledge.additionalVariants", { count: p.variants.filter((item) => item.status !== "archived").length - 1 })}`
                          : ""}
                      </small>
                    </span>
                    <em className={p.status}>
                      {t(`common.${p.status}`, { defaultValue: p.status })}
                    </em>
                    {value.canManage && p.sourceProvider === "manual" && (
                      <span className="offering-actions">
                        <button
                          className="icon-button"
                          title={t("common.edit")}
                          onClick={() => setEditingOffering(p)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button danger-soft"
                          title={t("knowledge.offeringArchive")}
                          onClick={() => void archiveOffering(p)}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
              {!products.length && (
                <div className="offering-empty">
                  <span>
                    <b>{t("knowledge.offeringEmptyTitle")}</b>
                    <small>{t("knowledge.offeringEmptyHelp")}</small>
                  </span>
                </div>
              )}
            </div>
          </section>
          <section
            id="knowledge-extras"
            className="panel knowledge-anchor"
            hidden={section !== "catalog"}
          >
            <ExtrasPanel
              tenant={tenant}
              groups={modifierGroups}
              canManage={modifierGroupsCanManage}
              onChanged={loadModifierGroups}
              onNotice={onNotice}
            />
          </section>
          <section
            id="knowledge-sources"
            className="panel knowledge-anchor"
            hidden={section !== "sources"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.sourcesTitle")}</h2>
                <p>{t("knowledge.sourcesHelp")}</p>
              </div>
            </div>
            <div className="source-list">
              {sourceRows(commerceProviders, value.sources)}
            </div>
          </section>
          {section === "sources" && capabilities.includes("appointments") && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t("knowledge.calendarSourcesTitle")}</h2>
                  <p>{t("knowledge.calendarSourcesHelp")}</p>
                </div>
                <CalendarDays />
              </div>
              <div className="source-list">
                {sourceRows(calendarProviders, value.calendarSources)}
              </div>
            </section>
          )}
          <section
            id="knowledge-responses"
            className="panel learned-responses knowledge-anchor"
            hidden={section !== "responses"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.responseVariantsTitle")}</h2>
                <p>{t("knowledge.responseVariantsHelp")}</p>
              </div>
            </div>
            <LearnedResponsesPanel
              tenant={tenant}
              variants={responseVariants}
              canManage={value.canManage}
              onUpdated={(next) =>
                setResponseVariants((items) =>
                  items.map((item) => (item.id === next.id ? next : item)),
                )
              }
            />
          </section>
          <section
            id="knowledge-learning"
            className="panel learning-inbox knowledge-anchor"
            hidden={section !== "learning"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.learningTitle")}</h2>
                <p>{t("knowledge.learningHelp")}</p>
              </div>
            </div>
            <div className="source-list">
              {unresolved.length === 0 ? (
                <div className="learning-empty">
                  <span className="learning-empty-icon">
                    <BookOpen size={20} />
                  </span>
                  <span>
                    <b>{t("knowledge.learningEmptyTitle")}</b>
                    <small>{t("knowledge.learningEmpty")}</small>
                  </span>
                </div>
              ) : (
                unresolved.map((question) => (
                  <LearningQuestion
                    key={question.id}
                    tenant={tenant}
                    question={question}
                    onReviewed={() =>
                      setUnresolved((items) =>
                        items.filter((item) => item.id !== question.id),
                      )
                    }
                  />
                ))
              )}
            </div>
          </section>
          <section
            id="knowledge-answers"
            className="panel knowledge-faq knowledge-anchor"
            hidden={section !== "answers"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.faqTitle")}</h2>
                <p>{t("knowledge.faqHelp")}</p>
              </div>
            </div>
            <div>
              {entries.map((entry) => (
                <PublishedAnswer
                  key={entry.id}
                  tenant={tenant}
                  entry={entry}
                  canManage={value.canManage}
                  onUpdated={(next) =>
                    setEntries((items) =>
                      items.map((item) => (item.id === next.id ? next : item)),
                    )
                  }
                  onArchived={() =>
                    setEntries((items) =>
                      items.filter((item) => item.id !== entry.id),
                    )
                  }
                />
              ))}
            </div>
          </section>
        </div>
      </div>
      {editingOffering && (
        <OfferingModal
          tenant={tenant}
          offering={editingOffering === "new" ? null : editingOffering}
          modifierGroups={modifierGroups}
          onNotice={onNotice}
          onClose={() => setEditingOffering(null)}
          onSaved={(offering) => {
            setProducts((rows) => {
              const exists = rows.some((row) => row.id === offering.id);
              return exists
                ? rows.map((row) => (row.id === offering.id ? offering : row))
                : [...rows, offering].sort((a, b) =>
                    a.name.localeCompare(b.name),
                  );
            });
            void loadModifierGroups();
            onNotice(t("knowledge.offeringSaved"));
            setEditingOffering(null);
          }}
        />
      )}
    </>
  );
}

function LearnedResponsesPanel({
  tenant,
  variants,
  canManage,
  onUpdated,
}: {
  tenant: string;
  variants: ResponseVariant[];
  canManage: boolean;
  onUpdated: (variant: ResponseVariant) => void;
}) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<
    "all" | "candidate" | "approved" | "rejected"
  >("candidate");
  const filtered = variants.filter(
    (variant) => filter === "all" || variant.status === filter,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const active =
    filtered.find((variant) => variant.id === selected) ?? filtered[0] ?? null;
  return (
    <div className="learned-response-browser">
      <div className="learned-response-filters">
        {(["candidate", "approved", "rejected", "all"] as const).map(
          (status) => (
            <button
              key={status}
              className={filter === status ? "active" : ""}
              onClick={() => {
                setFilter(status);
                setSelected(null);
              }}
            >
              {t(`knowledge.responseVariantFilters.${status}`)}
              <span>
                {status === "all"
                  ? variants.length
                  : variants.filter((variant) => variant.status === status)
                      .length}
              </span>
            </button>
          ),
        )}
      </div>
      {variants.length === 0 ? (
        <p className="empty-copy">{t("knowledge.responseVariantsEmpty")}</p>
      ) : filtered.length === 0 ? (
        <p className="empty-copy">
          {t("knowledge.responseVariantsFilterEmpty")}
        </p>
      ) : (
        <div
          className={`learned-response-content ${filtered.length === 1 ? "single" : ""}`}
        >
          <div className="learned-response-list">
            {filtered.map((variant) => (
              <button
                key={variant.id}
                className={active?.id === variant.id ? "active" : ""}
                onClick={() => setSelected(variant.id)}
              >
                <b>
                  {t(
                    `knowledge.responseVariantTemplates.${variant.templateKey}`,
                    { defaultValue: variant.templateKey },
                  )}
                </b>
                <small>
                  {formatLanguageName(
                    variant.locale,
                    i18n.resolvedLanguage ?? i18n.language,
                  )}{" "}
                  ·{" "}
                  {t("knowledge.responseVariantUses", {
                    count: variant.useCount,
                  })}
                </small>
              </button>
            ))}
          </div>
          {active && (
            <LearnedResponse
              tenant={tenant}
              variant={active}
              canManage={canManage}
              onUpdated={onUpdated}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Word-level diff (classic LCS) so a reviewer can see at a glance what the
// rewrite actually changed, instead of having to read both full sentences
// side by side to spot the difference.
function diffWords(
  base: string,
  candidate: string,
): {
  base: { text: string; changed: boolean }[];
  candidate: { text: string; changed: boolean }[];
} {
  const a = base.split(/(\s+)/);
  const b = candidate.split(/(\s+)/);
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const baseOut: { text: string; changed: boolean }[] = [];
  const candidateOut: { text: string; changed: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      baseOut.push({ text: a[i], changed: false });
      candidateOut.push({ text: b[j], changed: false });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      baseOut.push({ text: a[i], changed: true });
      i++;
    } else {
      candidateOut.push({ text: b[j], changed: true });
      j++;
    }
  }
  while (i < m) {
    baseOut.push({ text: a[i], changed: true });
    i++;
  }
  while (j < n) {
    candidateOut.push({ text: b[j], changed: true });
    j++;
  }
  return { base: baseOut, candidate: candidateOut };
}

function LearnedResponse({
  tenant,
  variant,
  canManage,
  onUpdated,
}: {
  tenant: string;
  variant: ResponseVariant;
  canManage: boolean;
  onUpdated: (variant: ResponseVariant) => void;
}) {
  const { t, i18n } = useTranslation();
  const [body, setBody] = useState(variant.variantBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unchanged = body.trim() === variant.deterministicBody.trim();
  const diff = diffWords(variant.deterministicBody, body);
  useEffect(() => setBody(variant.variantBody), [variant.variantBody]);
  async function review(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ variant: ResponseVariant }>(
        `/v1/admin/tenants/${tenant}/knowledge/response-variants/${variant.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action, variantBody: body }),
        },
      );
      onUpdated(result.variant);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="learned-response-card">
      <div className="learned-response-meta">
        <b>
          {t(`knowledge.responseVariantTemplates.${variant.templateKey}`, {
            defaultValue: variant.templateKey,
          })}
        </b>
        <span className={`response-variant-status ${variant.status}`}>
          {t(`knowledge.responseVariantStatuses.${variant.status}`)}
        </span>
      </div>
      {unchanged && (
        <span className="response-variant-unchanged">
          {t("knowledge.responseVariantUnchanged")}
        </span>
      )}
      <small>
        {formatLanguageName(
          variant.locale,
          i18n.resolvedLanguage ?? i18n.language,
        )}{" "}
        · {t("knowledge.responseVariantUses", { count: variant.useCount })}
      </small>
      <div className="learned-response-comparison">
        <label>
          <span>{t("knowledge.responseVariantOriginal")}</span>
          <textarea value={variant.deterministicBody} readOnly />
        </label>
        <label>
          <span>{t("knowledge.responseVariantCandidate")}</span>
          <textarea
            value={body}
            disabled={!canManage || busy}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
      </div>
      {!unchanged && (
        <div className="learned-response-diff">
          <span>{t("knowledge.responseVariantDiff")}</span>
          {diff.candidate.map((word, index) =>
            word.changed ? (
              <mark key={index}>{word.text}</mark>
            ) : (
              <Fragment key={index}>{word.text}</Fragment>
            ),
          )}
        </div>
      )}
      {error && <small className="error-text">{error}</small>}
      {canManage && (
        <div className="learned-response-actions">
          <button
            disabled={busy || !body.trim() || unchanged}
            onClick={() => void review("approve")}
          >
            {t("knowledge.responseVariantApprove")}
          </button>
          <button
            className="danger-soft"
            disabled={busy}
            onClick={() => void review("reject")}
          >
            {t(
              unchanged
                ? "knowledge.responseVariantDiscard"
                : "knowledge.responseVariantReject",
            )}
          </button>
        </div>
      )}
    </article>
  );
}

function ExtrasPanel({
  tenant,
  groups,
  canManage,
  onChanged,
  onNotice,
}: {
  tenant: string;
  groups: ModifierGroup[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onNotice: (message: string, type?: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupType, setNewGroupType] = useState<"single" | "multiple">("multiple");
  const [busy, setBusy] = useState(false);
  const [optionDrafts, setOptionDrafts] = useState<
    Record<string, { name: string; price: string }>
  >({});
  const draftFor = (groupId: string) =>
    optionDrafts[groupId] ?? { name: "", price: "" };
  async function createGroup(event: FormEvent) {
    event.preventDefault();
    if (!newGroupName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/modifier-groups`, {
        method: "POST",
        body: JSON.stringify({ name: newGroupName.trim(), selectionType: newGroupType }),
      });
      setNewGroupName("");
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function archiveGroup(groupId: string) {
    if (!window.confirm(t("knowledge.extrasGroupArchiveConfirm"))) return;
    try {
      await api(`/v1/admin/tenants/${tenant}/modifier-groups/${groupId}`, {
        method: "DELETE",
      });
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  async function addOption(groupId: string, event: FormEvent) {
    event.preventDefault();
    const draft = draftFor(groupId);
    if (!draft.name.trim()) return;
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/modifier-groups/${groupId}/options`, {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          priceMinor: Math.round(Number(draft.price || "0") * 100),
          currency: "COP",
        }),
      });
      setOptionDrafts((drafts) => ({ ...drafts, [groupId]: { name: "", price: "" } }));
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  async function archiveOption(groupId: string, optionId: string) {
    try {
      await api(
        `/v1/admin/tenants/${tenant}/modifier-groups/${groupId}/options/${optionId}`,
        { method: "DELETE" },
      );
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  return (
    <>
      <div className="panel-head">
        <div>
          <h2>{t("knowledge.extrasTitle")}</h2>
          <p>{t("knowledge.extrasHelp")}</p>
        </div>
      </div>
      {error && <div className="form-alert">{error}</div>}
      {canManage && (
        <form className="extras-new-group" onSubmit={createGroup}>
          <input
            placeholder={t("knowledge.extrasGroupNamePlaceholder")}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <AppSelect
            value={newGroupType}
            onChange={setNewGroupType}
            options={[
              { value: "multiple", label: t("knowledge.extrasSelectionMultiple") },
              { value: "single", label: t("knowledge.extrasSelectionSingle") },
            ]}
          />
          <button disabled={busy}>{t("knowledge.extrasGroupCreate")}</button>
        </form>
      )}
      <div className="extras-groups">
        {groups.map((group) => (
          <div key={group.id} className="extras-group">
            <div className="extras-group-head">
              <span>
                <b>{group.name}</b>
                <small>
                  {t(
                    group.selectionType === "single"
                      ? "knowledge.extrasSelectionSingle"
                      : "knowledge.extrasSelectionMultiple",
                  )}
                </small>
              </span>
              {canManage && (
                <button
                  type="button"
                  className="icon-button danger-soft"
                  title={t("knowledge.extrasGroupArchive")}
                  onClick={() => void archiveGroup(group.id)}
                >
                  ×
                </button>
              )}
            </div>
            <div className="extras-options">
              {group.options.map((option) => (
                <div key={option.id} className="extras-option">
                  <span>
                    {option.name}
                    {option.priceMinor > 0 && (
                      <small>
                        {" "}
                        +
                        {new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: option.currency,
                          maximumFractionDigits: 0,
                        }).format(option.priceMinor / 100)}
                      </small>
                    )}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      className="icon-button danger-soft"
                      title={t("knowledge.extrasOptionArchive")}
                      onClick={() => void archiveOption(group.id, option.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!group.options.length && (
                <small>{t("knowledge.extrasOptionsEmpty")}</small>
              )}
            </div>
            {canManage && (
              <form
                className="extras-new-option"
                onSubmit={(e) => void addOption(group.id, e)}
              >
                <input
                  placeholder={t("knowledge.extrasOptionNamePlaceholder")}
                  value={draftFor(group.id).name}
                  onChange={(e) =>
                    setOptionDrafts((drafts) => ({
                      ...drafts,
                      [group.id]: { ...draftFor(group.id), name: e.target.value },
                    }))
                  }
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("knowledge.extrasOptionPricePlaceholder")}
                  value={draftFor(group.id).price}
                  onChange={(e) =>
                    setOptionDrafts((drafts) => ({
                      ...drafts,
                      [group.id]: { ...draftFor(group.id), price: e.target.value },
                    }))
                  }
                />
                <button>{t("knowledge.extrasOptionAdd")}</button>
              </form>
            )}
          </div>
        ))}
        {!groups.length && <small>{t("knowledge.extrasGroupsEmpty")}</small>}
      </div>
    </>
  );
}

function OfferingModal({
  tenant,
  offering,
  modifierGroups,
  onNotice,
  onClose,
  onSaved,
}: {
  tenant: string;
  offering: Offering | null;
  modifierGroups: ModifierGroup[];
  onNotice: (message: string, type?: "success" | "error") => void;
  onClose: () => void;
  onSaved: (offering: Offering) => void;
}) {
  const { t } = useTranslation();
  const variant =
    offering?.variants.find((item) => item.status !== "archived") ??
    offering?.variants[0];
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    offering
      ? modifierGroups
          .filter((group) => group.assignedItemIds.includes(offering.id))
          .map((group) => group.id)
      : [],
  );
  const [form, setForm] = useState({
    name: offering?.name ?? "",
    description: offering?.description ?? "",
    category: offering?.category ?? "",
    offeringType: (offering?.offeringType ?? "product") as
      "product" | "service" | "prepared_product" | "appointment" | "package",
    status: (offering?.status === "inactive" ? "inactive" : "active") as
      "active" | "inactive",
    durationMinutes: offering?.durationMinutes?.toString() ?? "",
    bookingRequired: offering?.bookingRequired ?? false,
    variantName: variant?.name ?? t("knowledge.defaultVariant"),
    sku: variant?.sku ?? "",
    price: variant ? (variant.priceMinor / 100).toString() : "",
    currency: variant?.currency ?? "COP",
    availabilityStatus: (variant?.availabilityStatus === "unavailable"
      ? "unavailable"
      : "available") as "available" | "unavailable",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings${offering ? `/${offering.id}` : ""}`,
        {
          method: offering ? "PATCH" : "POST",
          body: JSON.stringify({
            ...form,
            priceMinor: Math.round(Number(form.price) * 100),
            durationMinutes: form.durationMinutes
              ? Number(form.durationMinutes)
              : null,
          }),
        },
      );
      await api(
        `/v1/admin/tenants/${tenant}/modifier-groups/items/${result.offering.id}`,
        { method: "PUT", body: JSON.stringify({ groupIds: selectedGroupIds }) },
      );
      onSaved(result.offering);
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="modal-backdrop">
      <section className="modal offering-modal">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <h2>
          {t(offering ? "knowledge.offeringEdit" : "knowledge.offeringCreate")}
        </h2>
        <p>{t("knowledge.offeringFormHelp")}</p>
        <form onSubmit={submit}>
          <label>
            {t("knowledge.offeringName")}
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {t("knowledge.offeringDescription")}
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <div className="modal-two">
            <label>
              {t("knowledge.offeringCategory")}
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </label>
            <label>
              {t("knowledge.offeringType")}
              <AppSelect
                value={form.offeringType}
                onChange={(offeringType) => setForm({ ...form, offeringType })}
                options={(
                  [
                    "product",
                    "service",
                    "prepared_product",
                    "appointment",
                    "package",
                  ] as const
                ).map((value) => ({
                  value,
                  label: t(`knowledge.offeringTypes.${value}`),
                }))}
              />
            </label>
          </div>
          <div className="modal-two">
            <label>
              {t("knowledge.variantName")}
              <input
                required
                value={form.variantName}
                onChange={(e) =>
                  setForm({ ...form, variantName: e.target.value })
                }
              />
            </label>
            <label>
              SKU
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </label>
          </div>
          <div className="modal-two">
            <label>
              {t("knowledge.price")}
              <input
                required
                min="0"
                step="0.01"
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </label>
            <label>
              {t("knowledge.currency")}
              <input
                required
                maxLength={3}
                value={form.currency}
                onChange={(e) =>
                  setForm({ ...form, currency: e.target.value.toUpperCase() })
                }
              />
            </label>
          </div>
          <div className="modal-two">
            <label>
              {t("knowledge.status")}
              <AppSelect
                value={form.status}
                onChange={(status) => setForm({ ...form, status })}
                options={(["active", "inactive"] as const).map((value) => ({
                  value,
                  label: t(`common.${value}`),
                }))}
              />
            </label>
            <label>
              {t("knowledge.availability")}
              <AppSelect
                value={form.availabilityStatus}
                onChange={(availabilityStatus) =>
                  setForm({ ...form, availabilityStatus })
                }
                options={(["available", "unavailable"] as const).map(
                  (value) => ({
                    value,
                    label: t(`common.${value}`, { defaultValue: value }),
                  }),
                )}
              />
            </label>
          </div>
          {(form.offeringType === "service" ||
            form.offeringType === "appointment") && (
            <div className="modal-two">
              <label>
                {t("knowledge.durationMinutes")}
                <input
                  min="1"
                  type="number"
                  value={form.durationMinutes}
                  onChange={(e) =>
                    setForm({ ...form, durationMinutes: e.target.value })
                  }
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.bookingRequired}
                  onChange={(e) =>
                    setForm({ ...form, bookingRequired: e.target.checked })
                  }
                />
                {t("knowledge.bookingRequired")}
              </label>
            </div>
          )}
          {modifierGroups.length > 0 && (
            <label>
              {t("knowledge.extrasAssign")}
              <div className="checkbox-list">
                {modifierGroups.map((group) => (
                  <label key={group.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(group.id)}
                      onChange={(e) =>
                        setSelectedGroupIds((ids) =>
                          e.target.checked
                            ? [...ids, group.id]
                            : ids.filter((id) => id !== group.id),
                        )
                      }
                    />
                    {group.name}
                  </label>
                ))}
              </div>
            </label>
          )}
          {error && <div className="form-alert">{error}</div>}
          <button disabled={busy}>
            {busy ? t("common.saving") : t("common.saveChanges")}
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}
function PublishedAnswer({
  tenant,
  entry,
  canManage,
  onUpdated,
  onArchived,
}: {
  tenant: string;
  entry: KnowledgePayload["entries"][number];
  canManage: boolean;
  onUpdated: (entry: KnowledgePayload["entries"][number]) => void;
  onArchived: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [keywords, setKeywords] = useState((entry.keywords ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ entry: KnowledgePayload["entries"][number] }>(
        `/v1/admin/tenants/${tenant}/knowledge/entries/${entry.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title,
            content,
            keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          }),
        },
      );
      onUpdated(result.entry);
      setEditing(false);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!window.confirm(t("knowledge.archiveConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/knowledge/entries/${entry.id}`, {
        method: "DELETE",
      });
      onArchived();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details open={editing}>
      <summary>{entry.title}</summary>
      {editing ? (
        <div className="faq-editor">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <input
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder={t("knowledge.keywordsPlaceholder")}
          />
          <small>{t("knowledge.keywordsHelp")}</small>
          {error && <small className="error-text">{error}</small>}
          <div className="faq-actions">
            <button
              disabled={busy || !title.trim() || !content.trim()}
              onClick={() => void save()}
            >
              {t("common.saveChanges")}
            </button>
            <button className="text-button" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>{entry.content}</p>
          {entry.keywords?.length > 0 && (
            <small className="faq-keywords">
              {t("knowledge.keywordsLabel")}: {entry.keywords.join(", ")}
            </small>
          )}
          {error && <small className="error-text">{error}</small>}
          {canManage && (
            <div className="faq-actions">
              <button className="secondary" onClick={() => setEditing(true)}>
                {t("knowledge.editAnswer")}
              </button>
              <button
                className="danger-soft"
                disabled={busy}
                onClick={() => void archive()}
              >
                {t("knowledge.archiveAnswer")}
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}
function LearningQuestion({
  tenant,
  question,
  onReviewed,
}: {
  tenant: string;
  question: KnowledgePayload["unresolvedQuestions"][number];
  onReviewed: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(question.question);
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function review(action: "dismiss" | "publish") {
    setBusy(true);
    setError("");
    try {
      await api(
        `/v1/admin/tenants/${tenant}/knowledge/unresolved/${question.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            title,
            content,
            keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          }),
        },
      );
      onReviewed();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="learning-question">
      <span>
        <b>{question.question}</b>
        <small>
          {t("knowledge.learningOccurrences", {
            count: question.occurrenceCount,
          })}{" "}
          · {new Date(question.lastSeenAt).toLocaleDateString()}
        </small>
        {question.contextMessages.length > 0 && (
          <div className="learning-context">
            <small className="learning-context-title">
              {t("knowledge.learningContext")}
            </small>
            {question.contextMessages.map((message, index) => (
              <div
                key={`${message.occurredAt}-${index}`}
                className={`learning-context-message ${message.direction}`}
              >
                <span>
                  {message.direction === "inbound"
                    ? t("knowledge.customer")
                    : t("knowledge.assistant")}
                </span>
                <p>{message.body}</p>
              </div>
            ))}
          </div>
        )}
        {editing && (
          <>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("knowledge.answerTitle")}
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("knowledge.answerContent")}
            />
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("knowledge.keywordsPlaceholder")}
            />
            <small>{t("knowledge.keywordsHelp")}</small>
            {error && <small className="error-text">{error}</small>}
          </>
        )}
      </span>
      <span className="learning-actions">
        {editing ? (
          <>
            <button
              disabled={busy || !title.trim() || !content.trim()}
              onClick={() => void review("publish")}
            >
              {t("knowledge.publishAnswer")}
            </button>
            <button className="text-button" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)}>
              {t("knowledge.convertAnswer")}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void review("dismiss")}
            >
              {t("knowledge.dismiss")}
            </button>
          </>
        )}
      </span>
    </div>
  );
}
function BotSettings({
  tenant,
  value,
  onSaved,
}: {
  tenant: string;
  value: BotConfig;
  onSaved: (value: BotConfig) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setForm(value), [value]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/bot`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      onSaved(form);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel page-panel bot-settings">
      <div className="panel-head">
        <div>
          <h2>{t("bot.title")}</h2>
          <p>{t("bot.description")}</p>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          <span className="switch-control" aria-hidden="true">
            <span />
          </span>
          <span>
            <b>{form.enabled ? t("bot.enabled") : t("bot.disabled")}</b>
            <small>
              {form.enabled ? t("bot.enabledHelp") : t("bot.disabledHelp")}
            </small>
          </span>
        </label>
      </div>
      <form onSubmit={submit} className="settings-form">
        <div className="settings-section-title">
          <Bot size={18} />
          <span>
            <b>{t("bot.identity")}</b>
            <small>{t("bot.identityHelp")}</small>
          </span>
        </div>
        <label>
          {t("bot.name")}
          <input
            value={form.assistantName}
            onChange={(e) =>
              setForm({ ...form, assistantName: e.target.value })
            }
          />
        </label>
        <label>
          {t("bot.language")}
          <AppSelect
            value={form.locale}
            onChange={(locale) => setForm({ ...form, locale })}
            options={[
              { value: "es", label: "Spanish" },
              { value: "en", label: "English" },
            ]}
          />
        </label>
        <div className="settings-section-title">
          <MessageCircle size={18} />
          <span>
            <b>{t("bot.responses")}</b>
            <small>{t("bot.responsesHelp")}</small>
          </span>
        </div>
        <label>
          {t("bot.welcome")}
          <textarea
            value={form.welcomeMessage}
            onChange={(e) =>
              setForm({ ...form, welcomeMessage: e.target.value })
            }
          />
        </label>
        <label>
          {t("bot.fallback")}
          <textarea
            value={form.fallbackMessage}
            onChange={(e) =>
              setForm({ ...form, fallbackMessage: e.target.value })
            }
          />
        </label>
        <label>
          {t("bot.handoff")}
          <input
            value={form.handoffKeywords.join(", ")}
            onChange={(e) =>
              setForm({
                ...form,
                handoffKeywords: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
          <small>{t("bot.handoffHelp")}</small>
        </label>
        <label>
          {t("bot.conversationTimeout")}
          <input
            type="number"
            min={1}
            max={10080}
            placeholder={t("bot.conversationTimeoutDisabled")}
            value={form.conversationTimeoutMinutes ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                conversationTimeoutMinutes:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          <small>{t("bot.conversationTimeoutHelp")}</small>
        </label>
        <label>
          {t("bot.messageRetention")}
          <input
            type="number"
            min={7}
            max={3650}
            placeholder={t("bot.messageRetentionDisabled")}
            value={form.messageRetentionDays ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                messageRetentionDays:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          <small>{t("bot.messageRetentionHelp")}</small>
        </label>
        <div className="settings-section-title">
          <Bot size={18} />
          <span>
            <b>{t("bot.aiRewriting")}</b>
            <small>{t("bot.aiRewritingHelp")}</small>
          </span>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={form.aiResponsePolicy.enabled}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  enabled: e.target.checked,
                },
              })
            }
          />
          <span className="switch-control" aria-hidden="true">
            <span />
          </span>
          <span>
            <b>{t("bot.aiEnabled")}</b>
            <small>{t("bot.aiEnabledHelp")}</small>
          </span>
        </label>
        <label>
          {t("bot.aiRollout")}
          <input
            type="number"
            min="0"
            max="100"
            value={form.aiResponsePolicy.rolloutPercentage}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  rolloutPercentage: Number(e.target.value),
                },
              })
            }
          />
        </label>
        <label>
          {t("bot.aiDailyLimit")}
          <input
            type="number"
            min="0"
            max="100000"
            value={form.aiResponsePolicy.dailyRequestLimit}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  dailyRequestLimit: Number(e.target.value),
                },
              })
            }
          />
        </label>
        <label>
          {t("bot.aiMonthlyBudget", {
            currency: form.aiResponsePolicy.costCurrency,
          })}
          <input
            type="number"
            min="0"
            step="0.01"
            value={(form.aiResponsePolicy.monthlyCostLimitMinor / 100).toFixed(
              2,
            )}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  monthlyCostLimitMinor: Math.round(
                    Number(e.target.value) * 100,
                  ),
                },
              })
            }
          />
        </label>
        {error && <div className="form-alert">{error}</div>}
        <div className="settings-actions">
          <span>{t("bot.saveHint")}</span>
          <button disabled={busy}>
            {busy ? t("common.saving") : t("common.saveChanges")}
          </button>
        </div>
      </form>
    </section>
  );
}
function Connections({
  rows,
  canManage,
  webhookPath,
  tenant,
  onConfigure,
  onNotice,
  onChanged,
}: {
  rows: Connection[];
  canManage: boolean;
  webhookPath: string;
  tenant: string;
  onConfigure: (connection: Connection) => void;
  onNotice: (message: string, type?: "success" | "error") => void;
  onChanged: (message: string, type?: "success" | "error") => Promise<void>;
}) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState<string | null>(null);
  async function testConnection(connection: Connection) {
    if (!connection.id) return;
    onNotice("");
    setTesting(connection.id);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/channel-connections/${connection.id}/test`,
        { method: "POST" },
      );
      await onChanged(t("connections.testSucceeded"));
    } catch (error) {
      await onChanged((error as Error).message, "error");
    } finally {
      setTesting(null);
    }
  }
  return (
    <section className="panel page-panel">
      <div className="panel-head">
        <div>
          <h2>{t("connections.title")}</h2>
          <p>{t("connections.description")}</p>
        </div>
      </div>
      <div className="webhook-info">
        <ShieldCheck size={19} />
        <span>
          <b>{t("connections.webhookUrl")}</b>
          <code>{webhookPath}</code>
        </span>
      </div>
      {rows.length ? (
        <div className="connection-list">
          {rows.map((r) => (
            <div key={r.channelId}>
              <Link2 />
              <span>
                <b>{t("connections.whatsapp")}</b>
                <small>
                  {r.externalAddress} · Phone Number ID {r.phoneNumberId}
                </small>
                <small>WABA {r.wabaId ?? t("connections.notConfigured")}</small>
              </span>
              <div className="connection-actions">
                <em>{t(`common.${r.status}`, { defaultValue: r.status })}</em>
                {canManage && (
                  <>
                    <button
                      className="secondary compact-action"
                      onClick={() => onConfigure(r)}
                    >
                      {r.id
                        ? t("connections.edit")
                        : t("connections.configure")}
                    </button>
                    {r.id && (
                      <button
                        className="secondary compact-action"
                        disabled={testing === r.id}
                        onClick={() => void testConnection(r)}
                      >
                        {testing === r.id
                          ? t("connections.testing")
                          : t("connections.test")}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Link2 size={35} />
          <h3>{t("connections.emptyTitle")}</h3>
          <p>{t("connections.emptyDescription")}</p>
        </div>
      )}
    </section>
  );
}

function ConnectionModal({
  tenant,
  connection,
  onClose,
  onDone,
}: {
  tenant: string;
  connection: Connection;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [phoneNumberId, setPhoneNumberId] = useState(
    connection.phoneNumberId.startsWith("demo-")
      ? ""
      : connection.phoneNumberId,
  );
  const [wabaId, setWabaId] = useState(connection.wabaId ?? "");
  const [providerAppId, setProviderAppId] = useState(
    connection.providerAppId ?? "",
  );
  // Never pre-filled with the stored token — the API never echoes it back.
  // Left empty on save, the backend keeps whatever token is already on file.
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/channel-connections`, {
        method: "PUT",
        body: JSON.stringify({
          channelId: connection.channelId,
          phoneNumberId,
          wabaId,
          providerAppId,
          // Omit entirely when left blank, so the backend keeps the token
          // already on file instead of rejecting an empty value.
          ...(accessToken ? { accessToken } : {}),
        }),
      });
      onDone();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow green">
          {t("connections.metaConfiguration")}
        </span>
        <h2>{t("connections.configureTitle")}</h2>
        <p>{t("connections.secretHelp")}</p>
        {error && (
          <div className="form-alert" role="alert">
            {error}
          </div>
        )}
        <label>
          {t("connections.phoneNumberId")}
          <input
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            required
          />
        </label>
        <label>
          {t("connections.wabaId")}
          <input
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            required
          />
        </label>
        <label>
          {t("connections.appId")}
          <input
            value={providerAppId}
            onChange={(e) => setProviderAppId(e.target.value)}
          />
        </label>
        <label>
          {t("connections.accessToken")}
          <input
            type="password"
            autoComplete="off"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={
              connection.secretConfigured
                ? t("connections.accessTokenKeepPlaceholder")
                : t("connections.accessTokenPlaceholder")
            }
            required={!connection.secretConfigured}
          />
          {connection.secretConfigured && (
            <small>{t("connections.accessTokenConfigured")}</small>
          )}
        </label>
        <button disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </div>
  );
}
function CompanyModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [displayName, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/v1/admin/platform/tenants", {
        method: "POST",
        body: JSON.stringify({
          displayName,
          slug,
          timezone: "America/Bogota",
          defaultLocale: "es-CO",
        }),
      });
      onDone();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow green">{t("companyModal.eyebrow")}</span>
        <h2>{t("companyModal.title")}</h2>
        <form onSubmit={submit}>
          <label>
            {t("companyModal.name")}
            <input
              value={displayName}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(slugify(e.target.value));
              }}
              required
            />
          </label>
          <label>
            {t("companyModal.slug")}
            <input
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              required
            />
            <small>{t("companyModal.slugHint")}</small>
          </label>
          {error && <div className="error">{error}</div>}
          <button>{t("companyModal.submit")}</button>
        </form>
      </section>
    </div>
  );
}
function EditCompanyModal({
  company,
  onClose,
  onDone,
}: {
  company: Tenant;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    displayName: company.displayName,
    timezone: company.timezone,
    defaultLocale: company.defaultLocale,
    status: company.status,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/platform/tenants/${company.id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      onDone();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const timezones = [
    "America/Bogota",
    "America/Mexico_City",
    "America/Lima",
    "America/Santiago",
    "America/New_York",
    "Europe/Madrid",
  ].map((value) => ({ value, label: value }));
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow green">{t("companyModal.editEyebrow")}</span>
        <h2>{t("companyModal.editTitle")}</h2>
        <p>{t("companyModal.editHelp")}</p>
        {error && <div className="form-alert">{error}</div>}
        <label>
          {t("companyModal.name")}
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            required
          />
        </label>
        <label>
          {t("companyModal.slug")}
          <input value={company.slug} disabled />
          <small>{t("companyModal.slugLocked")}</small>
        </label>
        <div className="modal-two">
          <label>
            {t("companyModal.timezone")}
            <AppSelect
              value={form.timezone}
              onChange={(timezone) => setForm({ ...form, timezone })}
              options={timezones}
            />
          </label>
          <label>
            {t("companyModal.locale")}
            <AppSelect
              value={form.defaultLocale}
              onChange={(defaultLocale) => setForm({ ...form, defaultLocale })}
              options={[
                { value: "es-CO", label: "Spanish (Colombia)" },
                { value: "es-MX", label: "Spanish (Mexico)" },
                { value: "es-ES", label: "Spanish (Spain)" },
                { value: "en-US", label: "English (United States)" },
              ]}
            />
          </label>
        </div>
        <label>
          {t("companyModal.status")}
          <AppSelect
            value={form.status}
            onChange={(status) => setForm({ ...form, status })}
            options={[
              { value: "active", label: t("common.active") },
              { value: "suspended", label: t("common.suspended") },
              { value: "disabled", label: t("common.disabled") },
            ]}
          />
        </label>
        <button disabled={busy}>
          {busy ? t("common.saving") : t("common.saveChanges")}
        </button>
      </form>
    </div>
  );
}
function InviteModal({
  tenant,
  onClose,
  onDone,
}: {
  tenant: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ invitationToken?: string }>(
        `/v1/admin/tenants/${tenant}/invitations`,
        { method: "POST", body: JSON.stringify({ email, role }) },
      );
      if (r.invitationToken) setToken(r.invitationToken);
      else onDone();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow green">{t("inviteModal.eyebrow")}</span>
        <h2>{t("inviteModal.title")}</h2>
        {token ? (
          <>
            <p>{t("inviteModal.created")}</p>
            <div className="token-box">{token}</div>
            <button onClick={onDone}>{t("common.finish")}</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              {t("inviteModal.email")}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              {t("inviteModal.role")}
              <AppSelect
                value={role}
                onChange={setRole}
                options={[
                  { value: "admin", label: t("roles.admin") },
                  { value: "operator", label: t("roles.operator") },
                  { value: "viewer", label: t("roles.viewer") },
                ]}
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button>{t("inviteModal.submit")}</button>
          </form>
        )}
      </section>
    </div>
  );
}
type ConversationRow = {
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

type CommercialRequest = {
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
type ScheduleRule = {
  id?: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
};
type BookingResource = {
  id: string;
  resourceType: "person" | "space" | "equipment" | "other";
  name: string;
  status: string;
  rules: ScheduleRule[];
  serviceIds: string[];
  calendarLinks: {
    calendarSourceId: string;
    externalCalendarId: string;
    status: string;
  }[];
};
type SchedulingPayload = {
  canManage: boolean;
  resources: BookingResource[];
  services: {
    id: string;
    name: string;
    durationMinutes: number | null;
    offeringType: string;
  }[];
  calendarSources: {
    id: string;
    provider: string;
    displayName: string;
    status: string;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    schedulingMode: "global" | "per_resource";
    globalCalendarId: string | null;
  }[];
};
type GoogleCalendarOption = {
  id: string;
  name: string;
  description: string | null;
  primary: boolean;
  accessRole: string | null;
  timezone: string | null;
  color: string | null;
};

function SchedulingSettings({
  tenant,
  onNotice,
}: {
  tenant: string;
  onNotice: (message: string, type?: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<SchedulingPayload | null>(null);
  const [editing, setEditing] = useState<BookingResource | "new" | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarOption[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [globalCalendarId, setGlobalCalendarId] = useState("");
  const [resourceCalendars, setResourceCalendars] = useState<
    Record<string, string>
  >({});
  const load = async () =>
    setValue(
      await api<SchedulingPayload>(`/v1/admin/tenants/${tenant}/scheduling`),
    );
  const connectGoogle = async () => {
    try {
      const result = await api<{ authorizationUrl: string }>(
        `/v1/admin/tenants/${tenant}/scheduling/google-calendar/authorize`,
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      onNotice((error as Error).message, "error");
    }
  };
  const saveCalendarMode = async (
    sourceId: string,
    mode: "global" | "per_resource",
  ) => {
    try {
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/calendar-sources/${sourceId}/strategy`,
        { method: "PUT", body: JSON.stringify({ mode }) },
      );
      await load();
      onNotice(t("scheduling.calendarModeSaved"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    }
  };
  const loadCalendars = async (sourceId: string) => {
    setCalendarBusy(true);
    try {
      const result = await api<{ calendars: GoogleCalendarOption[] }>(
        `/v1/admin/tenants/${tenant}/scheduling/calendar-sources/${sourceId}/calendars`,
      );
      setCalendars(result.calendars);
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setCalendarBusy(false);
    }
  };
  const saveCalendarAssignment = async (sourceId: string) => {
    setCalendarBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/calendar-sources/${sourceId}/assignment`,
        {
          method: "PUT",
          body: JSON.stringify({
            globalCalendarId: globalCalendarId || null,
            resourceAssignments: Object.entries(resourceCalendars)
              .filter(([, calendarId]) => calendarId)
              .map(([resourceId, calendarId]) => ({ resourceId, calendarId })),
          }),
        },
      );
      await load();
      onNotice(t("scheduling.calendarAssignmentSaved"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setCalendarBusy(false);
    }
  };
  useEffect(() => {
    setValue(null);
    void load().catch((error) => onNotice(error.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  // Re-runs only when a source's id/status actually changes, not on every
  // re-render of `value` (e.g. after loadCalendars re-sets it below).
  const calendarSourcesKey = value?.calendarSources
    .map((source) => `${source.id}:${source.status}`)
    .join("|");
  useEffect(() => {
    const source = value?.calendarSources.find(
      (row) => row.provider === "google_calendar" && row.status === "connected",
    );
    if (!source) {
      setCalendars([]);
      return;
    }
    setGlobalCalendarId(source.globalCalendarId ?? "");
    setResourceCalendars(
      Object.fromEntries(
        value!.resources.map((resource) => [
          resource.id,
          resource.calendarLinks.find(
            (link) =>
              link.calendarSourceId === source.id && link.status === "active",
          )?.externalCalendarId ?? "",
        ]),
      ),
    );
    void loadCalendars(source.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, calendarSourcesKey]);
  if (!value)
    return (
      <section className="panel scheduling-loading">
        {t("common.loading")}
      </section>
    );
  const google = value.calendarSources.filter(
    (source) => source.provider === "google_calendar",
  );
  return (
    <>
      <section className="scheduling-overview">
        <div className="panel scheduling-resources">
          <div className="panel-head">
            <div>
              <h2>{t("scheduling.resourcesTitle")}</h2>
              <p>{t("scheduling.resourcesHelp")}</p>
            </div>
            {value.canManage && (
              <button onClick={() => setEditing("new")}>
                <Plus size={16} />
                {t("scheduling.newResource")}
              </button>
            )}
          </div>
          <div className="resource-grid">
            {value.resources.map((resource) => (
              <article className="resource-card" key={resource.id}>
                <div className="resource-card-head">
                  <span className="resource-icon">
                    <CalendarDays size={19} />
                  </span>
                  <span>
                    <b>{resource.name}</b>
                    <small>
                      {t(`scheduling.resourceTypes.${resource.resourceType}`)}
                    </small>
                  </span>
                  <em className={resource.status}>
                    {t(`common.${resource.status}`)}
                  </em>
                </div>
                <div className="resource-schedule">
                  {resource.rules.slice(0, 4).map((rule) => (
                    <span key={`${rule.dayOfWeek}-${rule.startsAt}`}>
                      <b>{t(`scheduling.days.${rule.dayOfWeek}`)}</b>
                      {rule.startsAt}–{rule.endsAt}
                    </span>
                  ))}
                  {!resource.rules.length && (
                    <small>{t("scheduling.noAvailability")}</small>
                  )}
                </div>
                <div className="resource-card-footer">
                  <small>
                    {t("scheduling.servicesCount", {
                      count: resource.serviceIds.length,
                    })}
                  </small>
                  {value.canManage && (
                    <button
                      className="secondary compact-action"
                      onClick={() => setEditing(resource)}
                    >
                      {t("common.configure")}
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!value.resources.length && (
              <div className="resource-empty">
                <CalendarDays size={28} />
                <b>{t("scheduling.emptyTitle")}</b>
                <small>{t("scheduling.emptyHelp")}</small>
              </div>
            )}
          </div>
        </div>
        <aside className="panel calendar-integration">
          <div className="panel-head">
            <div>
              <h2>Google Calendar</h2>
              <p>{t("scheduling.googleHelp")}</p>
            </div>
          </div>
          <div className="google-calendar-card">
            <span className="google-mark">G</span>
            <span>
              <b>
                {google.length
                  ? t("scheduling.sourcesConfigured", { count: google.length })
                  : t("scheduling.googleReady")}
              </b>
              <small>
                {google.length
                  ? google.map((source) => source.displayName).join(", ")
                  : t("scheduling.googleBoundary")}
              </small>
            </span>
            <em
              className={
                google.some((source) => source.status === "connected")
                  ? "active"
                  : "planned"
              }
            >
              {google.some((source) => source.status === "connected")
                ? t("common.connected")
                : t("knowledge.planned")}
            </em>
            {value.canManage && (
              <button
                className="secondary compact-action"
                onClick={() => void connectGoogle()}
              >
                {google.some((source) => source.status === "connected")
                  ? t("scheduling.reconnectGoogle")
                  : t("scheduling.connectGoogle")}
              </button>
            )}
          </div>
          {google[0]?.status === "connected" && (
            <>
              <div className="calendar-mode">
                <b>{t("scheduling.calendarModeTitle")}</b>
                <p>{t("scheduling.calendarModeHelp")}</p>
                <div>
                  {(["global", "per_resource"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={
                        google[0].schedulingMode === mode ? "selected" : ""
                      }
                      onClick={() => void saveCalendarMode(google[0].id, mode)}
                    >
                      <CalendarDays size={18} />
                      <span>
                        <b>{t(`scheduling.calendarModes.${mode}.title`)}</b>
                        <small>
                          {t(`scheduling.calendarModes.${mode}.help`)}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="calendar-assignment">
                <b>{t("scheduling.calendarAssignmentTitle")}</b>
                <p>
                  {calendarBusy && !calendars.length
                    ? t("scheduling.loadingCalendars")
                    : t("scheduling.calendarAssignmentHelp")}
                </p>
                {google[0].schedulingMode === "global" ? (
                  <label>
                    {t("scheduling.globalCalendarLabel")}
                    <AppSelect
                      value={globalCalendarId}
                      onChange={setGlobalCalendarId}
                      options={[
                        { value: "", label: t("scheduling.selectCalendar") },
                        ...calendars.map((calendar) => ({
                          value: calendar.id,
                          label: `${calendar.name}${calendar.primary ? ` · ${t("scheduling.primaryCalendar")}` : ""}`,
                        })),
                      ]}
                    />
                  </label>
                ) : (
                  <div className="resource-calendar-list">
                    {value.resources.map((resource) => (
                      <label key={resource.id}>
                        <span>
                          <b>{resource.name}</b>
                          <small>
                            {t(
                              `scheduling.resourceTypes.${resource.resourceType}`,
                            )}
                          </small>
                        </span>
                        <AppSelect
                          value={resourceCalendars[resource.id] ?? ""}
                          onChange={(calendarId) =>
                            setResourceCalendars((current) => ({
                              ...current,
                              [resource.id]: calendarId,
                            }))
                          }
                          options={[
                            {
                              value: "",
                              label: t("scheduling.selectCalendar"),
                            },
                            ...calendars.map((calendar) => ({
                              value: calendar.id,
                              label: calendar.name,
                            })),
                          ]}
                        />
                      </label>
                    ))}
                    {!value.resources.length && (
                      <small>
                        {t("scheduling.resourcesRequiredForCalendars")}
                      </small>
                    )}
                  </div>
                )}
                {value.canManage && (
                  <button
                    disabled={calendarBusy || !calendars.length}
                    onClick={() => void saveCalendarAssignment(google[0].id)}
                  >
                    {calendarBusy
                      ? t("common.saving")
                      : t("scheduling.saveCalendarAssignment")}
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </section>
      {editing && (
        <ResourceModal
          tenant={tenant}
          resource={editing === "new" ? null : editing}
          services={value.services}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            onNotice(t("scheduling.saved"));
          }}
        />
      )}
    </>
  );
}

function ResourceModal({
  tenant,
  resource,
  services,
  onClose,
  onSaved,
}: {
  tenant: string;
  resource: BookingResource | null;
  services: SchedulingPayload["services"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const defaultTimezone = "America/Bogota";
  const [name, setName] = useState(resource?.name ?? "");
  const [resourceType, setResourceType] = useState<
    BookingResource["resourceType"]
  >(resource?.resourceType ?? "person");
  const [rules, setRules] = useState<ScheduleRule[]>(
    resource?.rules.length
      ? resource.rules.map(({ dayOfWeek, startsAt, endsAt, timezone }) => ({
          dayOfWeek,
          startsAt,
          endsAt,
          timezone,
        }))
      : [
          {
            dayOfWeek: 1,
            startsAt: "09:00",
            endsAt: "18:00",
            timezone: defaultTimezone,
          },
        ],
  );
  const [serviceIds, setServiceIds] = useState(resource?.serviceIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const updateRule = (index: number, patch: Partial<ScheduleRule>) =>
    setRules((rows) =>
      rows.map((row, current) =>
        current === index ? { ...row, ...patch } : row,
      ),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let id = resource?.id;
      if (id)
        await api(`/v1/admin/tenants/${tenant}/scheduling/resources/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            resourceType,
            status: "active",
            attributes: {},
          }),
        });
      else {
        id = (
          await api<{ resourceId: string }>(
            `/v1/admin/tenants/${tenant}/scheduling/resources`,
            {
              method: "POST",
              body: JSON.stringify({
                name,
                resourceType,
                status: "active",
                attributes: {},
              }),
            },
          )
        ).resourceId;
      }
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/resources/${id}/availability`,
        { method: "PUT", body: JSON.stringify({ rules }) },
      );
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/resources/${id}/services`,
        { method: "PUT", body: JSON.stringify({ catalogItemIds: serviceIds }) },
      );
      await onSaved();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="modal-backdrop">
      <section className="modal resource-modal">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow green">{t("scheduling.resourceEyebrow")}</span>
        <h2>
          {t(resource ? "scheduling.editResource" : "scheduling.newResource")}
        </h2>
        <p>{t("scheduling.resourceFormHelp")}</p>
        <form onSubmit={submit}>
          <div className="modal-two">
            <label>
              {t("scheduling.resourceName")}
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              {t("scheduling.resourceType")}
              <AppSelect
                value={resourceType}
                onChange={setResourceType}
                options={(
                  ["person", "space", "equipment", "other"] as const
                ).map((value) => ({
                  value,
                  label: t(`scheduling.resourceTypes.${value}`),
                }))}
              />
            </label>
          </div>
          <fieldset className="schedule-rules">
            <legend>{t("scheduling.weeklyAvailability")}</legend>
            {rules.map((rule, index) => (
              <div className="schedule-rule" key={index}>
                <AppSelect
                  value={String(rule.dayOfWeek)}
                  onChange={(day) =>
                    updateRule(index, { dayOfWeek: Number(day) })
                  }
                  options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({
                    value: String(day),
                    label: t(`scheduling.days.${day}`),
                  }))}
                />
                <input
                  aria-label={t("scheduling.startsAt")}
                  type="time"
                  value={rule.startsAt}
                  onChange={(event) =>
                    updateRule(index, { startsAt: event.target.value })
                  }
                />
                <input
                  aria-label={t("scheduling.endsAt")}
                  type="time"
                  value={rule.endsAt}
                  onChange={(event) =>
                    updateRule(index, { endsAt: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="icon-button danger-soft"
                  onClick={() =>
                    setRules((rows) =>
                      rows.filter((_, current) => current !== index),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary compact-action"
              onClick={() =>
                setRules((rows) => [
                  ...rows,
                  {
                    dayOfWeek: 1,
                    startsAt: "09:00",
                    endsAt: "18:00",
                    timezone: defaultTimezone,
                  },
                ])
              }
            >
              <Plus size={15} />
              {t("scheduling.addSchedule")}
            </button>
          </fieldset>
          <fieldset className="service-assignment">
            <legend>{t("scheduling.compatibleServices")}</legend>
            <p>{t("scheduling.compatibleServicesHelp")}</p>
            <div>
              {services.map((service) => (
                <label className="service-check" key={service.id}>
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(service.id)}
                    onChange={(event) =>
                      setServiceIds(
                        event.target.checked
                          ? [...serviceIds, service.id]
                          : serviceIds.filter((id) => id !== service.id),
                      )
                    }
                  />
                  <span className="switch-control">
                    <span />
                  </span>
                  <span>
                    <b>{service.name}</b>
                    <small>
                      {service.durationMinutes
                        ? t("scheduling.duration", {
                            count: service.durationMinutes,
                          })
                        : t("scheduling.durationNotSet")}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? t("common.saving") : t("common.saveChanges")}
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}
type CommercialRequestLine = {
  id: string;
  description: string;
  unitPriceMinor: number;
  currency: string;
  quantity: number;
  lineTotalMinor: number;
  status: string;
};
type CommercialRequestDetail = {
  canManage: boolean;
  request: CommercialRequest;
  lines: CommercialRequestLine[];
};

function CommercialRequests({
  tenant,
  onNotice,
  onCountsChanged,
}: {
  tenant: string;
  onNotice: (message: string, type?: "success" | "error") => void;
  onCountsChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CommercialRequest[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommercialRequestDetail | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [filter, setFilter] = useState("active");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const value = await api<{
      canManage: boolean;
      newCount: number;
      requests: CommercialRequest[];
    }>(`/v1/admin/tenants/${tenant}/commercial-requests`);
    setRows(value.requests);
    setCanManage(value.canManage);
    setSelected((current) =>
      current && value.requests.some((row) => row.id === current)
        ? current
        : (value.requests[0]?.id ?? null),
    );
    return value.requests;
  };
  const loadDetail = async (id: string) =>
    setDetail(
      await api<CommercialRequestDetail>(
        `/v1/admin/tenants/${tenant}/commercial-requests/${id}`,
      ),
    );
  useEffect(() => {
    setRows([]);
    setSelected(null);
    setDetail(null);
    void (async () => {
      await api(`/v1/admin/tenants/${tenant}/commercial-requests/seen`, {
        method: "POST",
      });
      await load();
      await onCountsChanged();
    })().catch((error) => onNotice(error.message, "error"));
    // load/onCountsChanged/onNotice are redefined every render; this effect
    // must only reset and reload when the tenant actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  useEffect(() => {
    if (selected)
      void loadDetail(selected).catch((error) => onNotice(error.message, "error"));
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tenant]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        await load();
        if (selected) await loadDetail(selected);
        await onCountsChanged();
      })().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
    // Same reason as above: including the redefined-every-render functions
    // here would tear down and recreate the poll interval on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, selected]);
  const visible = rows.filter(
    (row) =>
      filter === "all" ||
      (filter === "active"
        ? ["ready", "accepted", "in_progress"].includes(row.status)
        : row.status === filter),
  );
  const actions: Record<string, string[]> = {
    draft: ["cancelled"],
    awaiting_confirmation: ["cancelled"],
    ready: ["cancelled"],
    accepted: ["cancelled"],
    in_progress: ["cancelled"],
  };
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value / 100);
  const actionLabel = (type: string, status: string) =>
    t(
      `requests.actions.${type === "reservation" ? "reservation" : "order"}.${status}`,
    );
  const statusLabel = (type: string, status: string) =>
    t(
      `requests.operationStatuses.${type === "reservation" ? "reservation" : "order"}.${status}`,
    );
  const appointmentDate = (value: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  const appointmentTime = (value: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  async function change(status: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/commercial-requests/${detail.request.id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      await load();
      await loadDetail(detail.request.id);
      await onCountsChanged();
      onNotice(t("requests.statusUpdated"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="requests-shell">
      <div className="request-list panel">
        <div className="request-list-head">
          <div>
            <h2>{t("requests.title")}</h2>
            <small>{t("requests.count", { count: visible.length })}</small>
          </div>
          <AppSelect
            value={filter}
            onChange={setFilter}
            options={[
              "active",
              "all",
              "ready",
              "accepted",
              "in_progress",
              "completed",
            ].map((value) => ({
              value,
              label: t(`requests.filters.${value}`),
            }))}
          />
        </div>
        <div className="request-list-items">
          {visible.map((row) => (
            <button
              key={row.id}
              className={`request-list-item ${selected === row.id ? "selected" : ""}`}
              onClick={() => setSelected(row.id)}
            >
              <span className="request-item-top">
                <b>{row.customerName}</b>
                <span className={`request-status ${row.status}`}>
                  {statusLabel(row.type, row.status)}
                </span>
              </span>
              <span>
                {t(`requests.types.${row.type}`)} · {row.lineCount} ·{" "}
                {money(row.totalMinor, row.currency)}
              </span>
              <small>
                #{row.id.slice(-8).toUpperCase()} ·{" "}
                {new Date(row.updatedAt).toLocaleString()}
              </small>
            </button>
          ))}
          {!visible.length && (
            <div className="request-empty">
              <ShoppingBag size={28} />
              <b>{t("requests.emptyTitle")}</b>
              <small>{t("requests.emptyHelp")}</small>
            </div>
          )}
        </div>
      </div>
      <div className="request-detail panel">
        {detail ? (
          <>
            <div className="request-detail-head">
              <div>
                <span className="eyebrow green">
                  {t(`requests.types.${detail.request.type}`)}
                </span>
                <h2>{detail.request.customerName}</h2>
                <p>
                  #{detail.request.id.slice(-8).toUpperCase()} ·{" "}
                  {t(
                    `requests.fulfillment.${detail.request.fulfillmentType ?? "unspecified"}`,
                  )}
                </p>
              </div>
              <span className={`request-status large ${detail.request.status}`}>
                {statusLabel(detail.request.type, detail.request.status)}
              </span>
            </div>
            <div className="request-summary">
              <span>
                <small>{t("requests.total")}</small>
                <b>
                  {money(detail.request.totalMinor, detail.request.currency)}
                </b>
              </span>
              <span>
                <small>{t("requests.created")}</small>
                <b>{new Date(detail.request.createdAt).toLocaleString()}</b>
              </span>
              <span>
                <small>{t("requests.confirmed")}</small>
                <b>
                  {detail.request.confirmedAt
                    ? new Date(detail.request.confirmedAt).toLocaleString()
                    : "—"}
                </b>
              </span>
            </div>
            {detail.request.appointment && (
              <div className="request-appointment">
                <span className="request-appointment-icon">
                  <CalendarDays size={21} />
                </span>
                <div>
                  <small>{t("requests.appointment.schedule")}</small>
                  <b>
                    {appointmentDate(
                      detail.request.appointment.startsAt,
                      detail.request.appointment.timezone,
                    )}{" "}
                    –{" "}
                    {appointmentTime(
                      detail.request.appointment.endsAt,
                      detail.request.appointment.timezone,
                    )}
                  </b>
                  <small>{detail.request.appointment.timezone}</small>
                </div>
                <div>
                  <small>{t("requests.appointment.resource")}</small>
                  <b>{detail.request.appointment.resource.name}</b>
                  <small>
                    {t(
                      `scheduling.resourceTypes.${detail.request.appointment.resource.type}`,
                    )}
                  </small>
                </div>
                <span
                  className={`request-status ${detail.request.appointment.status}`}
                >
                  {t(
                    `requests.appointment.statuses.${detail.request.appointment.status}`,
                  )}
                </span>
              </div>
            )}
            <div className="request-lines">
              <h3>{t("requests.lines")}</h3>
              {detail.lines
                .filter((line) => line.status === "active")
                .map((line) => (
                  <div className="request-line" key={line.id}>
                    <span>
                      <b>{line.description}</b>
                      <small>
                        {line.quantity} ×{" "}
                        {money(line.unitPriceMinor, line.currency)}
                      </small>
                    </span>
                    <b>{money(line.lineTotalMinor, line.currency)}</b>
                  </div>
                ))}
            </div>
            {detail.request.customerNotes && (
              <div className="request-notes">
                <small>{t("requests.notes")}</small>
                <p>{detail.request.customerNotes}</p>
              </div>
            )}
            {canManage && actions[detail.request.status]?.length > 0 && (
              <div className="request-actions">
                <span>
                  <b>{t("requests.nextAction")}</b>
                  <small>{t("requests.nextActionHelp")}</small>
                </span>
                {actions[detail.request.status].map((status) => (
                  <button
                    disabled={busy}
                    className={
                      status === "cancelled" || status === "rejected"
                        ? "danger-soft"
                        : ""
                    }
                    onClick={() => void change(status)}
                    key={status}
                  >
                    {actionLabel(detail.request.type, status)}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="request-detail-empty">
            <ShoppingBag size={38} />
            <h3>{t("requests.selectTitle")}</h3>
            <p>{t("requests.selectHelp")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

type ConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  senderType: string;
  body: string;
  interactive: {
    type: "buttons" | "list";
    options: Array<{ id: string; title: string; description?: string }>;
  } | null;
  intent: string | null;
  sources: string[];
  generationMode: "openai" | "deterministic" | "library" | null;
  generationModel: string | null;
  generationOutcome:
    "rewritten" | "reviewed" | "fallback" | "deterministic" | "reused" | null;
  deterministicBody: string | null;
  fallbackReason: string | null;
  aiUsage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostMinor: number;
    currency: string;
    latencyMs: number;
    success: boolean;
  } | null;
  deliveryStatus: string;
  deliveryErrorCode: string | null;
  occurredAt: string;
};

function ConversationMessageBody({ body }: { body: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const options = [...body.matchAll(/["“]([^"”]+)["”]/g)].map(
    (match) => match[1],
  );
  if (options.length < 3) return <p>{renderWhatsAppBold(body)}</p>;
  const introduction = body
    .slice(0, body.search(/["“]/))
    .trim()
    .replace(/:$/, "");
  const featuredOptions = options.slice(0, 4);
  const remainingOptions = options.slice(4);
  const visibleOptions = expanded ? options : featuredOptions;
  return (
    <div className="structured-message">
      <p className="structured-message-title">
        {introduction || t("conversations.actions.title")}
      </p>
      <span className="structured-message-help">
        {t("conversations.actions.help")}
      </span>
      <ul>
        {visibleOptions.map((option) => (
          <li key={option}>{option}</li>
        ))}
      </ul>
      {remainingOptions.length > 0 && (
        <button
          type="button"
          className="structured-message-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {t(
            expanded
              ? "conversations.actions.showLess"
              : "conversations.actions.showMore",
            { count: remainingOptions.length },
          )}
        </button>
      )}
    </div>
  );
}

function renderWhatsAppBold(body: string) {
  return body
    .split(/(\*[^*\n]+\*)/g)
    .map((part, index) =>
      part.startsWith("*") && part.endsWith("*") ? (
        <strong key={`${index}-${part}`}>{part.slice(1, -1)}</strong>
      ) : (
        part
      ),
    );
}
type ConversationDetail = {
  canManage: boolean;
  conversation: ConversationRow;
  messages: ConversationMessage[];
};

// Time alone reads fine for today's messages, but the inbox keeps rows from
// any day — without a date, an old conversation's timestamp looks identical
// to one from minutes ago.
function formatConversationRowTimestamp(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === new Date().toDateString()) return time;
  const day = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return `${day} ${time}`;
}

function ConversationInbox({
  tenant,
  onNotice,
  onCountsChanged,
}: {
  tenant: string;
  onNotice: (message: string, type?: "success" | "error") => void;
  onCountsChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const timelineRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "bot" | "human">("all");
  const [statusFilter, setStatusFilter] = useState<
    "active" | "all" | "closed"
  >("active");
  const [messageFilter, setMessageFilter] = useState<
    "all" | "ai" | "deterministic" | "fallback" | "failed"
  >("all");
  const [messageSearch, setMessageSearch] = useState("");
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [evaluationMode, setEvaluationMode] = useState(false);
  const [technicalMessage, setTechnicalMessage] =
    useState<ConversationMessage | null>(null);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  useEffect(() => {
    if (!technicalMessage) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTechnicalMessage(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [technicalMessage]);
  const load = async () => {
    const result = await api<{
      canManage: boolean;
      conversations: ConversationRow[];
    }>(`/v1/admin/tenants/${tenant}/conversations`);
    setRows(result.conversations);
    void onCountsChanged().catch(() => undefined);
    setCanManage(result.canManage);
    setSelected((current) =>
      current && result.conversations.some((row) => row.id === current)
        ? current
        : (result.conversations[0]?.id ?? null),
    );
    return result.conversations;
  };
  const open = async (id: string) => {
    setSelected(id);
    const next = await api<ConversationDetail>(
      `/v1/admin/tenants/${tenant}/conversations/${id}/messages`,
    );
    setDetail(next);
  };
  useEffect(() => {
    setDetail(null);
    setSelected(null);
    void load().catch((error) => onNotice(error.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  useEffect(() => {
    if (selected) void open(selected).catch((error) => onNotice(error.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tenant]);
  useEffect(() => {
    if (!selected) return;
    void api(`/v1/admin/tenants/${tenant}/conversations/${selected}/read`, {
      method: "POST",
    })
      .then(() => load())
      .catch((error) => onNotice(error.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tenant]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const conversations = await load();
        if (!selected) return;
        await open(selected);
        if (conversations.find((row) => row.id === selected)?.unreadCount) {
          await api(
            `/v1/admin/tenants/${tenant}/conversations/${selected}/read`,
            {
              method: "POST",
            },
          );
          await load();
        }
      })().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
    // load/open are redefined every render; including them here would tear
    // down and recreate the 2.5s poll interval on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, selected]);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const frame = requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [detail?.conversation.id, detail?.messages.length]);
  async function act(action: "take" | "bot" | "close") {
    if (!selected) return;
    setBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/conversations/${selected}/actions`,
        { method: "POST", body: JSON.stringify({ action }) },
      );
      await load();
      await open(selected);
      onNotice(t(`conversations.${action}Done`));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !text.trim()) return;
    setBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/conversations/${selected}/messages`,
        { method: "POST", body: JSON.stringify({ text }) },
      );
      setText("");
      await open(selected);
      await load();
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function retry(messageId: string) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/conversations/${selected}/messages/${messageId}/retry`,
        { method: "POST" },
      );
      await open(selected);
      await load();
      onNotice(t("conversations.retryQueued"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  // The conversation currently open on the right always stays visible here,
  // regardless of the active filters — switching filters while reading a
  // conversation shouldn't make it vanish from the list with nothing shown
  // as selected (see the Carlos conversation review).
  const visible = rows.filter(
    (row) =>
      row.id === selected ||
      ((filter === "all" || row.handlingMode === filter) &&
        (statusFilter === "all" ||
          (statusFilter === "active"
            ? row.status !== "closed"
            : row.status === "closed"))),
  );
  const visibleMessages = (detail?.messages ?? []).filter((message) => {
    const matchesSearch =
      !messageSearch.trim() ||
      message.body
        .toLocaleLowerCase()
        .includes(messageSearch.trim().toLocaleLowerCase());
    const matchesFilter =
      messageFilter === "all" ||
      (messageFilter === "ai" &&
        ["rewritten", "reviewed", "reused"].includes(
          message.generationOutcome ?? "",
        )) ||
      (messageFilter === "deterministic" &&
        message.generationOutcome === "deterministic") ||
      (messageFilter === "fallback" &&
        message.generationOutcome === "fallback") ||
      (messageFilter === "failed" && message.deliveryStatus === "failed");
    return matchesSearch && matchesFilter;
  });
  return (
    <section
      className={`conversation-shell panel ${inboxCollapsed ? "inbox-collapsed" : ""}`}
    >
      <div className="conversation-list">
        <div className="conversation-list-head">
          <div>
            <h2>{t("conversations.inbox")}</h2>
            <small>{t("conversations.count", { count: visible.length })}</small>
          </div>
          <button
            className="secondary compact-button"
            onClick={() => void load()}
          >
            {t("conversations.refresh")}
          </button>
          <button
            className="icon-button inbox-toggle"
            aria-label={t("conversations.hideInbox")}
            onClick={() => setInboxCollapsed(true)}
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
        <div className="conversation-filters">
          {(["active", "closed", "all"] as const).map((value) => (
            <button
              key={value}
              className={statusFilter === value ? "active" : ""}
              onClick={() => setStatusFilter(value)}
            >
              {t(`conversations.statusFilters.${value}`)}
            </button>
          ))}
        </div>
        <div className="conversation-filters">
          {(["all", "bot", "human"] as const).map((value) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {t(`conversations.filters.${value}`)}
            </button>
          ))}
        </div>
        <div className="conversation-scroll">
          {visible.map((row) => (
            <button
              key={row.id}
              className={`conversation-row ${selected === row.id ? "selected" : ""} ${row.unreadCount > 0 ? "unread" : ""}`}
              onClick={() => setSelected(row.id)}
            >
              <span className="conversation-avatar">
                {row.contactName.slice(0, 2).toUpperCase()}
              </span>
              <span className="conversation-summary">
                <b>{row.contactName}</b>
                <small>
                  {row.lastMessage || t("conversations.noMessages")}
                </small>
              </span>
              <span className="conversation-row-meta">
                {row.lastDeliveryStatus === "failed" && (
                  <TriangleAlert className="row-delivery-warning" size={14} />
                )}
                {row.lastMessageAt && (
                  <small>{formatConversationRowTimestamp(row.lastMessageAt)}</small>
                )}
                {row.unreadCount > 0 && (
                  <span
                    className="unread-count"
                    aria-label={t("conversations.unreadCount", {
                      count: row.unreadCount,
                    })}
                  >
                    {row.unreadCount > 99 ? "99+" : row.unreadCount}
                  </span>
                )}
                <span className={`mode-pill ${row.handlingMode}`}>
                  {t(`conversations.modes.${row.handlingMode}`)}
                </span>
              </span>
            </button>
          ))}
          {visible.length === 0 && (
            <div className="empty compact-empty">
              {t("conversations.empty")}
            </div>
          )}
        </div>
      </div>
      <div className="conversation-detail">
        {detail ? (
          <>
            <div className="conversation-toolbar">
              <div>
                {inboxCollapsed && (
                  <button
                    className="icon-button show-inbox"
                    aria-label={t("conversations.showInbox")}
                    onClick={() => setInboxCollapsed(false)}
                  >
                    <PanelLeftOpen size={18} />
                  </button>
                )}
                <h2>{detail.conversation.contactName}</h2>
                <small>{detail.conversation.contactAddress}</small>
              </div>
              {canManage && (
                <div className="conversation-actions">
                  {detail.conversation.status === "closed" ? (
                    <button disabled={busy} onClick={() => void act("take")}>
                      {t("conversations.reopen")}
                    </button>
                  ) : (
                    <>
                      {detail.conversation.handlingMode === "bot" ? (
                        <button disabled={busy} onClick={() => void act("take")}>
                          {t("conversations.take")}
                        </button>
                      ) : (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void act("bot")}
                        >
                          {t("conversations.returnBot")}
                        </button>
                      )}
                      <button
                        className="danger-soft"
                        disabled={busy}
                        onClick={() => void act("close")}
                      >
                        {t("conversations.close")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div
              className={`conversation-health ${detail.conversation.channelStatus !== "active" || detail.conversation.status === "closed" ? "has-warning" : ""}`}
            >
              {detail.conversation.status === "closed" && (
                <span className="warning">
                  <TriangleAlert size={13} />
                  {t("conversations.status.closed")}
                </span>
              )}
              <span
                className={
                  detail.conversation.handlingMode === "bot"
                    ? "healthy"
                    : "neutral"
                }
              >
                {t(`conversations.modes.${detail.conversation.handlingMode}`)}
              </span>
              <span
                className={
                  detail.conversation.aiEnabled ? "healthy" : "neutral"
                }
              >
                {detail.conversation.aiEnabled
                  ? t("conversations.status.aiEnabled")
                  : t("conversations.status.aiDisabled")}
              </span>
              <span
                className={
                  detail.conversation.channelStatus === "active"
                    ? "healthy"
                    : "warning"
                }
              >
                {detail.conversation.channelStatus === "active" ? (
                  t("conversations.status.whatsappConnected")
                ) : (
                  <>
                    <TriangleAlert size={13} />
                    {t("conversations.status.whatsappDisconnectedHelp")}
                  </>
                )}
              </span>
              <div className="evaluation-toggle">
                <FlaskConical size={14} />
                <button
                  className={!evaluationMode ? "active" : ""}
                  onClick={() => setEvaluationMode(false)}
                >
                  {t("conversations.normalMode")}
                </button>
                <button
                  className={evaluationMode ? "active" : ""}
                  onClick={() => setEvaluationMode(true)}
                >
                  {t("conversations.evaluationMode")}
                </button>
              </div>
            </div>
            <div className="message-tools">
              <input
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder={t("conversations.searchMessages")}
              />
              <div>
                {(
                  ["all", "ai", "deterministic", "fallback", "failed"] as const
                ).map((value) => (
                  <button
                    key={value}
                    className={messageFilter === value ? "active" : ""}
                    onClick={() => setMessageFilter(value)}
                  >
                    {t(`conversations.messageFilters.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="message-timeline"
              ref={timelineRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                setAwayFromLatest(
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight >
                    120,
                );
              }}
            >
              {visibleMessages.map((message, index) => {
                const previous = visibleMessages[index - 1];
                const currentDate = new Date(
                  message.occurredAt,
                ).toLocaleDateString();
                const previousDate = previous
                  ? new Date(previous.occurredAt).toLocaleDateString()
                  : null;
                return (
                  <Fragment key={message.id}>
                    {currentDate !== previousDate && (
                      <div className="message-date-separator">
                        <span>
                          {new Date(message.occurredAt).toLocaleDateString(
                            undefined,
                            { year: "numeric", month: "long", day: "numeric" },
                          )}
                        </span>
                      </div>
                    )}
                    <article
                      className={`message-bubble ${message.direction} ${message.direction === "inbound" && previous ? "turn-start" : ""}`}
                    >
                      <span className="message-author">
                        {message.direction === "inbound"
                          ? detail.conversation.contactName
                          : message.senderType === "user"
                            ? t("conversations.humanAgent")
                            : t("conversations.aiAssistant")}
                      </span>
                      <ConversationMessageBody body={message.body} />
                      {message.direction === "outbound" &&
                        message.interactive?.options.length && (
                          <div className="message-interactive-preview">
                            <span>{t("conversations.whatsappOptions")}</span>
                            <div>
                              {message.interactive.options.map((option) => (
                                <span key={option.id}>
                                  {option.title}
                                  {option.description ? ` — ${option.description}` : ""}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      {message.direction === "outbound" &&
                        message.generationMode && (
                          <button
                            className={`message-generation ${message.generationOutcome ?? message.generationMode}`}
                            onClick={() => setTechnicalMessage(message)}
                          >
                            {["openai", "library"].includes(
                              message.generationMode,
                            ) && <Sparkles size={13} />}
                            {!evaluationMode
                              ? t(
                                  message.generationMode === "library"
                                    ? "conversations.generation.reused"
                                    : message.generationMode === "openai" &&
                                        message.generationOutcome ===
                                          "rewritten"
                                      ? "conversations.generation.rewrittenWithAi"
                                      : "conversations.generation.automatic",
                                )
                              : t(
                                  `conversations.generation.outcomes.${message.generationOutcome ?? "deterministic"}`,
                                )}
                          </button>
                        )}
                      <small>
                        {new Date(message.occurredAt).toLocaleString()}
                        {message.deliveryStatus !== "failed" && (
                          <>
                            {" "}
                            ·{" "}
                            {t(
                              `conversations.delivery.${message.deliveryStatus}`,
                              { defaultValue: message.deliveryStatus },
                            )}
                          </>
                        )}
                      </small>
                      {message.deliveryStatus === "failed" && (
                        <div className="message-failure compact">
                          <span
                            title={t(
                              `conversations.errors.${message.deliveryErrorCode}`,
                              {
                                defaultValue: t(
                                  "conversations.errors.delivery_failed",
                                ),
                              },
                            )}
                          >
                            <TriangleAlert size={13} />
                            {t("conversations.delivery.failed")}
                          </span>
                          {canManage &&
                            detail.conversation.channelStatus === "active" && (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => void retry(message.id)}
                              >
                                {t("conversations.retry")}
                              </button>
                            )}
                        </div>
                      )}
                    </article>
                  </Fragment>
                );
              })}
              {!visibleMessages.length && (
                <div className="empty compact-empty">
                  {t("conversations.noFilteredMessages")}
                </div>
              )}
              {awayFromLatest && (
                <button
                  className="jump-to-latest"
                  onClick={() => {
                    const timeline = timelineRef.current;
                    if (timeline) {
                      timeline.scrollTop = timeline.scrollHeight;
                      setAwayFromLatest(false);
                    }
                  }}
                >
                  <ArrowDown size={15} />
                  {t("conversations.latest")}
                </button>
              )}
            </div>
            {canManage && (
              <form className="conversation-composer" onSubmit={send}>
                {quickRepliesOpen && (
                  <div className="quick-replies">
                    {["greeting", "reviewing", "handoff"].map((key) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => {
                          setText(t(`conversations.quickReplies.${key}`));
                          setQuickRepliesOpen(false);
                        }}
                      >
                        {t(`conversations.quickReplies.${key}`)}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="secondary quick-reply-trigger"
                  disabled={detail.conversation.status === "closed"}
                  onClick={() => setQuickRepliesOpen((value) => !value)}
                >
                  {t("conversations.quickReply")}
                </button>
                <textarea
                  value={text}
                  disabled={detail.conversation.status === "closed"}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    detail.conversation.status === "closed"
                      ? t("conversations.closedPlaceholder")
                      : t("conversations.placeholder")
                  }
                />
                <button
                  disabled={
                    busy ||
                    !text.trim() ||
                    detail.conversation.status === "closed"
                  }
                >
                  <Send size={17} />
                  {t("conversations.send")}
                </button>
              </form>
            )}
            {technicalMessage && (
              <>
                <button
                  type="button"
                  className="technical-drawer-backdrop"
                  aria-label={t("conversations.close")}
                  onClick={() => setTechnicalMessage(null)}
                />
                <aside
                  className="technical-drawer"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("conversations.generation.details")}
                >
                  <div className="technical-drawer-head">
                    <div>
                      <span className="eyebrow green">
                        {t("conversations.generation.details")}
                      </span>
                      <h3>
                        {t(
                          `conversations.generation.outcomes.${technicalMessage.generationOutcome ?? "deterministic"}`,
                        )}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="technical-drawer-close"
                      aria-label={t("conversations.close")}
                      onClick={() => setTechnicalMessage(null)}
                    >
                      <X size={18} />
                      <span>{t("conversations.close")}</span>
                    </button>
                  </div>
                  <dl>
                    {technicalMessage.intent && (
                      <div>
                        <dt>{t("conversations.generation.detectedIntent")}</dt>
                        <dd>
                          {t(
                            `conversations.intents.${technicalMessage.intent}`,
                            { defaultValue: technicalMessage.intent },
                          )}
                        </dd>
                      </div>
                    )}
                    {technicalMessage.sources.length > 0 && (
                      <div>
                        <dt>{t("conversations.generation.informationUsed")}</dt>
                        <dd>
                          {[
                            ...new Set(
                              technicalMessage.sources.map((source) => {
                                const [type] = source.split(":");
                                return t(`conversations.sourceTypes.${type}`, {
                                  defaultValue: type,
                                });
                              }),
                            ),
                          ].join(", ")}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>{t("conversations.generation.mode")}</dt>
                      <dd>
                        {t(
                          `conversations.generation.modes.${technicalMessage.generationMode}`,
                        )}
                      </dd>
                    </div>
                    {technicalMessage.generationModel && (
                      <div>
                        <dt>{t("conversations.generation.model")}</dt>
                        <dd>{technicalMessage.generationModel}</dd>
                      </div>
                    )}
                    {technicalMessage.aiUsage && (
                      <>
                        <div>
                          <dt>{t("conversations.generation.tokens")}</dt>
                          <dd>
                            {technicalMessage.aiUsage.inputTokens} /{" "}
                            {technicalMessage.aiUsage.outputTokens}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("conversations.generation.latency")}</dt>
                          <dd>{technicalMessage.aiUsage.latencyMs} ms</dd>
                        </div>
                        <div>
                          <dt>{t("conversations.generation.cost")}</dt>
                          <dd>
                            {(
                              technicalMessage.aiUsage.estimatedCostMinor / 100
                            ).toLocaleString(undefined, {
                              style: "currency",
                              currency: technicalMessage.aiUsage.currency,
                            })}
                          </dd>
                        </div>
                      </>
                    )}
                    {technicalMessage.fallbackReason && (
                      <div>
                        <dt>{t("conversations.generation.fallback")}</dt>
                        <dd>
                          {t(
                            `conversations.fallbackReasons.${technicalMessage.fallbackReason}`,
                            { defaultValue: technicalMessage.fallbackReason },
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {technicalMessage.deterministicBody && (
                    <div className="drawer-comparison">
                      <span>
                        <b>{t("conversations.generation.original")}</b>
                        <p>{technicalMessage.deterministicBody}</p>
                      </span>
                      <span>
                        <b>{t("conversations.generation.final")}</b>
                        <p>{technicalMessage.body}</p>
                      </span>
                    </div>
                  )}
                </aside>
              </>
            )}
          </>
        ) : (
          <div className="empty">
            <MessagesSquare size={42} />
            <h3>{t("conversations.selectTitle")}</h3>
            <p>{t("conversations.selectHelp")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function LanguageSwitcher({
  compact = false,
  persist = false,
}: {
  compact?: boolean;
  persist?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = i18n.language.startsWith("es") ? "es" : "en";
  const languages = [
    { code: "es", label: "Spanish (ES)" },
    { code: "en", label: "English (EN)" },
  ];
  const selected = languages.find((language) => language.code === current)!;
  return (
    <div className={compact ? "language-picker compact" : "language-picker"}>
      <button
        type="button"
        className="language-toggle"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language.label")}
      >
        <Languages size={17} />
        <span>{selected.label}</span>
        <ChevronDown className={open ? "rotated" : ""} size={16} />
      </button>
      {open && (
        <div
          className="language-menu"
          role="listbox"
          aria-label={t("language.label")}
        >
          {languages.map((language) => (
            <button
              key={language.code}
              type="button"
              role="option"
              aria-selected={language.code === current}
              className={language.code === current ? "selected" : ""}
              onClick={() => {
                void i18n.changeLanguage(language.code);
                if (persist)
                  void api("/v1/auth/preferences", {
                    method: "PATCH",
                    body: JSON.stringify({ uiLanguage: language.code }),
                  });
                setOpen(false);
              }}
            >
              <span>{language.label}</span>
              {language.code === current && <ShieldCheck size={17} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function roleName(
  role: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return t(`roles.${role}`, { defaultValue: role });
}
function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
