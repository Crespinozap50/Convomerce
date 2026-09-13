\set ON_ERROR_STOP on

begin;
set local role commerce_owner;

-- D-149 (docs/decisions.md): live finding — a real customer asked "Cuál son
-- las especificaciones del iPhone 17 ?" and, right after, "Y el 16 ?".
-- CrediCel's catalog only carried "iPhone 15 Pro" (009's realism pass), so
-- the consultative AI correctly found nothing to recommend and the bot fell
-- back to its generic "no tengo esa información" message — not a bug, but a
-- real content gap for a phone store operating in 2026, where the 16 and 17
-- are current, plausible stock. Adds both as real catalog items (applied
-- live first via the real KnowledgeService.createOffering/createVariant,
-- not hand-written SQL — this just persists that same state so a
-- reprovisioned database doesn't regress). Same two-variant convention as
-- every other multi-variant phone in 009 (base storage + a larger one, ~12%
-- price step), and the same catalog id every other CrediCel product in
-- 008/009 already uses.
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);

insert into app.catalog_items(id,tenant_id,catalog_id,name,description,category,status,offering_type,source_provider)
values
 ('01a09680-e98d-7159-9ba7-481a071c0356','0194f000-0000-7000-8000-000000000002','0194f004-0000-7000-8000-000000000002',
  'iPhone 16',
  'Pantalla 6.1", 128GB de almacenamiento, sistema de cámaras dual con Modo Acción y grabación en 4K, chip A18 con funciones de Apple Intelligence. Pensado para quien busca el ecosistema Apple más reciente con muy buen desempeño general.',
  'celulares','active','product','manual'),
 ('01a09680-e99f-768a-abec-dfa496999e73','0194f000-0000-7000-8000-000000000002','0194f004-0000-7000-8000-000000000002',
  'iPhone 17',
  'Pantalla 6.3", 128GB de almacenamiento, sistema de cámaras dual con teleobjetivo mejorado y grabación en 4K, chip A19 con funciones avanzadas de Apple Intelligence. Pensado para quien busca lo último del ecosistema Apple con el mejor desempeño disponible.',
  'celulares','active','product','manual')
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,
 status=excluded.status,offering_type=excluded.offering_type,updated_at=now();

insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status)
values
 ('01a09680-e98d-7159-9ba7-4f200a93d8bc','0194f000-0000-7000-8000-000000000002','01a09680-e98d-7159-9ba7-481a071c0356','TECH-VAR-IPHONE16','Único','active',420000000,'COP','available'),
 ('01a09680-e999-7488-9a60-d17b36e58732','0194f000-0000-7000-8000-000000000002','01a09680-e98d-7159-9ba7-481a071c0356','TECH-VAR-IPHONE16-256','256 GB','active',470000000,'COP','available'),
 ('01a09680-e99f-768a-abec-e36235c0bb52','0194f000-0000-7000-8000-000000000002','01a09680-e99f-768a-abec-dfa496999e73','TECH-VAR-IPHONE17','Único','active',490000000,'COP','available'),
 ('01a09680-e9a4-776a-8cef-b326b9a394ec','0194f000-0000-7000-8000-000000000002','01a09680-e99f-768a-abec-dfa496999e73','TECH-VAR-IPHONE17-256','256 GB','active',545000000,'COP','available')
on conflict(id) do update set name=excluded.name,status=excluded.status,price_minor=excluded.price_minor,
 currency=excluded.currency,availability_status=excluded.availability_status,updated_at=now();

commit;
