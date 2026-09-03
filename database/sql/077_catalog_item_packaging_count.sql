-- D-104: which products count toward "1 packaging fee per N items" — a
-- drink doesn't need the same takeout container as a dish, but this is a
-- per-tenant/per-menu distinction (not every industry even has "food" vs
-- "drink"), so it's a data flag, not a hardcoded category name in code.
-- Defaults true (every existing item counts, unchanged) — a tenant opts
-- specific items (typically drinks) out explicitly.
set role commerce_owner;

alter table app.catalog_items add column counts_toward_packaging boolean not null default true;

reset role;
