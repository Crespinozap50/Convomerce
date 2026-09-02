-- Autenticación propia: credenciales Argon2id y sesiones opacas revocables.
-- Las tablas son globales porque la identidad puede pertenecer a varios tenants.

set role commerce_owner;

-- La autenticación externa fue descartada antes de entrar en uso.
drop function if exists app.resolve_authenticated_user(text, text);
drop table if exists app.user_identities;

create table app.local_credentials (
  user_id uuid primary key references app.users(id) on delete restrict,
  password_hash text not null check (password_hash like '$argon2id$%'),
  must_change_password boolean not null default false,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.user_sessions (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete restrict,
  token_hash char(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index user_sessions_active_idx on app.user_sessions (user_id, expires_at)
  where revoked_at is null;

create table app.login_attempts (
  id uuid primary key,
  normalized_email text not null,
  user_id uuid references app.users(id) on delete restrict,
  succeeded boolean not null,
  source_ip inet,
  user_agent text,
  occurred_at timestamptz not null default now()
);
create index login_attempts_email_time_idx
  on app.login_attempts (normalized_email, occurred_at desc);

create function app.get_local_login(_email text)
returns table (
  user_id uuid,
  password_hash text,
  must_change_password boolean,
  locked_until timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select account.id, credential.password_hash,
         credential.must_change_password, credential.locked_until
    from app.users account
    join app.local_credentials credential on credential.user_id = account.id
   where lower(account.email) = lower(trim(_email))
     and account.status = 'active'
$$;

create function app.record_local_login(
  _attempt_id uuid,
  _email text,
  _user_id uuid,
  _succeeded boolean,
  _source_ip inet,
  _user_agent text
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  _locked_until timestamptz;
begin
  insert into app.login_attempts (
    id, normalized_email, user_id, succeeded, source_ip, user_agent
  ) values (
    _attempt_id, lower(trim(_email)), _user_id, _succeeded,
    _source_ip, left(_user_agent, 512)
  );

  if _user_id is null then return null; end if;

  if _succeeded then
    update app.local_credentials
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where user_id = _user_id;
    return null;
  end if;

  update app.local_credentials
     set failed_attempts = failed_attempts + 1,
         locked_until = case
           when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
           else locked_until
         end,
         updated_at = now()
   where user_id = _user_id
   returning locked_until into _locked_until;
  return _locked_until;
end
$$;

create function app.create_local_session(
  _session_id uuid,
  _user_id uuid,
  _token_hash char(64),
  _expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if not exists (
    select 1 from app.users account
     where account.id = _user_id and account.status = 'active'
  ) then
    raise insufficient_privilege using message = 'Usuario inactivo';
  end if;
  insert into app.user_sessions (id, user_id, token_hash, expires_at)
  values (_session_id, _user_id, _token_hash, _expires_at);
  return _session_id;
end
$$;

create function app.resolve_local_session(_token_hash char(64))
returns table (user_id uuid, session_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  return query
  update app.user_sessions session
     set last_seen_at = now()
    from app.users account
   where session.token_hash = _token_hash
     and session.user_id = account.id
     and session.revoked_at is null
     and session.expires_at > now()
     and account.status = 'active'
  returning session.user_id, session.id, session.expires_at;
end
$$;

create function app.revoke_local_session(_token_hash char(64))
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  update app.user_sessions set revoked_at = now()
   where token_hash = _token_hash and revoked_at is null;
  return found;
end
$$;

revoke all on app.local_credentials, app.user_sessions, app.login_attempts
  from public, commerce_runtime, commerce_readonly, commerce_outbox;
revoke all on function app.get_local_login(text) from public;
revoke all on function app.record_local_login(uuid,text,uuid,boolean,inet,text) from public;
revoke all on function app.create_local_session(uuid,uuid,char,timestamptz) from public;
revoke all on function app.resolve_local_session(char) from public;
revoke all on function app.revoke_local_session(char) from public;
grant execute on function app.get_local_login(text) to commerce_runtime;
grant execute on function app.record_local_login(uuid,text,uuid,boolean,inet,text) to commerce_runtime;
grant execute on function app.create_local_session(uuid,uuid,char,timestamptz) to commerce_runtime;
grant execute on function app.resolve_local_session(char) to commerce_runtime;
grant execute on function app.revoke_local_session(char) to commerce_runtime;

reset role;
