import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Plus } from "lucide-react";
import { api } from "../api";
import { AppSelect } from "../components/AppSelect";
import { ResourceModal } from "./ResourceModal";

export type ScheduleRule = {
  id?: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
};
export type BookingResource = {
  id: string;
  resourceType: "person" | "space" | "equipment" | "other";
  name: string;
  status: string;
  rules: ScheduleRule[];
  serviceIds: string[];
  calendarLinks: {
    calendarSourceId: string;
    externalCalendarId: string;
    status: string;
  }[];
};
export type SchedulingPayload = {
  canManage: boolean;
  resources: BookingResource[];
  services: {
    id: string;
    name: string;
    durationMinutes: number | null;
    offeringType: string;
  }[];
  calendarSources: {
    id: string;
    provider: string;
    displayName: string;
    status: string;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    schedulingMode: "global" | "per_resource";
    globalCalendarId: string | null;
  }[];
};
export type GoogleCalendarOption = {
  id: string;
  name: string;
  description: string | null;
  primary: boolean;
  accessRole: string | null;
  timezone: string | null;
  color: string | null;
};

export function SchedulingSettings({
  tenant,
  onNotice,
}: {
  tenant: string;
  onNotice: (message: string, type?: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<SchedulingPayload | null>(null);
  const [editing, setEditing] = useState<BookingResource | "new" | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarOption[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [globalCalendarId, setGlobalCalendarId] = useState("");
  const [resourceCalendars, setResourceCalendars] = useState<
    Record<string, string>
  >({});
  const load = async () =>
    setValue(
      await api<SchedulingPayload>(`/v1/admin/tenants/${tenant}/scheduling`),
    );
  const connectGoogle = async () => {
    try {
      const result = await api<{ authorizationUrl: string }>(
        `/v1/admin/tenants/${tenant}/scheduling/google-calendar/authorize`,
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      onNotice((error as Error).message, "error");
    }
  };
  const saveCalendarMode = async (
    sourceId: string,
    mode: "global" | "per_resource",
  ) => {
    try {
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/calendar-sources/${sourceId}/strategy`,
        { method: "PUT", body: JSON.stringify({ mode }) },
      );
      await load();
      onNotice(t("scheduling.calendarModeSaved"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    }
  };
  const loadCalendars = async (sourceId: string) => {
    setCalendarBusy(true);
    try {
      const result = await api<{ calendars: GoogleCalendarOption[] }>(
        `/v1/admin/tenants/${tenant}/scheduling/calendar-sources/${sourceId}/calendars`,
      );
      setCalendars(result.calendars);
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setCalendarBusy(false);
    }
  };
  const saveCalendarAssignment = async (sourceId: string) => {
    setCalendarBusy(true);
    try {
      await api(
        `/v1/admin/tenants/${tenant}/scheduling/calendar-sources/${sourceId}/assignment`,
        {
          method: "PUT",
          body: JSON.stringify({
            globalCalendarId: globalCalendarId || null,
            resourceAssignments: Object.entries(resourceCalendars)
              .filter(([, calendarId]) => calendarId)
              .map(([resourceId, calendarId]) => ({ resourceId, calendarId })),
          }),
        },
      );
      await load();
      onNotice(t("scheduling.calendarAssignmentSaved"));
    } catch (error) {
      onNotice((error as Error).message, "error");
    } finally {
      setCalendarBusy(false);
    }
  };
  useEffect(() => {
    setValue(null);
    void load().catch((error) => onNotice(error.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  // Re-runs only when a source's id/status actually changes, not on every
  // re-render of `value` (e.g. after loadCalendars re-sets it below).
  const calendarSourcesKey = value?.calendarSources
    .map((source) => `${source.id}:${source.status}`)
    .join("|");
  useEffect(() => {
    const source = value?.calendarSources.find(
      (row) => row.provider === "google_calendar" && row.status === "connected",
    );
    if (!source) {
      setCalendars([]);
      return;
    }
    setGlobalCalendarId(source.globalCalendarId ?? "");
    setResourceCalendars(
      Object.fromEntries(
        value!.resources.map((resource) => [
          resource.id,
          resource.calendarLinks.find(
            (link) =>
              link.calendarSourceId === source.id && link.status === "active",
          )?.externalCalendarId ?? "",
        ]),
      ),
    );
    void loadCalendars(source.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, calendarSourcesKey]);
  if (!value)
    return (
      <section className="panel scheduling-loading">
        {t("common.loading")}
      </section>
    );
  const google = value.calendarSources.filter(
    (source) => source.provider === "google_calendar",
  );
  return (
    <>
      <section className="scheduling-overview">
        <div className="panel scheduling-resources">
          <div className="panel-head">
            <div>
              <h2>{t("scheduling.resourcesTitle")}</h2>
              <p>{t("scheduling.resourcesHelp")}</p>
            </div>
            {value.canManage && (
              <button onClick={() => setEditing("new")}>
                <Plus size={16} />
                {t("scheduling.newResource")}
              </button>
            )}
          </div>
          <div className="resource-grid">
            {value.resources.map((resource) => (
              <article className="resource-card" key={resource.id}>
                <div className="resource-card-head">
                  <span className="resource-icon">
                    <CalendarDays size={19} />
                  </span>
                  <span>
                    <b>{resource.name}</b>
                    <small>
                      {t(`scheduling.resourceTypes.${resource.resourceType}`)}
                    </small>
                  </span>
                  <em className={resource.status}>
                    {t(`common.${resource.status}`)}
                  </em>
                </div>
                <div className="resource-schedule">
                  {resource.rules.slice(0, 4).map((rule) => (
                    <span key={`${rule.dayOfWeek}-${rule.startsAt}`}>
                      <b>{t(`scheduling.days.${rule.dayOfWeek}`)}</b>
                      {rule.startsAt}–{rule.endsAt}
                    </span>
                  ))}
                  {!resource.rules.length && (
                    <small>{t("scheduling.noAvailability")}</small>
                  )}
                </div>
                <div className="resource-card-footer">
                  <small>
                    {t("scheduling.servicesCount", {
                      count: resource.serviceIds.length,
                    })}
                  </small>
                  {value.canManage && (
                    <button
                      className="secondary compact-action"
                      onClick={() => setEditing(resource)}
                    >
                      {t("common.configure")}
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!value.resources.length && (
              <div className="resource-empty">
                <CalendarDays size={28} />
                <b>{t("scheduling.emptyTitle")}</b>
                <small>{t("scheduling.emptyHelp")}</small>
              </div>
            )}
          </div>
        </div>
        <aside className="panel calendar-integration">
          <div className="panel-head">
            <div>
              <h2>Google Calendar</h2>
              <p>{t("scheduling.googleHelp")}</p>
            </div>
          </div>
          <div className="google-calendar-card">
            <span className="google-mark">G</span>
            <span>
              <b>
                {google.length
                  ? t("scheduling.sourcesConfigured", { count: google.length })
                  : t("scheduling.googleReady")}
              </b>
              <small>
                {google.length
                  ? google.map((source) => source.displayName).join(", ")
                  : t("scheduling.googleBoundary")}
              </small>
            </span>
            <em
              className={
                google.some((source) => source.status === "connected")
                  ? "active"
                  : "planned"
              }
            >
              {google.some((source) => source.status === "connected")
                ? t("common.connected")
                : t("knowledge.planned")}
            </em>
            {value.canManage && (
              <button
                className="secondary compact-action"
                onClick={() => void connectGoogle()}
              >
                {google.some((source) => source.status === "connected")
                  ? t("scheduling.reconnectGoogle")
                  : t("scheduling.connectGoogle")}
              </button>
            )}
          </div>
          {google[0]?.status === "connected" && (
            <>
              <div className="calendar-mode">
                <b>{t("scheduling.calendarModeTitle")}</b>
                <p>{t("scheduling.calendarModeHelp")}</p>
                <div>
                  {(["global", "per_resource"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={
                        google[0].schedulingMode === mode ? "selected" : ""
                      }
                      onClick={() => void saveCalendarMode(google[0].id, mode)}
                    >
                      <CalendarDays size={18} />
                      <span>
                        <b>{t(`scheduling.calendarModes.${mode}.title`)}</b>
                        <small>
                          {t(`scheduling.calendarModes.${mode}.help`)}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="calendar-assignment">
                <b>{t("scheduling.calendarAssignmentTitle")}</b>
                <p>
                  {calendarBusy && !calendars.length
                    ? t("scheduling.loadingCalendars")
                    : t("scheduling.calendarAssignmentHelp")}
                </p>
                {google[0].schedulingMode === "global" ? (
                  <label>
                    {t("scheduling.globalCalendarLabel")}
                    <AppSelect
                      value={globalCalendarId}
                      onChange={setGlobalCalendarId}
                      options={[
                        { value: "", label: t("scheduling.selectCalendar") },
                        ...calendars.map((calendar) => ({
                          value: calendar.id,
                          label: `${calendar.name}${calendar.primary ? ` · ${t("scheduling.primaryCalendar")}` : ""}`,
                        })),
                      ]}
                    />
                  </label>
                ) : (
                  <div className="resource-calendar-list">
                    {value.resources.map((resource) => (
                      <label key={resource.id}>
                        <span>
                          <b>{resource.name}</b>
                          <small>
                            {t(
                              `scheduling.resourceTypes.${resource.resourceType}`,
                            )}
                          </small>
                        </span>
                        <AppSelect
                          value={resourceCalendars[resource.id] ?? ""}
                          onChange={(calendarId) =>
                            setResourceCalendars((current) => ({
                              ...current,
                              [resource.id]: calendarId,
                            }))
                          }
                          options={[
                            {
                              value: "",
                              label: t("scheduling.selectCalendar"),
                            },
                            ...calendars.map((calendar) => ({
                              value: calendar.id,
                              label: calendar.name,
                            })),
                          ]}
                        />
                      </label>
                    ))}
                    {!value.resources.length && (
                      <small>
                        {t("scheduling.resourcesRequiredForCalendars")}
                      </small>
                    )}
                  </div>
                )}
                {value.canManage && (
                  <button
                    disabled={calendarBusy || !calendars.length}
                    onClick={() => void saveCalendarAssignment(google[0].id)}
                  >
                    {calendarBusy
                      ? t("common.saving")
                      : t("scheduling.saveCalendarAssignment")}
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </section>
      {editing && (
        <ResourceModal
          tenant={tenant}
          resource={editing === "new" ? null : editing}
          services={value.services}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            onNotice(t("scheduling.saved"));
          }}
        />
      )}
    </>
  );
}
