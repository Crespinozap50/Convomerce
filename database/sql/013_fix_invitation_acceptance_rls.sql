-- La aceptación comienza sin tenant conocido. La función estrecha se ejecuta
-- bajo commerce_resolver (NOLOGIN + BYPASSRLS), igual que el resolver WhatsApp.

set role commerce_owner;

drop function app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid);
grant usage, create on schema app to commerce_resolver;
grant select, update on app.tenant_user_invitations to commerce_resolver;
grant select, insert, update on app.users to commerce_resolver;
grant select, insert on app.local_credentials to commerce_resolver;
grant select, insert on app.tenant_users to commerce_resolver;
grant insert on app.audit_events to commerce_resolver;

reset role;
set role commerce_resolver;

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

reset role;
set role commerce_owner;
revoke create on schema app from commerce_resolver;
revoke all on function app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid) from public;
grant execute on function app.accept_tenant_user_invitation(char,uuid,uuid,text,text,uuid) to commerce_runtime;

reset role;
