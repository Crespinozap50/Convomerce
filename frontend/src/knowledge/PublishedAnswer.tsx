import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { KnowledgePayload } from "../types";
import { FieldHelp } from "../components/FieldHelp";
import { ConfirmModal } from "../components/ConfirmModal";

export function PublishedAnswer({
  tenant,
  entry,
  canManage,
  onUpdated,
  onArchived,
}: {
  tenant: string;
  entry: KnowledgePayload["entries"][number];
  canManage: boolean;
  onUpdated: (entry: KnowledgePayload["entries"][number]) => void;
  onArchived: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [keywords, setKeywords] = useState((entry.keywords ?? []).join(", "));
  const [titleEn, setTitleEn] = useState(entry.translations?.en.title ?? "");
  const [contentEn, setContentEn] = useState(entry.translations?.en.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ entry: KnowledgePayload["entries"][number] }>(
        `/v1/admin/tenants/${tenant}/knowledge/entries/${entry.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title,
            content,
            keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          }),
        },
      );
      const localized = await api<{ entry: KnowledgePayload["entries"][number] }>(
        `/v1/admin/tenants/${tenant}/knowledge/entries/${entry.id}/localizations/en`,
        { method: "PUT", body: JSON.stringify({ title: titleEn, content: contentEn }) },
      );
      onUpdated({ ...result.entry, translations: localized.entry.translations });
      setEditing(false);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/knowledge/entries/${entry.id}`, {
        method: "DELETE",
      });
      onArchived();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <details open={editing}>
        <summary>{entry.title}</summary>
        {editing ? (
        <div className="faq-editor">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <input
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder={t("knowledge.keywordsPlaceholder")}
          />
          <FieldHelp>{t("knowledge.keywordsHelp")}</FieldHelp>
          <details className="translation-fields">
            <summary>{t("knowledge.englishTranslation")}</summary>
            <input
              value={titleEn}
              onChange={(event) => setTitleEn(event.target.value)}
              placeholder={t("knowledge.answerTitle")}
            />
            <textarea
              value={contentEn}
              onChange={(event) => setContentEn(event.target.value)}
              placeholder={t("knowledge.answerContent")}
            />
            <FieldHelp>{t("knowledge.translationHelp")}</FieldHelp>
          </details>
          {error && <small className="error-text">{error}</small>}
          <div className="faq-actions">
            <button
              disabled={busy || !title.trim() || !content.trim()}
              onClick={() => void save()}
            >
              {t("common.saveChanges")}
            </button>
            <button className="text-button" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>{entry.content}</p>
          {entry.keywords?.length > 0 && (
            <FieldHelp>{`${t("knowledge.keywordsLabel")}: ${entry.keywords.join(", ")}`}</FieldHelp>
          )}
          {entry.translations?.en.title && (
            <FieldHelp>{`EN: ${entry.translations.en.title}`}</FieldHelp>
          )}
          {error && <small className="error-text">{error}</small>}
          {canManage && (
            <div className="faq-actions">
              <button className="secondary" onClick={() => setEditing(true)}>
                {t("knowledge.editAnswer")}
              </button>
              <button
                className="danger-soft"
                disabled={busy}
                onClick={() => setConfirmingArchive(true)}
              >
                {t("knowledge.archiveAnswer")}
              </button>
            </div>
          )}
        </>
      )}
      </details>
      {confirmingArchive && (
        <ConfirmModal
          message={t("knowledge.archiveConfirm")}
          confirmLabel={t("knowledge.archiveAnswer")}
          onCancel={() => setConfirmingArchive(false)}
          onConfirm={() => {
            setConfirmingArchive(false);
            void archive();
          }}
        />
      )}
    </>
  );
}
