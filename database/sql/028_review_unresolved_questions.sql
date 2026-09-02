set role commerce_owner;
create function app.review_unresolved_question(_actor uuid,_question_id uuid,_action text,_entry_id uuid,_title text,_content text)
returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$
declare tid uuid:=app.current_tenant_id();
begin
  if tid is null or not app.can_manage_channel_connections(_actor) then raise insufficient_privilege using message='Actor cannot review unresolved questions'; end if;
  if _action='dismiss' then
    update app.unresolved_customer_questions set status='dismissed' where tenant_id=tid and id=_question_id and status='pending';
  elsif _action='publish' then
    if nullif(trim(_title),'') is null or nullif(trim(_content),'') is null then raise check_violation using message='Title and content are required'; end if;
    insert into app.knowledge_entries(id,tenant_id,kind,title,content,status,source_reference,version)
    values(_entry_id,tid,'faq',trim(_title),trim(_content),'published','unresolved_question:'||_question_id::text,1);
    update app.unresolved_customer_questions set status='resolved' where tenant_id=tid and id=_question_id and status='pending';
  else raise check_violation using message='Invalid review action'; end if;
  if not found then raise no_data_found using message='Pending question was not found'; end if;
  return true;
end $$;
revoke all on function app.review_unresolved_question(uuid,uuid,text,uuid,text,text) from public;
grant execute on function app.review_unresolved_question(uuid,uuid,text,uuid,text,text) to commerce_runtime;
reset role;
