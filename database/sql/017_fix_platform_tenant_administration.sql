-- Califica columnas que coinciden con nombres de salida PL/pgSQL.

set role commerce_owner;

create or replace function app.list_platform_tenants(_actor_user_id uuid)
returns table (id uuid, slug text, display_name text, status text, timezone text, default_locale text)
language plpgsql stable security definer set search_path = pg_catalog, app
as $$
begin
  if not exists (
    select 1 from app.platform_admins admin
     where admin.user_id = _actor_user_id
       and admin.role = 'owner'
       and admin.status = 'active'
  ) then
    raise insufficient_privilege using message = 'Actor no autorizado para administrar empresas';
  end if;
  return query select tenant.id, tenant.slug, tenant.display_name, tenant.status,
                      tenant.timezone, tenant.default_locale
    from app.tenants tenant order by lower(tenant.display_name);
end
$$;

create or replace function app.create_platform_tenant(
  _actor_user_id uuid, _tenant_id uuid, _membership_id uuid,
  _slug text, _display_name text, _timezone text, _default_locale text
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, app
as $$
begin
  if not exists (
    select 1 from app.platform_admins admin
     where admin.user_id = _actor_user_id
       and admin.role = 'owner'
       and admin.status = 'active'
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

reset role;
