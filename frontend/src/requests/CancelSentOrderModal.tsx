import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

const MIN_NOTE = 5;
const MAX_NOTE = 300;

export function CancelSentOrderModal({
  reference,
  busy,
  onConfirm,
  onCancel,
}: {
  reference: string;
  busy: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const clean = note.trim();
  const valid = clean.length >= MIN_NOTE && clean.length <= MAX_NOTE;
  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <section
        className="modal confirm-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>{t("requests.cancelSent.title", { reference })}</h3>
        <p>{t("requests.cancelSent.warning")}</p>
        <label className="field">
          <span>{t("requests.cancelSent.noteLabel")}</span>
          <textarea
            rows={3}
            maxLength={MAX_NOTE}
            value={note}
            placeholder={t("requests.cancelSent.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
          />
          <small>{t("requests.cancelSent.noteHelp", { min: MIN_NOTE })}</small>
        </label>
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="danger-soft"
            disabled={!valid || busy}
            onClick={() => onConfirm(clean)}
          >
            {busy ? t("common.saving") : t("requests.cancelSent.confirm")}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
