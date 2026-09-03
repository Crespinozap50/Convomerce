import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <section
        className="modal confirm-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="danger-soft" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
