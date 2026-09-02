-- Expired holds no longer block a resource; confirmed appointments always do.
set role commerce_owner;

create or replace function app.prevent_appointment_overlap() returns trigger
language plpgsql security definer set search_path=pg_catalog,app as $$
begin
  if new.resource_id is null or new.status not in('held','confirmed') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||new.resource_id::text,0));
  if exists(
    select 1 from app.appointments existing
    where existing.tenant_id=new.tenant_id and existing.resource_id=new.resource_id
      and existing.id<>new.id
      and (existing.status='confirmed' or (existing.status='held' and existing.hold_expires_at>now()))
      and tstzrange(existing.starts_at,existing.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')
  ) then raise exclusion_violation using message='Resource already has an appointment in this time range'; end if;
  return new;
end $$;

reset role;
