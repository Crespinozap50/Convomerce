-- Preserve a short, bounded conversation window so reviewers can understand
-- follow-up questions without storing an unbounded transcript copy.
set role commerce_owner;

alter table app.unresolved_customer_questions
  add column context_messages jsonb not null default '[]'::jsonb
  check (jsonb_typeof(context_messages) = 'array');

alter table app.unresolved_customer_questions no force row level security;
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
   ),'[]'::jsonb);
alter table app.unresolved_customer_questions force row level security;

reset role;
