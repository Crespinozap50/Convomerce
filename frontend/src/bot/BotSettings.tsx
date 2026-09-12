import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, MessageCircle } from "lucide-react";
import { api } from "../api";
import { AiUsageSummary, BotConfig } from "../types";
import { AppSelect } from "../components/AppSelect";

export function BotSettings({
  tenant,
  value,
  onSaved,
}: {
  tenant: string;
  value: BotConfig;
  onSaved: (value: BotConfig) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  useEffect(() => setForm(value), [value]);
  // D-148 (docs/decisions.md): loaded once on open — this is a point-in-time
  // snapshot for orientation ("am I close to the limit right now"), not a
  // live dashboard; the project owner can reopen this panel to refresh it,
  // same as every other read in this settings form.
  useEffect(() => {
    let cancelled = false;
    api<AiUsageSummary>(`/v1/admin/tenants/${tenant}/bot/ai-usage`)
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch(() => {
        // Silent: this is a supplementary read-only summary, not required
        // for the form itself to load and work.
      });
    return () => {
      cancelled = true;
    };
  }, [tenant]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/v1/admin/tenants/${tenant}/bot`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      onSaved(form);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel page-panel bot-settings">
      <div className="panel-head">
        <div>
          <h2>{t("bot.title")}</h2>
          <p>{t("bot.description")}</p>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          <span className="switch-control" aria-hidden="true">
            <span />
          </span>
          <span>
            <b>{form.enabled ? t("bot.enabled") : t("bot.disabled")}</b>
            <small>
              {form.enabled ? t("bot.enabledHelp") : t("bot.disabledHelp")}
            </small>
          </span>
        </label>
      </div>
      <form onSubmit={submit} className="settings-form">
        <div className="settings-section-title">
          <Bot size={18} />
          <span>
            <b>{t("bot.identity")}</b>
            <small>{t("bot.identityHelp")}</small>
          </span>
        </div>
        <label>
          {t("bot.name")}
          <input
            value={form.assistantName}
            onChange={(e) =>
              setForm({ ...form, assistantName: e.target.value })
            }
          />
        </label>
        <label>
          {t("bot.language")}
          <AppSelect
            value={form.locale}
            onChange={(locale) => setForm({ ...form, locale })}
            options={[
              { value: "es", label: "Spanish" },
              { value: "en", label: "English" },
            ]}
          />
        </label>
        <div className="settings-section-title">
          <MessageCircle size={18} />
          <span>
            <b>{t("bot.responses")}</b>
            <small>{t("bot.responsesHelp")}</small>
          </span>
        </div>
        <label>
          {t("bot.welcome")}
          <textarea
            value={form.welcomeMessage}
            onChange={(e) =>
              setForm({ ...form, welcomeMessage: e.target.value })
            }
          />
        </label>
        <label>
          {t("bot.fallback")}
          <textarea
            value={form.fallbackMessage}
            onChange={(e) =>
              setForm({ ...form, fallbackMessage: e.target.value })
            }
          />
        </label>
        <label>
          {t("bot.handoff")}
          <input
            value={form.handoffKeywords.join(", ")}
            onChange={(e) =>
              setForm({
                ...form,
                handoffKeywords: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
          <small>{t("bot.handoffHelp")}</small>
        </label>
        <label>
          {t("bot.conversationTimeout")}
          <input
            type="number"
            min={1}
            max={10080}
            placeholder={t("bot.conversationTimeoutDisabled")}
            value={form.conversationTimeoutMinutes ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                conversationTimeoutMinutes:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          <small>{t("bot.conversationTimeoutHelp")}</small>
        </label>
        <label>
          {t("bot.messageRetention")}
          <input
            type="number"
            min={7}
            max={3650}
            placeholder={t("bot.messageRetentionDisabled")}
            value={form.messageRetentionDays ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                messageRetentionDays:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          <small>{t("bot.messageRetentionHelp")}</small>
        </label>
        <label>
          {t("bot.categoryLabelPrefix")}
          <input
            type="text"
            maxLength={30}
            placeholder={t("bot.categoryLabelPrefixDisabled")}
            value={form.categoryLabelPrefix ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                categoryLabelPrefix:
                  e.target.value === "" ? null : e.target.value,
              })
            }
          />
          <small>{t("bot.categoryLabelPrefixHelp")}</small>
        </label>
        <div className="settings-section-title">
          <Bot size={18} />
          <span>
            <b>{t("bot.aiRewriting")}</b>
            <small>{t("bot.aiRewritingHelp")}</small>
          </span>
        </div>
        {usage && (
          <div className="ai-usage-summary">
            <div className="ai-usage-row">
              <span>
                {t("bot.aiUsageDayLabel")}
                <b>
                  {" "}
                  {usage.day.requestsUsed} / {usage.day.requestsLimit}
                </b>
              </span>
              <div className="ai-usage-bar">
                <div
                  className={
                    usage.day.requestsLimit > 0 &&
                    usage.day.requestsUsed / usage.day.requestsLimit >= 0.9
                      ? "ai-usage-fill ai-usage-fill-danger"
                      : "ai-usage-fill"
                  }
                  style={{
                    width: `${Math.min(100, usage.day.requestsLimit > 0 ? (usage.day.requestsUsed / usage.day.requestsLimit) * 100 : 0)}%`,
                  }}
                />
              </div>
            </div>
            <div className="ai-usage-row">
              <span>
                {t("bot.aiUsageMonthLabel")}
                <b>
                  {" "}
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: usage.costCurrency,
                  }).format(usage.month.costUsedMinor / 100)}{" "}
                  /{" "}
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: usage.costCurrency,
                  }).format(usage.month.costLimitMinor / 100)}
                </b>
              </span>
              <div className="ai-usage-bar">
                <div
                  className={
                    usage.month.costLimitMinor > 0 &&
                    usage.month.costUsedMinor / usage.month.costLimitMinor >=
                      0.9
                      ? "ai-usage-fill ai-usage-fill-danger"
                      : "ai-usage-fill"
                  }
                  style={{
                    width: `${Math.min(100, usage.month.costLimitMinor > 0 ? (usage.month.costUsedMinor / usage.month.costLimitMinor) * 100 : 0)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}
        <label className="switch-row">
          <input
            type="checkbox"
            checked={form.aiResponsePolicy.enabled}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  enabled: e.target.checked,
                },
              })
            }
          />
          <span className="switch-control" aria-hidden="true">
            <span />
          </span>
          <span>
            <b>{t("bot.aiEnabled")}</b>
            <small>{t("bot.aiEnabledHelp")}</small>
          </span>
        </label>
        <label>
          {t("bot.aiRollout")}
          <input
            type="number"
            min="0"
            max="100"
            value={form.aiResponsePolicy.rolloutPercentage}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  rolloutPercentage: Number(e.target.value),
                },
              })
            }
          />
        </label>
        <label>
          {t("bot.aiDailyLimit")}
          <input
            type="number"
            min="0"
            max="100000"
            value={form.aiResponsePolicy.dailyRequestLimit}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  dailyRequestLimit: Number(e.target.value),
                },
              })
            }
          />
        </label>
        <label>
          {t("bot.aiMonthlyBudget", {
            currency: form.aiResponsePolicy.costCurrency,
          })}
          <input
            type="number"
            min="0"
            step="0.01"
            value={(form.aiResponsePolicy.monthlyCostLimitMinor / 100).toFixed(
              2,
            )}
            onChange={(e) =>
              setForm({
                ...form,
                aiResponsePolicy: {
                  ...form.aiResponsePolicy,
                  monthlyCostLimitMinor: Math.round(
                    Number(e.target.value) * 100,
                  ),
                },
              })
            }
          />
        </label>
        {error && <div className="form-alert">{error}</div>}
        <div className="settings-actions">
          <span>{t("bot.saveHint")}</span>
          <button disabled={busy}>
            {busy ? t("common.saving") : t("common.saveChanges")}
          </button>
        </div>
      </form>
    </section>
  );
}
