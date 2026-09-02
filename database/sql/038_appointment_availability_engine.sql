-- Deterministic availability, temporary holds and calendar-ready lifecycle events.
set role commerce_owner;

alter table app.appointments
  add column hold_expires_at timestamptz,
  add column cancelled_at timestamptz;
alter table app.appointments add constraint appointments_hold_expiry_check
  check(status<>'held' or hold_expires_at is not null);
create index appointments_expired_holds_idx on app.appointments(tenant_id,hold_expires_at) where status='held';

create function app.find_available_slots(
  _catalog_item_id uuid,
  _from timestamptz,
  _until timestamptz,
  _limit integer default 20
) returns table(resource_id uuid,resource_name text,starts_at timestamptz,ends_at timestamptz,timezone text)
language sql stable security definer set search_path=pg_catalog,app as $$
  with compatible as (
    select resource.id resource_id,resource.name resource_name,
      coalesce(link.duration_minutes,item.duration_minutes) duration_minutes
    from app.catalog_items item
    join app.service_resource_links link on link.tenant_id=item.tenant_id and link.catalog_item_id=item.id and link.status='active'
    join app.booking_resources resource on resource.tenant_id=link.tenant_id and resource.id=link.resource_id and resource.status='active'
    where item.tenant_id=app.current_tenant_id() and item.id=_catalog_item_id
      and coalesce(link.duration_minutes,item.duration_minutes) is not null
  ), candidates as (
    select compatible.*,rule.timezone,candidate starts_at,
      candidate+make_interval(mins=>compatible.duration_minutes) ends_at
    from compatible
    join app.resource_availability_rules rule on rule.tenant_id=app.current_tenant_id()
      and rule.resource_id=compatible.resource_id and rule.status='active'
    cross join lateral generate_series(
      date_bin('15 minutes',greatest(_from,now())+interval '14 minutes 59 seconds',timestamptz '2000-01-01 00:00:00+00'),
      _until,
      interval '15 minutes'
    ) candidate
    where extract(dow from candidate at time zone rule.timezone)::smallint=rule.day_of_week
      and (candidate at time zone rule.timezone)::time>=rule.starts_at
      and ((candidate+make_interval(mins=>compatible.duration_minutes)) at time zone rule.timezone)::time<=rule.ends_at
      and (rule.valid_from is null or (candidate at time zone rule.timezone)::date>=rule.valid_from)
      and (rule.valid_until is null or (candidate at time zone rule.timezone)::date<=rule.valid_until)
  )
  select candidate.resource_id,candidate.resource_name,candidate.starts_at,candidate.ends_at,candidate.timezone
  from candidates candidate
  where candidate.ends_at<=_until
    and not exists(select 1 from app.resource_availability_exceptions exception
      where exception.tenant_id=app.current_tenant_id() and exception.resource_id=candidate.resource_id
        and exception.availability='unavailable'
        and tstzrange(exception.starts_at,exception.ends_at,'[)')&&tstzrange(candidate.starts_at,candidate.ends_at,'[)'))
    and not exists(select 1 from app.appointments appointment
      where appointment.tenant_id=app.current_tenant_id() and appointment.resource_id=candidate.resource_id
        and (appointment.status='confirmed' or (appointment.status='held' and appointment.hold_expires_at>now()))
        and tstzrange(appointment.starts_at,appointment.ends_at,'[)')&&tstzrange(candidate.starts_at,candidate.ends_at,'[)'))
  order by candidate.starts_at,candidate.resource_name
  limit least(greatest(_limit,1),100)
$$;

create function app.hold_appointment(
  _id uuid,_catalog_item_id uuid,_contact_id uuid,_resource_id uuid,
  _commercial_request_id uuid,_idempotency_key text,_starts_at timestamptz,
  _ends_at timestamptz,_timezone text,_hold_minutes integer default 10
) returns uuid language plpgsql security definer set search_path=pg_catalog,app as $$
declare tid uuid:=app.current_tenant_id(); existing uuid;
begin
  if tid is null then raise invalid_authorization_specification using message='Tenant context is required'; end if;
  select id into existing from app.appointments where tenant_id=tid and idempotency_key=_idempotency_key;
  if existing is not null then return existing; end if;
  if not exists(
    select 1 from app.find_available_slots(_catalog_item_id,_starts_at,_ends_at,100) slot
    where slot.resource_id=_resource_id and slot.starts_at=_starts_at and slot.ends_at=_ends_at
  ) then raise exclusion_violation using message='Appointment slot is no longer available'; end if;
  insert into app.appointments(id,tenant_id,catalog_item_id,contact_id,resource_id,commercial_request_id,
    idempotency_key,starts_at,ends_at,timezone,status,hold_expires_at)
  values(_id,tid,_catalog_item_id,_contact_id,_resource_id,_commercial_request_id,_idempotency_key,
    _starts_at,_ends_at,_timezone,'held',now()+make_interval(mins=>least(greatest(_hold_minutes,1),30)));
  return _id;
end $$;

create function app.transition_appointment(_id uuid,_action text,_starts_at timestamptz default null,_ends_at timestamptz default null)
returns text language plpgsql security definer set search_path=pg_catalog,app as $$
declare tid uuid:=app.current_tenant_id(); current app.appointments%rowtype; event_type text;
begin
  select * into current from app.appointments where tenant_id=tid and id=_id for update;
  if current.id is null then raise no_data_found using message='Appointment was not found'; end if;
  if _action='confirm' then
    if current.status<>'held' or current.hold_expires_at<=now() then raise check_violation using message='Appointment hold has expired'; end if;
    update app.appointments set status='confirmed',hold_expires_at=null,updated_at=now() where id=_id;event_type:='appointment.confirmed';
  elsif _action='reschedule' then
    if current.status not in('held','confirmed') or _starts_at is null or _ends_at is null or _ends_at<=_starts_at then raise check_violation using message='Appointment cannot be rescheduled'; end if;
    update app.appointments set starts_at=_starts_at,ends_at=_ends_at,updated_at=now() where id=_id;event_type:='appointment.rescheduled';
  elsif _action='cancel' then
    if current.status not in('held','confirmed') then raise check_violation using message='Appointment cannot be cancelled'; end if;
    update app.appointments set status='cancelled',hold_expires_at=null,cancelled_at=now(),updated_at=now() where id=_id;event_type:='appointment.cancelled';
  elsif _action='complete' then
    if current.status<>'confirmed' then raise check_violation using message='Appointment cannot be completed'; end if;
    update app.appointments set status='completed',updated_at=now() where id=_id;event_type:='appointment.completed';
  else raise check_violation using message='Invalid appointment action'; end if;
  return event_type;
end $$;

revoke all on function app.find_available_slots(uuid,timestamptz,timestamptz,integer),
  app.hold_appointment(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer),
  app.transition_appointment(uuid,text,timestamptz,timestamptz) from public;
grant execute on function app.find_available_slots(uuid,timestamptz,timestamptz,integer),
  app.hold_appointment(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer),
  app.transition_appointment(uuid,text,timestamptz,timestamptz) to commerce_runtime;

reset role;
