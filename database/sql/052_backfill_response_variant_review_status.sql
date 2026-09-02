set role commerce_owner;

alter table app.approved_response_variants no force row level security;
update app.approved_response_variants
   set status='candidate',updated_at=now()
 where source='openai' and status='approved';
alter table app.approved_response_variants force row level security;

reset role;
