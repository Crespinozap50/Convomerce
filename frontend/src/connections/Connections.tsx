import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Connection } from "../types";

export function Connections({
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
