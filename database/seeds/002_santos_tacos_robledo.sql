\set ON_ERROR_STOP on

begin;
set local role commerce_owner;
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);

-- Negocio totalmente ficticio, inspirado en una taquería de barrio en Robledo, Medellín.
update app.tenants set display_name='Santos Tacos Robledo (Demo)', timezone='America/Bogota', default_locale='es-CO', updated_at=now()
where id='0194f000-0000-7000-8000-000000000001';

insert into app.business_profiles(tenant_id,description,address,phone,business_hours,payment_methods,fulfillment_options,updated_by_user_id)
values(
 '0194f000-0000-7000-8000-000000000001',
 'Taquería mexicana de barrio con sabores adaptados al gusto paisa. Preparamos tacos, quesadillas, nachos, combos y bebidas frescas al momento.',
 'Sector Robledo, Medellín. Dirección ficticia para demostración; el punto exacto se confirma al realizar el pedido.',
 '+57 300 000 0000 (número ficticio)',
 'Martes a jueves de 5:00 p. m. a 10:00 p. m.; viernes y sábado de 5:00 p. m. a 11:00 p. m.; domingo de 4:00 p. m. a 9:00 p. m.; lunes cerrado.',
 'Efectivo, transferencia por medios colombianos y datáfono al recibir. Todos los medios son ficticios en este ambiente.',
 'Consumo en el punto, recogida y domicilio en sectores seleccionados de Robledo. Tiempo estimado de preparación: 20 a 35 minutos.',
 '0194f000-0000-7000-8000-000000000102'
)
on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,phone=excluded.phone,
 business_hours=excluded.business_hours,payment_methods=excluded.payment_methods,fulfillment_options=excluded.fulfillment_options,
 updated_by_user_id=excluded.updated_by_user_id,updated_at=now();

insert into app.business_profile_localizations(
 tenant_id,locale,address,business_hours,payment_methods,fulfillment_options
)
values(
 '0194f000-0000-7000-8000-000000000001',
 'en',
 'Robledo area, Medellín. Fictional demo address; the exact location is confirmed when placing the order.',
 'Tuesday through Thursday from 5:00 p.m. to 10:00 p.m.; Friday and Saturday from 5:00 p.m. to 11:00 p.m.; Sunday from 4:00 p.m. to 9:00 p.m.; closed Monday.',
 'Cash, Colombian bank transfer, and card payment upon delivery. All payment methods are fictional in this environment.',
 'On-site service, pickup, and delivery in selected Robledo areas. Estimated preparation time: 20 to 35 minutes.'
)
on conflict(tenant_id,locale) do update set
 address=excluded.address,business_hours=excluded.business_hours,
 payment_methods=excluded.payment_methods,fulfillment_options=excluded.fulfillment_options,
 updated_at=now();

insert into app.tenant_capabilities(tenant_id,capability,enabled)
values
 ('0194f000-0000-7000-8000-000000000001','commercial_offerings',true),
 ('0194f000-0000-7000-8000-000000000001','inventory',false),
 ('0194f000-0000-7000-8000-000000000001','orders',true),
 ('0194f000-0000-7000-8000-000000000001','appointments',false),
 ('0194f000-0000-7000-8000-000000000001','delivery',true)
on conflict(tenant_id,capability) do update set enabled=excluded.enabled,updated_at=now();

insert into app.bot_configurations(tenant_id,enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords,updated_by_user_id)
values(
 '0194f000-0000-7000-8000-000000000001',true,'Santos','es',
 '¡Hola! Soy Santos, el asistente de Santos Tacos Robledo. Puedo mostrarte el menú, ayudarte con un pedido o contarte sobre nuestros domicilios. ¿Qué se te antoja?',
 'Todavía no tengo esa información. Puedo ayudarte con el menú, precios, horarios, medios de pago y cobertura, o comunicarte con una persona.',
 array['asesor','persona','humano','hablar con alguien'],
 '0194f000-0000-7000-8000-000000000102'
)
on conflict(tenant_id) do update set enabled=excluded.enabled,assistant_name=excluded.assistant_name,locale=excluded.locale,
 welcome_message=excluded.welcome_message,fallback_message=excluded.fallback_message,handoff_keywords=excluded.handoff_keywords,
 updated_by_user_id=excluded.updated_by_user_id,updated_at=now();

insert into app.contacts(id,tenant_id,display_name,locale,consent_status)
values(
 '0194f002-0000-7000-8000-000000000099',
 '0194f000-0000-7000-8000-000000000001',
 'Prueba visual de recomendación',
 'es',
 'unknown'
)
on conflict(id) do update set display_name=excluded.display_name,locale=excluded.locale,updated_at=now();

update app.catalogs set name='Menú Santos Tacos Robledo',currency='COP',status='published',published_at=coalesce(published_at,now()),updated_at=now()
where id='0194f004-0000-7000-8000-000000000001';

insert into app.catalog_items(id,tenant_id,catalog_id,external_reference,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required)
values
 ('0194f005-0000-7000-8000-000000000001','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-TACO-PASTOR','Tacos al pastor','Tres tortillas de maíz con cerdo al pastor, piña asada, cebolla, cilantro y limón.','Tacos','active','manual','prepared_product',25,false),
 ('0194f005-0000-7000-8000-000000000011','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-TACO-BIRRIA','Tacos de birria','Tres tacos de res cocida lentamente, queso, cebolla, cilantro y consomé de la casa.','Tacos','active','manual','prepared_product',30,false),
 ('0194f005-0000-7000-8000-000000000012','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-TACO-POLLO','Tacos de pollo','Tres tacos de pollo especiado, pico de gallo, repollo y salsa de aguacate.','Tacos','active','manual','prepared_product',20,false),
 ('0194f005-0000-7000-8000-000000000013','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-TACO-VEGGIE','Tacos vegetarianos','Tres tacos con fríjol negro, maíz, champiñones, pico de gallo y aguacate.','Tacos','active','manual','prepared_product',20,false),
 ('0194f005-0000-7000-8000-000000000014','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-QUESADILLA','Quesadilla norteña','Tortilla de harina con queso, proteína a elección, pico de gallo y crema agria.','Antojitos','active','manual','prepared_product',20,false),
 ('0194f005-0000-7000-8000-000000000015','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-NACHOS','Nachos Santos','Totopos con fríjol, queso, pico de gallo, guacamole, crema agria y jalapeños.','Antojitos','active','manual','prepared_product',18,false),
 ('0194f005-0000-7000-8000-000000000016','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-COMBO-DOS','Combo parceros','Seis tacos a elección, una porción de nachos pequeños y dos aguas frescas.','Combos','active','manual','package',35,false),
 ('0194f005-0000-7000-8000-000000000017','0194f000-0000-7000-8000-000000000001','0194f004-0000-7000-8000-000000000001','ST-AGUA-FRESCA','Agua fresca','Bebida preparada de fruta; sabores según disponibilidad del día.','Bebidas','active','manual','prepared_product',5,false)
on conflict(id) do update set external_reference=excluded.external_reference,name=excluded.name,description=excluded.description,
 category=excluded.category,status=excluded.status,source_provider=excluded.source_provider,offering_type=excluded.offering_type,
 duration_minutes=excluded.duration_minutes,booking_required=excluded.booking_required,updated_at=now();

insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at)
values
 ('0194f006-0000-7000-8000-000000000001','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000001','ST-VAR-PASTOR-3','Orden de 3 tacos','active',1890000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000011','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000011','ST-VAR-BIRRIA-3','Orden de 3 tacos con consomé','active',2290000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000012','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000012','ST-VAR-POLLO-3','Orden de 3 tacos','active',1790000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000013','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000013','ST-VAR-VEGGIE-3','Orden de 3 tacos','active',1690000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000014','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000014','ST-VAR-QUESADILLA','Unidad','active',1850000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000015','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000015','ST-VAR-NACHOS','Porción para compartir','active',1590000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000016','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000016','ST-VAR-COMBO-DOS','Combo para 2 personas','active',4590000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000017','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000017','ST-VAR-AGUA-12','Vaso de 12 oz','active',700000,'COP','available',now()),
 ('0194f006-0000-7000-8000-000000000018','0194f000-0000-7000-8000-000000000001','0194f005-0000-7000-8000-000000000017','ST-VAR-AGUA-16','Vaso de 16 oz','active',900000,'COP','available',now())
on conflict(id) do update set name=excluded.name,status=excluded.status,price_minor=excluded.price_minor,currency=excluded.currency,
 availability_status=excluded.availability_status,availability_checked_at=excluded.availability_checked_at,updated_at=now();

-- Tenant-configurable commercial relationships. The generic engine consumes
-- these records and never contains business-specific recommendation rules.
insert into app.product_recommendations(
 id,tenant_id,source_variant_id,target_variant_id,relationship_type,priority,reason,status
)
values
 ('0194f045-0000-7000-8000-000000000001','0194f000-0000-7000-8000-000000000001','0194f006-0000-7000-8000-000000000001','0194f006-0000-7000-8000-000000000017','complements',100,'Bebida sugerida para acompañar tacos','active'),
 ('0194f045-0000-7000-8000-000000000011','0194f000-0000-7000-8000-000000000001','0194f006-0000-7000-8000-000000000011','0194f006-0000-7000-8000-000000000017','complements',100,'Bebida sugerida para acompañar tacos','active'),
 ('0194f045-0000-7000-8000-000000000012','0194f000-0000-7000-8000-000000000001','0194f006-0000-7000-8000-000000000012','0194f006-0000-7000-8000-000000000017','complements',100,'Bebida sugerida para acompañar tacos','active'),
 ('0194f045-0000-7000-8000-000000000013','0194f000-0000-7000-8000-000000000001','0194f006-0000-7000-8000-000000000013','0194f006-0000-7000-8000-000000000017','complements',100,'Bebida sugerida para acompañar tacos','active'),
 ('0194f045-0000-7000-8000-000000000014','0194f000-0000-7000-8000-000000000001','0194f006-0000-7000-8000-000000000014','0194f006-0000-7000-8000-000000000017','complements',90,'Bebida sugerida para acompañar antojitos','active'),
 ('0194f045-0000-7000-8000-000000000015','0194f000-0000-7000-8000-000000000001','0194f006-0000-7000-8000-000000000015','0194f006-0000-7000-8000-000000000017','complements',90,'Bebida sugerida para acompañar antojitos','active')
on conflict(tenant_id,source_variant_id,target_variant_id,relationship_type) do update
set priority=excluded.priority,reason=excluded.reason,status=excluded.status,updated_at=now();

insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version,keywords)
values
 ('0194f007-0000-7000-8000-000000000001','0194f000-0000-7000-8000-000000000001','hours','¿Cuál es el horario?','Atendemos martes a jueves de 5:00 p. m. a 10:00 p. m.; viernes y sábado hasta las 11:00 p. m.; domingo de 4:00 p. m. a 9:00 p. m. Los lunes descansamos.','published','seed/santos-tacos',1,'{}'),
 ('0194f007-0000-7000-8000-000000000011','0194f000-0000-7000-8000-000000000001','coverage','¿Hacen domicilios?','Sí. Tenemos cobertura ficticia en sectores seleccionados de Robledo. El valor y tiempo se confirman con el barrio y un punto de referencia antes de aceptar el pedido.','published','seed/santos-tacos',1,'{}'),
 ('0194f007-0000-7000-8000-000000000012','0194f000-0000-7000-8000-000000000001','faq','¿Cuánto tarda un pedido?','La preparación normalmente toma entre 20 y 35 minutos. El domicilio puede sumar entre 15 y 30 minutos según la zona y la demanda.','published','seed/santos-tacos',1,array['demora','tarda','tiempo']),
 ('0194f007-0000-7000-8000-000000000013','0194f000-0000-7000-8000-000000000001','faq','¿Los tacos son picantes?','Las preparaciones base tienen picante suave o no tienen picante. Las salsas picantes se entregan aparte y puedes pedirlas sin costo.','published','seed/santos-tacos',1,array['picante','pica','salsa']),
 ('0194f007-0000-7000-8000-000000000014','0194f000-0000-7000-8000-000000000001','faq','¿Tienen opciones vegetarianas?','Sí. Ofrecemos tacos vegetarianos con fríjol negro, maíz, champiñones, pico de gallo y aguacate. Confirma tus restricciones antes de ordenar.','published','seed/santos-tacos',1,array['vegetariano','vegetariana','sin carne','veggie']),
 ('0194f007-0000-7000-8000-000000000015','0194f000-0000-7000-8000-000000000001','policy','Alergias y contaminación cruzada','La cocina manipula lácteos, gluten y otros alérgenos. Podemos omitir ingredientes, pero no garantizamos ausencia total de contaminación cruzada.','published','seed/santos-tacos',1,array['alerg','gluten','lactosa','contaminacion']),
 ('0194f007-0000-7000-8000-000000000016','0194f000-0000-7000-8000-000000000001','faq','¿Qué medios de pago reciben?','En este escenario demo aceptamos efectivo, transferencia y datáfono al recibir. No se procesa dinero real.','published','seed/santos-tacos',1,'{}'),
 ('0194f007-0000-7000-8000-000000000017','0194f000-0000-7000-8000-000000000001','policy','Cambios y novedades del pedido','Si el pedido aún no ha entrado a cocina podemos revisar cambios. Si llega incompleto o con una novedad, solicita atención humana e indica el número del pedido.','published','seed/santos-tacos',1,'{}'),
 ('0194f007-0000-7000-8000-000000000018','0194f000-0000-7000-8000-000000000001','faq','¿Puedo recoger mi pedido?','Sí. Puedes pedir para recoger. Te confirmaremos cuando esté listo y compartiremos el punto ficticio de entrega dentro del sector Robledo.','published','seed/santos-tacos',1,array['recoger','recogida'])
on conflict(id) do update set kind=excluded.kind,title=excluded.title,content=excluded.content,status=excluded.status,
 source_reference=excluded.source_reference,version=excluded.version,keywords=excluded.keywords,updated_at=now();

commit;
\echo 'Fixture realista y ficticio de Santos Tacos Robledo cargado.'
