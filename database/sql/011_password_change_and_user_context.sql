-- Cambio obligatorio de contraseña y contexto administrativo del usuario.

set role commerce_owner;

drop function app.resolve_local_session(char);
create function app.resolve_local_session(_token_hash char(64))
returns table (
  user_id uuid,
  session_id uuid,
  expires_at timestamptz,
  must_change_password boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  return query
  update app.user_sessions session
     set last_seen_at = now()
    from app.users account, app.local_credentials credential
   where session.token_hash = _token_hash
     and session.user_id = account.id
     and credential.user_id = account.id
     and session.revoked_at is null
     and session.expires_at > now()
     and account.status = 'active'
  returning session.user_id, session.id, session.expires_at,
            credential.must_change_password;
end
$$;

create function app.change_local_password(
  _user_id uuid,
  _current_session_id uuid,
  _expected_password_hash text,
  _new_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if _new_password_hash not like '$argon2id$%' then
    raise check_violation using message = 'Hash de contraseña inválido';
  end if;

  update app.local_credentials
     set password_hash = _new_password_hash,
         must_change_password = false,
         failed_attempts = 0,
         locked_until = null,
         password_changed_at = now(),
         updated_at = now()
   where user_id = _user_id
     and password_hash = _expected_password_hash;
  if not found then return false; end if;

  update app.user_sessions
     set revoked_at = now()
   where user_id = _user_id
     and id <> _current_session_id
     and revoked_at is null;
  return true;
end
$$;

create function app.get_local_user_context(_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'userId', account.id,
    'email', account.email,
    'displayName', account.display_name,
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

revoke all on function app.resolve_local_session(char) from public;
revoke all on function app.change_local_password(uuid,uuid,text,text) from public;
revoke all on function app.get_local_user_context(uuid) from public;
grant execute on function app.resolve_local_session(char) to commerce_runtime;
grant execute on function app.change_local_password(uuid,uuid,text,text) to commerce_runtime;
grant execute on function app.get_local_user_context(uuid) to commerce_runtime;

reset role;
