-- Persist the interface locale as a global user preference.

set role commerce_owner;

alter table app.users
  add column interface_locale text not null default 'en'
  check (interface_locale in ('en', 'es'));

create or replace function app.get_local_user_context(_user_id uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'userId', account.id,
    'email', account.email,
    'displayName', account.display_name,
    'uiLanguage', account.interface_locale,
    'mustChangePassword', credential.must_change_password,
    'platformRole', (
      select admin.role from app.platform_admins admin
       where admin.user_id = account.id and admin.status = 'active'
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenantId', membership.tenant_id,
        'role', membership.role
      ) order by membership.created_at)
      from app.tenant_users membership
      join app.tenants tenant on tenant.id = membership.tenant_id
      where membership.user_id = account.id
        and membership.status = 'active'
        and tenant.status = 'active'
    ), '[]'::jsonb)
  )
  from app.users account
  join app.local_credentials credential on credential.user_id = account.id
  where account.id = _user_id and account.status = 'active'
$$;

create function app.update_user_interface_locale(_user_id uuid, _session_id uuid, _locale text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, app
as $$
begin
  if _locale not in ('en', 'es') then
    raise check_violation using message = 'Unsupported interface locale';
  end if;
  if not exists (
    select 1 from app.user_sessions session
     where session.id = _session_id and session.user_id = _user_id
       and session.revoked_at is null and session.expires_at > now()
  ) then
    raise invalid_authorization_specification using message = 'Invalid or expired session';
  end if;
  update app.users set interface_locale = _locale, updated_at = now()
   where id = _user_id and status = 'active';
  return found;
end
$$;

revoke all on function app.update_user_interface_locale(uuid,uuid,text) from public;
grant execute on function app.update_user_interface_locale(uuid,uuid,text) to commerce_runtime;

reset role;
