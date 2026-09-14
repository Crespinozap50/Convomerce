import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/v1/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    } catch {
      // Deliberately ignored: the backend already resolves the same way
      // whether or not the email matches a real account (D-159) — showing
      // a different message here for a network/validation failure would
      // defeat that, so this always lands on the same generic success view.
    } finally {
      setBusy(false);
      setDone(true);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark">
          <MessageCircle size={32} />
        </div>
        <span className="eyebrow">COMMERCE ASSISTANT</span>
        <h1>{t("forgotPassword.title")}</h1>
        <p>{t("forgotPassword.subtitle")}</p>
        <div className="trust">
          <ShieldCheck />
          <span>{t("login.trust")}</span>
        </div>
      </section>
      <section className="auth-card">
        <div>
          <LanguageSwitcher />
          <span className="eyebrow green">{t("forgotPassword.eyebrow")}</span>
          <h2>{t("forgotPassword.title")}</h2>
          <p>{t("forgotPassword.subtitle")}</p>
        </div>
        {done ? (
          <>
            <p>{t("forgotPassword.success")}</p>
            <a href="/">{t("forgotPassword.backToLogin")}</a>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              {t("forgotPassword.email")}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button disabled={busy}>
              {busy ? t("forgotPassword.busy") : t("forgotPassword.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
