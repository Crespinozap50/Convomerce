import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { api } from "../api";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function ChangePassword({
  onChanged,
  error,
  onError,
}: {
  onChanged: () => void;
  error: string;
  onError: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError("");
    try {
      await api("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged();
    } catch (x) {
      onError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="center muted-bg">
      <section className="password-card">
        <div className="icon-box">
          <ShieldCheck />
        </div>
        <LanguageSwitcher persist />
        <span className="eyebrow green">{t("password.eyebrow")}</span>
        <h2>{t("password.title")}</h2>
        <p>{t("password.description")}</p>
        <form onSubmit={submit}>
          <label>
            {t("password.current")}
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label>
            {t("password.next")}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              minLength={12}
              required
            />
            <small>{t("password.hint")}</small>
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>{t("password.submit")}</button>
        </form>
      </section>
    </main>
  );
}
