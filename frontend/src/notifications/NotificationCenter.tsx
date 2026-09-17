import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ShieldCheck, TriangleAlert, X } from "lucide-react";

export type NotificationEntry = {
  id: number;
  message: string;
  type: "success" | "error";
  occurredAt: number;
};

// D-205 (docs/decisions.md): the top-right toast auto-dismisses after 5s
// with nothing keeping a record of it — a notice missed while looking
// away was simply gone. This is the review-after-it-disappears half; the
// toast itself (App.tsx) is untouched.
function formatRelativeTime(
  occurredAt: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const minutes = Math.floor((Date.now() - occurredAt) / 60000);
  if (minutes < 1) return t("notifications.justNow");
  if (minutes < 60) return t("notifications.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("notifications.hoursAgo", { count: hours });
  return new Date(occurredAt).toLocaleString();
}

export function NotificationCenter({
  entries,
  unreadCount,
  onOpen,
  onClear,
}: {
  entries: NotificationEntry[];
  unreadCount: number;
  onOpen: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="notification-center">
      <button
        type="button"
        className="notification-bell"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t("notifications.title")}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen();
        }}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="notification-panel"
          role="dialog"
          aria-label={t("notifications.title")}
        >
          <div className="notification-panel-head">
            <b>{t("notifications.title")}</b>
            <div>
              {entries.length > 0 && (
                <button type="button" className="text-button" onClick={onClear}>
                  {t("notifications.clear")}
                </button>
              )}
              <button
                type="button"
                className="notification-panel-close"
                onClick={() => setOpen(false)}
                aria-label={t("common.dismiss")}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="notification-panel-empty">{t("notifications.empty")}</p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={`notification-item notification-${entry.type}`}
                >
                  {entry.type === "success" ? (
                    <ShieldCheck size={16} />
                  ) : (
                    <TriangleAlert size={16} />
                  )}
                  <span>
                    <p>{entry.message}</p>
                    <small>{formatRelativeTime(entry.occurredAt, t)}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
