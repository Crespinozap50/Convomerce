set role commerce_owner;

-- Runtime conversations need the tenant timezone for date interpretation.
-- RLS still limits the visible row to app.current_tenant_id().
grant select (id,timezone) on app.tenants to commerce_runtime;

reset role;
