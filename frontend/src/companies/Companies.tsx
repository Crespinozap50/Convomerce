import { useTranslation } from "react-i18next";
import { Building2, Pencil, Plus } from "lucide-react";
import { Tenant } from "../types";

export function Companies({
  companies,
  onCreate,
  onOpen,
  onEdit,
}: {
  companies: Tenant[];
  onCreate: () => void;
  onOpen: (id: string) => void;
  onEdit: (company: Tenant) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="panel page-panel">
      <div className="panel-head">
        <div>
          <h2>{t("tenant.registered")}</h2>
          <p>{t("tenant.available", { count: companies.length })}</p>
        </div>
        <button onClick={onCreate}>
          <Plus size={18} /> {t("tenant.new")}
        </button>
      </div>
      <div className="company-grid">
        {companies.map((c) => (
          <article className="company-card" key={c.id}>
            <button className="company-card-open" onClick={() => onOpen(c.id)}>
              <Building2 />
              <span>
                <b>{c.displayName}</b>
                <small>
                  {c.slug} · {c.timezone}
                </small>
              </span>
            </button>
            <div className="company-card-actions">
              <em className={c.status}>
                {t(`common.${c.status}`, { defaultValue: c.status })}
              </em>
              <button className="company-card-edit" onClick={() => onEdit(c)}>
                <Pencil size={15} />
                {t("companyModal.edit")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
