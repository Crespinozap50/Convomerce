-- D-097: a catalog item can now be restricted to a daily time window (e.g.
-- lunch-only dishes vs. the rest of the menu) instead of always being
-- orderable. Both columns null means always available — every existing
-- item across every tenant keeps its current behavior unchanged.
set role commerce_owner;

alter table app.catalog_items add column available_from_time time;
alter table app.catalog_items add column available_until_time time;

reset role;
