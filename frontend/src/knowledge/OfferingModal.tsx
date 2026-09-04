import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Offering } from "../types";
import { AppSelect } from "../components/AppSelect";
import { FieldHelp } from "../components/FieldHelp";
import { ModifierGroup } from "./KnowledgeSettings";

export function OfferingModal({
  tenant,
  offering,
  modifierGroups,
  onNotice,
  onClose,
  onSaved,
}: {
  tenant: string;
  offering: Offering | null;
  modifierGroups: ModifierGroup[];
  onNotice: (message: string, type?: "success" | "error") => void;
  onClose: () => void;
  onSaved: (offering: Offering) => void;
}) {
  const { t } = useTranslation();
  const variant =
    offering?.variants.find((item) => item.status !== "archived") ??
    offering?.variants[0];
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    offering
      ? modifierGroups
          .filter((group) => group.assignedItemIds.includes(offering.id))
          .map((group) => group.id)
      : [],
  );
  const [form, setForm] = useState({
    name: offering?.name ?? "",
    description: offering?.description ?? "",
    category: offering?.category ?? "",
    offeringType: (offering?.offeringType ?? "product") as
      "product" | "service" | "prepared_product" | "appointment" | "package",
    status: (offering?.status === "inactive" ? "inactive" : "active") as
      "active" | "inactive",
    durationMinutes: offering?.durationMinutes?.toString() ?? "",
    bookingRequired: offering?.bookingRequired ?? false,
    variantName: variant?.name ?? t("knowledge.defaultVariant"),
    sku: variant?.sku ?? "",
    price: variant ? (variant.priceMinor / 100).toString() : "",
    currency: variant?.currency ?? "COP",
    availabilityStatus: (variant?.availabilityStatus === "unavailable"
      ? "unavailable"
      : "available") as "available" | "unavailable",
  });
  const [translation, setTranslation] = useState({
    name: offering?.translations?.en.name ?? "",
    description: offering?.translations?.en.description ?? "",
    variantName: variant?.translations?.en.name ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings${offering ? `/${offering.id}` : ""}`,
        {
          method: offering ? "PATCH" : "POST",
          body: JSON.stringify({
            ...form,
            priceMinor: Math.round(Number(form.price) * 100),
            durationMinutes: form.durationMinutes
              ? Number(form.durationMinutes)
              : null,
          }),
        },
      );
      await api(
        `/v1/admin/tenants/${tenant}/modifier-groups/items/${result.offering.id}`,
        { method: "PUT", body: JSON.stringify({ groupIds: selectedGroupIds }) },
      );
      const localized = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings/${result.offering.id}/localizations/en`,
        { method: "PUT", body: JSON.stringify(translation) },
      );
      onSaved(localized.offering);
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="modal-backdrop">
      <section className="modal offering-modal">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <h2>
          {t(offering ? "knowledge.offeringEdit" : "knowledge.offeringCreate")}
        </h2>
        <p>{t("knowledge.offeringFormHelp")}</p>
        <form onSubmit={submit}>
          <label>
            {t("knowledge.offeringName")}
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {t("knowledge.offeringDescription")}
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <details className="translation-fields">
            <summary>{t("knowledge.englishTranslation")}</summary>
            <input
              value={translation.name}
              onChange={(e) => setTranslation({ ...translation, name: e.target.value })}
              placeholder={t("knowledge.offeringName")}
            />
            <textarea
              value={translation.description}
              onChange={(e) => setTranslation({ ...translation, description: e.target.value })}
              placeholder={t("knowledge.offeringDescription")}
            />
            <input
              value={translation.variantName}
              onChange={(e) => setTranslation({ ...translation, variantName: e.target.value })}
              placeholder={t("knowledge.variantName")}
            />
            <FieldHelp>{t("knowledge.translationHelp")}</FieldHelp>
          </details>
          <div className="modal-two">
            <label>
              {t("knowledge.offeringCategory")}
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </label>
            <label>
              {t("knowledge.offeringType")}
              <AppSelect
                value={form.offeringType}
                onChange={(offeringType) => setForm({ ...form, offeringType })}
                options={(
                  [
                    "product",
                    "service",
                    "prepared_product",
                    "appointment",
                    "package",
                  ] as const
                ).map((value) => ({
                  value,
                  label: t(`knowledge.offeringTypes.${value}`),
                }))}
              />
            </label>
          </div>
          <div className="modal-two">
            <label>
              {t("knowledge.variantName")}
              <input
                required
                value={form.variantName}
                onChange={(e) =>
                  setForm({ ...form, variantName: e.target.value })
                }
              />
            </label>
            <label>
              SKU
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </label>
          </div>
          <div className="modal-two">
            <label>
              {t("knowledge.price")}
              <input
                required
                min="0"
                step="0.01"
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </label>
            <label>
              {t("knowledge.currency")}
              <input
                required
                maxLength={3}
                value={form.currency}
                onChange={(e) =>
                  setForm({ ...form, currency: e.target.value.toUpperCase() })
                }
              />
            </label>
          </div>
          <div className="modal-two">
            <label>
              {t("knowledge.status")}
              <AppSelect
                value={form.status}
                onChange={(status) => setForm({ ...form, status })}
                options={(["active", "inactive"] as const).map((value) => ({
                  value,
                  label: t(`common.${value}`),
                }))}
              />
            </label>
            <label>
              {t("knowledge.availability")}
              <AppSelect
                value={form.availabilityStatus}
                onChange={(availabilityStatus) =>
                  setForm({ ...form, availabilityStatus })
                }
                options={(["available", "unavailable"] as const).map(
                  (value) => ({
                    value,
                    label: t(`common.${value}`, { defaultValue: value }),
                  }),
                )}
              />
            </label>
          </div>
          {(form.offeringType === "service" ||
            form.offeringType === "appointment") && (
            <div className="modal-two">
              <label>
                {t("knowledge.durationMinutes")}
                <input
                  min="1"
                  type="number"
                  value={form.durationMinutes}
                  onChange={(e) =>
                    setForm({ ...form, durationMinutes: e.target.value })
                  }
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.bookingRequired}
                  onChange={(e) =>
                    setForm({ ...form, bookingRequired: e.target.checked })
                  }
                />
                {t("knowledge.bookingRequired")}
              </label>
            </div>
          )}
          {modifierGroups.length > 0 && (
            <label>
              {t("knowledge.extrasAssign")}
              <div className="checkbox-list">
                {modifierGroups.map((group) => (
                  <label key={group.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(group.id)}
                      onChange={(e) =>
                        setSelectedGroupIds((ids) =>
                          e.target.checked
                            ? [...ids, group.id]
                            : ids.filter((id) => id !== group.id),
                        )
                      }
                    />
                    {group.name}
                  </label>
                ))}
              </div>
            </label>
          )}
          {error && <div className="form-alert">{error}</div>}
          <button disabled={busy}>
            {busy ? t("common.saving") : t("common.saveChanges")}
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}
