-- Give the dashboard enough tenant metadata to preselect and label memberships.
set role commerce_owner;
grant create on schema app to commerce_resolver;
set role commerce_resolver;
create or replace function app.get_local_user_context(_user_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,app as $$
 select jsonb_build_object(
  'userId',account.id,'email',account.email,'displayName',account.display_name,
  'uiLanguage',account.interface_locale,'mustChangePassword',credential.must_change_password,
  'platformRole',(select admin.role from app.platform_admins admin where admin.user_id=account.id and admin.status='active'),
  'memberships',coalesce((select jsonb_agg(jsonb_build_object(
    'tenantId',membership.tenant_id,'tenantName',tenant.display_name,'role',membership.role
  ) order by membership.created_at)
    from app.tenant_users membership join app.tenants tenant on tenant.id=membership.tenant_id
    where membership.user_id=account.id and membership.status='active' and tenant.status='active'),'[]'::jsonb)
 ) from app.users account join app.local_credentials credential on credential.user_id=account.id
 where account.id=_user_id and account.status='active'
$$;
reset role;
revoke create on schema app from commerce_resolver;
