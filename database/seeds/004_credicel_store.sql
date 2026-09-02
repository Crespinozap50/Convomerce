\set ON_ERROR_STOP on

begin;
set local role commerce_owner;

-- CrediCel Store Demo (tenant 0194f000-0000-7000-8000-000000000002) was created by
-- 001_demo_tenants.sql before the bot-configuration / tenant-owner pattern used by
-- 002/003 existed. It shipped with a channel and a single catalog item but no bot
-- configuration and no owner login, so the bot could never reply and no one could
-- sign into the dashboard for it. This seed brings it up to the same standard as
-- the other demo tenants.

-- Administrador ficticio del tenant CrediCel Store. No es administrador de plataforma.
insert into app.users(id,email,display_name,status)
values('0194f000-0000-7000-8000-000000000104','admin.credicel@commerce.test','Administración CrediCel Store','active')
on conflict(id) do update set display_name=excluded.display_name,status='active',updated_at=now();
-- Contraseña ficticia local: LocalDemo-ChangeMe-2026!
insert into app.local_credentials(user_id,password_hash,must_change_password)
values('0194f000-0000-7000-8000-000000000104','$argon2id$v=19$m=65536,t=3,p=4$+pGXH5M5N3CKAIQlJwnPDQ$u/GrIcaoDXLcTDdxm153dSH2Xw+xriyEIM2A3bj7mUA',true)
on conflict(user_id) do nothing;

select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);

-- 001_demo_tenants.sql seeded this tenant with orders disabled, which meant
-- conversation-decision.engine.ts's `if(capabilities.has('orders'))` gate
-- never ran CommercialFlowService.resolve for it: tapping a catalog item
-- fell straight through to the knowledge/fallback path with no
-- acknowledgment of the selection. CrediCel Store is a real product
-- storefront (celulares, portátiles, accesorios), so it should support the
-- same order flow as Santos Tacos.
update app.tenant_capabilities set enabled=true,updated_at=now()
where tenant_id='0194f000-0000-7000-8000-000000000002' and capability='orders';

insert into app.tenant_users(id,tenant_id,user_id,role,status)
values('0194f000-0000-7000-8000-000000000114','0194f000-0000-7000-8000-000000000002','0194f000-0000-7000-8000-000000000104','admin','active')
on conflict(tenant_id,user_id) do update set role='admin',status='active',updated_at=now();

insert into app.business_profiles(tenant_id,description,address,phone,business_hours,payment_methods,fulfillment_options)
values(
 '0194f000-0000-7000-8000-000000000002',
 'Tienda de tecnología especializada en celulares, portátiles y accesorios, con planes de crédito directo para quienes no manejan tarjeta de crédito.',
 'Centro Comercial demo, Medellín. Dirección completamente ficticia para demostración.',
 '+57 300 000 0202 (número ficticio)',
 E'Lunes a sábado de 10:00 a. m. a 8:00 p. m.\nDomingo de 11:00 a. m. a 5:00 p. m.',
 'Efectivo, transferencia, datáfono y crédito directo CrediCel. No se realizan cobros reales en este ambiente.',
 'Recogida en tienda. Entrega en el mismo día para pedidos confirmados antes de las 4:00 p. m.'
)
on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,phone=excluded.phone,
 business_hours=excluded.business_hours,payment_methods=excluded.payment_methods,
 fulfillment_options=excluded.fulfillment_options,updated_at=now();

insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords)
values('0194f000-0000-7000-8000-000000000002',true,'Nico','es',
 '¡Hola! Soy Nico, asistente de CrediCel Store. Puedo mostrarte celulares, portátiles y accesorios, y contarte de nuestros planes de crédito directo. ¿Qué buscas hoy?',
 'Todavía no tengo esa información. Puedo ayudarte con productos, precios, planes de crédito o comunicarte con una persona.',
 array['asesor','persona','humano','vendedor'])
on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,locale=excluded.locale,
 welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,
 handoff_keywords=excluded.handoff_keywords,updated_at=now();

-- Amplía el catálogo original (un solo portátil) para tener con qué conversar.
insert into app.catalog_items(id,tenant_id,catalog_id,external_reference,name,description,category,status,offering_type)
values
 ('0194f005-0000-7000-8000-100000000002','0194f000-0000-7000-8000-000000000002','0194f004-0000-7000-8000-000000000002',
  'TECH-DEMO-2','Celular gama media','Producto ficticio para desarrollo local','celulares','active','product'),
 ('0194f005-0000-7000-8000-100000000003','0194f000-0000-7000-8000-000000000002','0194f004-0000-7000-8000-000000000002',
  'TECH-DEMO-3','Celular gama alta','Producto ficticio para desarrollo local','celulares','active','product'),
 ('0194f005-0000-7000-8000-100000000004','0194f000-0000-7000-8000-000000000002','0194f004-0000-7000-8000-000000000002',
  'TECH-DEMO-4','Audífonos inalámbricos','Producto ficticio para desarrollo local','accesorios','active','product')
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,
 status=excluded.status,offering_type=excluded.offering_type,updated_at=now();

insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status)
values
 ('0194f006-0000-7000-8000-100000000002','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000002',
  'TECH-VAR-2','128 GB','active',85000000,'COP','available'),
 ('0194f006-0000-7000-8000-100000000003','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000003',
  'TECH-VAR-3','256 GB','active',185000000,'COP','available'),
 ('0194f006-0000-7000-8000-100000000004','0194f000-0000-7000-8000-000000000002','0194f005-0000-7000-8000-100000000004',
  'TECH-VAR-4','Estándar','active',12000000,'COP','available')
on conflict(id) do update set name=excluded.name,status=excluded.status,price_minor=excluded.price_minor,
 currency=excluded.currency,availability_status=excluded.availability_status,updated_at=now();

select set_config('app.tenant_id','',true);

commit;
