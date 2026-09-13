import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../api";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function AcceptInvite({ token }: { token: string | null }) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError(t("acceptInvite.passwordMismatch"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/v1/auth/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, displayName, password }),
      });
      setDone(true);
    } catch (x) {
      setError(x instanceof ApiError ? x.message : (x as Error).message);
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
        <h1>{t("acceptInvite.title")}</h1>
        <p>{t("acceptInvite.subtitle")}</p>
        <div className="trust">
          <ShieldCheck />
          <span>{t("login.trust")}</span>
        </div>
      </section>
      <section className="auth-card">
        <div>
          <LanguageSwitcher />
          <span className="eyebrow green">{t("acceptInvite.eyebrow")}</span>
          <h2>{t("acceptInvite.title")}</h2>
          <p>{t("acceptInvite.subtitle")}</p>
        </div>
        {!token ? (
          <div className="error">{t("acceptInvite.missingToken")}</div>
        ) : done ? (
          <>
            <p>{t("acceptInvite.success")}</p>
            <a href="/">{t("acceptInvite.goToLogin")}</a>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              {t("acceptInvite.displayName")}
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                minLength={2}
                maxLength={120}
              />
            </label>
            <label>
              {t("acceptInvite.password")}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
              />
            </label>
            <label>
              {t("acceptInvite.confirmPassword")}
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={12}
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button disabled={busy}>
              {busy ? t("acceptInvite.busy") : t("acceptInvite.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
