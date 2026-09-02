set role commerce_owner;

alter table app.conversations
  add column language_locale text,
  add column language_source text
    check (language_source in ('tenant_default', 'contact_preference', 'detected')),
  add column language_candidate_locale text,
  add column language_candidate_count smallint not null default 0
    check (language_candidate_count between 0 and 10),
  add column language_updated_at timestamptz;

alter table app.conversations
  add constraint conversations_language_state_check check (
    (language_locale is null and language_source is null and language_updated_at is null)
    or
    (language_locale is not null and language_source is not null and language_updated_at is not null)
  ),
  add constraint conversations_language_candidate_check check (
    (language_candidate_locale is null and language_candidate_count = 0)
    or
    (language_candidate_locale is not null and language_candidate_count > 0)
  );

reset role;
