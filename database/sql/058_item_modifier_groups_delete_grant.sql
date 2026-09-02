-- Fixes a grant gap found while exercising ModifierGroupsService against the
-- real database: setItemGroups replaces the full set of extras groups
-- assigned to a product with a literal delete+insert (same precedent as
-- 057's operational_requirement_options — a plain association/link row has
-- no soft-delete concept, unlike catalog_items/modifier_groups/
-- modifier_options themselves, which stay archived rather than deleted).
-- 003 only granted select/insert/update to commerce_runtime on
-- app.item_modifier_groups.
set role commerce_owner;

grant delete on app.item_modifier_groups to commerce_runtime;

reset role;
