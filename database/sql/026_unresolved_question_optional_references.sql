-- Learning records survive conversation/message retention cleanup.
set role commerce_owner;
alter table app.unresolved_customer_questions
  drop constraint unresolved_customer_questions_tenant_id_last_conversation__fkey,
  drop constraint unresolved_customer_questions_tenant_id_last_message_id_fkey;
alter table app.unresolved_customer_questions
  add constraint unresolved_customer_questions_last_conversation_fkey
    foreign key (tenant_id,last_conversation_id) references app.conversations(tenant_id,id)
    on delete set null (last_conversation_id),
  add constraint unresolved_customer_questions_last_message_fkey
    foreign key (tenant_id,last_message_id) references app.messages(tenant_id,id)
    on delete set null (last_message_id);
reset role;
