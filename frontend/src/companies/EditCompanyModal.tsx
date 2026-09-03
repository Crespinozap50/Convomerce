import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Tenant } from "../types";
import { AppSelect } from "../components/AppSelect";

export function EditCompanyModal({
  company,
  onClose,
  onDone,
}: {
  company: Tenant;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    displayName: company.displayName,
    timezone: company.timezone,
    defaultLocale: company.defaultLocale,
    status: company.status,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/platform/tenants/${company.id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      onDone();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const timezones = [
    "America/Bogota",
    "America/Mexico_City",
    "America/Lima",
    "America/Santiago",
    "America/New_York",
    "Europe/Madrid",
  ].map((value) => ({ value, label: value }));
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow green">{t("companyModal.editEyebrow")}</span>
        <h2>{t("companyModal.editTitle")}</h2>
        <p>{t("companyModal.editHelp")}</p>
        {error && <div className="form-alert">{error}</div>}
        <label>
          {t("companyModal.name")}
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            required
          />
        </label>
        <label>
          {t("companyModal.slug")}
          <input value={company.slug} disabled />
          <small>{t("companyModal.slugLocked")}</small>
        </label>
        <div className="modal-two">
          <label>
            {t("companyModal.timezone")}
            <AppSelect
              value={form.timezone}
              onChange={(timezone) => setForm({ ...form, timezone })}
              options={timezones}
            />
          </label>
          <label>
            {t("companyModal.locale")}
            <AppSelect
              value={form.defaultLocale}
              onChange={(defaultLocale) => setForm({ ...form, defaultLocale })}
              options={[
                { value: "es-CO", label: "Spanish (Colombia)" },
                { value: "es-MX", label: "Spanish (Mexico)" },
                { value: "es-ES", label: "Spanish (Spain)" },
                { value: "en-US", label: "English (United States)" },
              ]}
            />
          </label>
        </div>
        <label>
          {t("companyModal.status")}
          <AppSelect
            value={form.status}
            onChange={(status) => setForm({ ...form, status })}
            options={[
              { value: "active", label: t("common.active") },
              { value: "suspended", label: t("common.suspended") },
              { value: "disabled", label: t("common.disabled") },
            ]}
          />
        </label>
        <button disabled={busy}>
          {busy ? t("common.saving") : t("common.saveChanges")}
        </button>
      </form>
    </div>
  );
}
