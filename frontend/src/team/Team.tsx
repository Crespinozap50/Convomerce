import { useTranslation } from "react-i18next";
import { UserPlus } from "lucide-react";
import { Member } from "../types";
import { AppSelect } from "../components/AppSelect";
import { roleName } from "../dashboard/utils";

export function Team({
  members,
  owners,
  tenant,
  onInvite,
  onUpdate,
}: {
  members: Member[];
  owners: number;
  tenant: string;
  onInvite: () => void;
  onUpdate: (m: Member, r: string, s: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <section className="stats">
        <div>
          <span>{t("team.members")}</span>
          <strong>{members.length}</strong>
        </div>
        <div>
          <span>{t("team.active")}</span>
          <strong>{members.filter((m) => m.status === "active").length}</strong>
        </div>
        <div>
          <span>{t("team.administrators")}</span>
          <strong>
            {members.filter((m) => ["owner", "admin"].includes(m.role)).length}
          </strong>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{t("team.title")}</h2>
            <p>{t("team.description")}</p>
          </div>
          <button onClick={onInvite} disabled={!tenant}>
            <UserPlus size={18} /> {t("team.invite")}
          </button>
        </div>
        <div className="table">
          <div className="row heading">
            <span>{t("team.user")}</span>
            <span>{t("team.role")}</span>
            <span>{t("team.status")}</span>
            <span>{t("team.actions")}</span>
          </div>
          {members.map((m) => {
            const protectedOwner =
              m.role === "owner" && m.status === "active" && owners === 1;
            return (
              <div className="row" key={m.membershipId}>
                <span className="user-cell">
                  <i>{m.displayName.slice(0, 2).toUpperCase()}</i>
                  <span>
                    <b>{m.displayName}</b>
                    <small>{m.email}</small>
                  </span>
                </span>
                <span>
                  {protectedOwner ? (
                    <span className="fixed-role">{t("roles.owner")}</span>
                  ) : (
                    <AppSelect
                      value={m.role}
                      onChange={(role) => onUpdate(m, role, m.status)}
                      options={["owner", "admin", "operator", "viewer"].map(
                        (role) => ({ value: role, label: roleName(role, t) }),
                      )}
                    />
                  )}
                </span>
                <span>
                  <em className={m.status}>
                    {t(`common.${m.status}`, { defaultValue: m.status })}
                  </em>
                </span>
                <span>
                  {protectedOwner ? (
                    <small className="protected">
                      {t("team.ownerPrimary")}
                    </small>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() =>
                        onUpdate(
                          m,
                          m.role,
                          m.status === "active" ? "disabled" : "active",
                        )
                      }
                    >
                      {m.status === "active"
                        ? t("team.disable")
                        : t("team.reactivate")}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
