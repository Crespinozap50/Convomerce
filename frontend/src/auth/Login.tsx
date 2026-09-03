import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Session } from "../types";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("admin@commerce.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onLogin(await api("/v1/auth/me"));
    } catch (x) {
      setError((x as Error).message);
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
        <h1>{t("login.headline")}</h1>
        <p>{t("login.description")}</p>
        <div className="trust">
          <ShieldCheck />
          <span>{t("login.trust")}</span>
        </div>
      </section>
      <section className="auth-card">
        <div>
          <LanguageSwitcher />
          <span className="eyebrow green">{t("login.eyebrow")}</span>
          <h2>{t("login.title")}</h2>
          <p>{t("login.subtitle")}</p>
        </div>
        <form onSubmit={submit}>
          <label>
            {t("login.email")}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            {t("login.password")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? t("login.busy") : t("login.submit")}
          </button>
        </form>
        <small>{t("login.secure")}</small>
      </section>
    </main>
  );
}
