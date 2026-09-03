import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ShoppingBag } from "lucide-react";
import { api } from "../api";
import { CommercialRequest } from "../types";
import { AppSelect } from "../components/AppSelect";

type CommercialRequestLine = {
  id: string;
  description: string;
  unitPriceMinor: number;
  currency: string;
  quantity: number;
  lineTotalMinor: number;
  status: string;
};
type CommercialRequestDetail = {
  canManage: boolean;
  request: CommercialRequest;
  lines: CommercialRequestLine[];
};

export function CommercialRequests({
  tenant,
  onNotice,
  onCountsChanged,
}: {
  tenant: string;
  onNotice: (message: string, type?: "success" | "error") => void;
  onCountsChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CommercialRequest[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommercialRequestDetail | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [filter, setFilter] = useState("active");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const value = await api<{
      canManage: boolean;
      newCount: number;
      requests: CommercialRequest[];
    }>(`/v1/admin/tenants/${tenant}/commercial-requests`);
    setRows(value.requests);
    setCanManage(value.canManage);
    setSelected((current) =>
      current && value.requests.some((row) => row.id === current)
        ? current
        : (value.requests[0]?.id ?? null),
    );
    return value.requests;
  };
  const loadDetail = async (id: string) =>
    setDetail(
      await api<CommercialRequestDetail>(
        `/v1/admin/tenants/${tenant}/commercial-requests/${id}`,
      ),
    );
  useEffect(() => {
    setRows([]);
    setSelected(null);
    setDetail(null);
    void (async () => {
      await api(`/v1/admin/tenants/${tenant}/commercial-requests/seen`, {
        method: "POST",
      });
      await load();
      await onCountsChanged();
    })().catch((error) => onNotice(error.message, "error"));
    // load/onCountsChanged/onNotice are redefined every render; this effect
    // must only reset and reload when the tenant actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  useEffect(() => {
    if (selected)
      void loadDetail(selected).catch((error) => onNotice(error.message, "error"));
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tenant]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        await load();
        if (selected) await loadDetail(selected);
        await onCountsChanged();
      })().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
    // Same reason as above: including the redefined-every-render functions
    // here would tear down and recreate the poll interval on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, selected]);
  const visible = rows.filter(
    (row) =>
      filter === "all" ||
      (filter === "active"
        ? ["ready", "accepted", "in_progress"].includes(row.status)
        : row.status === filter),
  );
  const actions: Record<string, string[]> = {
    draft: ["cancelled"],
    awaiting_confirmation: ["cancelled"],
    ready: ["cancelled"],
    accepted: ["cancelled"],
    in_progress: ["cancelled"],
  };
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value / 100);
  const actionLabel = (type: string, status: string) =>
    t(
      `requests.actions.${type === "reservation" ? "reservation" : "order"}.${status}`,
    );
  const statusLabel = (type: string, status: string) =>
    t(
      `requests.operationStatuses.${type === "reservation" ? "reservation" : "order"}.${status}`,
    );
  const appointmentDate = (value: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  const appointmentTime = (value: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  async function change(status: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/commercial-requests/${detail.request.id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      await load();
      await loadDetail(detail.request.id);
      await onCountsChanged();
      onNotice(t("requests.statusUpdated"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="requests-shell">
      <div className="request-list panel">
        <div className="request-list-head">
          <div>
            <h2>{t("requests.title")}</h2>
            <small>{t("requests.count", { count: visible.length })}</small>
          </div>
          <AppSelect
            value={filter}
            onChange={setFilter}
            options={[
              "active",
              "all",
              "ready",
              "accepted",
              "in_progress",
              "completed",
            ].map((value) => ({
              value,
              label: t(`requests.filters.${value}`),
            }))}
          />
        </div>
        <div className="request-list-items">
          {visible.map((row) => (
            <button
              key={row.id}
              className={`request-list-item ${selected === row.id ? "selected" : ""}`}
              onClick={() => setSelected(row.id)}
            >
              <span className="request-item-top">
                <b>{row.customerName}</b>
                <span className={`request-status ${row.status}`}>
                  {statusLabel(row.type, row.status)}
                </span>
              </span>
              <span>
                {t(`requests.types.${row.type}`)} · {row.lineCount} ·{" "}
                {money(row.totalMinor, row.currency)}
              </span>
              <small>
                #{row.id.slice(-8).toUpperCase()} ·{" "}
                {new Date(row.updatedAt).toLocaleString()}
              </small>
            </button>
          ))}
          {!visible.length && (
            <div className="request-empty">
              <ShoppingBag size={28} />
              <b>{t("requests.emptyTitle")}</b>
              <small>{t("requests.emptyHelp")}</small>
            </div>
          )}
        </div>
      </div>
      <div className="request-detail panel">
        {detail ? (
          <>
            <div className="request-detail-head">
              <div>
                <span className="eyebrow green">
                  {t(`requests.types.${detail.request.type}`)}
                </span>
                <h2>{detail.request.customerName}</h2>
                <p>
                  #{detail.request.id.slice(-8).toUpperCase()} ·{" "}
                  {t(
                    `requests.fulfillment.${detail.request.fulfillmentType ?? "unspecified"}`,
                  )}
                </p>
              </div>
              <span className={`request-status large ${detail.request.status}`}>
                {statusLabel(detail.request.type, detail.request.status)}
              </span>
            </div>
            <div className="request-summary">
              <span>
                <small>{t("requests.total")}</small>
                <b>
                  {money(detail.request.totalMinor, detail.request.currency)}
                </b>
              </span>
              <span>
                <small>{t("requests.created")}</small>
                <b>{new Date(detail.request.createdAt).toLocaleString()}</b>
              </span>
              <span>
                <small>{t("requests.confirmed")}</small>
                <b>
                  {detail.request.confirmedAt
                    ? new Date(detail.request.confirmedAt).toLocaleString()
                    : "—"}
                </b>
              </span>
            </div>
            {detail.request.appointment && (
              <div className="request-appointment">
                <span className="request-appointment-icon">
                  <CalendarDays size={21} />
                </span>
                <div>
                  <small>{t("requests.appointment.schedule")}</small>
                  <b>
                    {appointmentDate(
                      detail.request.appointment.startsAt,
                      detail.request.appointment.timezone,
                    )}{" "}
                    –{" "}
                    {appointmentTime(
                      detail.request.appointment.endsAt,
                      detail.request.appointment.timezone,
                    )}
                  </b>
                  <small>{detail.request.appointment.timezone}</small>
                </div>
                <div>
                  <small>{t("requests.appointment.resource")}</small>
                  <b>{detail.request.appointment.resource.name}</b>
                  <small>
                    {t(
                      `scheduling.resourceTypes.${detail.request.appointment.resource.type}`,
                    )}
                  </small>
                </div>
                <span
                  className={`request-status ${detail.request.appointment.status}`}
                >
                  {t(
                    `requests.appointment.statuses.${detail.request.appointment.status}`,
                  )}
                </span>
              </div>
            )}
            <div className="request-lines">
              <h3>{t("requests.lines")}</h3>
              {detail.lines
                .filter((line) => line.status === "active")
                .map((line) => (
                  <div className="request-line" key={line.id}>
                    <span>
                      <b>{line.description}</b>
                      <small>
                        {line.quantity} ×{" "}
                        {money(line.unitPriceMinor, line.currency)}
                      </small>
                    </span>
                    <b>{money(line.lineTotalMinor, line.currency)}</b>
                  </div>
                ))}
            </div>
            {detail.request.customerNotes && (
              <div className="request-notes">
                <small>{t("requests.notes")}</small>
                <p>{detail.request.customerNotes}</p>
              </div>
            )}
            {canManage && actions[detail.request.status]?.length > 0 && (
              <div className="request-actions">
                <span>
                  <b>{t("requests.nextAction")}</b>
                  <small>{t("requests.nextActionHelp")}</small>
                </span>
                {actions[detail.request.status].map((status) => (
                  <button
                    disabled={busy}
                    className={
                      status === "cancelled" || status === "rejected"
                        ? "danger-soft"
                        : ""
                    }
                    onClick={() => void change(status)}
                    key={status}
                  >
                    {actionLabel(detail.request.type, status)}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="request-detail-empty">
            <ShoppingBag size={38} />
            <h3>{t("requests.selectTitle")}</h3>
            <p>{t("requests.selectHelp")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
