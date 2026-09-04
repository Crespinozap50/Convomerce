import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponseVariant } from "../types";
import { formatLanguageName } from "./utils";
import { LearnedResponse } from "./LearnedResponse";

export function LearnedResponsesPanel({
  tenant,
  variants,
  canManage,
  onUpdated,
}: {
  tenant: string;
  variants: ResponseVariant[];
  canManage: boolean;
  onUpdated: (variant: ResponseVariant) => void;
}) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<
    "all" | "candidate" | "approved" | "rejected"
  >("candidate");
  const filtered = variants.filter(
    (variant) => filter === "all" || variant.status === filter,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const active =
    filtered.find((variant) => variant.id === selected) ?? filtered[0] ?? null;
  return (
    <div className="learned-response-browser">
      <div className="learned-response-filters">
        {(["candidate", "approved", "rejected", "all"] as const).map(
          (status) => (
            <button
              key={status}
              className={filter === status ? "active" : ""}
              onClick={() => {
                setFilter(status);
                setSelected(null);
              }}
            >
              {t(`knowledge.responseVariantFilters.${status}`)}
              <span>
                {status === "all"
                  ? variants.length
                  : variants.filter((variant) => variant.status === status)
                      .length}
              </span>
            </button>
          ),
        )}
      </div>
      {variants.length === 0 ? (
        <p className="empty-copy">{t("knowledge.responseVariantsEmpty")}</p>
      ) : filtered.length === 0 ? (
        <p className="empty-copy">
          {t("knowledge.responseVariantsFilterEmpty")}
        </p>
      ) : (
        <div
          className={`learned-response-content ${filtered.length === 1 ? "single" : ""}`}
        >
          <div className="learned-response-list">
            {filtered.map((variant) => (
              <button
                key={variant.id}
                className={active?.id === variant.id ? "active" : ""}
                onClick={() => setSelected(variant.id)}
              >
                <b>
                  {t(
                    `knowledge.responseVariantTemplates.${variant.templateKey}`,
                    { defaultValue: variant.templateKey },
                  )}
                </b>
                <small>
                  {formatLanguageName(
                    variant.locale,
                    i18n.resolvedLanguage ?? i18n.language,
                  )}{" "}
                  ·{" "}
                  {t("knowledge.responseVariantUses", {
                    count: variant.useCount,
                  })}
                </small>
              </button>
            ))}
          </div>
          {active && (
            <LearnedResponse
              tenant={tenant}
              variant={active}
              canManage={canManage}
              onUpdated={onUpdated}
            />
          )}
        </div>
      )}
    </div>
  );
}
