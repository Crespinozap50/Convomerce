-- D-195 (docs/decisions.md): a Loggro order line with a mapped modifier
-- (D-192/D-193) creates TWO independent order documents in Loggro, one per
-- entry in `orders[]` — never one order with two lines. pushOrder() used to
-- keep only the first created id, leaving every modifier's own order
-- document untracked (a real orphan found live today, cleaned up by hand).
-- pos_external_order_id now tracks every id Loggro returned for a push.
set role commerce_owner;

alter table app.commercial_requests
  alter column pos_external_order_id type text[]
  using case when pos_external_order_id is null then null else array[pos_external_order_id] end;

reset role;
