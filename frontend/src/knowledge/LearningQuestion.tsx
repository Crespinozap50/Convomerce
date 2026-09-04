import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { KnowledgePayload } from "../types";
import { FieldHelp } from "../components/FieldHelp";

export function LearningQuestion({
  tenant,
  question,
  onReviewed,
}: {
  tenant: string;
  question: KnowledgePayload["unresolvedQuestions"][number];
  onReviewed: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(question.question);
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function review(action: "dismiss" | "publish") {
    setBusy(true);
    setError("");
    try {
      await api(
        `/v1/admin/tenants/${tenant}/knowledge/unresolved/${question.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            title,
            content,
            keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          }),
        },
      );
      onReviewed();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="learning-question">
      <span>
        <b>{question.question}</b>
        <small>
          {t("knowledge.learningOccurrences", {
            count: question.occurrenceCount,
          })}{" "}
          · {new Date(question.lastSeenAt).toLocaleDateString()}
        </small>
        {question.contextMessages.length > 0 && (
          <div className="learning-context">
            <small className="learning-context-title">
              {t("knowledge.learningContext")}
            </small>
            {question.contextMessages.map((message, index) => (
              <div
                key={`${message.occurredAt}-${index}`}
                className={`learning-context-message ${message.direction}`}
              >
                <span>
                  {message.direction === "inbound"
                    ? t("knowledge.customer")
                    : t("knowledge.assistant")}
                </span>
                <p>{message.body}</p>
              </div>
            ))}
          </div>
        )}
        {editing && (
          <>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("knowledge.answerTitle")}
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("knowledge.answerContent")}
            />
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("knowledge.keywordsPlaceholder")}
            />
            <FieldHelp>{t("knowledge.keywordsHelp")}</FieldHelp>
            {error && <small className="error-text">{error}</small>}
          </>
        )}
      </span>
      <span className="learning-actions">
        {editing ? (
          <>
            <button
              disabled={busy || !title.trim() || !content.trim()}
              onClick={() => void review("publish")}
            >
              {t("knowledge.publishAnswer")}
            </button>
            <button className="text-button" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)}>
              {t("knowledge.convertAnswer")}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void review("dismiss")}
            >
              {t("knowledge.dismiss")}
            </button>
          </>
        )}
      </span>
    </div>
  );
}
