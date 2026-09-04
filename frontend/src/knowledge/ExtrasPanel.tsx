import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { AppSelect } from "../components/AppSelect";
import { ConfirmModal } from "../components/ConfirmModal";
import { ModifierGroup } from "./KnowledgeSettings";

export function ExtrasPanel({
  tenant,
  groups,
  canManage,
  onChanged,
  onNotice,
}: {
  tenant: string;
  groups: ModifierGroup[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onNotice: (message: string, type?: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupType, setNewGroupType] = useState<"single" | "multiple">("multiple");
  const [busy, setBusy] = useState(false);
  const [confirmingArchiveGroupId, setConfirmingArchiveGroupId] = useState<
    string | null
  >(null);
  const [optionDrafts, setOptionDrafts] = useState<
    Record<string, { name: string; price: string }>
  >({});
  const draftFor = (groupId: string) =>
    optionDrafts[groupId] ?? { name: "", price: "" };
  async function createGroup(event: FormEvent) {
    event.preventDefault();
    if (!newGroupName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/modifier-groups`, {
        method: "POST",
        body: JSON.stringify({ name: newGroupName.trim(), selectionType: newGroupType }),
      });
      setNewGroupName("");
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function archiveGroup(groupId: string) {
    try {
      await api(`/v1/admin/tenants/${tenant}/modifier-groups/${groupId}`, {
        method: "DELETE",
      });
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  async function addOption(groupId: string, event: FormEvent) {
    event.preventDefault();
    const draft = draftFor(groupId);
    if (!draft.name.trim()) return;
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/modifier-groups/${groupId}/options`, {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          priceMinor: Math.round(Number(draft.price || "0") * 100),
          currency: "COP",
        }),
      });
      setOptionDrafts((drafts) => ({ ...drafts, [groupId]: { name: "", price: "" } }));
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  async function archiveOption(groupId: string, optionId: string) {
    try {
      await api(
        `/v1/admin/tenants/${tenant}/modifier-groups/${groupId}/options/${optionId}`,
        { method: "DELETE" },
      );
      await onChanged();
    } catch (x) {
      const message = (x as Error).message;
      setError(message);
      onNotice(message, "error");
    }
  }
  return (
    <>
      <div className="panel-head">
        <div>
          <h2>{t("knowledge.extrasTitle")}</h2>
          <p>{t("knowledge.extrasHelp")}</p>
        </div>
      </div>
      {error && <div className="form-alert">{error}</div>}
      {canManage && (
        <form className="extras-new-group" onSubmit={createGroup}>
          <input
            placeholder={t("knowledge.extrasGroupNamePlaceholder")}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <AppSelect
            value={newGroupType}
            onChange={setNewGroupType}
            options={[
              { value: "multiple", label: t("knowledge.extrasSelectionMultiple") },
              { value: "single", label: t("knowledge.extrasSelectionSingle") },
            ]}
          />
          <button disabled={busy}>{t("knowledge.extrasGroupCreate")}</button>
        </form>
      )}
      <div className="extras-groups">
        {groups.map((group) => (
          <div key={group.id} className="extras-group">
            <div className="extras-group-head">
              <span>
                <b>{group.name}</b>
                <small>
                  {t(
                    group.selectionType === "single"
                      ? "knowledge.extrasSelectionSingle"
                      : "knowledge.extrasSelectionMultiple",
                  )}
                </small>
              </span>
              {canManage && (
                <button
                  type="button"
                  className="icon-button danger-soft"
                  title={t("knowledge.extrasGroupArchive")}
                  onClick={() => setConfirmingArchiveGroupId(group.id)}
                >
                  ×
                </button>
              )}
            </div>
            <div className="extras-options">
              {group.options.map((option) => (
                <div key={option.id} className="extras-option">
                  <span>
                    {option.name}
                    {option.priceMinor > 0 && (
                      <small>
                        {" "}
                        +
                        {new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: option.currency,
                          maximumFractionDigits: 0,
                        }).format(option.priceMinor / 100)}
                      </small>
                    )}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      className="icon-button danger-soft"
                      title={t("knowledge.extrasOptionArchive")}
                      onClick={() => void archiveOption(group.id, option.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!group.options.length && (
                <small>{t("knowledge.extrasOptionsEmpty")}</small>
              )}
            </div>
            {canManage && (
              <form
                className="extras-new-option"
                onSubmit={(e) => void addOption(group.id, e)}
              >
                <input
                  placeholder={t("knowledge.extrasOptionNamePlaceholder")}
                  value={draftFor(group.id).name}
                  onChange={(e) =>
                    setOptionDrafts((drafts) => ({
                      ...drafts,
                      [group.id]: { ...draftFor(group.id), name: e.target.value },
                    }))
                  }
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("knowledge.extrasOptionPricePlaceholder")}
                  value={draftFor(group.id).price}
                  onChange={(e) =>
                    setOptionDrafts((drafts) => ({
                      ...drafts,
                      [group.id]: { ...draftFor(group.id), price: e.target.value },
                    }))
                  }
                />
                <button>{t("knowledge.extrasOptionAdd")}</button>
              </form>
            )}
          </div>
        ))}
        {!groups.length && <small>{t("knowledge.extrasGroupsEmpty")}</small>}
      </div>
      {confirmingArchiveGroupId && (
        <ConfirmModal
          message={t("knowledge.extrasGroupArchiveConfirm")}
          confirmLabel={t("knowledge.extrasGroupArchive")}
          onCancel={() => setConfirmingArchiveGroupId(null)}
          onConfirm={() => {
            void archiveGroup(confirmingArchiveGroupId);
            setConfirmingArchiveGroupId(null);
          }}
        />
      )}
    </>
  );
}
