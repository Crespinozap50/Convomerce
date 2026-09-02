-- DISEÑO INICIAL REVISABLE; TODAVÍA NO EJECUTADO.
-- Requiere UUIDv7 generado por la aplicación. No depende de un ORM.

set role commerce_owner;

create schema if not exists app authorization commerce_owner;
revoke all on schema public from public;

create table app.schema_migrations (
  version text primary key,
  name text not null unique,
  checksum char(64) not null,
  applied_at timestamptz not null default now(),
  check (version ~ '^[0-9]{3}$'),
  check (checksum ~ '^[0-9a-f]{64}$')
);

create function app.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create table app.tenants (
  id uuid primary key,
  slug text not null unique,
  display_name text not null,
  status text not null check (status in ('active', 'suspended', 'disabled')),
  timezone text not null,
  default_locale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table app.users (
  id uuid primary key,
  email text not null,
  display_name text not null,
  status text not null check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_ci_uidx on app.users (lower(email));

create table app.tenant_users (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  user_id uuid not null references app.users(id) on delete restrict,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  status text not null check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);

create table app.channels (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  provider text not null check (provider in ('whatsapp_cloud')),
  external_account_id text not null,
  external_address text not null,
  status text not null check (status in ('active', 'disabled', 'error')),
  secret_reference text not null,
  configuration_version integer not null default 1 check (configuration_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (provider, external_address)
);

create table app.contacts (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  display_name text,
  locale text,
  timezone text,
  consent_status text not null default 'unknown'
    check (consent_status in ('unknown', 'granted', 'denied', 'withdrawn')),
  consent_at timestamptz,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((consent_status = 'unknown' and consent_at is null) or consent_status <> 'unknown')
);

create table app.contact_identities (
  id uuid primary key,
  tenant_id uuid not null,
  contact_id uuid not null,
  channel_id uuid not null,
  provider_subject text not null,
  normalized_address text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, channel_id, provider_subject),
  foreign key (tenant_id, contact_id) references app.contacts(tenant_id, id) on delete restrict,
  foreign key (tenant_id, channel_id) references app.channels(tenant_id, id) on delete restrict
);

create table app.conversations (
  id uuid primary key,
  tenant_id uuid not null,
  channel_id uuid not null,
  contact_id uuid not null,
  previous_conversation_id uuid,
  assigned_user_id uuid,
  status text not null check (status in ('open', 'waiting_customer', 'waiting_human', 'closed')),
  current_intent text,
  close_reason text check (close_reason in ('completed', 'human_resolved', 'inactive', 'customer_ended', 'cancelled', 'failed')),
  version integer not null default 1 check (version > 0),
  opened_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, channel_id) references app.channels(tenant_id, id) on delete restrict,
  foreign key (tenant_id, contact_id) references app.contacts(tenant_id, id) on delete restrict,
  foreign key (tenant_id, previous_conversation_id) references app.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, assigned_user_id) references app.tenant_users(tenant_id, id) on delete restrict,
  check ((status = 'closed' and closed_at is not null and close_reason is not null)
      or (status <> 'closed' and closed_at is null and close_reason is null))
);
create unique index conversations_one_active_uidx
  on app.conversations (tenant_id, channel_id, contact_id)
  where status <> 'closed';
create index conversations_activity_idx
  on app.conversations (tenant_id, status, last_activity_at);

create table app.messages (
  id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  channel_id uuid not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('contact', 'ai', 'user', 'system')),
  external_message_id text,
  message_type text not null check (message_type in ('text', 'image', 'audio', 'video', 'document', 'location', 'interactive', 'unknown')),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  reply_to_message_id uuid,
  delivery_status text not null check (delivery_status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  occurred_at timestamptz not null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references app.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, channel_id) references app.channels(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reply_to_message_id) references app.messages(tenant_id, id) on delete restrict
);
create unique index messages_external_id_uidx
  on app.messages (tenant_id, channel_id, external_message_id)
  where external_message_id is not null;
create index messages_conversation_timeline_idx
  on app.messages (tenant_id, conversation_id, occurred_at, id);

create table app.conversation_results (
  id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  supersedes_result_id uuid,
  result_type text not null check (result_type in ('resolved', 'order_ready', 'qualified_opportunity', 'human_handoff', 'abandoned', 'failed')),
  source text not null check (source in ('system', 'ai', 'user')),
  is_final boolean not null default false,
  metadata_schema_version integer not null default 1 check (metadata_schema_version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references app.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_result_id) references app.conversation_results(tenant_id, id) on delete restrict
);
create unique index conversation_results_one_final_uidx
  on app.conversation_results (tenant_id, conversation_id)
  where is_final;

create table app.catalogs (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  name text not null,
  status text not null check (status in ('draft', 'published', 'archived')),
  currency char(3) not null,
  version integer not null check (version > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name, version),
  check ((status = 'published' and published_at is not null) or status <> 'published')
);
create index catalogs_status_idx on app.catalogs (tenant_id, status, published_at desc);

create table app.catalog_items (
  id uuid primary key,
  tenant_id uuid not null,
  catalog_id uuid not null,
  external_reference text,
  name text not null,
  description text,
  category text,
  status text not null check (status in ('active', 'inactive', 'archived')),
  attributes_schema_version integer not null default 1 check (attributes_schema_version > 0),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, catalog_id) references app.catalogs(tenant_id, id) on delete restrict
);
create unique index catalog_items_external_ref_uidx
  on app.catalog_items (tenant_id, catalog_id, external_reference)
  where external_reference is not null;

create table app.item_variants (
  id uuid primary key,
  tenant_id uuid not null,
  catalog_item_id uuid not null,
  sku text,
  name text not null,
  status text not null check (status in ('active', 'inactive', 'archived')),
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null,
  availability_status text not null check (availability_status in ('available', 'unavailable', 'unknown')),
  availability_checked_at timestamptz,
  attributes_schema_version integer not null default 1 check (attributes_schema_version > 0),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, catalog_item_id) references app.catalog_items(tenant_id, id) on delete restrict
);
create unique index item_variants_sku_uidx
  on app.item_variants (tenant_id, sku) where sku is not null;
create index item_variants_lookup_idx
  on app.item_variants (tenant_id, catalog_item_id, status, availability_status);

create table app.modifier_groups (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  name text not null,
  selection_type text not null check (selection_type in ('single', 'multiple')),
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer check (max_selections is null or max_selections >= 1),
  status text not null check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (max_selections is null or max_selections >= min_selections),
  check (selection_type = 'multiple' or coalesce(max_selections, 1) = 1)
);

create table app.modifier_options (
  id uuid primary key,
  tenant_id uuid not null,
  modifier_group_id uuid not null,
  name text not null,
  price_delta_minor bigint not null default 0,
  currency char(3) not null,
  status text not null check (status in ('active', 'inactive', 'archived')),
  sort_order integer not null default 0,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, modifier_group_id) references app.modifier_groups(tenant_id, id) on delete restrict
);

create table app.item_modifier_groups (
  id uuid primary key,
  tenant_id uuid not null,
  catalog_item_id uuid,
  item_variant_id uuid,
  modifier_group_id uuid not null,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, catalog_item_id) references app.catalog_items(tenant_id, id) on delete restrict,
  foreign key (tenant_id, item_variant_id) references app.item_variants(tenant_id, id) on delete restrict,
  foreign key (tenant_id, modifier_group_id) references app.modifier_groups(tenant_id, id) on delete restrict,
  check ((catalog_item_id is not null)::integer + (item_variant_id is not null)::integer = 1)
);
create unique index item_modifier_groups_item_uidx
  on app.item_modifier_groups (tenant_id, catalog_item_id, modifier_group_id)
  where catalog_item_id is not null;
create unique index item_modifier_groups_variant_uidx
  on app.item_modifier_groups (tenant_id, item_variant_id, modifier_group_id)
  where item_variant_id is not null;

create table app.knowledge_entries (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  kind text not null check (kind in ('hours', 'coverage', 'faq', 'instruction', 'policy', 'other')),
  title text not null,
  content text not null,
  status text not null check (status in ('draft', 'published', 'archived')),
  valid_from timestamptz,
  valid_until timestamptz,
  source_reference text,
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create table app.tenant_policies (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  policy_type text not null,
  schema_version integer not null check (schema_version > 0),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  status text not null check (status in ('draft', 'active', 'archived')),
  effective_from timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, policy_type, schema_version)
);

create table app.prompt_versions (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  purpose text not null,
  version integer not null check (version > 0),
  template_reference text not null,
  model_configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(model_configuration) = 'object'),
  status text not null check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, purpose, version)
);

create table app.commercial_requests (
  id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  contact_id uuid not null,
  request_type text not null check (request_type in ('order', 'quote', 'reservation', 'opportunity')),
  status text not null check (status in ('draft', 'awaiting_confirmation', 'ready', 'cancelled', 'expired')),
  currency char(3) not null,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  fulfillment_type text,
  customer_notes text,
  version integer not null default 1 check (version > 0),
  confirmed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references app.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, contact_id) references app.contacts(tenant_id, id) on delete restrict,
  check (total_minor >= subtotal_minor),
  check (status <> 'ready' or confirmed_at is not null)
);
create unique index commercial_requests_one_editable_uidx
  on app.commercial_requests (tenant_id, conversation_id, request_type)
  where status in ('draft', 'awaiting_confirmation');
create index commercial_requests_status_idx
  on app.commercial_requests (tenant_id, conversation_id, status, updated_at desc);

create table app.request_lines (
  id uuid primary key,
  tenant_id uuid not null,
  commercial_request_id uuid not null,
  item_variant_id uuid,
  description_snapshot text not null,
  unit_price_minor_snapshot bigint not null check (unit_price_minor_snapshot >= 0),
  currency char(3) not null,
  quantity numeric(12,3) not null check (quantity > 0),
  attributes_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes_snapshot) = 'object'),
  line_total_minor bigint not null check (line_total_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, commercial_request_id) references app.commercial_requests(tenant_id, id) on delete restrict,
  foreign key (tenant_id, item_variant_id) references app.item_variants(tenant_id, id) on delete restrict
);

create table app.request_line_modifiers (
  id uuid primary key,
  tenant_id uuid not null,
  request_line_id uuid not null,
  modifier_option_id uuid,
  description_snapshot text not null,
  unit_price_delta_minor_snapshot bigint not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  total_delta_minor bigint not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, request_line_id) references app.request_lines(tenant_id, id) on delete restrict,
  foreign key (tenant_id, modifier_option_id) references app.modifier_options(tenant_id, id) on delete restrict
);

create table app.human_handoffs (
  id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  assigned_user_id uuid,
  reason text not null,
  priority text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  summary text not null,
  suggested_next_action text,
  status text not null check (status in ('requested', 'accepted', 'resolved', 'cancelled')),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references app.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, assigned_user_id) references app.tenant_users(tenant_id, id) on delete restrict
);
create unique index human_handoffs_one_active_uidx
  on app.human_handoffs (tenant_id, conversation_id)
  where status in ('requested', 'accepted');

create table app.processing_events (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  source text not null,
  external_event_id text not null,
  correlation_id uuid not null,
  status text not null check (status in ('received', 'processing', 'processed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  payload_reference text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text,
  unique (tenant_id, id),
  unique (tenant_id, source, external_event_id)
);

create table app.outbox_events (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  correlation_id uuid not null,
  payload_schema_version integer not null check (payload_schema_version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'publishing', 'published', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  last_error_code text,
  unique (tenant_id, id),
  check ((status = 'published' and published_at is not null) or status <> 'published'),
  check ((status = 'publishing' and lease_expires_at is not null) or status <> 'publishing')
);
create index outbox_events_publishable_idx
  on app.outbox_events (available_at, created_at)
  where status in ('pending', 'publishing');

create table app.processed_events (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  consumer_name text not null,
  event_id uuid not null,
  processed_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, consumer_name, event_id)
);

create table app.audit_events (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  actor_type text not null check (actor_type in ('user', 'service', 'ai', 'system')),
  actor_id uuid,
  action text not null,
  subject_type text not null,
  subject_id uuid,
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (tenant_id, id)
);
create index audit_events_timeline_idx on app.audit_events (tenant_id, occurred_at desc, id);

create table app.ai_usage (
  id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid,
  message_id uuid,
  provider text not null,
  model text not null,
  purpose text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_minor bigint not null default 0 check (estimated_cost_minor >= 0),
  cost_currency char(3) not null,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  success boolean not null,
  occurred_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references app.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, message_id) references app.messages(tenant_id, id) on delete restrict
);
create index ai_usage_timeline_idx on app.ai_usage (tenant_id, occurred_at desc, id);

reset role;
