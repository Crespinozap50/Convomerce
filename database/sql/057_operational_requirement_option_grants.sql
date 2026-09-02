-- Fixes a grant gap found while exercising OperationalRequirementsService
-- against the real database: setOptions replaces the option list with a
-- literal delete+insert (no soft-delete concept applies to a set of option
-- values), but 056 only granted select/insert/update to commerce_runtime.
-- 056 is already applied locally, so this is a new migration rather than an
-- edit to 056 (handoff rule: never edit an already-applied migration).
set role commerce_owner;

grant delete on app.operational_requirement_options to commerce_runtime;
grant delete on app.operational_requirement_option_localizations to commerce_runtime;

reset role;
