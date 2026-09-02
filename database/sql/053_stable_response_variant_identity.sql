set role commerce_owner;

alter table app.approved_response_variants no force row level security;
update app.approved_response_variants
   set input_hash='5fbce3ce58bea5f384b01acb13bc75a31a0132486e78a9de4a6187f034f1a2b5',
       updated_at=now()
 where protected_facts='[]'::jsonb;
alter table app.approved_response_variants force row level security;

reset role;
