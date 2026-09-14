-- Recuperación de contraseña por correo. Global (no por tenant), igual que
-- app.local_credentials/app.user_sessions — la identidad de un usuario
-- puede abarcar varios tenants.
-- D-159 (docs/decisions.md): no existía ningún mecanismo — ni siquiera uno
-- de administrador — para recuperar una contraseña olvidada; la única
-- opción hasta ahora era editar el hash a mano en la base de datos. Mismo
-- patrón que app.tenant_user_invitations (012_tenant_user_invitations.sql):
-- token opaco de un solo uso, hasheado antes de guardarse, con expiración.

set role commerce_owner;

create table app.password_reset_tokens (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete restrict,
  token_hash char(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'used', 'expired')),
  requested_ip inet,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'used' and used_at is not null) or status <> 'used')
);
create index password_reset_tokens_user_pending_idx
  on app.password_reset_tokens (user_id) where status = 'pending';

-- D-159 live design note: deliberately returns nothing that distinguishes
-- "this email exists" from "it doesn't" — request_password_reset() always
-- succeeds from the caller's point of view (the service layer above always
-- shows the same generic "if that email exists, we sent a link" message).
-- Only when a real, active local-credentials account matches does this
-- actually create a token; a previous pending token for the same user is
-- expired first, mirroring create_tenant_user_invitation()'s same
-- single-pending-request rule.
create function app.request_password_reset(
  _id uuid, _email text, _token_hash char(64), _expires_at timestamptz,
  _requested_ip inet
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare _user_id uuid;
begin
  select account.id into _user_id
    from app.users account
    join app.local_credentials credential on credential.user_id = account.id
   where lower(account.email) = lower(trim(_email)) and account.status = 'active';
  if _user_id is null then return false; end if;

  update app.password_reset_tokens set status = 'expired'
   where user_id = _user_id and status = 'pending';
  insert into app.password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip)
  values (_id, _user_id, _token_hash, _expires_at, _requested_ip);
  return true;
end
$$;

-- Resetting the password also revokes every existing session and clears
-- the account-lockout counters (010_local_authentication.sql) — a reset
-- most often happens because the old password was forgotten OR because the
-- account was locked out; either way, whoever just proved control of the
-- inbox should start clean, not inherit a still-locked or still-logged-in
-- state from before.
create function app.reset_password(
  _token_hash char(64), _password_hash text
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare _token app.password_reset_tokens%rowtype;
begin
  select * into _token from app.password_reset_tokens
   where token_hash = _token_hash and status = 'pending' for update;
  if not found or _token.expires_at <= now() then
    raise invalid_authorization_specification using message = 'Enlace de recuperación inválido o vencido';
  end if;
  update app.local_credentials
     set password_hash = _password_hash, must_change_password = false,
         failed_attempts = 0, locked_until = null,
         password_changed_at = now(), updated_at = now()
   where user_id = _token.user_id;
  update app.user_sessions set revoked_at = now()
   where user_id = _token.user_id and revoked_at is null;
  update app.password_reset_tokens set status = 'used', used_at = now()
   where id = _token.id;
  return _token.user_id;
end
$$;

revoke all on app.password_reset_tokens from public, commerce_runtime, commerce_readonly, commerce_outbox;
revoke all on function app.request_password_reset(uuid,text,char,timestamptz,inet) from public;
revoke all on function app.reset_password(char,text) from public;
grant execute on function app.request_password_reset(uuid,text,char,timestamptz,inet) to commerce_runtime;
grant execute on function app.reset_password(char,text) to commerce_runtime;

reset role;
