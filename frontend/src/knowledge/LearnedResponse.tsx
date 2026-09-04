import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { ResponseVariant } from "../types";
import { formatLanguageName } from "./utils";

// Word-level diff (classic LCS) so a reviewer can see at a glance what the
// rewrite actually changed, instead of having to read both full sentences
// side by side to spot the difference.
function diffWords(
  base: string,
  candidate: string,
): {
  base: { text: string; changed: boolean }[];
  candidate: { text: string; changed: boolean }[];
} {
  const a = base.split(/(\s+)/);
  const b = candidate.split(/(\s+)/);
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const baseOut: { text: string; changed: boolean }[] = [];
  const candidateOut: { text: string; changed: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      baseOut.push({ text: a[i], changed: false });
      candidateOut.push({ text: b[j], changed: false });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      baseOut.push({ text: a[i], changed: true });
      i++;
    } else {
      candidateOut.push({ text: b[j], changed: true });
      j++;
    }
  }
  while (i < m) {
    baseOut.push({ text: a[i], changed: true });
    i++;
  }
  while (j < n) {
    candidateOut.push({ text: b[j], changed: true });
    j++;
  }
  return { base: baseOut, candidate: candidateOut };
}

export function LearnedResponse({
  tenant,
  variant,
  canManage,
  onUpdated,
}: {
  tenant: string;
  variant: ResponseVariant;
  canManage: boolean;
  onUpdated: (variant: ResponseVariant) => void;
}) {
  const { t, i18n } = useTranslation();
  const [body, setBody] = useState(variant.variantBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unchanged = body.trim() === variant.deterministicBody.trim();
  const diff = diffWords(variant.deterministicBody, body);
  useEffect(() => setBody(variant.variantBody), [variant.variantBody]);
  async function review(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ variant: ResponseVariant }>(
        `/v1/admin/tenants/${tenant}/knowledge/response-variants/${variant.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action, variantBody: body }),
        },
      );
      onUpdated(result.variant);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="learned-response-card">
      <div className="learned-response-meta">
        <b>
          {t(`knowledge.responseVariantTemplates.${variant.templateKey}`, {
            defaultValue: variant.templateKey,
          })}
        </b>
        <span className={`response-variant-status ${variant.status}`}>
          {t(`knowledge.responseVariantStatuses.${variant.status}`)}
        </span>
      </div>
      {unchanged && (
        <span className="response-variant-unchanged">
          {t("knowledge.responseVariantUnchanged")}
        </span>
      )}
      <small>
        {formatLanguageName(
          variant.locale,
          i18n.resolvedLanguage ?? i18n.language,
        )}{" "}
        · {t("knowledge.responseVariantUses", { count: variant.useCount })}
      </small>
      <div className="learned-response-comparison">
        <label>
          <span>{t("knowledge.responseVariantOriginal")}</span>
          <textarea value={variant.deterministicBody} readOnly />
        </label>
        <label>
          <span>{t("knowledge.responseVariantCandidate")}</span>
          <textarea
            value={body}
            disabled={!canManage || busy}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
      </div>
      {!unchanged && (
        <div className="learned-response-diff">
          <span>{t("knowledge.responseVariantDiff")}</span>
          {diff.candidate.map((word, index) =>
            word.changed ? (
              <mark key={index}>{word.text}</mark>
            ) : (
              <Fragment key={index}>{word.text}</Fragment>
            ),
          )}
        </div>
      )}
      {error && <small className="error-text">{error}</small>}
      {canManage && (
        <div className="learned-response-actions">
          <button
            disabled={busy || !body.trim() || unchanged}
            onClick={() => void review("approve")}
          >
            {t("knowledge.responseVariantApprove")}
          </button>
          <button
            className="danger-soft"
            disabled={busy}
            onClick={() => void review("reject")}
          >
            {t(
              unchanged
                ? "knowledge.responseVariantDiscard"
                : "knowledge.responseVariantReject",
            )}
          </button>
        </div>
      )}
    </article>
  );
}
