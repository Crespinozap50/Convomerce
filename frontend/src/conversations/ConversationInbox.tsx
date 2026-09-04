import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { api } from "../api";
import { ConversationRow } from "../types";

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

export function ConversationInbox({
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
