-- D-104: some catalog items exist only to be priced and referenced by the
-- application itself (e.g. an automatically-calculated packaging fee), not
-- to be browsed or ordered directly by a customer. Defaults true so every
-- existing item across every tenant keeps its current behavior unchanged —
-- only specific items get flagged false, and always via a direct data
-- update, never through this schema-only migration (see docs/decisions.md).
set role commerce_owner;

alter table app.catalog_items add column customer_orderable boolean not null default true;

reset role;
