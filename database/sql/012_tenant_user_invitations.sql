-- Invitaciones de usuarios administradas por tenant.

set role commerce_owner;

create table app.tenant_user_invitations (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  token_hash char(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id uuid not null references app.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_by_user_id uuid references app.users(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (expires_at > created_at),
  check ((status = 'accepted' and accepted_at is not null and accepted_by_user_id is not null)
      or status <> 'accepted')
);
create unique index tenant_user_invitations_one_pending_email_uidx
  on app.tenant_user_invitations (tenant_id, lower(email)) where status = 'pending';

alter table app.tenant_user_invitations enable row level security;
alter table app.tenant_user_invitations force row level security;
create policy tenant_isolation on app.tenant_user_invitations
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

create function app.can_manage_tenant_users(_actor_user_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, app
as $$
  select app.current_tenant_id() is not null and (
    exists (select 1 from app.platform_admins p where p.user_id = _actor_user_id and p.status = 'active')
    or exists (
      select 1 from app.tenant_users m
      where m.tenant_id = app.current_tenant_id() and m.user_id = _actor_user_id
        and m.status = 'active' and m.role in ('owner', 'admin')
    )
  )
$$;

create function app.list_tenant_users(_actor_user_id uuid)
returns table (membership_id uuid, user_id uuid, email text, display_name text, role text, status text)
language plpgsql stable security definer set search_path = pg_catalog, app
as $$
begin
  if not app.can_manage_tenant_users(_actor_user_id) then
    raise insufficient_privilege using message = 'Actor no autorizado para administrar usuarios';
  end if;
  return query select m.id, u.id, u.email, u.display_name, m.role, m.status
    from app.tenant_users m join app.users u on u.id = m.user_id
    where m.tenant_id = app.current_tenant_id() order by lower(u.email);
end
$$;

create function app.create_tenant_user_invitation(
  _id uuid, _actor_user_id uuid, _email text, _role text,
  _token_hash char(64), _expires_at timestamptz, _correlation_id uuid
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare _tenant_id uuid := app.current_tenant_id(); _existing_user_id uuid;
begin
  if not app.can_manage_tenant_users(_actor_user_id) then
    raise insufficient_privilege using message = 'Actor no autorizado para invitar usuarios';
  end if;
  if _role not in ('owner', 'admin', 'operator', 'viewer') then
    raise check_violation using message = 'Rol inválido';
  end if;
  select id into _existing_user_id from app.users where lower(email) = lower(trim(_email));
  if _existing_user_id is not null and exists (
    select 1 from app.tenant_users where tenant_id = _tenant_id and user_id = _existing_user_id
  ) then raise unique_violation using message = 'El usuario ya pertenece al tenant'; end if;

  update app.tenant_user_invitations set status = 'expired', updated_at = now()
   where tenant_id = _tenant_id and lower(email) = lower(trim(_email))
     and status = 'pending' and expires_at <= now();
  insert into app.tenant_user_invitations
    (id, tenant_id, email, role, token_hash, invited_by_user_id, expires_at)
  values (_id, _tenant_id, lower(trim(_email)), _role, _token_hash, _actor_user_id, _expires_at);
  insert into app.audit_events
    (id, tenant_id, actor_type, actor_id, action, subject_type, subject_id, correlation_id, metadata)
  values (_correlation_id, _tenant_id, 'user', _actor_user_id, 'tenant_user.invited',
          'tenant_user_invitation', _id, _correlation_id, jsonb_build_object('role', _role));
  return _id;
end
$$;

create function app.accept_tenant_user_invitation(
  _token_hash char(64), _user_id uuid, _membership_id uuid,
  _display_name text, _password_hash text, _correlation_id uuid
)
returns table (user_id uuid, tenant_id uuid)
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare _invitation app.tenant_user_invitations%rowtype; _account_id uuid;
begin
  select * into _invitation from app.tenant_user_invitations
   where token_hash = _token_hash and status = 'pending' for update;
  if not found or _invitation.expires_at <= now() then
    raise invalid_authorization_specification using message = 'Invitación inválida o vencida';
  end if;
  select id into _account_id from app.users where lower(email) = lower(_invitation.email);
  if _account_id is null then
    _account_id := _user_id;
    insert into app.users (id, email, display_name, status)
    values (_account_id, _invitation.email, trim(_display_name), 'active');
    insert into app.local_credentials (user_id, password_hash)
    values (_account_id, _password_hash);
  elsif not exists (select 1 from app.local_credentials where user_id = _account_id) then
    insert into app.local_credentials (user_id, password_hash) values (_account_id, _password_hash);
    update app.users set status = 'active', display_name = trim(_display_name), updated_at = now()
     where id = _account_id;
  end if;
  insert into app.tenant_users (id, tenant_id, user_id, role, status)
  values (_membership_id, _invitation.tenant_id, _account_id, _invitation.role, 'active');
  update app.tenant_user_invitations set status = 'accepted', accepted_by_user_id = _account_id,
    accepted_at = now(), updated_at = now() where id = _invitation.id;
  insert into app.audit_events
    (id, tenant_id, actor_type, actor_id, action, subject_type, subject_id, correlation_id, metadata)
  values (_correlation_id, _invitation.tenant_id, 'user', _account_id, 'tenant_user.invitation_accepted',
          'tenant_user', _membership_id, _correlation_id, jsonb_build_object('role', _invitation.role));
  return query select _account_id, _invitation.tenant_id;
end
$$;

revoke all on app.tenant_user_invitations from public, commerce_runtime, commerce_readonly, commerce_outbox;
revoke all on function app.can_manage_tenant_users(uuid) from public;
revoke all on function app.list_tenant_users(uuid) from public;
revoke all on function app.create_tenant_user_invitation(uuid,uuid,text,text,char,timestamptz,uuid) from public;
revoke all on function app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid) from public;
grant execute on function app.can_manage_tenant_users(uuid) to commerce_runtime;
grant execute on function app.list_tenant_users(uuid) to commerce_runtime;
grant execute on function app.create_tenant_user_invitation(uuid,uuid,text,text,char,timestamptz,uuid) to commerce_runtime;
grant execute on function app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid) to commerce_runtime;

reset role;
