import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { api } from "../api";

type LoggroStatus = {
  connected: boolean;
  status: string;
  secretConfigured: boolean;
  tableNamePattern: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  enabled: boolean;
};
type LoggroTable = { _id: string; name: string; isActive: boolean; isHomeDelivery: boolean };

// Backend counterpart already exists (backend/src/pos-integrations/) — this
// is the missing admin-facing half: entering the real email/password,
// testing the connection (via the real /login call PUT already triggers),
// and picking the isHomeDelivery table by hand (see docs/decisions.md D-186
// for why it's never assumed automatically).
export function LoggroConnectionPanel({
  tenant,
  canManage,
  onNotice,
}: {
  tenant: string;
  canManage: boolean;
  onNotice: (message: string, type?: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LoggroStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pattern, setPattern] = useState("");
  const [busy, setBusy] = useState(false);
  const [tables, setTables] = useState<LoggroTable[] | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  async function load() {
    try {
      const result = await api<LoggroStatus>(
        `/v1/admin/tenants/${tenant}/pos-connections/loggro`,
      );
      setStatus(result);
      setPattern((current) => current || result.tableNamePattern || "");
    } catch (error) {
      onNotice((error as Error).message, "error");
    }
  }

  async function connect() {
    setBusy(true);
    try {
      await api(`/v1/admin/tenants/${tenant}/pos-connections/loggro`, {
        method: "PUT",
        body: JSON.stringify({ email, password: password || undefined }),
      });
      setPassword("");
      setTables(null);
      await load();
      onNotice(t("connections.loggro.connected"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadTables() {
    setBusy(true);
    try {
      const result = await api<LoggroTable[]>(
        `/v1/admin/tenants/${tenant}/pos-connections/loggro/tables`,
      );
      setTables(result);
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function savePattern() {
    setBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/pos-connections/loggro/table-pool`,
        { method: "PUT", body: JSON.stringify({ pattern }) },
      );
      await load();
      onNotice(t("connections.loggro.tablePatternSaved"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // D-201 (docs/decisions.md): loggro_pos used to be toggleable only via a
  // direct SQL update — this is the missing admin-facing switch. The
  // backend re-checks the same connected+pattern preconditions on every
  // save regardless of what's disabled here, so a stale UI state can never
  // silently enable it incorrectly.
  async function toggleEnabled() {
    const next = !status?.enabled;
    setBusy(true);
    try {
      await api(`/v1/admin/tenants/${tenant}/pos-connections/loggro/enabled`, {
        method: "PUT",
        body: JSON.stringify({ enabled: next }),
      });
      await load();
      onNotice(
        next ? t("connections.loggro.enabledOn") : t("connections.loggro.enabledOff"),
      );
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const matchingTables = tables?.filter((table) =>
    pattern.trim() ? table.name.trim().toLowerCase().startsWith(pattern.trim().toLowerCase()) : false,
  );

  return (
    <section className="panel page-panel">
      <div className="panel-head">
        <div>
          <h2>{t("connections.loggro.title")}</h2>
          <p>{t("connections.loggro.description")}</p>
        </div>
      </div>
      <div className="connection-list">
        <div>
          <Package />
          <span>
            <b>Loggro Restobar</b>
            <small>
              {status?.secretConfigured
                ? t("connections.loggro.emailNote")
                : t("connections.loggro.notConnected")}
            </small>
            <small>
              {status?.tableNamePattern
                ? t("connections.loggro.tablePatternConfigured", {
                    pattern: status.tableNamePattern,
                  })
                : t("connections.loggro.tablePatternMissing")}
            </small>
            {status?.lastErrorCode && (
              <small className="loggro-last-error">{status.lastErrorCode}</small>
            )}
          </span>
          <div className="connection-actions">
            <em>
              {t(`common.${status?.status ?? "disconnected"}`, {
                defaultValue: status?.status ?? "disconnected",
              })}
            </em>
            {status?.connected && (
              <span className={`loggro-enabled-badge ${status.enabled ? "on" : "off"}`}>
                {status.enabled
                  ? t("connections.loggro.enabledBadgeOn")
                  : t("connections.loggro.enabledBadgeOff")}
              </span>
            )}
          </div>
        </div>
      </div>
      {canManage && (
        <div className="loggro-connect-form">
          <input
            type="email"
            placeholder={t("connections.loggro.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder={
              status?.secretConfigured
                ? t("connections.loggro.passwordKeepPlaceholder")
                : t("connections.loggro.passwordPlaceholder")
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="secondary compact-action"
            disabled={busy || !email.trim()}
            onClick={() => void connect()}
          >
            {status?.secretConfigured
              ? t("connections.loggro.save")
              : t("connections.loggro.connect")}
          </button>
        </div>
      )}
      {canManage && status?.connected && (
        <div className="loggro-table-pool-form">
          <input
            type="text"
            placeholder={t("connections.loggro.tablePatternPlaceholder")}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <button
            type="button"
            className="secondary compact-action"
            disabled={busy || !pattern.trim()}
            onClick={() => void savePattern()}
          >
            {t("connections.loggro.tablePatternSave")}
          </button>
          <button
            type="button"
            className="secondary compact-action"
            disabled={busy}
            onClick={() => void loadTables()}
          >
            {t("connections.loggro.tablePatternPreview")}
          </button>
          {tables && (
            <div className="loggro-table-list">
              {(matchingTables?.length ?? 0) === 0 && <p>{t("connections.loggro.tablePatternNoMatches")}</p>}
              {matchingTables?.map((table) => (
                <span key={table._id} className="loggro-table-match">
                  {table.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {canManage && status?.connected && (
        <div className="loggro-enabled-toggle">
          <label className="switch-row">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy || (!status.enabled && !status.tableNamePattern)}
              onChange={() => void toggleEnabled()}
            />
            <span className="switch-control" aria-hidden="true">
              <span />
            </span>
            <span>
              <b>{t("connections.loggro.enabledToggle")}</b>
              <small>
                {!status.enabled && !status.tableNamePattern
                  ? t("connections.loggro.enabledRequiresPattern")
                  : t("connections.loggro.enabledHelp")}
              </small>
            </span>
          </label>
        </div>
      )}
    </section>
  );
}
