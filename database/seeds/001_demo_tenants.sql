\set ON_ERROR_STOP on

begin;
set local role commerce_owner;

insert into app.tenants (id, slug, display_name, status, timezone, default_locale)
values
  ('0194f000-0000-7000-8000-000000000001', 'restaurante-demo', 'Restaurante Demo', 'active', 'America/Bogota', 'es-CO'),
  ('0194f000-0000-7000-8000-000000000002', 'tecnologia-demo', 'Tecnología Demo', 'active', 'America/Bogota', 'es-CO')
on conflict (id) do nothing;

insert into app.users (id, email, display_name, status)
values
  ('0194f000-0000-7000-8000-000000000101', 'admin@commerce.test', 'Administración Demo', 'active'),
  ('0194f000-0000-7000-8000-000000000102', 'owner.restaurante@commerce.test', 'Propietario Restaurante Demo', 'active')
on conflict (id) do nothing;

insert into app.platform_admins (user_id, role, status)
values ('0194f000-0000-7000-8000-000000000101', 'owner', 'active')
on conflict (user_id) do nothing;

-- Contraseña ficticia local: LocalDemo-ChangeMe-2026!
-- Ambos usuarios deben cambiarla al implementar la pantalla correspondiente.
insert into app.local_credentials (user_id, password_hash, must_change_password)
values
  ('0194f000-0000-7000-8000-000000000101', '$argon2id$v=19$m=65536,t=3,p=4$+pGXH5M5N3CKAIQlJwnPDQ$u/GrIcaoDXLcTDdxm153dSH2Xw+xriyEIM2A3bj7mUA', true),
  ('0194f000-0000-7000-8000-000000000102', '$argon2id$v=19$m=65536,t=3,p=4$+pGXH5M5N3CKAIQlJwnPDQ$u/GrIcaoDXLcTDdxm153dSH2Xw+xriyEIM2A3bj7mUA', true)
on conflict (user_id) do nothing;

select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);

insert into app.tenant_users (id, tenant_id, user_id, role, status)
values ('0194f000-0000-7000-8000-000000000111', '0194f000-0000-7000-8000-000000000001',
        '0194f000-0000-7000-8000-000000000102', 'owner', 'active')
on conflict (tenant_id, user_id) do nothing;

insert into app.channels (id, tenant_id, provider, external_account_id, external_address, status, secret_reference)
values ('0194f001-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
        'whatsapp_cloud', 'demo-account-restaurant', '+570000000001', 'active', 'local/demo/restaurant')
on conflict (id) do nothing;

insert into app.contacts (id, tenant_id, display_name, locale, consent_status)
values ('0194f002-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
        'Cliente Restaurante', 'es-CO', 'unknown')
on conflict (id) do nothing;

insert into app.contact_identities (
  id, tenant_id, contact_id, channel_id, provider_subject, normalized_address
) values (
  '0194f002-1000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
  '0194f002-0000-7000-8000-000000000001', '0194f001-0000-7000-8000-000000000001',
  'fixture-recipient-restaurant', '000000000101'
)
on conflict (id) do nothing;

insert into app.conversations (id, tenant_id, channel_id, contact_id, status)
values ('0194f003-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
        '0194f001-0000-7000-8000-000000000001', '0194f002-0000-7000-8000-000000000001', 'open')
on conflict (id) do nothing;

insert into app.catalogs (id, tenant_id, name, status, currency, version, published_at)
values ('0194f004-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
        'Menú de demostración', 'published', 'COP', 1, now())
on conflict (id) do nothing;

insert into app.catalog_items (id, tenant_id, catalog_id, external_reference, name, description, category, status)
values ('0194f005-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
        '0194f004-0000-7000-8000-000000000001', 'REST-DEMO-1', 'Plato de la casa',
        'Producto ficticio para desarrollo local', 'platos', 'active')
on conflict (id) do nothing;

insert into app.item_variants (id, tenant_id, catalog_item_id, sku, name, status, price_minor, currency, availability_status)
values ('0194f006-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
        '0194f005-0000-7000-8000-000000000001', 'REST-VAR-1', 'Porción estándar', 'active', 2500000, 'COP', 'available')
on conflict (id) do nothing;

insert into app.knowledge_entries (id, tenant_id, kind, title, content, status, version)
values ('0194f007-0000-7000-8000-000000000001', '0194f000-0000-7000-8000-000000000001',
        'hours', 'Horario ficticio', 'Atención de demostración de 11:00 a 20:00.', 'published', 1)
on conflict (id) do nothing;

select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000002', true);

insert into app.channels (id, tenant_id, provider, external_account_id, external_address, status, secret_reference)
values ('0194f001-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
        'whatsapp_cloud', 'demo-account-technology', '+570000000002', 'active', 'local/demo/technology')
on conflict (id) do nothing;

insert into app.contacts (id, tenant_id, display_name, locale, consent_status)
values ('0194f002-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
        'Cliente Tecnología', 'es-CO', 'unknown')
on conflict (id) do nothing;

insert into app.contact_identities (
  id, tenant_id, contact_id, channel_id, provider_subject, normalized_address
) values (
  '0194f002-1000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
  '0194f002-0000-7000-8000-000000000002', '0194f001-0000-7000-8000-000000000002',
  'fixture-recipient-technology', '000000000102'
)
on conflict (id) do nothing;

insert into app.conversations (id, tenant_id, channel_id, contact_id, status)
values ('0194f003-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
        '0194f001-0000-7000-8000-000000000002', '0194f002-0000-7000-8000-000000000002', 'open')
on conflict (id) do nothing;

insert into app.catalogs (id, tenant_id, name, status, currency, version, published_at)
values ('0194f004-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
        'Catálogo tecnológico de demostración', 'published', 'COP', 1, now())
on conflict (id) do nothing;

insert into app.catalog_items (id, tenant_id, catalog_id, external_reference, name, description, category, status)
values ('0194f005-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
        '0194f004-0000-7000-8000-000000000002', 'TECH-DEMO-1', 'Equipo portátil demo',
        'Producto ficticio para desarrollo local', 'computadores', 'active')
on conflict (id) do nothing;

insert into app.item_variants (id, tenant_id, catalog_item_id, sku, name, status, price_minor, currency, availability_status)
values ('0194f006-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
        '0194f005-0000-7000-8000-000000000002', 'TECH-VAR-1', 'Configuración base', 'active', 350000000, 'COP', 'available')
on conflict (id) do nothing;

insert into app.knowledge_entries (id, tenant_id, kind, title, content, status, version)
values ('0194f007-0000-7000-8000-000000000002', '0194f000-0000-7000-8000-000000000002',
        'policy', 'Garantía', 'La garantía de demostración no representa una oferta real.', 'published', 1)
on conflict (id) do nothing;

-- database/sql/033_conversation_workflows.sql backfills customer_data_requirements
-- from app.tenants *at migration time* — but these two tenants are only ever
-- created here, by a seed that runs after every migration, so that backfill
-- always sees zero rows for them on a fresh install (migrate.sh then
-- seed.sh). Mirrors the same backfill seeds/003 already does for its own
-- tenants (0003-0005), for the same reason. Found live: this is why
-- app.operational_requirements ended up empty for the restaurant tenant on a
-- freshly migrated + seeded database — 056's own backfill reads from this
-- table, and found nothing to read.
alter table app.customer_data_requirements no force row level security;
insert into app.customer_data_requirements
 (tenant_id,operation_type,fulfillment_type,require_name,require_phone,require_address)
select tenant_id,rule.operation_type,rule.fulfillment_type,true,true,rule.require_address
from (values
 ('0194f000-0000-7000-8000-000000000001'::uuid),
 ('0194f000-0000-7000-8000-000000000002'::uuid)
) tenant(tenant_id)
cross join (values
 ('order','pickup',false),('order','delivery',true),('order','on_site',false),
 ('appointment','on_site',false),('appointment','at_home',true),
 ('service','on_site',false),('service','at_home',true)
) rule(operation_type,fulfillment_type,require_address)
on conflict(tenant_id,operation_type,fulfillment_type) do update
 set require_name=excluded.require_name,require_phone=excluded.require_phone,
     require_address=excluded.require_address,updated_at=now();
alter table app.customer_data_requirements force row level security;

commit;

\echo 'Datos ficticios cargados para restaurante-demo y tecnologia-demo.'
