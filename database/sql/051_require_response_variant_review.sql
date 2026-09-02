set role commerce_owner;

update app.approved_response_variants
   set status='candidate',updated_at=now()
 where source='openai' and status='approved';

reset role;
