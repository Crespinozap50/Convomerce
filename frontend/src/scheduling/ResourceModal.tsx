import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { api } from "../api";
import { AppSelect } from "../components/AppSelect";
import { BookingResource, ScheduleRule, SchedulingPayload } from "./SchedulingSettings";

export function ResourceModal({
  tenant,
  resource,
  services,
  onClose,
  onSaved,
}: {
  tenant: string;
  resource: BookingResource | null;
  services: SchedulingPayload["services"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const defaultTimezone = "America/Bogota";
  const [name, setName] = useState(resource?.name ?? "");
  const [resourceType, setResourceType] = useState<
    BookingResource["resourceType"]
  >(resource?.resourceType ?? "person");
  const [rules, setRules] = useState<ScheduleRule[]>(
    resource?.rules.length
      ? resource.rules.map(({ dayOfWeek, startsAt, endsAt, timezone }) => ({
          dayOfWeek,
          startsAt,
          endsAt,
          timezone,
        }))
      : [
          {
            dayOfWeek: 1,
            startsAt: "09:00",
            endsAt: "18:00",
            timezone: defaultTimezone,
          },
        ],
  );
  const [serviceIds, setServiceIds] = useState(resource?.serviceIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const updateRule = (index: number, patch: Partial<ScheduleRule>) =>
    setRules((rows) =>
      rows.map((row, current) =>
        current === index ? { ...row, ...patch } : row,
      ),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let id = resource?.id;
      if (id)
        await api(`/v1/admin/tenants/${tenant}/scheduling/resources/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            resourceType,
            status: "active",
            attributes: {},
          }),
        });
      else {
        id = (
          await api<{ resourceId: string }>(
            `/v1/admin/tenants/${tenant}/scheduling/resources`,
            {
              method: "POST",
              body: JSON.stringify({
                name,
                resourceType,
                status: "active",
                attributes: {},
              }),
            },
          )
        ).resourceId;
      }
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/resources/${id}/availability`,
        { method: "PUT", body: JSON.stringify({ rules }) },
      );
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/resources/${id}/services`,
        { method: "PUT", body: JSON.stringify({ catalogItemIds: serviceIds }) },
      );
      await onSaved();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="modal-backdrop">
      <section className="modal resource-modal">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow green">{t("scheduling.resourceEyebrow")}</span>
        <h2>
          {t(resource ? "scheduling.editResource" : "scheduling.newResource")}
        </h2>
        <p>{t("scheduling.resourceFormHelp")}</p>
        <form onSubmit={submit}>
          <div className="modal-two">
            <label>
              {t("scheduling.resourceName")}
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              {t("scheduling.resourceType")}
              <AppSelect
                value={resourceType}
                onChange={setResourceType}
                options={(
                  ["person", "space", "equipment", "other"] as const
                ).map((value) => ({
                  value,
                  label: t(`scheduling.resourceTypes.${value}`),
                }))}
              />
            </label>
          </div>
          <fieldset className="schedule-rules">
            <legend>{t("scheduling.weeklyAvailability")}</legend>
            {rules.map((rule, index) => (
              <div className="schedule-rule" key={index}>
                <AppSelect
                  value={String(rule.dayOfWeek)}
                  onChange={(day) =>
                    updateRule(index, { dayOfWeek: Number(day) })
                  }
                  options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({
                    value: String(day),
                    label: t(`scheduling.days.${day}`),
                  }))}
                />
                <input
                  aria-label={t("scheduling.startsAt")}
                  type="time"
                  value={rule.startsAt}
                  onChange={(event) =>
                    updateRule(index, { startsAt: event.target.value })
                  }
                />
                <input
                  aria-label={t("scheduling.endsAt")}
                  type="time"
                  value={rule.endsAt}
                  onChange={(event) =>
                    updateRule(index, { endsAt: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="icon-button danger-soft"
                  onClick={() =>
                    setRules((rows) =>
                      rows.filter((_, current) => current !== index),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary compact-action"
              onClick={() =>
                setRules((rows) => [
                  ...rows,
                  {
                    dayOfWeek: 1,
                    startsAt: "09:00",
                    endsAt: "18:00",
                    timezone: defaultTimezone,
                  },
                ])
              }
            >
              <Plus size={15} />
              {t("scheduling.addSchedule")}
            </button>
          </fieldset>
          <fieldset className="service-assignment">
            <legend>{t("scheduling.compatibleServices")}</legend>
            <p>{t("scheduling.compatibleServicesHelp")}</p>
            <div>
              {services.map((service) => (
                <label className="service-check" key={service.id}>
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(service.id)}
                    onChange={(event) =>
                      setServiceIds(
                        event.target.checked
                          ? [...serviceIds, service.id]
                          : serviceIds.filter((id) => id !== service.id),
                      )
                    }
                  />
                  <span className="switch-control">
                    <span />
                  </span>
                  <span>
                    <b>{service.name}</b>
                    <small>
                      {service.durationMinutes
                        ? t("scheduling.duration", {
                            count: service.durationMinutes,
                          })
                        : t("scheduling.durationNotSet")}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? t("common.saving") : t("common.saveChanges")}
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}
