import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { AppSelect } from "../components/AppSelect";

export function InviteModal({
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
