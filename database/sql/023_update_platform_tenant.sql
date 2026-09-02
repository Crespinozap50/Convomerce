-- Editable company metadata for platform owners. The immutable slug remains the internal identifier.

set role commerce_owner;

create function app.update_platform_tenant(
  _actor_user_id uuid,
  _tenant_id uuid,
  _display_name text,
  _timezone text,
  _default_locale text,
  _status text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, app
as $$
begin
  if not exists (
    select 1 from app.platform_admins admin
     where admin.user_id = _actor_user_id
       and admin.role = 'owner'
       and admin.status = 'active'
  ) then
    raise insufficient_privilege using message = 'Actor is not authorized to update companies';
  end if;
  if length(trim(_display_name)) not between 2 and 120
     or length(trim(_timezone)) not between 1 and 64
     or length(trim(_default_locale)) not between 2 and 16
     or _status not in ('active', 'suspended', 'disabled') then
    raise check_violation using message = 'Invalid company configuration';
  end if;
  update app.tenants
     set display_name = trim(_display_name),
         timezone = trim(_timezone),
         default_locale = trim(_default_locale),
         status = _status,
         updated_at = now()
   where id = _tenant_id;
  if not found then raise no_data_found using message = 'Company not found'; end if;
  return true;
end
$$;

revoke all on function app.update_platform_tenant(uuid,uuid,text,text,text,text) from public;
grant execute on function app.update_platform_tenant(uuid,uuid,text,text,text,text) to commerce_runtime;

reset role;
