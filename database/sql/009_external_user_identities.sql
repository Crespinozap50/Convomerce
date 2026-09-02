-- Vincula identidades OIDC verificadas con usuarios internos.

set role commerce_owner;

create table app.user_identities (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete restrict,
  provider text not null check (provider in ('oidc')),
  issuer text not null,
  subject text not null,
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer, subject),
  unique (user_id, provider, issuer)
);

create function app.resolve_authenticated_user(_issuer text, _subject text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select identity.user_id
  from app.user_identities identity
  join app.users account on account.id = identity.user_id
  where identity.issuer = _issuer
    and identity.subject = _subject
    and identity.status = 'active'
    and account.status = 'active'
$$;

revoke all on app.user_identities from public, commerce_runtime, commerce_readonly, commerce_outbox;
revoke all on function app.resolve_authenticated_user(text,text) from public;
grant execute on function app.resolve_authenticated_user(text,text) to commerce_runtime;

reset role;
