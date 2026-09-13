\set ON_ERROR_STOP on

begin;
set local role commerce_owner;

-- D-150 (docs/decisions.md): live finding — a real customer (Cristian)
-- asked "Quisiera saber como realizo un credito" and got the generic
-- fallback. Not a bug: CrediCel's welcome message already promises to
-- "contarte de nuestros planes de crédito directo", but the tenant had
-- exactly one published knowledge_entries row ("Garantía") and nothing at
-- all about credit — the bot had no content to answer from. Researched
-- Addi (a real Colombian BNPL/financing provider several real Colombian
-- electronics retailers, e.g. Ktronix, already integrate — a realistic fit
-- for a phone/laptop store like CrediCel) and used its real published terms
-- (co.addi.com, requirements/timelines/rates as of 2026) to write this
-- entry. Applied live first through the real admin review path
-- (KnowledgeService.review(), publishing the exact unresolved_customer_
-- questions row Cristian's message created — not a fresh hand-written
-- entry), which also marks that question resolved; this just persists the
-- resulting row so a reprovisioned database doesn't regress to the same
-- content gap.
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000002',true);

insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version,keywords)
values
 ('01a09699-3e0b-7499-94ac-10ea4576a1c7','0194f000-0000-7000-8000-000000000002','faq','Crédito',
  E'Puedes financiar tu compra con crédito Addi, sin tarjeta de crédito ni papeleo:\n' ||
  E'• Validas tu identidad con tu cédula y tu celular (necesitas cédula física, celular con cámara y WhatsApp, y un correo válido). Debes ser mayor de edad.\n' ||
  E'• La decisión llega en minutos. Si te aprueban, te entregamos el producto y pagas a Addi en cuotas: 3, 6, 9, 12, 18 o 24 meses, según tu perfil y el monto.\n' ||
  E'• Si tu compra es de $600.000 o menos a 3 cuotas, no pagas intereses. Para montos o plazos mayores, la tasa depende de tu evaluación de crédito, sin cuota de manejo ni costos ocultos.\n' ||
  E'• Puedes pagar por adelantado o cancelar tu crédito cuando quieras, sin penalidad.\n\n' ||
  '¿Seguimos armando tu pedido? Al confirmarlo puedes elegir pagar con Addi.',
  'published','seed/credicel-addi-2026',1,
  ARRAY['credito','creditos','cuotas','addi','financiacion','plan de credito','pago a cuotas'])
on conflict(id) do update set title=excluded.title,content=excluded.content,status='published',
 keywords=excluded.keywords,updated_at=now();

update app.unresolved_customer_questions set status='resolved'
where tenant_id='0194f000-0000-7000-8000-000000000002'
  and id='01a0968b-a674-7507-9a23-d1ff473d2372'
  and status<>'resolved';

commit;
