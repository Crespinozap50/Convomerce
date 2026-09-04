import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  Bot,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Gauge,
  Link2,
  LogOut,
  MessageCircle,
  MessagesSquare,
  ShoppingBag,
  ShieldCheck,
  TriangleAlert,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import { OperationalRequirementsPanel } from "./operational-requirements/OperationalRequirementsPanel";
import {
  Session,
  Tenant,
  Member,
  Connection,
  BotConfig,
  CommercialRequest,
  KnowledgePayload,
  ConversationRow,
} from "./types";
import {
  Page,
  KnowledgeSection,
  knowledgeSections,
  knowledgePaths,
  pagePaths,
  knowledgeDescriptionKeys,
  readDashboardPage,
  readDashboardTenant,
  readDashboardRoute,
} from "./dashboard/routing";
import { playNotificationSound, showDesktopNotification, roleName } from "./dashboard/utils";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { Login } from "./auth/Login";
import { ChangePassword } from "./auth/ChangePassword";
import { TenantSelector } from "./companies/TenantSelector";
import { Companies } from "./companies/Companies";
import { CompanyModal } from "./companies/CompanyModal";
import { EditCompanyModal } from "./companies/EditCompanyModal";
import { TenantMetrics } from "./tenant-metrics/TenantMetrics";
import { Team } from "./team/Team";
import { InviteModal } from "./team/InviteModal";
import { Connections } from "./connections/Connections";
import { ConnectionModal } from "./connections/ConnectionModal";
import { BotSettings } from "./bot/BotSettings";
import { SchedulingSettings } from "./scheduling/SchedulingSettings";
import { CommercialRequests } from "./requests/CommercialRequests";
import { KnowledgeSettings } from "./knowledge/KnowledgeSettings";
import { ConversationInbox } from "./conversations/ConversationInbox";

type ConnectionsResponse = {
  canManage: boolean;
  webhookPath: string;
  connections: Connection[];
};

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
  const appliedSessionLanguage = useRef<string | null>(null);
  useEffect(() => {
    if (
      session?.uiLanguage &&
      appliedSessionLanguage.current !== session.uiLanguage
    ) {
      appliedSessionLanguage.current = session.uiLanguage;
      if (i18n.language !== session.uiLanguage) {
        void i18n.changeLanguage(session.uiLanguage);
      }
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
          {isSuperAdmin && (
            <button
              className={page === "tenant-metrics" ? "active" : ""}
              onClick={() => navigate("tenant-metrics")}
            >
              <Gauge />
              {t("nav.tenantMetrics")}
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
                : page === "tenant-metrics"
                  ? t("pages.tenantMetrics.title")
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
                : page === "tenant-metrics"
                  ? t("pages.tenantMetrics.description")
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
          {page !== "companies" && page !== "tenant-metrics" && (
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
        {page === "tenant-metrics" && (
          <TenantMetrics onNotice={setNotice} />
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

