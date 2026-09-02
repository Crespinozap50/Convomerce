-- Tenant-controlled Google Calendar assignment strategy.
set role commerce_owner;
alter table app.calendar_sources
  add column scheduling_mode text not null default 'global'
    check(scheduling_mode in('global','per_resource')),
  add column global_external_calendar_id text;
reset role;
