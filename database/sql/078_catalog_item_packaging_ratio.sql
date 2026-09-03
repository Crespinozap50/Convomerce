-- D-104: how many food items one packaging fee covers — lives on the same
-- row as is_packaging_fee/price, since a tenant editing "how much do we
-- charge for packaging" and "how many items per package" are the same
-- configuration action. Meaningless (and left null) on every item that
-- isn't the packaging-fee item.
set role commerce_owner;

alter table app.catalog_items add column packaging_ratio integer check (packaging_ratio is null or packaging_ratio > 0);

reset role;
