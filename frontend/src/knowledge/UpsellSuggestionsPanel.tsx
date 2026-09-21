import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";

type Suggestion = {
  targetVariantId: string;
  productName: string;
  variantName: string;
  priceMinor: string;
  currency: string;
  active: boolean;
  available: boolean;
  offeredWith: { variantId: string; name: string }[];
};
type Payload = { enabled: boolean; suggestions: Suggestion[] };

export function UpsellSuggestionsPanel({
  tenant,
  canManage,
  hidden,
  onNotice,
}: {
  tenant: string;
  canManage: boolean;
  hidden: boolean;
  onNotice: (message: string, type?: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/v1/admin/tenants/${tenant}/upsell-suggestions`;

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>(base));
    } catch (x) {
      onNotice((x as Error).message, "error");
    }
  }, [base, onNotice]);
  useEffect(() => {
    void load();
  }, [load]);

  async function change(path: string, enabled: boolean) {
    setBusy(true);
    try {
      await api(`${base}${path}`, { method: path === "/enabled" ? "PUT" : "PATCH", body: JSON.stringify({ enabled }) });
      onNotice(t("knowledge.upsell.saved"));
      await load();
    } catch (x) {
      onNotice((x as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const money = (s: Suggestion) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: s.currency, maximumFractionDigits: 0 }).format(
      Number(s.priceMinor) / 100,
    );
  return (
    <section className="panel page-panel capability-panel" hidden={hidden}>
      <div className="panel-head">
        <div>
          <h2>{t("knowledge.upsell.title")}</h2>
          <p>{t("knowledge.upsell.help")}</p>
        </div>
      </div>
      <div className="capability-grid">
        <label className="capability-card">
          <input
            type="checkbox"
            checked={data.enabled}
            disabled={!canManage || busy}
            onChange={(event) => void change("/enabled", event.target.checked)}
          />
          <span className="switch-control" aria-hidden="true">
            <span />
          </span>
          <span>
            <b>{t("knowledge.upsell.general")}</b>
            <small>{t("knowledge.upsell.generalHelp")}</small>
          </span>
        </label>
        {data.suggestions.map((suggestion) => (
          <label key={suggestion.targetVariantId} className="capability-card">
            <input
              type="checkbox"
              checked={suggestion.active}
              disabled={!canManage || busy || !data.enabled}
              onChange={(event) => void change(`/targets/${suggestion.targetVariantId}`, event.target.checked)}
            />
            <span className="switch-control" aria-hidden="true">
              <span />
            </span>
            <span>
              <b>
                {t("knowledge.upsell.offers", { product: suggestion.productName, price: money(suggestion) })}
              </b>
              <small>
                {t("knowledge.upsell.when", {
                  count: suggestion.offeredWith.length,
                  products: suggestion.offeredWith.map((source) => source.name).join(", "),
                })}
                {!suggestion.available && ` ${t("knowledge.upsell.unavailable")}`}
                {!data.enabled && ` ${t("knowledge.upsell.generalOff")}`}
              </small>
            </span>
          </label>
        ))}
        {data.suggestions.length === 0 && <small>{t("knowledge.upsell.empty")}</small>}
      </div>
    </section>
  );
}
