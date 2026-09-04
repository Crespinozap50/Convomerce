\set ON_ERROR_STOP on

-- Validates D-039/D-040 (docs/operational-requirements.md, plan step 5): a
-- genuinely new industry, never configured before this seed, added purely
-- through data — no code change anywhere in backend/src. If this tenant
-- works end-to-end through the same acceptance matrix as
-- 003_cross_industry_demo_businesses.sql's tenants, the operational
-- requirements model is proven generic, not just tested against industries
-- that already existed when it was built.
--
-- Must be numbered lower than 007_operational_requirements_backfill.sql —
-- see that file's header for why (D-082-class seed-ordering bug found while
-- adding this tenant).

begin;
set local role commerce_owner;

-- All names, addresses, phones and commercial details in this fixture are fictitious.
insert into app.tenants(id,slug,display_name,status,timezone,default_locale)
values
 ('0194f000-0000-7000-8000-000000000006','peluqueria-aurora','Peluquería Aurora (Demo)','active','America/Bogota','es-CO')
on conflict(id) do update set display_name=excluded.display_name,status=excluded.status,
 timezone=excluded.timezone,default_locale=excluded.default_locale,updated_at=now();

-- Administrador ficticio del tenant. No es administrador de plataforma.
insert into app.users(id,email,display_name,status)
values('0194f000-0000-7000-8000-000000000106','admin.peluqueria@commerce.test','Administración Peluquería Aurora','active')
on conflict(id) do update set display_name=excluded.display_name,status='active',updated_at=now();
-- Contraseña ficticia local: LocalDemo-ChangeMe-2026!
insert into app.local_credentials(user_id,password_hash,must_change_password)
values('0194f000-0000-7000-8000-000000000106','$argon2id$v=19$m=65536,t=3,p=4$+pGXH5M5N3CKAIQlJwnPDQ$u/GrIcaoDXLcTDdxm153dSH2Xw+xriyEIM2A3bj7mUA',true)
on conflict(user_id) do nothing;

-- New tenant needs the same global customer-data rules as tenants created by the migration.
alter table app.customer_data_requirements no force row level security;
insert into app.customer_data_requirements
 (tenant_id,operation_type,fulfillment_type,require_name,require_phone,require_address)
select '0194f000-0000-7000-8000-000000000006'::uuid,rule.operation_type,rule.fulfillment_type,true,true,rule.require_address
from (values
 ('order','pickup',false),('order','delivery',true),('order','on_site',false),
 ('appointment','on_site',false),('appointment','at_home',true),
 ('service','on_site',false),('service','at_home',true)
) rule(operation_type,fulfillment_type,require_address)
on conflict(tenant_id,operation_type,fulfillment_type) do update
 set require_name=excluded.require_name,require_phone=excluded.require_phone,
     require_address=excluded.require_address,updated_at=now();
alter table app.customer_data_requirements force row level security;

-- ---------------------------------------------------------------------------
-- Hair salon
-- ---------------------------------------------------------------------------
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000006',true);

insert into app.channels(id,tenant_id,provider,external_account_id,external_address,status,secret_reference)
values('0194f001-0000-7000-8000-000000000006','0194f000-0000-7000-8000-000000000006',
       'whatsapp_cloud','demo-account-peluqueria','+570000000006','active','local/demo/peluqueria')
on conflict(id) do nothing;

insert into app.tenant_users(id,tenant_id,user_id,role,status)
values('0194f000-0000-7000-8000-000000000116','0194f000-0000-7000-8000-000000000006','0194f000-0000-7000-8000-000000000106','admin','active')
on conflict(tenant_id,user_id) do update set role='admin',status='active',updated_at=now();

insert into app.business_profiles(tenant_id,description,address,phone,business_hours,payment_methods,fulfillment_options)
values(
 '0194f000-0000-7000-8000-000000000006',
 'Peluquería y salón de belleza capilar: cortes, color, tratamientos de keratina y peinados para eventos. Trabajamos principalmente con cita previa.',
 'Sector Envigado, Medellín. Dirección completamente ficticia para demostración.',
 '+57 300 000 0606 (número ficticio)',
 E'Martes a sábado de 9:00 a. m. a 7:00 p. m.\nLunes y domingo cerrado.',
 'Efectivo, transferencia y datáfono. No se realizan cobros reales en este ambiente.',
 'Atención en el local con cita. Se recomienda llegar 5 minutos antes; hay 10 minutos de tolerancia.'
)
on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,phone=excluded.phone,
 business_hours=excluded.business_hours,payment_methods=excluded.payment_methods,
 fulfillment_options=excluded.fulfillment_options,updated_at=now();

insert into app.tenant_capabilities(tenant_id,capability,enabled)
values
 ('0194f000-0000-7000-8000-000000000006','commercial_offerings',true),
 ('0194f000-0000-7000-8000-000000000006','inventory',false),
 ('0194f000-0000-7000-8000-000000000006','orders',false),
 ('0194f000-0000-7000-8000-000000000006','appointments',true),
 ('0194f000-0000-7000-8000-000000000006','delivery',false)
on conflict(tenant_id,capability) do update set enabled=excluded.enabled,updated_at=now();

insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords)
values('0194f000-0000-7000-8000-000000000006',true,'Sol','es',
 '¡Hola! Soy Sol, asistente de Peluquería Aurora. Puedo ayudarte a elegir un servicio, consultar precios y encontrar una cita con nuestras estilistas. ¿Qué necesitas?',
 'Aún no tengo esa información. Puedo ayudarte con servicios, precios, horarios, disponibilidad o comunicarte con una persona.',
 array['asesor','persona','humano','estilista'])
on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,locale=excluded.locale,
 welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,
 handoff_keywords=excluded.handoff_keywords,updated_at=now();

insert into app.catalogs(id,tenant_id,name,status,currency,version,published_at)
values('0194f004-0000-7000-8000-000000000006','0194f000-0000-7000-8000-000000000006',
 'Servicios Peluquería Aurora','published','COP',1,now())
on conflict(id) do update set name=excluded.name,status='published',currency='COP',published_at=coalesce(app.catalogs.published_at,now()),updated_at=now();

insert into app.catalog_items(id,tenant_id,catalog_id,external_reference,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required)
values
 ('0194f005-0000-7000-8000-000000000061','0194f000-0000-7000-8000-000000000006','0194f004-0000-7000-8000-000000000006','PEL-CORTE','Corte de cabello','Corte unisex con lavado, consulta de estilo y secado.','Cabello','active','manual','appointment',45,true),
 ('0194f005-0000-7000-8000-000000000062','0194f000-0000-7000-8000-000000000006','0194f004-0000-7000-8000-000000000006','PEL-COLOR','Color y tinte','Aplicación de color completo con lavado, tratamiento e hidratación.','Color','active','manual','appointment',120,true),
 ('0194f005-0000-7000-8000-000000000063','0194f000-0000-7000-8000-000000000006','0194f004-0000-7000-8000-000000000006','PEL-KERATINA','Tratamiento de keratina','Alisado y nutrición profunda con keratina, según diagnóstico capilar.','Tratamientos','active','manual','appointment',150,true),
 ('0194f005-0000-7000-8000-000000000064','0194f000-0000-7000-8000-000000000006','0194f004-0000-7000-8000-000000000006','PEL-EVENTO','Peinado para evento','Peinado y acabado para ocasiones especiales, con valoración previa.','Peinados','active','manual','appointment',60,true)
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,status='active',
 offering_type=excluded.offering_type,duration_minutes=excluded.duration_minutes,booking_required=true,updated_at=now();

insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at)
values
 ('0194f006-0000-7000-8000-000000000061','0194f000-0000-7000-8000-000000000006','0194f005-0000-7000-8000-000000000061','PEL-CORTE-STD','Servicio estándar','active',3000000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000062','0194f000-0000-7000-8000-000000000006','0194f005-0000-7000-8000-000000000062','PEL-COLOR-STD','Servicio estándar','active',9000000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000063','0194f000-0000-7000-8000-000000000006','0194f005-0000-7000-8000-000000000063','PEL-KERATINA-STD','Servicio estándar','active',15000000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000064','0194f000-0000-7000-8000-000000000006','0194f005-0000-7000-8000-000000000064','PEL-EVENTO-STD','Servicio estándar','active',6000000,'COP','available',now())
on conflict(id) do update set name=excluded.name,status='active',price_minor=excluded.price_minor,
 availability_status='available',availability_checked_at=now(),updated_at=now();

insert into app.booking_resources(id,tenant_id,resource_type,name,status,attributes)
values
 ('0194f008-0000-7000-8000-000000000061','0194f000-0000-7000-8000-000000000006','person','Valentina — estilista senior','active','{"specialties":["color","keratina"],"station":"Puesto 1"}'),
 ('0194f008-0000-7000-8000-000000000062','0194f000-0000-7000-8000-000000000006','person','Sebastián — estilista','active','{"specialties":["corte","peinados"],"station":"Puesto 2"}')
on conflict(id) do update set name=excluded.name,status='active',attributes=excluded.attributes,updated_at=now();

insert into app.resource_availability_rules(id,tenant_id,resource_id,day_of_week,starts_at,ends_at,timezone,status)
select gen_random_uuid(),
 '0194f000-0000-7000-8000-000000000006',resource_id,day_number,start_time,end_time,'America/Bogota','active'
from (values
 ('0194f008-0000-7000-8000-000000000061'::uuid,2,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000061'::uuid,3,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000061'::uuid,4,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000061'::uuid,5,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000061'::uuid,6,'09:00'::time,'17:00'::time),
 ('0194f008-0000-7000-8000-000000000062'::uuid,2,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000062'::uuid,3,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000062'::uuid,4,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000062'::uuid,5,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000062'::uuid,6,'09:00'::time,'17:00'::time)
) schedule(resource_id,day_number,start_time,end_time)
on conflict(tenant_id,resource_id,day_of_week,starts_at,ends_at) do update set status='active',timezone='America/Bogota',updated_at=now();

insert into app.service_resource_links(tenant_id,catalog_item_id,resource_id,duration_minutes,priority,status)
select '0194f000-0000-7000-8000-000000000006',service_id,resource_id,null,100,'active'
from (values
 ('0194f005-0000-7000-8000-000000000061'::uuid),('0194f005-0000-7000-8000-000000000062'::uuid),
 ('0194f005-0000-7000-8000-000000000063'::uuid),('0194f005-0000-7000-8000-000000000064'::uuid)
) service(service_id)
cross join (values
 ('0194f008-0000-7000-8000-000000000061'::uuid),('0194f008-0000-7000-8000-000000000062'::uuid)
) resource(resource_id)
on conflict(tenant_id,catalog_item_id,resource_id) do update set status='active',updated_at=now();

insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version,keywords)
values
 ('0194f007-0000-7000-8000-000000000061','0194f000-0000-7000-8000-000000000006','hours','¿Cuál es el horario?','Atendemos de martes a sábado de 9:00 a. m. a 7:00 p. m. Lunes y domingo permanecemos cerrados.','published','seed/peluqueria',1,'{}'),
 ('0194f007-0000-7000-8000-000000000062','0194f000-0000-7000-8000-000000000006','policy','Cancelaciones y retrasos','Puedes cancelar o reprogramar hasta 3 horas antes. Después de 15 minutos de retraso la cita puede liberarse para no afectar a la siguiente clienta.','published','seed/peluqueria',1,'{}'),
 ('0194f007-0000-7000-8000-000000000063','0194f000-0000-7000-8000-000000000006','faq','¿Debo lavarme el cabello antes de venir?','No es necesario, el lavado está incluido en todos los servicios de corte, color y keratina.','published','seed/peluqueria',1,'{}'),
 ('0194f007-0000-7000-8000-000000000064','0194f000-0000-7000-8000-000000000006','faq','¿Puedo elegir estilista?','Sí. Al reservar puedes elegir una profesional o pedir el primer horario disponible con cualquiera.','published','seed/peluqueria',1,'{}'),
 ('0194f007-0000-7000-8000-000000000065','0194f000-0000-7000-8000-000000000006','policy','Condiciones de servicio','Informa antes de la cita cualquier alergia a tintes, tratamiento químico reciente o sensibilidad en el cuero cabelludo.','published','seed/peluqueria',1,'{}')
on conflict(id) do update set title=excluded.title,content=excluded.content,status='published',keywords=excluded.keywords,updated_at=now();

commit;
\echo 'Peluquería Aurora (industria nueva, D-039/D-040) cargada con oferta y agenda.'
