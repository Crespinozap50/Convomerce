-- Preserve cart history while allowing customers to remove an item.
set role commerce_owner;

alter table app.request_lines
  add column status text not null default 'active'
    check (status in ('active','removed')),
  add column removed_at timestamptz;

alter table app.request_lines add constraint request_lines_removed_consistency
  check ((status='removed') = (removed_at is not null));

create index request_lines_active_request_idx
  on app.request_lines(tenant_id,commercial_request_id,created_at)
  where status='active';

grant update(status,removed_at,quantity,line_total_minor,updated_at) on app.request_lines to commerce_runtime;

reset role;
