import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Connection } from "../types";

export function ConnectionModal({
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
