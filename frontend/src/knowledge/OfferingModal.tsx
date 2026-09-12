import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Offering } from "../types";
import { AppSelect } from "../components/AppSelect";
import { ConfirmModal } from "../components/ConfirmModal";
import { FieldHelp } from "../components/FieldHelp";
import { ModifierGroup } from "./KnowledgeSettings";

type OfferingVariant = Offering["variants"][number];

export function OfferingModal({
  tenant,
  offering,
  modifierGroups,
  onNotice,
  onClose,
  onSaved,
  onVariantsChanged,
}: {
  tenant: string;
  offering: Offering | null;
  modifierGroups: ModifierGroup[];
  onNotice: (message: string, type?: "success" | "error") => void;
  onClose: () => void;
  onSaved: (offering: Offering) => void;
  onVariantsChanged: (offering: Offering) => void;
}) {
  const { t } = useTranslation();
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
  });
  // Only used when creating a brand-new offering: a product is never left
  // with zero variants, so the first one is submitted together with the
  // offering fields in the same POST. Once the offering exists, additional
  // variants are added through the row-level section below instead.
  const [newOfferingVariant, setNewOfferingVariant] = useState({
    name: t("knowledge.defaultVariant"),
    sku: "",
    price: "",
    currency: "COP",
    availabilityStatus: "available" as "available" | "unavailable",
  });
  const [translation, setTranslation] = useState({
    name: offering?.translations?.en.name ?? "",
    description: offering?.translations?.en.description ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = offering
        ? { ...form, durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null }
        : {
            ...form,
            durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
            variant: {
              name: newOfferingVariant.name,
              sku: newOfferingVariant.sku || null,
              priceMinor: Math.round(Number(newOfferingVariant.price) * 100),
              currency: newOfferingVariant.currency,
              status: "active",
              availabilityStatus: newOfferingVariant.availabilityStatus,
            },
          };
      const result = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings${offering ? `/${offering.id}` : ""}`,
        { method: offering ? "PATCH" : "POST", body: JSON.stringify(body) },
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
          {!offering && (
            <>
              <div className="modal-two">
                <label>
                  {t("knowledge.variantName")}
                  <input
                    required
                    value={newOfferingVariant.name}
                    onChange={(e) =>
                      setNewOfferingVariant({ ...newOfferingVariant, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  SKU
                  <input
                    value={newOfferingVariant.sku}
                    onChange={(e) =>
                      setNewOfferingVariant({ ...newOfferingVariant, sku: e.target.value })
                    }
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
                    value={newOfferingVariant.price}
                    onChange={(e) =>
                      setNewOfferingVariant({ ...newOfferingVariant, price: e.target.value })
                    }
                  />
                </label>
                <label>
                  {t("knowledge.currency")}
                  <input
                    required
                    maxLength={3}
                    value={newOfferingVariant.currency}
                    onChange={(e) =>
                      setNewOfferingVariant({
                        ...newOfferingVariant,
                        currency: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
              </div>
            </>
          )}
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
            {!offering && (
              <label>
                {t("knowledge.availability")}
                <AppSelect
                  value={newOfferingVariant.availabilityStatus}
                  onChange={(availabilityStatus) =>
                    setNewOfferingVariant({ ...newOfferingVariant, availabilityStatus })
                  }
                  options={(["available", "unavailable"] as const).map(
                    (value) => ({
                      value,
                      label: t(`common.${value}`, { defaultValue: value }),
                    }),
                  )}
                />
              </label>
            )}
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
        {offering && (
          <VariantsSection
            tenant={tenant}
            offering={offering}
            onNotice={onNotice}
            onChanged={onVariantsChanged}
          />
        )}
      </section>
    </div>,
    document.body,
  );
}

// Mirrors ExtrasPanel.tsx's design: every row action (add/save/archive) is
// an immediate, independent API call followed by a refresh — never a single
// "Save" button that has to diff a whole list of changes.
function VariantsSection({
  tenant,
  offering,
  onNotice,
  onChanged,
}: {
  tenant: string;
  offering: Offering;
  onNotice: (message: string, type?: "success" | "error") => void;
  onChanged: (offering: Offering) => void;
}) {
  const { t } = useTranslation();
  const [variants, setVariants] = useState(
    offering.variants.filter((v) => v.status !== "archived"),
  );
  const [rowDrafts, setRowDrafts] = useState<
    Record<string, { name: string; sku: string; price: string; currency: string; status: "active" | "inactive"; availabilityStatus: "available" | "unavailable" }>
  >({});
  const [translationDrafts, setTranslationDrafts] = useState<Record<string, string>>({});
  const [newVariant, setNewVariant] = useState({ name: "", sku: "", price: "", currency: "COP" });
  const [confirmingArchiveId, setConfirmingArchiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const activeCount = variants.filter((v) => v.status === "active").length;

  function applyRefreshed(refreshed: Offering) {
    setVariants(refreshed.variants.filter((v) => v.status !== "archived"));
    onChanged(refreshed);
  }
  function draftFor(variant: OfferingVariant) {
    return (
      rowDrafts[variant.id] ?? {
        name: variant.name,
        sku: variant.sku ?? "",
        price: (variant.priceMinor / 100).toString(),
        currency: variant.currency,
        status: (variant.status === "inactive" ? "inactive" : "active") as "active" | "inactive",
        availabilityStatus: (variant.availabilityStatus === "unavailable"
          ? "unavailable"
          : "available") as "available" | "unavailable",
      }
    );
  }
  function setDraft(variantId: string, draft: ReturnType<typeof draftFor>) {
    setRowDrafts((drafts) => ({ ...drafts, [variantId]: draft }));
  }

  async function saveVariant(variant: OfferingVariant, event: FormEvent) {
    event.preventDefault();
    const draft = draftFor(variant);
    setError("");
    try {
      const result = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings/${offering.id}/variants/${variant.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: draft.name,
            sku: draft.sku || null,
            priceMinor: Math.round(Number(draft.price) * 100),
            currency: draft.currency,
            status: draft.status,
            availabilityStatus: draft.availabilityStatus,
          }),
        },
      );
      setRowDrafts((drafts) => {
        const next = { ...drafts };
        delete next[variant.id];
        return next;
      });
      applyRefreshed(result.offering);
      onNotice(t("knowledge.variantSaved"));
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  async function addVariant(event: FormEvent) {
    event.preventDefault();
    if (!newVariant.name.trim()) return;
    setError("");
    try {
      const result = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings/${offering.id}/variants`,
        {
          method: "POST",
          body: JSON.stringify({
            name: newVariant.name.trim(),
            sku: newVariant.sku.trim() || null,
            priceMinor: Math.round(Number(newVariant.price || "0") * 100),
            currency: newVariant.currency,
            status: "active",
            availabilityStatus: "available",
          }),
        },
      );
      setNewVariant({ name: "", sku: "", price: "", currency: newVariant.currency });
      applyRefreshed(result.offering);
      onNotice(t("knowledge.variantSaved"));
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  async function archiveVariant(variantId: string) {
    try {
      const result = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings/${offering.id}/variants/${variantId}`,
        { method: "DELETE" },
      );
      applyRefreshed(result.offering);
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  async function saveTranslation(variant: OfferingVariant) {
    const name = translationDrafts[variant.id] ?? variant.translations.en.name;
    setError("");
    try {
      const result = await api<{ offering: Offering }>(
        `/v1/admin/tenants/${tenant}/knowledge/offerings/${offering.id}/variants/${variant.id}/localizations/en`,
        { method: "PUT", body: JSON.stringify({ name }) },
      );
      applyRefreshed(result.offering);
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }

  return (
    <div className="variants-section">
      <h3>{t("knowledge.variantsSectionTitle")}</h3>
      <p>{t("knowledge.variantsSectionHelp")}</p>
      {error && <div className="form-alert">{error}</div>}
      <div className="variants-list">
        {variants.map((variant) => {
          const draft = draftFor(variant);
          const isLastActive = variant.status === "active" && activeCount <= 1;
          return (
            <form
              key={variant.id}
              className="variant-row"
              onSubmit={(e) => void saveVariant(variant, e)}
            >
              <div className="modal-two">
                <input
                  required
                  placeholder={t("knowledge.variantName")}
                  value={draft.name}
                  onChange={(e) => setDraft(variant.id, { ...draft, name: e.target.value })}
                />
                <input
                  placeholder="SKU"
                  value={draft.sku}
                  onChange={(e) => setDraft(variant.id, { ...draft, sku: e.target.value })}
                />
              </div>
              <div className="modal-two">
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  placeholder={t("knowledge.price")}
                  value={draft.price}
                  onChange={(e) => setDraft(variant.id, { ...draft, price: e.target.value })}
                />
                <input
                  required
                  maxLength={3}
                  placeholder={t("knowledge.currency")}
                  value={draft.currency}
                  onChange={(e) =>
                    setDraft(variant.id, { ...draft, currency: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div className="modal-two">
                <AppSelect
                  value={draft.status}
                  onChange={(status) => setDraft(variant.id, { ...draft, status })}
                  options={(["active", "inactive"] as const).map((value) => ({
                    value,
                    label: t(`common.${value}`),
                  }))}
                />
                <AppSelect
                  value={draft.availabilityStatus}
                  onChange={(availabilityStatus) =>
                    setDraft(variant.id, { ...draft, availabilityStatus })
                  }
                  options={(["available", "unavailable"] as const).map((value) => ({
                    value,
                    label: t(`common.${value}`, { defaultValue: value }),
                  }))}
                />
              </div>
              <details className="translation-fields">
                <summary>{t("knowledge.variantTranslateName")}</summary>
                <input
                  value={translationDrafts[variant.id] ?? variant.translations.en.name}
                  onChange={(e) =>
                    setTranslationDrafts((drafts) => ({ ...drafts, [variant.id]: e.target.value }))
                  }
                />
                <button type="button" onClick={() => void saveTranslation(variant)}>
                  {t("common.saveChanges")}
                </button>
              </details>
              <div className="variant-row-actions">
                <button>{t("common.saveChanges")}</button>
                <button
                  type="button"
                  className="icon-button danger-soft"
                  title={t("knowledge.variantRemove")}
                  disabled={isLastActive}
                  onClick={() => setConfirmingArchiveId(variant.id)}
                >
                  ×
                </button>
              </div>
              {isLastActive && <FieldHelp>{t("knowledge.variantLastActiveHelp")}</FieldHelp>}
            </form>
          );
        })}
      </div>
      <form className="variant-row variant-row-new" onSubmit={addVariant}>
        <input
          placeholder={t("knowledge.variantAddNamePlaceholder")}
          value={newVariant.name}
          onChange={(e) => setNewVariant({ ...newVariant, name: e.target.value })}
        />
        <input
          placeholder="SKU"
          value={newVariant.sku}
          onChange={(e) => setNewVariant({ ...newVariant, sku: e.target.value })}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder={t("knowledge.price")}
          value={newVariant.price}
          onChange={(e) => setNewVariant({ ...newVariant, price: e.target.value })}
        />
        <input
          maxLength={3}
          placeholder={t("knowledge.currency")}
          value={newVariant.currency}
          onChange={(e) => setNewVariant({ ...newVariant, currency: e.target.value.toUpperCase() })}
        />
        <button>{t("knowledge.variantAdd")}</button>
      </form>
      {confirmingArchiveId && (
        <ConfirmModal
          message={t("knowledge.variantRemoveConfirm")}
          confirmLabel={t("knowledge.variantRemove")}
          onCancel={() => setConfirmingArchiveId(null)}
          onConfirm={() => {
            void archiveVariant(confirmingArchiveId);
            setConfirmingArchiveId(null);
          }}
        />
      )}
    </div>
  );
}
