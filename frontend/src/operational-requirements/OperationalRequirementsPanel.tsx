import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  createRequirement,
  listRequirements,
  setRequirementActive,
  setRequirementLocalization,
  setRequirementOptionLocalization,
  setRequirementOptions,
  updateRequirement,
} from "./operational-requirements.api";
import {
  editableLocales,
  OperationalRequirement,
  operationTypes,
  RequirementInput,
  requirementDataTypes,
  sensitivities,
} from "./operational-requirements.types";

const emptyInput = (): RequirementInput => ({
  operationType: "order",
  fulfillmentType: "delivery",
  catalogItemId: null,
  fieldKey: "",
  dataType: "text",
  isRequired: true,
  displayOrder: 20,
  validationRule: {},
  sensitivity: "none",
  retentionDays: null,
  requiresConfirmation: false,
});

function displayLabel(item: OperationalRequirement, language: string) {
  const match =
    item.localizations.find((localization) => localization.locale === language) ??
    item.localizations[0];
  return match?.label || item.fieldKey;
}

export function OperationalRequirementsPanel({ tenant }: { tenant: string }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<OperationalRequirement[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<OperationalRequirement | "new" | null>(
    null,
  );

  async function reload() {
    try {
      setItems(await listRequirements(tenant));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  useEffect(() => {
    setItems(null);
    setSelected(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  async function toggleActive(item: OperationalRequirement) {
    setError("");
    try {
      const updated = await setRequirementActive(tenant, item.id, !item.isActive);
      setItems((rows) =>
        (rows ?? []).map((row) => (row.id === updated.id ? updated : row)),
      );
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  return (
    <section className="panel requirements-panel">
      <div className="panel-head">
        <div>
          <h2>{t("requirements.title")}</h2>
          <p>{t("requirements.description")}</p>
        </div>
        <button
          className="secondary offering-add"
          onClick={() => setSelected("new")}
        >
          <Plus size={16} /> {t("requirements.create")}
        </button>
      </div>
      {error && <div className="notice standalone error">{error}</div>}
      {items === null ? (
        <p className="empty-copy">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="offering-empty">
          <span>
            <b>{t("requirements.emptyTitle")}</b>
            <small>{t("requirements.emptyHelp")}</small>
          </span>
        </div>
      ) : (
        <div className="requirements-list">
          {items.map((item) => (
            <div key={item.id}>
              <span>
                <b>{displayLabel(item, i18n.resolvedLanguage ?? i18n.language)}</b>
                <small>
                  {t(`requirements.operationTypes.${item.operationType}`)} ·{" "}
                  {item.fulfillmentType} ·{" "}
                  {t(`requirements.dataTypes.${item.dataType}`)}
                  {!item.isRequired ? ` · ${t("requirements.optionalBadge")}` : ""}
                </small>
              </span>
              <em className={item.isActive ? "" : "inactive"}>
                {t(item.isActive ? "common.active" : "common.inactive")}
              </em>
              <span className="offering-actions">
                <button
                  className="icon-button"
                  title={t("common.edit")}
                  onClick={() => setSelected(item)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="secondary compact-action"
                  onClick={() => void toggleActive(item)}
                >
                  {t(item.isActive ? "requirements.deactivate" : "requirements.activate")}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <RequirementEditor
          tenant={tenant}
          requirement={selected === "new" ? null : selected}
          onCancel={() => setSelected(null)}
          onSaved={(saved) => {
            setItems((rows) => {
              const existing = rows ?? [];
              return existing.some((row) => row.id === saved.id)
                ? existing.map((row) => (row.id === saved.id ? saved : row))
                : [...existing, saved];
            });
            setSelected(saved);
          }}
        />
      )}
    </section>
  );
}

function RequirementEditor({
  tenant,
  requirement,
  onSaved,
  onCancel,
}: {
  tenant: string;
  requirement: OperationalRequirement | null;
  onSaved: (requirement: OperationalRequirement) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<RequirementInput>(
    requirement
      ? {
          operationType: requirement.operationType,
          fulfillmentType: requirement.fulfillmentType,
          catalogItemId: requirement.catalogItemId,
          fieldKey: requirement.fieldKey,
          dataType: requirement.dataType,
          isRequired: requirement.isRequired,
          displayOrder: requirement.displayOrder,
          validationRule: requirement.validationRule,
          sensitivity: requirement.sensitivity,
          retentionDays: requirement.retentionDays,
          requiresConfirmation: requirement.requiresConfirmation,
        }
      : emptyInput(),
  );
  const [current, setCurrent] = useState(requirement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locale, setLocale] = useState<(typeof editableLocales)[number]>(
    (i18n.resolvedLanguage as (typeof editableLocales)[number]) ?? "es",
  );
  const [label, setLabel] = useState("");
  const [helpText, setHelpText] = useState("");
  const [newOption, setNewOption] = useState("");

  useEffect(() => {
    const existing = current?.localizations.find((item) => item.locale === locale);
    setLabel(existing?.label ?? "");
    setHelpText(existing?.helpText ?? "");
  }, [current, locale]);

  const isBuiltin = requirement !== null && current !== null &&
    (current.fieldKey === "name" || current.fieldKey === "delivery_address");

  async function submitCore(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = current
        ? await updateRequirement(tenant, current.id, {
            fulfillmentType: form.fulfillmentType,
            catalogItemId: form.catalogItemId,
            dataType: form.dataType,
            isRequired: form.isRequired,
            displayOrder: form.displayOrder,
            sensitivity: form.sensitivity,
            retentionDays: form.retentionDays,
            requiresConfirmation: form.requiresConfirmation,
          })
        : await createRequirement(tenant, form);
      setCurrent(saved);
      onSaved(saved);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveLabel() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const saved = await setRequirementLocalization(
        tenant,
        current.id,
        locale,
        label,
        helpText.trim() || null,
      );
      setCurrent(saved);
      onSaved(saved);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addOption() {
    if (!current || !newOption.trim()) return;
    setBusy(true);
    setError("");
    try {
      const nextOptions = [
        ...current.options.map((option) => ({
          value: option.optionValue,
          displayOrder: option.displayOrder,
        })),
        { value: newOption.trim(), displayOrder: current.options.length },
      ];
      const saved = await setRequirementOptions(tenant, current.id, nextOptions);
      setCurrent(saved);
      onSaved(saved);
      setNewOption("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeOption(value: string) {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const nextOptions = current.options
        .filter((option) => option.optionValue !== value)
        .map((option) => ({
          value: option.optionValue,
          displayOrder: option.displayOrder,
        }));
      const saved = await setRequirementOptions(tenant, current.id, nextOptions);
      setCurrent(saved);
      onSaved(saved);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveOptionLabel(optionValue: string, optionLabel: string) {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const saved = await setRequirementOptionLocalization(
        tenant,
        current.id,
        optionValue,
        locale,
        optionLabel,
      );
      setCurrent(saved);
      onSaved(saved);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="requirement-editor">
      <div className="panel-head">
        <h3>
          {current ? t("requirements.editTitle") : t("requirements.newTitle")}
        </h3>
        <button className="icon-button" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>
      {isBuiltin && (
        <p className="field-help">{t("requirements.builtinNotice")}</p>
      )}
      <form onSubmit={submitCore} className="requirement-form">
        <label>
          {t("requirements.operationType")}
          <select
            value={form.operationType}
            disabled={!!current}
            onChange={(e) =>
              setForm({ ...form, operationType: e.target.value as RequirementInput["operationType"] })
            }
          >
            {operationTypes.map((value) => (
              <option key={value} value={value}>
                {t(`requirements.operationTypes.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("requirements.fulfillmentType")}
          <input
            value={form.fulfillmentType}
            onChange={(e) => setForm({ ...form, fulfillmentType: e.target.value })}
            placeholder="delivery / pickup / on_site / *"
          />
        </label>
        <label>
          {t("requirements.fieldKey")}
          <input
            value={form.fieldKey}
            disabled={!!current}
            onChange={(e) => setForm({ ...form, fieldKey: e.target.value })}
            placeholder="vehicle_type"
          />
        </label>
        <label>
          {t("requirements.dataType")}
          <select
            value={form.dataType}
            onChange={(e) =>
              setForm({ ...form, dataType: e.target.value as RequirementInput["dataType"] })
            }
          >
            {requirementDataTypes.map((value) => (
              <option key={value} value={value}>
                {t(`requirements.dataTypes.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("requirements.sensitivity")}
          <select
            value={form.sensitivity}
            onChange={(e) =>
              setForm({ ...form, sensitivity: e.target.value as RequirementInput["sensitivity"] })
            }
          >
            {sensitivities.map((value) => (
              <option key={value} value={value}>
                {t(`requirements.sensitivities.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("requirements.displayOrder")}
          <input
            type="number"
            value={form.displayOrder}
            onChange={(e) =>
              setForm({ ...form, displayOrder: Number(e.target.value) })
            }
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.isRequired}
            onChange={(e) => setForm({ ...form, isRequired: e.target.checked })}
          />
          {t("requirements.isRequired")}
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.requiresConfirmation}
            onChange={(e) =>
              setForm({ ...form, requiresConfirmation: e.target.checked })
            }
          />
          {t("requirements.requiresConfirmation")}
        </label>
        {error && <div className="notice standalone error">{error}</div>}
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>

      {current && (
        <div className="requirement-localization">
          <div className="panel-head">
            <h4>{t("requirements.localizationsTitle")}</h4>
            <div className="locale-tabs">
              {editableLocales.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={value === locale ? "active" : ""}
                  onClick={() => setLocale(value)}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label>
            {t("requirements.label")}
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            {t("requirements.helpText")}
            <input value={helpText} onChange={(e) => setHelpText(e.target.value)} />
          </label>
          <div className="form-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy || !label.trim()}
              onClick={() => void saveLabel()}
            >
              {t("common.save")}
            </button>
          </div>

          {current.dataType === "select" && (
            <div className="requirement-options">
              <h4>{t("requirements.optionsTitle")}</h4>
              {current.options.map((option) => (
                <OptionRow
                  key={option.optionValue}
                  option={option}
                  locale={locale}
                  onRemove={() => void removeOption(option.optionValue)}
                  onSaveLabel={(value) =>
                    void saveOptionLabel(option.optionValue, value)
                  }
                />
              ))}
              <div className="add-option-row">
                <input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder={t("requirements.optionValue")}
                />
                <button
                  className="secondary compact-action"
                  type="button"
                  onClick={() => void addOption()}
                >
                  <Plus size={14} /> {t("requirements.addOption")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionRow({
  option,
  locale,
  onRemove,
  onSaveLabel,
}: {
  option: { optionValue: string; localizations: { locale: string; label: string }[] };
  locale: string;
  onRemove: () => void;
  onSaveLabel: (label: string) => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(
    option.localizations.find((item) => item.locale === locale)?.label ?? "",
  );
  useEffect(() => {
    setLabel(option.localizations.find((item) => item.locale === locale)?.label ?? "");
  }, [option, locale]);
  return (
    <div className="option-row">
      <code>{option.optionValue}</code>
      <input value={label} onChange={(e) => setLabel(e.target.value)} />
      <button
        className="icon-button"
        title={t("common.save")}
        onClick={() => onSaveLabel(label)}
      >
        <Pencil size={14} />
      </button>
      <button className="icon-button danger-soft" title={t("requirements.removeOption")} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
