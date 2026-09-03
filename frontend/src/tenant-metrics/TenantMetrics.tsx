import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { api } from "../api";
import { AppSelect } from "../components/AppSelect";

type TenantOperationalMetrics = {
  messagesTotal: number;
  resolvedRate: number | null;
  conversationsTotal: number;
  humanHandledRate: number | null;
  commercialRequestsTotal: number;
  conversionRate: number | null;
  avgResponseLatencyMs: number | null;
  aiCallsTotal: number;
  aiCostMinor: number;
  aiCurrency: string | null;
  aiAvgLatencyMs: number | null;
};
type TenantOperationalSummary = TenantOperationalMetrics & {
  tenantId: string;
  slug: string;
  displayName: string;
};
type TenantOperationalDay = TenantOperationalMetrics & { day: string };
type TenantMetricSortKey =
  | "resolvedRate"
  | "humanHandledRate"
  | "conversionRate"
  | "avgResponseLatencyMs"
  | "aiCostMinor";
const percentMetric = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
const msMetric = (value: number | null) =>
  value === null ? "—" : `${Math.round(value).toLocaleString()} ms`;
const moneyMetric = (value: number, currency: string | null) =>
  currency
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value / 100)
    : "—";
function MetricBar({
  value,
  tone,
}: {
  value: number | null;
  tone: "positive" | "neutral";
}) {
  if (value === null) return null;
  const width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  const level =
    tone === "neutral"
      ? "neutral"
      : value >= 0.8
        ? "good"
        : value >= 0.5
          ? "fair"
          : "poor";
  return (
    <span className="metric-bar" aria-hidden="true">
      <span className={`metric-bar-fill metric-bar-${level}`} style={{ width }} />
    </span>
  );
}
function SortableHeader({
  label,
  hint,
  sortKey,
  activeSortKey,
  sortDirection,
  onSort,
}: {
  label: string;
  hint: string;
  sortKey: TenantMetricSortKey;
  activeSortKey: TenantMetricSortKey | null;
  sortDirection: "asc" | "desc";
  onSort: (key: TenantMetricSortKey) => void;
}) {
  const active = activeSortKey === sortKey;
  return (
    <button
      type="button"
      className={`sortable-header${active ? " active" : ""}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className="sortable-header-hint" title={hint}>
        <Info size={12} />
      </span>
      {active &&
        (sortDirection === "asc" ? (
          <ChevronUp size={14} />
        ) : (
          <ChevronDown size={14} />
        ))}
    </button>
  );
}
export function TenantMetrics({
  onNotice,
}: {
  onNotice: (message: string, type?: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [windowChoice, setWindowChoice] = useState<
    "7" | "30" | "90" | "custom"
  >("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<TenantOperationalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<TenantMetricSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(
    null,
  );
  const [dailyRows, setDailyRows] = useState<TenantOperationalDay[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);
  const period =
    windowChoice === "custom"
      ? { from: customFrom, to: customTo }
      : (() => {
          const to = new Date();
          const from = new Date();
          from.setUTCDate(from.getUTCDate() - Number(windowChoice));
          return { from: isoDate(from), to: isoDate(to) };
        })();
  // Typing a custom date digit-by-digit can briefly produce a "from" later
  // than "to" before the user finishes — skip fetching (silently, no error
  // toast) until both fields form a sensible range, instead of firing a
  // request that the backend rejects mid-keystroke.
  const periodIsValid = Boolean(
    period.from && period.to && period.from <= period.to,
  );
  useEffect(() => {
    if (!periodIsValid) return;
    setLoading(true);
    api<TenantOperationalSummary[]>(
      `/v1/admin/platform/tenant-metrics?from=${period.from}&to=${period.to}`,
    )
      .then(setRows)
      .catch((error) => onNotice(error.message, "error"))
      .finally(() => setLoading(false));
    // onNotice is redefined every render; this effect must only reload when
    // the selected period actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.from, period.to]);
  useEffect(() => {
    if (!expandedTenantId || !periodIsValid) return;
    setDailyLoading(true);
    setDailyRows([]);
    api<TenantOperationalDay[]>(
      `/v1/admin/platform/tenant-metrics/${expandedTenantId}/daily?from=${period.from}&to=${period.to}`,
    )
      .then(setDailyRows)
      .catch((error) => onNotice(error.message, "error"))
      .finally(() => setDailyLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTenantId, period.from, period.to]);
  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const withIndex = rows.map((row, index) => ({ row, index }));
    withIndex.sort((a, b) => {
      const left = a.row[sortKey];
      const right = b.row[sortKey];
      if (left === null && right === null) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      const diff = left - right;
      if (diff !== 0) return sortDirection === "asc" ? diff : -diff;
      return a.index - b.index;
    });
    return withIndex.map((entry) => entry.row);
  }, [rows, sortKey, sortDirection]);
  const toggleSort = (key: TenantMetricSortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };
  const toggleExpanded = (tenantId: string) =>
    setExpandedTenantId((current) => (current === tenantId ? null : tenantId));
  return (
    <section className="panel page-panel">
      <div className="panel-head">
        <div>
          <h2>{t("tenantMetrics.title")}</h2>
          <p>{t("tenantMetrics.help")}</p>
        </div>
        <div className="tenant-metrics-window">
          <AppSelect
            value={windowChoice}
            onChange={setWindowChoice}
            options={[
              { value: "7", label: t("tenantMetrics.window7") },
              { value: "30", label: t("tenantMetrics.window30") },
              { value: "90", label: t("tenantMetrics.window90") },
              { value: "custom", label: t("tenantMetrics.windowCustom") },
            ]}
          />
          {windowChoice === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </>
          )}
        </div>
      </div>
      <div className="tenant-metrics-table">
        <div className="row heading">
          <span>{t("tenantMetrics.company")}</span>
          <SortableHeader
            label={t("tenantMetrics.resolvedRate")}
            hint={t("tenantMetrics.resolvedRateHint")}
            sortKey="resolvedRate"
            activeSortKey={sortKey}
            sortDirection={sortDirection}
            onSort={toggleSort}
          />
          <SortableHeader
            label={t("tenantMetrics.humanHandledRate")}
            hint={t("tenantMetrics.humanHandledRateHint")}
            sortKey="humanHandledRate"
            activeSortKey={sortKey}
            sortDirection={sortDirection}
            onSort={toggleSort}
          />
          <SortableHeader
            label={t("tenantMetrics.conversionRate")}
            hint={t("tenantMetrics.conversionRateHint")}
            sortKey="conversionRate"
            activeSortKey={sortKey}
            sortDirection={sortDirection}
            onSort={toggleSort}
          />
          <SortableHeader
            label={t("tenantMetrics.latency")}
            hint={t("tenantMetrics.latencyHint")}
            sortKey="avgResponseLatencyMs"
            activeSortKey={sortKey}
            sortDirection={sortDirection}
            onSort={toggleSort}
          />
          <SortableHeader
            label={t("tenantMetrics.aiCost")}
            hint={t("tenantMetrics.aiCostHint")}
            sortKey="aiCostMinor"
            activeSortKey={sortKey}
            sortDirection={sortDirection}
            onSort={toggleSort}
          />
        </div>
        {!loading && rows.length === 0 && (
          <p className="tenant-metrics-empty">{t("tenantMetrics.empty")}</p>
        )}
        {sortedRows.map((row) => (
          <div key={row.tenantId} className="tenant-metrics-row-group">
            <button
              type="button"
              className="row tenant-metrics-row-toggle"
              onClick={() => toggleExpanded(row.tenantId)}
              aria-expanded={expandedTenantId === row.tenantId}
            >
              <span className="tenant-metrics-company-cell">
                {expandedTenantId === row.tenantId ? (
                  <ChevronUp size={15} />
                ) : (
                  <ChevronDown size={15} />
                )}
                <span>
                  <b>{row.displayName}</b>
                  <small>
                    {row.messagesTotal} {t("tenantMetrics.messages")}
                  </small>
                </span>
              </span>
              <span>
                <MetricBar value={row.resolvedRate} tone="positive" />
                {percentMetric(row.resolvedRate)}
              </span>
              <span>
                <MetricBar value={row.humanHandledRate} tone="neutral" />
                {percentMetric(row.humanHandledRate)}
              </span>
              <span>
                <MetricBar value={row.conversionRate} tone="positive" />
                {percentMetric(row.conversionRate)}
              </span>
              <span>{msMetric(row.avgResponseLatencyMs)}</span>
              <span>{moneyMetric(row.aiCostMinor, row.aiCurrency)}</span>
            </button>
            {expandedTenantId === row.tenantId && (
              <div className="tenant-metrics-daily">
                {dailyLoading && (
                  <p className="tenant-metrics-empty">
                    {t("tenantMetrics.dailyLoading")}
                  </p>
                )}
                {!dailyLoading && dailyRows.length > 0 && (
                  <div className="tenant-metrics-table">
                    <div className="row heading">
                      <span>{t("tenantMetrics.day")}</span>
                      <span>{t("tenantMetrics.resolvedRate")}</span>
                      <span>{t("tenantMetrics.humanHandledRate")}</span>
                      <span>{t("tenantMetrics.conversionRate")}</span>
                      <span>{t("tenantMetrics.latency")}</span>
                      <span>{t("tenantMetrics.aiCost")}</span>
                    </div>
                    {dailyRows.map((day) => (
                      <div className="row" key={day.day}>
                        <span>{day.day.slice(0, 10)}</span>
                        <span>{percentMetric(day.resolvedRate)}</span>
                        <span>{percentMetric(day.humanHandledRate)}</span>
                        <span>{percentMetric(day.conversionRate)}</span>
                        <span>{msMetric(day.avgResponseLatencyMs)}</span>
                        <span>{moneyMetric(day.aiCostMinor, day.aiCurrency)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
