\set ON_ERROR_STOP on

begin;
set local role commerce_owner;

-- D-143 (docs/decisions.md): persists this session's live catalog-realism
-- pass, which was applied directly against the dev database via the real
-- KnowledgeService code (not hand-written SQL) while diagnosing why
-- CrediCel's "Accesorios" category silently fell back to "Todavía no tengo
-- esa información" on a real WhatsApp test. Without this seed, a fresh
-- database re-provision would regress back to the old catalog: two
-- "Producto ficticio para desarrollo local" phones (004_credicel_store.sql,
-- predating the real 20-per-category catalog in 005/008), one fictitious
-- pair of headphones, one leftover "demo" laptop, and a `prueba-cat-*`
-- product created by earlier ad-hoc browser testing — plus every real
-- device would go back to having exactly one variant, undoing the very
-- multi-variant self-service feature (D-142) this pass exists to exercise
-- against real data. Two side effects found live while building this and
-- folded in as real bug fixes, not just data changes (see their own
-- comments in commercial-flow.service.ts): categoryItemsReply()'s >10-item
-- bail had no `catalogButtonReply` fallback when reached via a direct
-- "category:" id tap, and consultativeCandidates() joined per-variant
-- instead of per-product, silently dropping roughly half of a multi-variant
-- catalog from the AI recommendation candidate pool.
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);

-- Leftover placeholders that never met the "real catalog" bar this
-- tenant's products are held to (see 008_credicel_store_catalog_expansion.sql) —
-- retired rather than left duplicating real branded equivalents already in
-- the same category.
update app.catalog_items set status='archived',updated_at=now()
where id in (
  '0194f005-0000-7000-8000-100000000003',
  '0194f005-0000-7000-8000-100000000002',
  '0194f005-0000-7000-8000-100000000004',
  '0194f005-0000-7000-8000-000000000002',
  '01a06e99-fc29-76ad-bbba-af8218aa1b4d'
) and status<>'archived';

-- The project owner's follow-up correction to the same realism pass: a
-- handful of real (non-fictitious) products still named themselves by
-- generic brand+tier ("Celular Apple gama alta", "Celular Samsung gama
-- media") instead of an actual, recognizable model — "no debería decir
-- Apple gama alta, debería decir iPhone 15 o 16 o 17". Renamed to a real,
-- plausible model per product, keeping the same id/category/description
-- (only the name changes).
update app.catalog_items set name=v.new_name, updated_at=now()
from (values
  ('0194f005-0000-7000-8000-100000000043'::uuid,'iPhone 15 Pro'),
  ('0194f005-0000-7000-8000-100000000048'::uuid,'Samsung Galaxy S24 Ultra'),
  ('0194f005-0000-7000-8000-100000000019'::uuid,'Samsung Galaxy A55'),
  ('0194f005-0000-7000-8000-100000000047'::uuid,'Motorola Edge 50 Fusion'),
  ('0194f005-0000-7000-8000-100000000041'::uuid,'Realme 12 Pro'),
  ('0194f005-0000-7000-8000-100000000021'::uuid,'Google Pixel 8 Pro'),
  ('0194f005-0000-7000-8000-100000000005'::uuid,'Xiaomi Redmi 13C'),
  ('0194f005-0000-7000-8000-100000000038'::uuid,'Infinix Hot 40'),
  ('0194f005-0000-7000-8000-100000000065'::uuid,'Samsung Galaxy Tab S9+'),
  ('0194f005-0000-7000-8000-100000000069'::uuid,'Lenovo Legion Tab Y700'),
  ('0194f005-0000-7000-8000-100000000008'::uuid,'Dell XPS 15'),
  ('0194f005-0000-7000-8000-100000000080'::uuid,'GoPro Hero 12 Black'),
  ('0194f005-0000-7000-8000-100000000084'::uuid,'Sony Alpha A7 IV')
) as v(id, new_name)
where app.catalog_items.id = v.id and app.catalog_items.tenant_id = '0194f000-0000-7000-8000-000000000002';

-- Second (storage/RAM+SSD/capacity) variant for every real device and
-- capacity-bearing accessory that only had one — the write-side half of
-- D-142's multi-variant catalog self-service feature, exercised against
-- real inventory instead of only synthetic test fixtures. Prices step up
-- ~15% (phones/tablets: one storage tier) or ~22% (laptops: RAM+SSD tier),
-- rounded to the nearest 10,000 COP to match this catalog's existing price
-- style.
insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status)
values
 ('01a093e2-95bc-75fe-a629-f7f2e2789cd6','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000005','TECH-VAR-5-128','128 GB','active',52000000,'COP','available'),
 ('01a093e2-95c4-7512-9668-4e9f16dcb0cb','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000006','TECH-VAR-6-B','16GB RAM / 512 GB SSD','active',218000000,'COP','available'),
 ('01a093e2-95c7-711c-b191-dbb35bad318f','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000007','TECH-VAR-7-B','16GB RAM / 1 TB SSD','active',328000000,'COP','available'),
 ('01a093e2-95cd-762d-8783-5e8344be842e','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000008','TECH-VAR-8-B','64GB RAM / 2 TB SSD','active',597000000,'COP','available'),
 ('01a093e2-95d5-74e1-bb97-16c972b8dd7c','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000009','TECH-VAR-9-128','128 GB','active',75000000,'COP','available'),
 ('01a093e2-95d8-729c-aee4-00f134a6f0b7','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000010','TECH-VAR-10-256','256 GB','active',167000000,'COP','available'),
 ('01a093e2-95b5-7110-9bcf-f2f800c338dc','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000013','TECH-VAR-13-65W','65W','active',9500000,'COP','available'),
 ('01a093e2-95b1-755b-923d-e0128c3a14c6','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000014','TECH-VAR-14-20K','20000mAh','active',14500000,'COP','available'),
 ('01a093e2-961e-71d9-836b-5dd4c530468b','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000019','TECH-VAR-19-256','256 GB','active',113000000,'COP','available'),
 ('01a093e2-9622-7299-a999-fe9cbe8665bc','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000020','TECH-VAR-20-256','256 GB','active',83000000,'COP','available'),
 ('01a093e2-9625-76bd-9e6b-34ff7869870c','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000021','TECH-VAR-21-512','512 GB','active',332000000,'COP','available'),
 ('01a093e2-9629-727d-8bd2-6264e3e7649e','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000022','TECH-VAR-22-128','128 GB','active',67000000,'COP','available'),
 ('01a093e2-962c-75aa-b830-c51a2f0a8b4a','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000023','TECH-VAR-23-B','16GB RAM / 512 GB SSD','active',238000000,'COP','available'),
 ('01a093e2-9630-724f-8b13-166e4d7816f9','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000024','TECH-VAR-24-B','32GB RAM / 1 TB SSD','active',475000000,'COP','available'),
 ('01a093e2-9633-73c5-9425-8c742ff53c4f','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000025','TECH-VAR-25-B','32GB RAM / 1 TB SSD','active',348000000,'COP','available'),
 ('01a093e2-95ea-74d5-a2b1-901454bbcbe1','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000026','TECH-VAR-26-B','32GB RAM / 1 TB SSD','active',384000000,'COP','available'),
 ('01a093e2-95ef-74eb-b612-8bd9459650b4','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000027','TECH-VAR-27-B','16GB RAM / 512 GB SSD','active',194000000,'COP','available'),
 ('01a093e2-95f3-778e-85e8-4d6bb2db4565','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000028','TECH-VAR-28-B','32GB RAM / 1 TB SSD','active',720000000,'COP','available'),
 ('01a093e2-95f8-7059-94bb-7a8a3d206068','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000029','TECH-VAR-29-256','256 GB','active',102000000,'COP','available'),
 ('01a093e2-95fc-70fe-ad4a-bc683aee0c71','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000030','TECH-VAR-30-512','512 GB','active',282000000,'COP','available'),
 ('01a093e2-95dc-7109-aae9-89c0bdf4d0fd','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000038','TECH-VAR-38-256','256 GB','active',48000000,'COP','available'),
 ('01a093e2-95e1-73ad-9f4b-dae2c1ee60e4','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000039','TECH-VAR-39-256','256 GB','active',102000000,'COP','available'),
 ('01a093e2-95e6-751f-8f09-5d185afe9ca8','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000040','TECH-VAR-40-512','512 GB','active',113000000,'COP','available'),
 ('01a093e2-9600-74a8-bfeb-040da56981aa','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000041','TECH-VAR-41-256','256 GB','active',86000000,'COP','available'),
 ('01a093e2-9604-7421-8b96-e4e0c7ba9642','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000042','TECH-VAR-42-64','64 GB','active',37000000,'COP','available'),
 ('01a093e2-9608-75dc-9080-d9ebd9b5d57e','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000043','TECH-VAR-43-256','256 GB','active',378000000,'COP','available'),
 ('01a093e2-960c-74ad-8115-7d8bdceca6a9','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000044','TECH-VAR-44-512','512 GB','active',748000000,'COP','available'),
 ('01a093e2-9610-718b-bdbf-3258626249e6','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000045','TECH-VAR-45-512','512 GB','active',167000000,'COP','available'),
 ('01a093e2-9614-754c-9c8f-89d782cc8ad0','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000046','TECH-VAR-46-128','128 GB','active',44000000,'COP','available'),
 ('01a093e2-9617-76a8-a988-002fee31f531','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000047','TECH-VAR-47-256','256 GB','active',94000000,'COP','available'),
 ('01a093e2-961b-70f8-83bf-96b16ed78917','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000048','TECH-VAR-48-512','512 GB','active',447000000,'COP','available'),
 ('01a093e2-9637-762b-8208-67da66238aea','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000049','TECH-VAR-49-256','256 GB','active',137000000,'COP','available'),
 ('01a093e2-963a-7170-9f08-5cce66d5b32e','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000050','TECH-VAR-50-256','256 GB','active',109000000,'COP','available'),
 ('01a093e2-963e-768c-a561-c5c243cec12c','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000051','TECH-VAR-51-B','64GB RAM / 2 TB SSD','active',842000000,'COP','available'),
 ('01a093e2-9641-7087-bb1e-72e07e9ac5ae','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000052','TECH-VAR-52-B','32GB RAM / 1 TB SSD','active',708000000,'COP','available'),
 ('01a093e2-9645-7042-b500-bfaaf1febb39','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000053','TECH-VAR-53-B','16GB RAM / 512 GB SSD','active',353000000,'COP','available'),
 ('01a093e2-9648-70b3-9e50-83dcfdd54d2d','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000054','TECH-VAR-54-B','8GB RAM / 256 GB SSD','active',157000000,'COP','available'),
 ('01a093e2-964c-72b2-83ad-21e1726f64b5','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000055','TECH-VAR-55-B','64GB RAM / 2 TB SSD','active',1159000000,'COP','available'),
 ('01a093e2-964f-7153-8c21-8ee6ed93aadc','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000056','TECH-VAR-56-B','16GB RAM / 512 GB SSD','active',194000000,'COP','available'),
 ('01a093e2-9652-761b-bbd2-b3ffda38ebd3','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000057','TECH-VAR-57-B','32GB RAM / 1 TB SSD','active',634000000,'COP','available'),
 ('01a093e2-9654-776c-bc6a-98b0705c0269','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000058','TECH-VAR-58-B','8GB RAM / 128 GB SSD','active',121000000,'COP','available'),
 ('01a093e2-9657-7789-b0ba-0c63b7cc78a2','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000059','TECH-VAR-59-B','32GB RAM / 1 TB SSD','active',438000000,'COP','available'),
 ('01a093e2-9659-72da-a6c9-c2f510f9d9d2','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000060','TECH-VAR-60-B','16GB RAM / 1 TB SSD','active',267000000,'COP','available'),
 ('01a093e2-965b-73a9-a817-843334a916e7','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000061','TECH-VAR-61-256','256 GB','active',275000000,'COP','available'),
 ('01a093e2-965d-750e-87f4-238cf39928ad','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000062','TECH-VAR-62-512','512 GB','active',564000000,'COP','available'),
 ('01a093e2-9660-716d-a6db-3e493df7104f','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000063','TECH-VAR-63-256','256 GB','active',102000000,'COP','available'),
 ('01a093e2-9662-770f-8dfd-c7479205a4d8','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000064','TECH-VAR-64-64','64 GB','active',60000000,'COP','available'),
 ('01a093e2-9664-753c-8170-08eab3fb4e76','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000065','TECH-VAR-65-512','512 GB','active',378000000,'COP','available'),
 ('01a093e2-9666-7633-a90f-53f370f82627','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000066','TECH-VAR-66-256','256 GB','active',137000000,'COP','available'),
 ('01a093e2-9669-77da-ae84-37bc209f2f48','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000067','TECH-VAR-67-128','128 GB','active',183000000,'COP','available'),
 ('01a093e2-966b-720a-8fb6-d46490738869','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000068','TECH-VAR-68-64','64 GB','active',79000000,'COP','available'),
 ('01a093e2-966e-752b-9de1-20f39dc35e30','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000069','TECH-VAR-69-512','512 GB','active',217000000,'COP','available'),
 ('01a093e2-9670-705f-93eb-d04595b491da','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000070','TECH-VAR-70-256','256 GB','active',252000000,'COP','available'),
 ('01a093e2-9672-70b9-9f69-c0fa70a1b292','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000071','TECH-VAR-71-64','64 GB','active',48000000,'COP','available'),
 ('01a093e2-9674-70cc-9c49-8b94683a3b51','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000072','TECH-VAR-72-512','512 GB','active',413000000,'COP','available'),
 ('01a093e2-9678-710a-8cdb-51689d17e268','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000073','TECH-VAR-73-128','128 GB','active',113000000,'COP','available'),
 ('01a093e2-967a-730a-9399-4eb92a10a8e0','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000074','TECH-VAR-74-256','256 GB','active',148000000,'COP','available'),
 ('01a093e2-967d-749f-94b6-b8a101cd01f5','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000075','TECH-VAR-75-64','64 GB','active',44000000,'COP','available'),
 ('01a093e2-967f-725e-ab52-caf2ed7d3587','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000076','TECH-VAR-76-128','128 GB','active',75000000,'COP','available'),
 ('01a093e2-95a8-74e3-9272-ed2866d7b89b','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000100','TECH-VAR-100-256','256GB','active',8500000,'COP','available'),
 ('01a093e2-95ae-707b-bacd-f910e6244c0b','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000101','TECH-VAR-101-512','512GB','active',13000000,'COP','available')
on conflict(id) do update set name=excluded.name,status=excluded.status,price_minor=excluded.price_minor,
 currency=excluded.currency,availability_status=excluded.availability_status,updated_at=now();

commit;
