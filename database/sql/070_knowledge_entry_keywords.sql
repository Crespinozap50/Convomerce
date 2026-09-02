-- D-078: retires the fixed, globally-shared FAQ intents (allergens,
-- vegetarian, spicy, pickup, preparation_time) that used to live in
-- es.json/en.json — restaurant-shaped vocabulary every tenant read
-- regardless of vertical. Their job moves to knowledge_entries.keywords:
-- a per-entry, per-tenant list of extra phrasings the customer's own
-- message is checked against, alongside the existing title match.
set role commerce_owner;

alter table app.knowledge_entries add column keywords text[] not null default '{}';

drop function app.review_unresolved_question(uuid,uuid,text,uuid,text,text);
create function app.review_unresolved_question(_actor uuid,_question_id uuid,_action text,_entry_id uuid,_title text,_content text,_keywords text[] default '{}')
returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$
declare tid uuid:=app.current_tenant_id();
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then raise insufficient_privilege using message='Actor cannot review unresolved questions'; end if;
  if _action='dismiss' then
    update app.unresolved_customer_questions set status='dismissed' where tenant_id=tid and id=_question_id and status='pending';
  elsif _action='publish' then
    if nullif(trim(_title),'') is null or nullif(trim(_content),'') is null then raise check_violation using message='Title and content are required'; end if;
    insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version,keywords)
    values(_entry_id,tid,'faq',trim(_title),trim(_content),'published','unresolved_question:'||_question_id::text,1,coalesce(_keywords,'{}'));
    update app.unresolved_customer_questions set status='resolved' where tenant_id=tid and id=_question_id and status='pending';
  else raise check_violation using message='Invalid review action'; end if;
  if not found then raise no_data_found using message='Pending question was not found'; end if;
  return true;
end $$;
revoke all on function app.review_unresolved_question(uuid,uuid,text,uuid,text,text,text[]) from public;
grant execute on function app.review_unresolved_question(uuid,uuid,text,uuid,text,text,text[]) to commerce_runtime;

-- Backfill: every published entry that used to be reachable through one of
-- the retired global intents' term lists gets that same vocabulary as its
-- own keywords, so no tenant's existing FAQ coverage regresses. Computed by
-- checking which retired-intent terms actually appeared in each entry's own
-- title+content before this migration (see the D-078 conversation); a
-- coincidental one-word overlap unrelated to the entry's actual topic
-- (e.g. "tiempo" inside an unrelated delivery-coverage answer) is
-- deliberately left out rather than carried forward as noise.
-- set_config(...,true) is transaction-local; psql runs each top-level
-- statement in its own autocommitted transaction unless explicitly wrapped,
-- so this whole block needs one explicit transaction to keep the tenant
-- context set across all the updates below (the same RLS/tenant-context
-- gotcha documented in 069's fix).
begin;
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000001', true);
update app.knowledge_entries set keywords=array['alerg','gluten','lactosa','contaminacion']
 where id='0194f007-0000-7000-8000-000000000015';
update app.knowledge_entries set keywords=array['demora','tarda','tiempo']
 where id='0194f007-0000-7000-8000-000000000012';
update app.knowledge_entries set keywords=array['picante','pica','salsa']
 where id='0194f007-0000-7000-8000-000000000013';
update app.knowledge_entries set keywords=array['recoger','recogida']
 where id='0194f007-0000-7000-8000-000000000018';
update app.knowledge_entries set keywords=array['vegetariano','vegetariana','sin carne','veggie']
 where id='0194f007-0000-7000-8000-000000000014';
commit;

begin;
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000004', true);
update app.knowledge_entries set keywords=array['alerg']
 where id='0194f007-0000-7000-8000-000000000043';
commit;

begin;
select set_config('app.tenant_id', '0194f000-0000-7000-8000-000000000005', true);
update app.knowledge_entries set keywords=array['demora','tarda','tiempo']
 where id='0194f007-0000-7000-8000-000000000052';
commit;

reset role;
