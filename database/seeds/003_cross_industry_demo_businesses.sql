\set ON_ERROR_STOP on

begin;
set local role commerce_owner;

-- All names, addresses, phones and commercial details in this fixture are fictitious.
insert into app.tenants(id,slug,display_name,status,timezone,default_locale)
values
 ('0194f000-0000-7000-8000-000000000003','barberia-robledo','Distrito Barbería Robledo (Demo)','active','America/Bogota','es-CO'),
 ('0194f000-0000-7000-8000-000000000004','spa-botanica','Botánica Spa Medellín (Demo)','active','America/Bogota','es-CO'),
 ('0194f000-0000-7000-8000-000000000005','lavadero-ruta-80','Ruta 80 Car Wash (Demo)','active','America/Bogota','es-CO')
on conflict(id) do update set display_name=excluded.display_name,status=excluded.status,
 timezone=excluded.timezone,default_locale=excluded.default_locale,updated_at=now();

-- Administrador ficticio del tenant de barbería. No es administrador de plataforma.
insert into app.users(id,email,display_name,status)
values('0194f000-0000-7000-8000-000000000103','admin.barberia@commerce.test','Administración Distrito Barbería','active')
on conflict(id) do update set display_name=excluded.display_name,status='active',updated_at=now();
-- Contraseña ficticia local: LocalDemo-ChangeMe-2026!
insert into app.local_credentials(user_id,password_hash,must_change_password)
values('0194f000-0000-7000-8000-000000000103','$argon2id$v=19$m=65536,t=3,p=4$+pGXH5M5N3CKAIQlJwnPDQ$u/GrIcaoDXLcTDdxm153dSH2Xw+xriyEIM2A3bj7mUA',true)
on conflict(user_id) do nothing;

-- New tenants need the same global customer-data rules as tenants created by the migration.
alter table app.customer_data_requirements no force row level security;
insert into app.customer_data_requirements
 (tenant_id,operation_type,fulfillment_type,require_name,require_phone,require_address)
select tenant_id,rule.operation_type,rule.fulfillment_type,true,true,rule.require_address
from (values
 ('0194f000-0000-7000-8000-000000000003'::uuid),
 ('0194f000-0000-7000-8000-000000000004'::uuid),
 ('0194f000-0000-7000-8000-000000000005'::uuid)
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

-- ---------------------------------------------------------------------------
-- Barber shop
-- ---------------------------------------------------------------------------
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000003',true);

insert into app.tenant_users(id,tenant_id,user_id,role,status)
values('0194f000-0000-7000-8000-000000000113','0194f000-0000-7000-8000-000000000003','0194f000-0000-7000-8000-000000000103','admin','active')
on conflict(tenant_id,user_id) do update set role='admin',status='active',updated_at=now();

insert into app.business_profiles(tenant_id,description,address,phone,business_hours,payment_methods,fulfillment_options)
values(
 '0194f000-0000-7000-8000-000000000003',
 'Barbería urbana para adultos y niños, especializada en cortes clásicos, degradados, arreglo de barba y asesoría de imagen. Trabajamos principalmente con cita previa.',
 'Sector Robledo, Medellín. Dirección completamente ficticia para demostración.',
 '+57 300 000 0303 (número ficticio)',
 E'Lunes a viernes de 9:00 a. m. a 7:00 p. m.\nSábado de 8:00 a. m. a 6:00 p. m.\nDomingo cerrado.',
 'Efectivo, transferencia y datáfono. No se realizan cobros reales en este ambiente.',
 'Atención en el local con cita. Se recomienda llegar 5 minutos antes; hay 10 minutos de tolerancia.'
)
on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,phone=excluded.phone,
 business_hours=excluded.business_hours,payment_methods=excluded.payment_methods,
 fulfillment_options=excluded.fulfillment_options,updated_at=now();

insert into app.tenant_capabilities(tenant_id,capability,enabled)
values
 ('0194f000-0000-7000-8000-000000000003','commercial_offerings',true),
 ('0194f000-0000-7000-8000-000000000003','inventory',false),
 ('0194f000-0000-7000-8000-000000000003','orders',false),
 ('0194f000-0000-7000-8000-000000000003','appointments',true),
 ('0194f000-0000-7000-8000-000000000003','delivery',false)
on conflict(tenant_id,capability) do update set enabled=excluded.enabled,updated_at=now();

insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords)
values('0194f000-0000-7000-8000-000000000003',true,'Dani','es',
 '¡Hola! Soy Dani, asistente de Distrito Barbería. Puedo ayudarte a elegir un servicio, consultar precios y encontrar una cita con nuestros barberos. ¿Qué necesitas?',
 'Aún no tengo esa información. Puedo ayudarte con servicios, precios, horarios, disponibilidad o comunicarte con una persona.',
 array['asesor','persona','humano','barbero'])
on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,locale=excluded.locale,
 welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,
 handoff_keywords=excluded.handoff_keywords,updated_at=now();

insert into app.catalogs(id,tenant_id,name,status,currency,version,published_at)
values('0194f004-0000-7000-8000-000000000003','0194f000-0000-7000-8000-000000000003',
 'Servicios Distrito Barbería','published','COP',1,now())
on conflict(id) do update set name=excluded.name,status='published',currency='COP',published_at=coalesce(app.catalogs.published_at,now()),updated_at=now();

insert into app.catalog_items(id,tenant_id,catalog_id,external_reference,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required)
values
 ('0194f005-0000-7000-8000-000000000031','0194f000-0000-7000-8000-000000000003','0194f004-0000-7000-8000-000000000003','BAR-CORTE','Corte clásico o degradado','Consulta inicial, corte con máquina y tijera, acabado y peinado.','Cabello','active','manual','appointment',45,true),
 ('0194f005-0000-7000-8000-000000000032','0194f000-0000-7000-8000-000000000003','0194f004-0000-7000-8000-000000000003','BAR-CORTE-BARBA','Corte y barba','Corte completo, perfilado de barba, toalla caliente y producto de acabado.','Combos','active','manual','appointment',75,true),
 ('0194f005-0000-7000-8000-000000000033','0194f000-0000-7000-8000-000000000003','0194f004-0000-7000-8000-000000000003','BAR-BARBA','Barba premium','Diseño y perfilado de barba con toalla caliente e hidratación.','Barba','active','manual','appointment',30,true),
 ('0194f005-0000-7000-8000-000000000034','0194f000-0000-7000-8000-000000000003','0194f004-0000-7000-8000-000000000003','BAR-NINO','Corte infantil','Corte para niños de 4 a 12 años, con acompañante responsable.','Cabello','active','manual','appointment',40,true)
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,status='active',
 offering_type=excluded.offering_type,duration_minutes=excluded.duration_minutes,booking_required=true,updated_at=now();

insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at)
values
 ('0194f006-0000-7000-8000-000000000031','0194f000-0000-7000-8000-000000000003','0194f005-0000-7000-8000-000000000031','BAR-CORTE-STD','Servicio estándar','active',3200000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000032','0194f000-0000-7000-8000-000000000003','0194f005-0000-7000-8000-000000000032','BAR-CB-STD','Servicio completo','active',5200000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000033','0194f000-0000-7000-8000-000000000003','0194f005-0000-7000-8000-000000000033','BAR-BARBA-STD','Servicio estándar','active',2400000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000034','0194f000-0000-7000-8000-000000000003','0194f005-0000-7000-8000-000000000034','BAR-NINO-STD','Servicio estándar','active',2800000,'COP','available',now())
on conflict(id) do update set name=excluded.name,status='active',price_minor=excluded.price_minor,
 availability_status='available',availability_checked_at=now(),updated_at=now();

insert into app.booking_resources(id,tenant_id,resource_type,name,status,attributes)
values
 ('0194f008-0000-7000-8000-000000000031','0194f000-0000-7000-8000-000000000003','person','Mateo — barbero senior','active','{"specialties":["degradados","barba"],"station":"Silla 1"}'),
 ('0194f008-0000-7000-8000-000000000032','0194f000-0000-7000-8000-000000000003','person','Juan — barbero','active','{"specialties":["corte clásico","corte infantil"],"station":"Silla 2"}')
on conflict(id) do update set name=excluded.name,status='active',attributes=excluded.attributes,updated_at=now();

insert into app.resource_availability_rules(id,tenant_id,resource_id,day_of_week,starts_at,ends_at,timezone,status)
select gen_random_uuid(),
 '0194f000-0000-7000-8000-000000000003',resource_id,day_number,start_time,end_time,'America/Bogota','active'
from (values
 ('0194f008-0000-7000-8000-000000000031'::uuid,1,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000031'::uuid,2,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000031'::uuid,3,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000031'::uuid,4,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000031'::uuid,5,'09:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000031'::uuid,6,'08:00'::time,'18:00'::time),
 ('0194f008-0000-7000-8000-000000000032'::uuid,2,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000032'::uuid,3,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000032'::uuid,4,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000032'::uuid,5,'10:00'::time,'19:00'::time),
 ('0194f008-0000-7000-8000-000000000032'::uuid,6,'08:00'::time,'18:00'::time)
) schedule(resource_id,day_number,start_time,end_time)
on conflict(tenant_id,resource_id,day_of_week,starts_at,ends_at) do update set status='active',timezone='America/Bogota',updated_at=now();

insert into app.service_resource_links(tenant_id,catalog_item_id,resource_id,duration_minutes,priority,status)
select '0194f000-0000-7000-8000-000000000003',service_id,resource_id,null,100,'active'
from (values
 ('0194f005-0000-7000-8000-000000000031'::uuid),('0194f005-0000-7000-8000-000000000032'::uuid),
 ('0194f005-0000-7000-8000-000000000033'::uuid),('0194f005-0000-7000-8000-000000000034'::uuid)
) service(service_id)
cross join (values
 ('0194f008-0000-7000-8000-000000000031'::uuid),('0194f008-0000-7000-8000-000000000032'::uuid)
) resource(resource_id)
on conflict(tenant_id,catalog_item_id,resource_id) do update set status='active',updated_at=now();

insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version)
values
 ('0194f007-0000-7000-8000-000000000031','0194f000-0000-7000-8000-000000000003','hours','¿Cuál es el horario?','Abrimos de lunes a viernes de 9:00 a. m. a 7:00 p. m. y los sábados de 8:00 a. m. a 6:00 p. m. El domingo descansamos.','published','seed/barberia',1),
 ('0194f007-0000-7000-8000-000000000032','0194f000-0000-7000-8000-000000000003','policy','Cancelaciones y retrasos','Puedes cancelar o reprogramar hasta 2 horas antes. Después de 10 minutos de retraso la cita puede liberarse para no afectar al siguiente cliente.','published','seed/barberia',1),
 ('0194f007-0000-7000-8000-000000000033','0194f000-0000-7000-8000-000000000003','faq','¿Atienden niños?','Sí, ofrecemos corte infantil para niños de 4 a 12 años acompañados por una persona adulta.','published','seed/barberia',1),
 ('0194f007-0000-7000-8000-000000000034','0194f000-0000-7000-8000-000000000003','faq','¿Puedo elegir barbero?','Sí. Al reservar puedes elegir un profesional o pedir el primer horario disponible con cualquiera.','published','seed/barberia',1),
 ('0194f007-0000-7000-8000-000000000035','0194f000-0000-7000-8000-000000000003','policy','Condiciones de servicio','Informa antes de la cita cualquier sensibilidad en la piel o condición que pueda afectar el servicio.','published','seed/barberia',1)
on conflict(id) do update set title=excluded.title,content=excluded.content,status='published',updated_at=now();

-- ---------------------------------------------------------------------------
-- Spa
-- ---------------------------------------------------------------------------
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000004',true);

insert into app.business_profiles(tenant_id,description,address,phone,business_hours,payment_methods,fulfillment_options)
values('0194f000-0000-7000-8000-000000000004',
 'Spa urbano enfocado en relajación y cuidado no médico: masajes, rituales faciales y experiencias de bienestar personalizadas.',
 'Sector Laureles, Medellín. Ubicación ficticia utilizada únicamente para demostración.',
 '+57 300 000 0404 (número ficticio)',
 E'Lunes a viernes de 9:00 a. m. a 8:00 p. m.\nSábado de 9:00 a. m. a 6:00 p. m.\nDomingo de 10:00 a. m. a 4:00 p. m.',
 'Efectivo, transferencia, tarjetas débito y crédito. No se procesan pagos reales.',
 'Servicios en sede con reserva previa. Algunos rituales requieren llegar 15 minutos antes para la valoración inicial.')
on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,phone=excluded.phone,
 business_hours=excluded.business_hours,payment_methods=excluded.payment_methods,fulfillment_options=excluded.fulfillment_options,updated_at=now();

insert into app.tenant_capabilities(tenant_id,capability,enabled)
values
 ('0194f000-0000-7000-8000-000000000004','commercial_offerings',true),('0194f000-0000-7000-8000-000000000004','inventory',false),
 ('0194f000-0000-7000-8000-000000000004','orders',false),('0194f000-0000-7000-8000-000000000004','appointments',true),
 ('0194f000-0000-7000-8000-000000000004','delivery',false)
on conflict(tenant_id,capability) do update set enabled=excluded.enabled,updated_at=now();

insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords)
values('0194f000-0000-7000-8000-000000000004',true,'Alma','es',
 '¡Hola! Soy Alma, asistente de Botánica Spa. Puedo orientarte sobre nuestros tratamientos y ayudarte a reservar el mejor horario. ¿Cómo quieres sentirte hoy?',
 'Todavía no tengo esa información. Puedo ayudarte con tratamientos, precios, recomendaciones generales, horarios o atención humana.',
 array['asesor','persona','humano','terapeuta'])
on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,locale=excluded.locale,
 welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,handoff_keywords=excluded.handoff_keywords,updated_at=now();

insert into app.catalogs(id,tenant_id,name,status,currency,version,published_at)
values('0194f004-0000-7000-8000-000000000004','0194f000-0000-7000-8000-000000000004','Carta de bienestar Botánica Spa','published','COP',1,now())
on conflict(id) do update set name=excluded.name,status='published',currency='COP',published_at=coalesce(app.catalogs.published_at,now()),updated_at=now();

insert into app.catalog_items(id,tenant_id,catalog_id,external_reference,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required)
values
 ('0194f005-0000-7000-8000-000000000041','0194f000-0000-7000-8000-000000000004','0194f004-0000-7000-8000-000000000004','SPA-RELAX','Masaje relajante','Masaje corporal de presión suave a media orientado a relajación general.','Masajes','active','manual','appointment',60,true),
 ('0194f005-0000-7000-8000-000000000042','0194f000-0000-7000-8000-000000000004','0194f004-0000-7000-8000-000000000004','SPA-DESCON','Masaje descontracturante','Masaje de intensidad media enfocado en zonas de tensión; no sustituye atención médica.','Masajes','active','manual','appointment',75,true),
 ('0194f005-0000-7000-8000-000000000043','0194f000-0000-7000-8000-000000000004','0194f004-0000-7000-8000-000000000004','SPA-FACIAL','Ritual facial hidratante','Limpieza suave, exfoliación, mascarilla e hidratación según valoración cosmética.','Faciales','active','manual','appointment',50,true),
 ('0194f005-0000-7000-8000-000000000044','0194f000-0000-7000-8000-000000000004','0194f004-0000-7000-8000-000000000004','SPA-PAREJA','Experiencia de relajación para dos','Masaje relajante simultáneo para dos personas en cabina doble.','Experiencias','active','manual','appointment',90,true)
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,status='active',
 offering_type='appointment',duration_minutes=excluded.duration_minutes,booking_required=true,updated_at=now();

insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at)
values
 ('0194f006-0000-7000-8000-000000000041','0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000041','SPA-RELAX-60','Sesión de 60 minutos','active',9500000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000042','0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000042','SPA-DESCON-75','Sesión de 75 minutos','active',12500000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000043','0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000043','SPA-FACIAL-50','Ritual de 50 minutos','active',11000000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000044','0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000044','SPA-PAREJA-90','Experiencia para dos','active',26000000,'COP','available',now())
on conflict(id) do update set name=excluded.name,status='active',price_minor=excluded.price_minor,availability_status='available',availability_checked_at=now(),updated_at=now();

insert into app.booking_resources(id,tenant_id,resource_type,name,status,attributes)
values
 ('0194f008-0000-7000-8000-000000000041','0194f000-0000-7000-8000-000000000004','person','Laura — terapeuta de bienestar','active','{"specialties":["masaje relajante","facial"]}'),
 ('0194f008-0000-7000-8000-000000000042','0194f000-0000-7000-8000-000000000004','person','Camila — terapeuta corporal','active','{"specialties":["relajante","descontracturante"]}'),
 ('0194f008-0000-7000-8000-000000000043','0194f000-0000-7000-8000-000000000004','space','Cabina doble','active','{"capacity":2,"features":["ducha","aromaterapia"]}')
on conflict(id) do update set name=excluded.name,status='active',attributes=excluded.attributes,updated_at=now();

insert into app.resource_availability_rules(id,tenant_id,resource_id,day_of_week,starts_at,ends_at,timezone,status)
select gen_random_uuid(),
 '0194f000-0000-7000-8000-000000000004',resource_id,day_number,start_time,end_time,'America/Bogota','active'
from (values
 ('0194f008-0000-7000-8000-000000000041'::uuid,1,'09:00'::time,'18:00'::time),('0194f008-0000-7000-8000-000000000041'::uuid,2,'09:00','18:00'),
 ('0194f008-0000-7000-8000-000000000041'::uuid,3,'09:00','18:00'),('0194f008-0000-7000-8000-000000000041'::uuid,4,'09:00','18:00'),
 ('0194f008-0000-7000-8000-000000000041'::uuid,5,'09:00','18:00'),('0194f008-0000-7000-8000-000000000042'::uuid,2,'11:00','20:00'),
 ('0194f008-0000-7000-8000-000000000042'::uuid,3,'11:00','20:00'),('0194f008-0000-7000-8000-000000000042'::uuid,4,'11:00','20:00'),
 ('0194f008-0000-7000-8000-000000000042'::uuid,5,'11:00','20:00'),('0194f008-0000-7000-8000-000000000042'::uuid,6,'09:00','18:00'),
 ('0194f008-0000-7000-8000-000000000043'::uuid,1,'09:00','20:00'),('0194f008-0000-7000-8000-000000000043'::uuid,2,'09:00','20:00'),
 ('0194f008-0000-7000-8000-000000000043'::uuid,3,'09:00','20:00'),('0194f008-0000-7000-8000-000000000043'::uuid,4,'09:00','20:00'),
 ('0194f008-0000-7000-8000-000000000043'::uuid,5,'09:00','20:00'),('0194f008-0000-7000-8000-000000000043'::uuid,6,'09:00','18:00'),
 ('0194f008-0000-7000-8000-000000000043'::uuid,0,'10:00','16:00')
) schedule(resource_id,day_number,start_time,end_time)
on conflict(tenant_id,resource_id,day_of_week,starts_at,ends_at) do update set status='active',updated_at=now();

insert into app.service_resource_links(tenant_id,catalog_item_id,resource_id,duration_minutes,priority,status)
values
 ('0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000041','0194f008-0000-7000-8000-000000000041',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000041','0194f008-0000-7000-8000-000000000042',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000042','0194f008-0000-7000-8000-000000000042',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000043','0194f008-0000-7000-8000-000000000041',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000004','0194f005-0000-7000-8000-000000000044','0194f008-0000-7000-8000-000000000043',null,100,'active')
on conflict(tenant_id,catalog_item_id,resource_id) do update set status='active',updated_at=now();

insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version,keywords)
values
 ('0194f007-0000-7000-8000-000000000041','0194f000-0000-7000-8000-000000000004','hours','¿Cuál es el horario?','Atendemos de lunes a viernes de 9:00 a. m. a 8:00 p. m., sábado de 9:00 a. m. a 6:00 p. m. y domingo de 10:00 a. m. a 4:00 p. m.','published','seed/spa',1,'{}'),
 ('0194f007-0000-7000-8000-000000000042','0194f000-0000-7000-8000-000000000004','policy','Cancelaciones','Puedes cancelar o reprogramar hasta 6 horas antes. Las experiencias para dos requieren aviso con 12 horas de anticipación.','published','seed/spa',1,'{}'),
 ('0194f007-0000-7000-8000-000000000043','0194f000-0000-7000-8000-000000000004','faq','¿Qué debo informar antes del masaje?','Antes de reservar informa embarazo, cirugías recientes, lesiones, alergias, condiciones cardiovasculares o recomendaciones médicas. Nuestros servicios no sustituyen atención de salud.','published','seed/spa',1,array['alerg']),
 ('0194f007-0000-7000-8000-000000000044','0194f000-0000-7000-8000-000000000004','faq','¿Qué debo llevar?','Te recomendamos ropa cómoda. El spa proporciona los elementos necesarios para el servicio reservado.','published','seed/spa',1,'{}'),
 ('0194f007-0000-7000-8000-000000000045','0194f000-0000-7000-8000-000000000004','policy','Llegada a la cita','Llega entre 10 y 15 minutos antes para realizar la valoración inicial sin reducir el tiempo del tratamiento.','published','seed/spa',1,'{}')
on conflict(id) do update set title=excluded.title,content=excluded.content,status='published',keywords=excluded.keywords,updated_at=now();

-- ---------------------------------------------------------------------------
-- Car wash
-- ---------------------------------------------------------------------------
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000005',true);

insert into app.business_profiles(tenant_id,description,address,phone,business_hours,payment_methods,fulfillment_options)
values('0194f000-0000-7000-8000-000000000005',
 'Centro de lavado para motos, automóviles y camionetas. Ofrece lavado exterior, limpieza interior, encerado y servicios por cita para reducir tiempos de espera.',
 'Corredor de la 80, Medellín. Dirección ficticia utilizada solamente para pruebas.',
 '+57 300 000 0505 (número ficticio)',
 E'Lunes a sábado de 7:00 a. m. a 7:00 p. m.\nDomingo y festivos de 8:00 a. m. a 4:00 p. m.',
 'Efectivo, transferencia y datáfono. No se procesan cobros reales.',
 'Atención en sede por orden de llegada o con reserva. El tiempo final depende del tipo, tamaño y estado del vehículo.')
on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,phone=excluded.phone,
 business_hours=excluded.business_hours,payment_methods=excluded.payment_methods,fulfillment_options=excluded.fulfillment_options,updated_at=now();

insert into app.tenant_capabilities(tenant_id,capability,enabled)
values
 ('0194f000-0000-7000-8000-000000000005','commercial_offerings',true),('0194f000-0000-7000-8000-000000000005','inventory',false),
 ('0194f000-0000-7000-8000-000000000005','orders',false),('0194f000-0000-7000-8000-000000000005','appointments',true),
 ('0194f000-0000-7000-8000-000000000005','delivery',false)
on conflict(tenant_id,capability) do update set enabled=excluded.enabled,updated_at=now();

insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords)
values('0194f000-0000-7000-8000-000000000005',true,'Rayo','es',
 '¡Hola! Soy Rayo, asistente de Ruta 80 Car Wash. Cuéntame si vienes con moto, carro o camioneta y te ayudo a elegir el lavado y reservar una hora.',
 'Aún no tengo esa información. Puedo ayudarte con tipos de lavado, precios, tiempos estimados, horarios o atención humana.',
 array['asesor','persona','humano','operario'])
on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,locale=excluded.locale,
 welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,handoff_keywords=excluded.handoff_keywords,updated_at=now();

insert into app.catalogs(id,tenant_id,name,status,currency,version,published_at)
values('0194f004-0000-7000-8000-000000000005','0194f000-0000-7000-8000-000000000005','Servicios Ruta 80 Car Wash','published','COP',1,now())
on conflict(id) do update set name=excluded.name,status='published',currency='COP',published_at=coalesce(app.catalogs.published_at,now()),updated_at=now();

-- Motorcycle wash pricing is split by displacement tier, not a single flat
-- price: the threshold between "baja" and "alta cilindrada" is a country
-- convention, not a universal constant (Colombia's is 200cc).
insert into app.catalog_items(id,tenant_id,catalog_id,external_reference,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required)
values
 ('0194f005-0000-7000-8000-000000000051','0194f000-0000-7000-8000-000000000005','0194f004-0000-7000-8000-000000000005','CW-MOTO-BAJA','Lavado de moto (baja cilindrada)','Para motos de hasta 199cc. Lavado exterior, rines, guardabarros, secado y brillo básico.','Motos','active','manual','appointment',30,true),
 ('0194f005-0000-7000-8000-000000000055','0194f000-0000-7000-8000-000000000005','0194f004-0000-7000-8000-000000000005','CW-MOTO-ALTA','Lavado de moto (alta cilindrada)','Para motos de 200cc en adelante. Lavado exterior, rines, guardabarros, secado y brillo básico.','Motos','active','manual','appointment',30,true),
 ('0194f005-0000-7000-8000-000000000052','0194f000-0000-7000-8000-000000000005','0194f004-0000-7000-8000-000000000005','CW-CARRO','Lavado completo de automóvil','Lavado exterior, aspirado interior, limpieza de tablero, tapetes y brillo de llantas.','Automóviles','active','manual','appointment',60,true),
 ('0194f005-0000-7000-8000-000000000053','0194f000-0000-7000-8000-000000000005','0194f004-0000-7000-8000-000000000005','CW-CAMIONETA','Lavado completo de camioneta','Servicio completo para SUV, camioneta o vehículo grande.','Camionetas','active','manual','appointment',75,true),
 ('0194f005-0000-7000-8000-000000000054','0194f000-0000-7000-8000-000000000005','0194f004-0000-7000-8000-000000000005','CW-PREMIUM','Lavado premium con cera','Lavado completo, descontaminación ligera y aplicación de cera líquida.','Premium','active','manual','appointment',120,true)
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,status='active',
 offering_type='appointment',duration_minutes=excluded.duration_minutes,booking_required=true,updated_at=now();

insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at)
values
 ('0194f006-0000-7000-8000-000000000051','0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000051','CW-MOTO-BAJA-STD','Moto baja cilindrada','active',1500000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000055','0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000055','CW-MOTO-ALTA-STD','Moto alta cilindrada','active',2200000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000052','0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000052','CW-CARRO-STD','Automóvil estándar','active',3800000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000053','0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000053','CW-CAMIONETA-STD','SUV o camioneta','active',4800000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000054','0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000054','CW-PREMIUM-STD','Automóvil estándar','active',8500000,'COP','available',now())
on conflict(id) do update set name=excluded.name,status='active',price_minor=excluded.price_minor,availability_status='available',availability_checked_at=now(),updated_at=now();

insert into app.booking_resources(id,tenant_id,resource_type,name,status,attributes)
values
 ('0194f008-0000-7000-8000-000000000051','0194f000-0000-7000-8000-000000000005','space','Bahía 1 — motos y automóviles','active','{"vehicle_types":["motorcycle","car"]}'),
 ('0194f008-0000-7000-8000-000000000052','0194f000-0000-7000-8000-000000000005','space','Bahía 2 — automóviles y camionetas','active','{"vehicle_types":["car","suv","truck"]}'),
 ('0194f008-0000-7000-8000-000000000053','0194f000-0000-7000-8000-000000000005','equipment','Zona de detallado premium','active','{"service":"wax_and_detail","capacity":1}')
on conflict(id) do update set name=excluded.name,status='active',attributes=excluded.attributes,updated_at=now();

insert into app.resource_availability_rules(id,tenant_id,resource_id,day_of_week,starts_at,ends_at,timezone,status)
select gen_random_uuid(),
 '0194f000-0000-7000-8000-000000000005',resource_id,day_number,
 case when day_number=0 then '08:00'::time else '07:00'::time end,
 case when day_number=0 then '16:00'::time else '19:00'::time end,'America/Bogota','active'
from (values
 ('0194f008-0000-7000-8000-000000000051'::uuid),('0194f008-0000-7000-8000-000000000052'::uuid),
 ('0194f008-0000-7000-8000-000000000053'::uuid)
) resource(resource_id)
cross join generate_series(0,6) day_number
on conflict(tenant_id,resource_id,day_of_week,starts_at,ends_at) do update set status='active',updated_at=now();

insert into app.service_resource_links(tenant_id,catalog_item_id,resource_id,duration_minutes,priority,status)
values
 ('0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000051','0194f008-0000-7000-8000-000000000051',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000055','0194f008-0000-7000-8000-000000000051',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000052','0194f008-0000-7000-8000-000000000051',null,110,'active'),
 ('0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000052','0194f008-0000-7000-8000-000000000052',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000053','0194f008-0000-7000-8000-000000000052',null,100,'active'),
 ('0194f000-0000-7000-8000-000000000005','0194f005-0000-7000-8000-000000000054','0194f008-0000-7000-8000-000000000053',null,100,'active')
on conflict(tenant_id,catalog_item_id,resource_id) do update set status='active',priority=excluded.priority,updated_at=now();

insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version,keywords)
values
 ('0194f007-0000-7000-8000-000000000051','0194f000-0000-7000-8000-000000000005','hours','¿Cuál es el horario?','Abrimos de lunes a sábado de 7:00 a. m. a 7:00 p. m. y domingos o festivos de 8:00 a. m. a 4:00 p. m.','published','seed/car-wash',1,'{}'),
 ('0194f007-0000-7000-8000-000000000052','0194f000-0000-7000-8000-000000000005','faq','¿Cuánto tarda el lavado?','Una moto suele tomar 30 minutos, un automóvil entre 45 y 60 minutos y una camioneta entre 60 y 75 minutos. El estado del vehículo puede cambiar el tiempo.','published','seed/car-wash',1,array['demora','tarda','tiempo']),
 ('0194f007-0000-7000-8000-000000000053','0194f000-0000-7000-8000-000000000005','faq','¿Debo reservar?','Puedes llegar sin reserva, pero una cita reduce la espera y permite confirmar una bahía adecuada para tu vehículo.','published','seed/car-wash',1,'{}'),
 ('0194f007-0000-7000-8000-000000000054','0194f000-0000-7000-8000-000000000005','policy','Objetos dentro del vehículo','Retira dinero, documentos y objetos de valor antes de entregar el vehículo. El negocio no recibe objetos en custodia.','published','seed/car-wash',1,'{}'),
 ('0194f007-0000-7000-8000-000000000055','0194f000-0000-7000-8000-000000000005','policy','Lluvia y reprogramaciones','Si las condiciones climáticas impiden realizar correctamente el servicio, te ofreceremos reprogramar sin costo.','published','seed/car-wash',1,'{}')
on conflict(id) do update set title=excluded.title,content=excluded.content,status='published',keywords=excluded.keywords,updated_at=now();

commit;
\echo 'Barbería, spa y lavadero ficticios cargados con oferta y agenda.'
