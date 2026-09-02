set role commerce_owner;

-- Runtime conversations need the tenant display name for configured assistant
-- introductions. RLS continues to restrict access to the active tenant.
grant select (id, display_name, timezone) on app.tenants to commerce_runtime;

reset role;
