-- The initial context backfill also needs temporary owner visibility over the
-- source messages because FORCE RLS correctly hides them without tenant context.
set role commerce_owner;

alter table app.unresolved_customer_questions no force row level security;
alter table app.messages no force row level security;

update app.unresolved_customer_questions question
   set context_messages = coalesce((
     select jsonb_agg(
       jsonb_build_object(
         'direction', history.direction,
         'body', history.content->>'body',
         'occurredAt', history.occurred_at
       ) order by history.occurred_at, history.id
     )
       from (
         select message.id,message.direction,message.content,message.occurred_at
           from app.messages message
           join app.messages current_message
             on current_message.tenant_id=question.tenant_id
            and current_message.id=question.last_message_id
          where message.tenant_id=question.tenant_id
            and message.conversation_id=question.last_conversation_id
            and (message.occurred_at,message.id)<(current_message.occurred_at,current_message.id)
          order by message.occurred_at desc,message.id desc
          limit 4
       ) history
   ),'[]'::jsonb)
 where question.context_messages='[]'::jsonb;

alter table app.messages force row level security;
alter table app.unresolved_customer_questions force row level security;

reset role;
