begin;

alter table app.bot_configurations
  drop constraint if exists bot_configurations_locale_check;

alter table app.bot_configurations
  add constraint bot_configurations_locale_check
  check (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

alter table app.bot_configurations
  alter column locale set default 'en',
  alter column welcome_message set default 'Hello! How can I help you?',
  alter column fallback_message set default 'I did not understand your request. I can connect you with a person.',
  alter column handoff_keywords set default array['agent','human','person']::text[];

comment on column app.bot_configurations.locale is
  'Canonical BCP 47 locale. Conversation copy falls back to English when its language catalog is unavailable.';

commit;
