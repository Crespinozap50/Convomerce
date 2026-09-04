import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, CalendarDays, PackageSearch, Pencil, Plus } from "lucide-react";
import { api } from "../api";
import {
  BusinessProfile,
  CapabilityName,
  ExternalSource,
  KnowledgePayload,
  Offering,
} from "../types";
import { KnowledgeSection } from "../dashboard/routing";
import { FieldHelp } from "../components/FieldHelp";
import { ConfirmModal } from "../components/ConfirmModal";
import { ExtrasPanel } from "./ExtrasPanel";
import { OfferingModal } from "./OfferingModal";
import { LearnedResponsesPanel } from "./LearnedResponsesPanel";
import { LearningQuestion } from "./LearningQuestion";
import { PublishedAnswer } from "./PublishedAnswer";

export type ModifierGroup = {
  id: string;
  name: string;
  selectionType: "single" | "multiple";
  status: string;
  options: {
    id: string;
    name: string;
    priceMinor: number;
    currency: string;
    status: string;
  }[];
  assignedItemIds: string[];
};

function BusinessHoursEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const lines = value.split("\n");
  const update = (index: number, next: string) =>
    onChange(
      lines
        .map((line, current) => (current === index ? next : line))
        .join("\n"),
    );
  const remove = (index: number) =>
    onChange(lines.filter((_, current) => current !== index).join("\n"));
  return (
    <fieldset className="business-hours-editor">
      <legend>{t("knowledge.hours")}</legend>
      <FieldHelp>{t("knowledge.hoursHelp")}</FieldHelp>
      <div className="business-hours-list">
        {lines.map((line, index) => (
          <div className="business-hours-row" key={index}>
            <CalendarDays size={18} />
            <input
              aria-label={t("knowledge.hoursRow", { number: index + 1 })}
              placeholder={t("knowledge.hoursPlaceholder")}
              value={line}
              onChange={(event) => update(index, event.target.value)}
            />
            {(lines.length > 1 || line) && (
              <button
                type="button"
                className="icon-button danger-soft"
                aria-label={t("knowledge.removeHoursRow")}
                onClick={() => remove(index)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary compact-action"
        onClick={() => onChange(value ? `${value}\n` : "")}
      >
        <Plus size={15} />
        {t("knowledge.addHoursRow")}
      </button>
    </fieldset>
  );
}

export function KnowledgeSettings({
  tenant,
  value,
  section,
  onNotice,
  onSaved,
}: {
  tenant: string;
  value: KnowledgePayload;
  section: KnowledgeSection;
  onNotice: (message: string, type?: "success" | "error") => void;
  onSaved: (profile: BusinessProfile) => void;
}) {
  const { t } = useTranslation();
  const normalizeHours = (hours: string) =>
    hours
      .split(/;|\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  const [form, setForm] = useState({
    ...value.profile,
    businessHours: normalizeHours(value.profile.businessHours),
  });
  const [translationForm, setTranslationForm] = useState({
    address: value.profile.translations?.en.address ?? "",
    businessHours: value.profile.translations?.en.businessHours ?? "",
    paymentMethods: value.profile.translations?.en.paymentMethods ?? "",
    fulfillmentOptions: value.profile.translations?.en.fulfillmentOptions ?? "",
  });
  const [capabilities, setCapabilities] = useState<CapabilityName[]>(
    value.capabilities,
  );
  const [busy, setBusy] = useState(false);
  const [capBusy, setCapBusy] = useState(false);
  const [error, setError] = useState("");
  const [capMessage, setCapMessage] = useState("");
  const [unresolved, setUnresolved] = useState(value.unresolvedQuestions);
  const [entries, setEntries] = useState(value.entries);
  const [products, setProducts] = useState(value.products);
  const [responseVariants, setResponseVariants] = useState(
    value.responseVariants,
  );
  const [editingOffering, setEditingOffering] = useState<
    Offering | null | "new"
  >(null);
  const [confirmingArchiveOffering, setConfirmingArchiveOffering] =
    useState<Offering | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierGroupsCanManage, setModifierGroupsCanManage] = useState(false);
  const loadModifierGroups = async () => {
    const result = await api<{
      groups: ModifierGroup[];
      items: { id: string; name: string }[];
    }>(`/v1/admin/tenants/${tenant}/modifier-groups`);
    setModifierGroups(result.groups);
  };
  useEffect(() => {
    setModifierGroupsCanManage(value.canManage);
    void loadModifierGroups().catch(() => undefined);
    // tenant-scoped fetch, intentionally not re-run when `value` changes
    // (only the parent tenant switch should refetch this list)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  useEffect(
    () =>
      setForm({
        ...value.profile,
        businessHours: normalizeHours(value.profile.businessHours),
      }),
    [value.profile],
  );
  useEffect(() => setCapabilities(value.capabilities), [value.capabilities]);
  useEffect(
    () => setUnresolved(value.unresolvedQuestions),
    [value.unresolvedQuestions],
  );
  useEffect(() => setEntries(value.entries), [value.entries]);
  useEffect(() => setProducts(value.products), [value.products]);
  useEffect(
    () => setResponseVariants(value.responseVariants),
    [value.responseVariants],
  );
  async function archiveOffering(offering: Offering) {
    try {
      await api(
        `/v1/admin/tenants/${tenant}/knowledge/offerings/${offering.id}`,
        { method: "DELETE" },
      );
      setProducts((rows) => rows.filter((row) => row.id !== offering.id));
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/knowledge/profile`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      await api(`/v1/admin/tenants/${tenant}/knowledge/profile/localizations/en`, {
        method: "PUT",
        body: JSON.stringify(translationForm),
      });
      onSaved({ ...form, translations: { en: translationForm } });
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveCapabilities() {
    setCapBusy(true);
    setCapMessage("");
    try {
      await api(`/v1/admin/tenants/${tenant}/knowledge/capabilities`, {
        method: "PUT",
        body: JSON.stringify({ capabilities }),
      });
      setCapMessage(t("knowledge.capabilitiesSaved"));
    } catch (x) {
      setCapMessage((x as Error).message);
    } finally {
      setCapBusy(false);
    }
  }
  const capabilityOptions: CapabilityName[] = [
    "commercial_offerings",
    "inventory",
    "orders",
    "appointments",
    "delivery",
  ];
  const commerceProviders = [
    { id: "shopify", name: "Shopify" },
    { id: "magento", name: "Magento / Adobe Commerce" },
    { id: "custom_api", name: t("knowledge.otherApi") },
  ];
  const calendarProviders = [
    { id: "google_calendar", name: "Google Calendar" },
    { id: "microsoft_outlook", name: "Microsoft Outlook" },
    { id: "calendly", name: "Calendly" },
    { id: "custom_api", name: t("knowledge.otherCalendar") },
  ];
  const sourceRows = (
    providers: { id: string; name: string }[],
    sources: ExternalSource[],
  ) =>
    providers.map((provider) => {
      const source = sources.find((item) => item.provider === provider.id);
      return (
        <div key={provider.id}>
          <span>
            <b>{provider.name}</b>
            <small>{source?.displayName ?? t("knowledge.adapterReady")}</small>
          </span>
          <em className={source?.status ?? "planned"}>
            {source
              ? t(`common.${source.status}`, { defaultValue: source.status })
              : t("knowledge.planned")}
          </em>
        </div>
      );
    });
  return (
    <>
      <section
        id="knowledge-profile"
        className="panel page-panel capability-panel knowledge-anchor"
        hidden={section !== "profile"}
      >
        <div className="panel-head">
          <div>
            <h2>{t("knowledge.capabilitiesTitle")}</h2>
            <p>{t("knowledge.capabilitiesHelp")}</p>
          </div>
        </div>
        <div className="capability-grid">
          {capabilityOptions.map((capability) => (
            <label key={capability} className="capability-card">
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={(event) =>
                  setCapabilities(
                    event.target.checked
                      ? [...capabilities, capability]
                      : capabilities.filter((item) => item !== capability),
                  )
                }
              />
              <span className="switch-control" aria-hidden="true">
                <span />
              </span>
              <span>
                <b>{t(`knowledge.capabilities.${capability}.title`)}</b>
                <small>{t(`knowledge.capabilities.${capability}.help`)}</small>
              </span>
            </label>
          ))}
        </div>
        {value.canManage && (
          <div className="capability-actions">
            <small>{capMessage}</small>
            <button onClick={() => void saveCapabilities()} disabled={capBusy}>
              {capBusy ? t("common.saving") : t("common.saveChanges")}
            </button>
          </div>
        )}
      </section>
      <div className="knowledge-layout">
        <section
          className="panel knowledge-profile"
          hidden={section !== "profile"}
        >
          <div className="panel-head">
            <div>
              <h2>{t("knowledge.profileTitle")}</h2>
              <p>{t("knowledge.profileHelp")}</p>
            </div>
          </div>
          <form className="knowledge-form" onSubmit={submit}>
            <label>
              {t("knowledge.description")}
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <div className="knowledge-two">
              <label>
                {t("knowledge.address")}
                <input
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.phone")}
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
            </div>
            <BusinessHoursEditor
              value={form.businessHours}
              onChange={(businessHours) => setForm({ ...form, businessHours })}
            />
            <div className="knowledge-two">
              <label>
                {t("knowledge.payments")}
                <textarea
                  value={form.paymentMethods}
                  onChange={(e) =>
                    setForm({ ...form, paymentMethods: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.fulfillment")}
                <textarea
                  value={form.fulfillmentOptions}
                  onChange={(e) =>
                    setForm({ ...form, fulfillmentOptions: e.target.value })
                  }
                />
              </label>
            </div>
            <details className="translation-fields">
              <summary>{t("knowledge.englishTranslation")}</summary>
              <label>
                {t("knowledge.address")}
                <input
                  value={translationForm.address}
                  onChange={(e) =>
                    setTranslationForm({ ...translationForm, address: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.hours")}
                <textarea
                  value={translationForm.businessHours}
                  onChange={(e) =>
                    setTranslationForm({ ...translationForm, businessHours: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.payments")}
                <textarea
                  value={translationForm.paymentMethods}
                  onChange={(e) =>
                    setTranslationForm({ ...translationForm, paymentMethods: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.fulfillment")}
                <textarea
                  value={translationForm.fulfillmentOptions}
                  onChange={(e) =>
                    setTranslationForm({ ...translationForm, fulfillmentOptions: e.target.value })
                  }
                />
              </label>
              <FieldHelp>{t("knowledge.translationHelp")}</FieldHelp>
            </details>
            {error && <div className="form-alert">{error}</div>}
            <div className="knowledge-save">
              <small>{t("knowledge.aiHelp")}</small>
              {value.canManage && (
                <button disabled={busy}>
                  {busy ? t("common.saving") : t("common.saveChanges")}
                </button>
              )}
            </div>
          </form>
        </section>
        <div className="knowledge-side route-view">
          <section
            id="knowledge-catalog"
            className="panel knowledge-anchor"
            hidden={section !== "catalog"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.catalogTitle")}</h2>
                <p>{t("knowledge.catalogHelp")}</p>
              </div>
              {value.canManage ? (
                <button
                  className="secondary offering-add"
                  onClick={() => setEditingOffering("new")}
                >
                  <Plus size={16} /> {t("knowledge.offeringCreate")}
                </button>
              ) : (
                <PackageSearch />
              )}
            </div>
            <div className="knowledge-products">
              {products.map((p) => {
                const variant =
                  p.variants.find((item) => item.status !== "archived") ??
                  p.variants[0];
                const price = variant
                  ? new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: variant.currency,
                      maximumFractionDigits: 0,
                    }).format(variant.priceMinor / 100)
                  : t("knowledge.noPrice");
                return (
                  <div key={p.id}>
                    <span>
                      <b>{p.name}</b>
                      <small>
                        {t(`knowledge.offeringTypes.${p.offeringType}`, {
                          defaultValue: p.offeringType,
                        })}{" "}
                        · {p.category ?? t("knowledge.uncategorized")}
                      </small>
                      <small>
                        {variant?.name} · {price}
                        {p.variants.filter((item) => item.status !== "archived")
                          .length > 1
                          ? ` · ${t("knowledge.additionalVariants", { count: p.variants.filter((item) => item.status !== "archived").length - 1 })}`
                          : ""}
                      </small>
                    </span>
                    <em className={p.status}>
                      {t(`common.${p.status}`, { defaultValue: p.status })}
                    </em>
                    {value.canManage && p.sourceProvider === "manual" && (
                      <span className="offering-actions">
                        <button
                          className="icon-button"
                          title={t("common.edit")}
                          onClick={() => setEditingOffering(p)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button danger-soft"
                          title={t("knowledge.offeringArchive")}
                          onClick={() => setConfirmingArchiveOffering(p)}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
              {!products.length && (
                <div className="offering-empty">
                  <span>
                    <b>{t("knowledge.offeringEmptyTitle")}</b>
                    <small>{t("knowledge.offeringEmptyHelp")}</small>
                  </span>
                </div>
              )}
            </div>
          </section>
          <section
            id="knowledge-extras"
            className="panel knowledge-anchor"
            hidden={section !== "catalog"}
          >
            <ExtrasPanel
              tenant={tenant}
              groups={modifierGroups}
              canManage={modifierGroupsCanManage}
              onChanged={loadModifierGroups}
              onNotice={onNotice}
            />
          </section>
          <section
            id="knowledge-sources"
            className="panel knowledge-anchor"
            hidden={section !== "sources"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.sourcesTitle")}</h2>
                <p>{t("knowledge.sourcesHelp")}</p>
              </div>
            </div>
            <div className="source-list">
              {sourceRows(commerceProviders, value.sources)}
            </div>
          </section>
          {section === "sources" && capabilities.includes("appointments") && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t("knowledge.calendarSourcesTitle")}</h2>
                  <p>{t("knowledge.calendarSourcesHelp")}</p>
                </div>
                <CalendarDays />
              </div>
              <div className="source-list">
                {sourceRows(calendarProviders, value.calendarSources)}
              </div>
            </section>
          )}
          <section
            id="knowledge-responses"
            className="panel learned-responses knowledge-anchor"
            hidden={section !== "responses"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.responseVariantsTitle")}</h2>
                <p>{t("knowledge.responseVariantsHelp")}</p>
              </div>
            </div>
            <LearnedResponsesPanel
              tenant={tenant}
              variants={responseVariants}
              canManage={value.canManage}
              onUpdated={(next) =>
                setResponseVariants((items) =>
                  items.map((item) => (item.id === next.id ? next : item)),
                )
              }
            />
          </section>
          <section
            id="knowledge-learning"
            className="panel learning-inbox knowledge-anchor"
            hidden={section !== "learning"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.learningTitle")}</h2>
                <p>{t("knowledge.learningHelp")}</p>
              </div>
            </div>
            <div className="source-list">
              {unresolved.length === 0 ? (
                <div className="learning-empty">
                  <span className="learning-empty-icon">
                    <BookOpen size={20} />
                  </span>
                  <span>
                    <b>{t("knowledge.learningEmptyTitle")}</b>
                    <small>{t("knowledge.learningEmpty")}</small>
                  </span>
                </div>
              ) : (
                unresolved.map((question) => (
                  <LearningQuestion
                    key={question.id}
                    tenant={tenant}
                    question={question}
                    onReviewed={() =>
                      setUnresolved((items) =>
                        items.filter((item) => item.id !== question.id),
                      )
                    }
                  />
                ))
              )}
            </div>
          </section>
          <section
            id="knowledge-answers"
            className="panel knowledge-faq knowledge-anchor"
            hidden={section !== "answers"}
          >
            <div className="panel-head">
              <div>
                <h2>{t("knowledge.faqTitle")}</h2>
                <p>{t("knowledge.faqHelp")}</p>
              </div>
            </div>
            <div>
              {entries.map((entry) => (
                <PublishedAnswer
                  key={entry.id}
                  tenant={tenant}
                  entry={entry}
                  canManage={value.canManage}
                  onUpdated={(next) =>
                    setEntries((items) =>
                      items.map((item) => (item.id === next.id ? next : item)),
                    )
                  }
                  onArchived={() =>
                    setEntries((items) =>
                      items.filter((item) => item.id !== entry.id),
                    )
                  }
                />
              ))}
            </div>
          </section>
        </div>
      </div>
      {editingOffering && (
        <OfferingModal
          tenant={tenant}
          offering={editingOffering === "new" ? null : editingOffering}
          modifierGroups={modifierGroups}
          onNotice={onNotice}
          onClose={() => setEditingOffering(null)}
          onSaved={(offering) => {
            setProducts((rows) => {
              const exists = rows.some((row) => row.id === offering.id);
              return exists
                ? rows.map((row) => (row.id === offering.id ? offering : row))
                : [...rows, offering].sort((a, b) =>
                    a.name.localeCompare(b.name),
                  );
            });
            void loadModifierGroups();
            onNotice(t("knowledge.offeringSaved"));
            setEditingOffering(null);
          }}
        />
      )}
      {confirmingArchiveOffering && (
        <ConfirmModal
          message={t("knowledge.offeringArchiveConfirm")}
          confirmLabel={t("knowledge.offeringArchive")}
          onCancel={() => setConfirmingArchiveOffering(null)}
          onConfirm={() => {
            void archiveOffering(confirmingArchiveOffering);
            setConfirmingArchiveOffering(null);
          }}
        />
      )}
    </>
  );
}
