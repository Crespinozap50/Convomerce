\set ON_ERROR_STOP on

-- Roles de grupo sin LOGIN. El acceso local se realiza mediante el usuario
-- postgres que vive exclusivamente dentro del contenedor de desarrollo.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'commerce_owner') then
    create role commerce_owner nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'commerce_migrator') then
    create role commerce_migrator nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'commerce_runtime') then
    create role commerce_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'commerce_outbox') then
    create role commerce_outbox nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'commerce_readonly') then
    create role commerce_readonly nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'commerce_resolver') then
    create role commerce_resolver nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
end
$$;

grant commerce_owner to commerce_migrator;
grant create on database whatsapp_commerce to commerce_owner;
