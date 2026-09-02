-- Platform administrators may manage a tenant without belonging to tenant_users.
-- Preserve the membership audit reference when it exists; otherwise leave it null.
set role commerce_owner;

create or replace function app.save_business_profile(
  _actor uuid,
  _description text,
  _address text,
  _phone text,
  _hours text,
  _payments text,
  _fulfillment text
) returns boolean
language plpgsql
security definer
set search_path=pg_catalog,app
as $$
declare
  tid uuid:=app.current_tenant_id();
  audit_actor uuid;
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then
    raise insufficient_privilege using message='Actor is not authorized to manage business knowledge';
  end if;

  select _actor into audit_actor
  where exists (
    select 1 from app.tenant_users
    where tenant_id=tid and user_id=_actor and status='active'
  );

  insert into app.business_profiles(
    tenant_id,description,address,phone,business_hours,payment_methods,
    fulfillment_options,updated_by_user_id
  ) values (
    tid,_description,_address,_phone,_hours,_payments,_fulfillment,audit_actor
  )
  on conflict(tenant_id) do update set
    description=excluded.description,
    address=excluded.address,
    phone=excluded.phone,
    business_hours=excluded.business_hours,
    payment_methods=excluded.payment_methods,
    fulfillment_options=excluded.fulfillment_options,
    updated_by_user_id=excluded.updated_by_user_id,
    updated_at=now();
  return true;
end
$$;

reset role;
