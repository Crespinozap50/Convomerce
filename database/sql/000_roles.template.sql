-- PLANTILLA DE INFRAESTRUCTURA; NO EJECUTAR AUTOMÁTICAMENTE.
-- No contiene LOGIN ni contraseñas. El provisionamiento seguro crea los roles
-- de acceso y les asigna las credenciales fuera del repositorio.

create role commerce_owner nologin nosuperuser nocreatedb nocreaterole noinherit;

create role commerce_migrator nologin nosuperuser nocreatedb nocreaterole noinherit;
create role commerce_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role commerce_outbox nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
create role commerce_readonly nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role commerce_resolver nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;

grant commerce_owner to commerce_migrator;

-- Los roles LOGIN específicos de cada entorno reciben membresía en uno de los
-- roles anteriores. Nunca se otorga commerce_owner al runtime ni al outbox.
-- commerce_resolver no recibe LOGIN y solo posee la función estrecha que resuelve
-- un canal autenticado; no se utiliza como identidad de conexión.
