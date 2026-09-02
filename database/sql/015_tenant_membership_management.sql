-- Gestión controlada de membresías. El runtime pierde escritura directa.

set role commerce_owner;

revoke insert, update on app.tenant_users from commerce_runtime;

create function app.update_tenant_membership(
  _actor_user_id uuid, _membership_id uuid, _role text, _status text, _correlation_id uuid
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare _tenant_id uuid := app.current_tenant_id(); _current app.tenant_users%rowtype;
begin
  if not app.can_manage_tenant_users(_actor_user_id) then
    raise insufficient_privilege using message = 'Actor no autorizado para administrar usuarios';
  end if;
  if _role not in ('owner','admin','operator','viewer') or _status not in ('active','disabled') then
    raise check_violation using message = 'Rol o estado inválido';
  end if;
  select * into _current from app.tenant_users
   where tenant_id = _tenant_id and id = _membership_id for update;
  if not found then return false; end if;
  if _current.role = 'owner' and _current.status = 'active'
     and (_role <> 'owner' or _status <> 'active')
     and (select count(*) from app.tenant_users
           where tenant_id = _tenant_id and role = 'owner' and status = 'active') <= 1 then
    raise check_violation using message = 'No se puede modificar al último owner activo';
  end if;
  update app.tenant_users set role = _role, status = _status, updated_at = now()
   where tenant_id = _tenant_id and id = _membership_id;
  if _status = 'disabled' then
    update app.user_sessions set revoked_at = coalesce(revoked_at, now())
     where user_id = _current.user_id;
  end if;
  insert into app.audit_events
    (id, tenant_id, actor_type, actor_id, action, subject_type, subject_id, correlation_id, metadata)
  values (_correlation_id, _tenant_id, 'user', _actor_user_id, 'tenant_user.updated',
          'tenant_user', _membership_id, _correlation_id,
          jsonb_build_object('previousRole', _current.role, 'role', _role,
                             'previousStatus', _current.status, 'status', _status));
  return true;
end
$$;

create function app.revoke_tenant_user_invitation(
  _actor_user_id uuid, _invitation_id uuid, _correlation_id uuid
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare _tenant_id uuid := app.current_tenant_id();
begin
  if not app.can_manage_tenant_users(_actor_user_id) then
    raise insufficient_privilege using message = 'Actor no autorizado para revocar invitaciones';
  end if;
  update app.tenant_user_invitations set status = 'revoked', updated_at = now()
   where tenant_id = _tenant_id and id = _invitation_id and status = 'pending';
  if not found then return false; end if;
  insert into app.audit_events
    (id, tenant_id, actor_type, actor_id, action, subject_type, subject_id, correlation_id)
  values (_correlation_id, _tenant_id, 'user', _actor_user_id, 'tenant_user.invitation_revoked',
          'tenant_user_invitation', _invitation_id, _correlation_id);
  return true;
end
$$;

revoke all on function app.update_tenant_membership(uuid,uuid,text,text,uuid) from public;
revoke all on function app.revoke_tenant_user_invitation(uuid,uuid,uuid) from public;
grant execute on function app.update_tenant_membership(uuid,uuid,text,text,uuid) to commerce_runtime;
grant execute on function app.revoke_tenant_user_invitation(uuid,uuid,uuid) to commerce_runtime;

reset role;
