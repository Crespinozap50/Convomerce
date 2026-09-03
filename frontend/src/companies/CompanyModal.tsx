import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CompanyModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [displayName, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/v1/admin/platform/tenants", {
        method: "POST",
        body: JSON.stringify({
          displayName,
          slug,
          timezone: "America/Bogota",
          defaultLocale: "es-CO",
        }),
      });
      onDone();
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
        <span className="eyebrow green">{t("companyModal.eyebrow")}</span>
        <h2>{t("companyModal.title")}</h2>
        <form onSubmit={submit}>
          <label>
            {t("companyModal.name")}
            <input
              value={displayName}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(slugify(e.target.value));
              }}
              required
            />
          </label>
          <label>
            {t("companyModal.slug")}
            <input
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              required
            />
            <small>{t("companyModal.slugHint")}</small>
          </label>
          {error && <div className="error">{error}</div>}
          <button>{t("companyModal.submit")}</button>
        </form>
      </section>
    </div>
  );
}
