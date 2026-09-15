-- Encontrado en vivo revisando una conversación real (Santiago, Santos
-- Tacos, docs/decisions.md): un modificador ("Guacamole", +$3.000) llegaba
-- a Loggro solo como texto libre dentro de las notas de la línea del
-- producto padre — nunca como su propio producto con precio real, así que
-- Loggro registraba $9.500 (solo el Dorado de Pollo) en vez de los $12.500
-- reales cobrados al cliente. Loggro tiene un campo hecho justo para esto
-- (`orders[].productsExtra: [{product, quantity, price}]`, ver
-- developer.loggro.com/reference/crearpedidos) — hace falta poder mapear un
-- app.modifier_options a su producto real de Loggro, igual que ya se hace
-- por item_variant_id.
set role commerce_owner;

alter table app.pos_product_mappings
  alter column item_variant_id drop not null,
  add column modifier_option_id uuid,
  add constraint pos_product_mappings_target_check check (
    (item_variant_id is not null and modifier_option_id is null)
    or (item_variant_id is null and modifier_option_id is not null)
  ),
  add foreign key (tenant_id, modifier_option_id) references app.modifier_options(tenant_id, id) on delete restrict;

-- NULLs no chocan entre sí en un unique index de Postgres — coexiste sin
-- problema con el unique existente de item_variant_id (que sigue exigiendo
-- unicidad solo entre filas donde modifier_option_id es NULL).
create unique index pos_product_mappings_modifier_uidx
  on app.pos_product_mappings(tenant_id, pos_connection_id, modifier_option_id)
  where modifier_option_id is not null;

reset role;
