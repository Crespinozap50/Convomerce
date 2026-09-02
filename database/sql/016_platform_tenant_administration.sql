-- Administración global de empresas para propietarios de la plataforma.

set role commerce_owner;

create function app.list_platform_tenants(_actor_user_id uuid)
returns table (id uuid, slug text, display_name text, status text, timezone text, default_locale text)
language plpgsql stable security definer set search_path = pg_catalog, app
as $$
begin
  if not exists (
    select 1 from app.platform_admins
     where user_id = _actor_user_id and role = 'owner' and status = 'active'
  ) then
    raise insufficient_privilege using message = 'Actor no autorizado para administrar empresas';
  end if;
  return query select t.id, t.slug, t.display_name, t.status, t.timezone, t.default_locale
    from app.tenants t order by lower(t.display_name);
end
$$;

create function app.create_platform_tenant(
  _actor_user_id uuid, _tenant_id uuid, _membership_id uuid,
  _slug text, _display_name text, _timezone text, _default_locale text
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, app
as $$
begin
  if not exists (
    select 1 from app.platform_admins
     where user_id = _actor_user_id and role = 'owner' and status = 'active'
  ) then
    raise insufficient_privilege using message = 'Actor no autorizado para crear empresas';
  end if;
  if trim(_display_name) = '' or _slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise check_violation using message = 'Nombre o identificador de empresa inválido';
  end if;
  insert into app.tenants (id, slug, display_name, status, timezone, default_locale)
  values (_tenant_id, _slug, trim(_display_name), 'active', _timezone, _default_locale);
  insert into app.tenant_users (id, tenant_id, user_id, role, status)
  values (_membership_id, _tenant_id, _actor_user_id, 'owner', 'active');
  return _tenant_id;
end
$$;

revoke all on function app.list_platform_tenants(uuid) from public;
revoke all on function app.create_platform_tenant(uuid,uuid,uuid,text,text,text,text) from public;
grant execute on function app.list_platform_tenants(uuid) to commerce_runtime;
grant execute on function app.create_platform_tenant(uuid,uuid,uuid,text,text,text,text) to commerce_runtime;

reset role;
