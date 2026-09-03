-- D-104: automatic packaging charge (1 fee per N food items in the order,
-- minimum 1 whenever the order has anything at all, only for pickup/
-- delivery). Marks which catalog_item (if any) supplies the fee's price —
-- generic across tenants, no hardcoded product name: a tenant with no
-- packaging fee configured (the default, every existing item false) simply
-- never gets a line added. At most one per tenant, enforced below the same
-- way a tenant's default address is enforced elsewhere in this schema.
set role commerce_owner;

alter table app.catalog_items add column is_packaging_fee boolean not null default false;

create unique index catalog_items_one_packaging_fee_uidx
  on app.catalog_items (tenant_id) where is_packaging_fee;

reset role;
