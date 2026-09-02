-- Provider-neutral availability for people, spaces, equipment and other resources.
set role commerce_owner;

create table app.resource_availability_rules (
  id uuid primary key,
  tenant_id uuid not null,
  resource_id uuid not null,
  day_of_week smallint not null check(day_of_week between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  timezone text not null,
  status text not null default 'active' check(status in('active','inactive')),
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id),
  unique(tenant_id,resource_id,day_of_week,starts_at,ends_at),
  foreign key(tenant_id,resource_id) references app.booking_resources(tenant_id,id) on delete restrict,
  check(ends_at>starts_at),
  check(valid_until is null or valid_from is null or valid_until>=valid_from)
);

create table app.resource_availability_exceptions (
  id uuid primary key,
  tenant_id uuid not null,
  resource_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  availability text not null check(availability in('available','unavailable')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id),
  foreign key(tenant_id,resource_id) references app.booking_resources(tenant_id,id) on delete restrict,
  check(ends_at>starts_at)
);

create table app.service_resource_links (
  tenant_id uuid not null,
  catalog_item_id uuid not null,
  resource_id uuid not null,
  duration_minutes integer check(duration_minutes is null or duration_minutes>0),
  priority integer not null default 100 check(priority>=0),
  status text not null default 'active' check(status in('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,catalog_item_id,resource_id),
  foreign key(tenant_id,catalog_item_id) references app.catalog_items(tenant_id,id) on delete restrict,
  foreign key(tenant_id,resource_id) references app.booking_resources(tenant_id,id) on delete restrict
);

alter table app.appointments add column commercial_request_id uuid;
alter table app.appointments add constraint appointments_commercial_request_fk
  foreign key(tenant_id,commercial_request_id) references app.commercial_requests(tenant_id,id) on delete restrict;

create index resource_availability_rules_lookup_idx on app.resource_availability_rules(tenant_id,resource_id,day_of_week) where status='active';
create index resource_availability_exceptions_lookup_idx on app.resource_availability_exceptions(tenant_id,resource_id,starts_at,ends_at);
create index appointments_resource_time_idx on app.appointments(tenant_id,resource_id,starts_at,ends_at) where status in('held','confirmed');

alter table app.resource_availability_rules enable row level security;
alter table app.resource_availability_rules force row level security;
create policy tenant_isolation on app.resource_availability_rules using(tenant_id=app.current_tenant_id()) with check(tenant_id=app.current_tenant_id());
alter table app.resource_availability_exceptions enable row level security;
alter table app.resource_availability_exceptions force row level security;
create policy tenant_isolation on app.resource_availability_exceptions using(tenant_id=app.current_tenant_id()) with check(tenant_id=app.current_tenant_id());
alter table app.service_resource_links enable row level security;
alter table app.service_resource_links force row level security;
create policy tenant_isolation on app.service_resource_links using(tenant_id=app.current_tenant_id()) with check(tenant_id=app.current_tenant_id());

create function app.prevent_appointment_overlap() returns trigger
language plpgsql security definer set search_path=pg_catalog,app as $$
begin
  if new.resource_id is null or new.status not in('held','confirmed') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||new.resource_id::text,0));
  if exists(
    select 1 from app.appointments existing
    where existing.tenant_id=new.tenant_id and existing.resource_id=new.resource_id
      and existing.id<>new.id and existing.status in('held','confirmed')
      and tstzrange(existing.starts_at,existing.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')
  ) then raise exclusion_violation using message='Resource already has an appointment in this time range'; end if;
  return new;
end $$;
create trigger appointments_prevent_overlap before insert or update of resource_id,starts_at,ends_at,status
on app.appointments for each row execute function app.prevent_appointment_overlap();

revoke all on app.resource_availability_rules,app.resource_availability_exceptions,app.service_resource_links from public;
grant select,insert,update on app.booking_resources,app.calendar_sources,app.resource_calendar_links,app.appointments,
  app.resource_availability_rules,app.resource_availability_exceptions,app.service_resource_links to commerce_runtime;
grant select on app.resource_availability_rules,app.resource_availability_exceptions,app.service_resource_links to commerce_readonly;
revoke all on function app.prevent_appointment_overlap() from public;

reset role;
