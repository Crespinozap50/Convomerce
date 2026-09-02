set role commerce_owner;
alter table app.messages add column delivery_error_code text;
alter table app.messages add constraint messages_delivery_error_consistency check (
  (delivery_status='failed' and delivery_error_code is not null) or
  (delivery_status<>'failed' and delivery_error_code is null)
);
grant update (delivery_status,delivery_error_code) on app.messages to commerce_runtime;
reset role;
