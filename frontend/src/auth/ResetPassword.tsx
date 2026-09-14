import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../api";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function ResetPassword({ token }: { token: string | null }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError(t("resetPassword.passwordMismatch"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/v1/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password }),
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
        <h1>{t("resetPassword.title")}</h1>
        <p>{t("resetPassword.subtitle")}</p>
        <div className="trust">
          <ShieldCheck />
          <span>{t("login.trust")}</span>
        </div>
      </section>
      <section className="auth-card">
        <div>
          <LanguageSwitcher />
          <span className="eyebrow green">{t("resetPassword.eyebrow")}</span>
          <h2>{t("resetPassword.title")}</h2>
          <p>{t("resetPassword.subtitle")}</p>
        </div>
        {!token ? (
          <div className="error">{t("resetPassword.missingToken")}</div>
        ) : done ? (
          <>
            <p>{t("resetPassword.success")}</p>
            <a href="/">{t("resetPassword.goToLogin")}</a>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              {t("resetPassword.password")}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
              />
            </label>
            <label>
              {t("resetPassword.confirmPassword")}
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
              {busy ? t("resetPassword.busy") : t("resetPassword.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
