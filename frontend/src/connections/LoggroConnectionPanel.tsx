import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { api } from "../api";

type LoggroStatus = {
  connected: boolean;
  status: string;
  secretConfigured: boolean;
  homeDeliveryTableId: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
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

  async function chooseTable(tableId: string) {
    setBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/pos-connections/loggro/home-delivery-table`,
        { method: "PUT", body: JSON.stringify({ tableId }) },
      );
      setTables(null);
      await load();
      onNotice(t("connections.loggro.tableSaved"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

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
              {status?.homeDeliveryTableId
                ? t("connections.loggro.tableConfigured", {
                    id: status.homeDeliveryTableId,
                  })
                : t("connections.loggro.tableMissing")}
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
          {status?.connected && (
            <button
              type="button"
              className="secondary compact-action"
              disabled={busy}
              onClick={() => void loadTables()}
            >
              {t("connections.loggro.chooseTable")}
            </button>
          )}
        </div>
      )}
      {tables && (
        <div className="loggro-table-list">
          {tables.length === 0 && <p>{t("connections.loggro.noTables")}</p>}
          {tables.map((table) => (
            <button
              key={table._id}
              type="button"
              className="secondary compact-action"
              disabled={busy}
              onClick={() => void chooseTable(table._id)}
            >
              {table.name}
              {table.isHomeDelivery ? ` (${t("connections.loggro.isHomeDelivery")})` : ""}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
