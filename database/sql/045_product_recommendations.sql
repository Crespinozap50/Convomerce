-- Relaciones comerciales genéricas y medición de recomendaciones contextuales.
set role commerce_owner;

create table app.product_recommendations (
  id uuid primary key,
  tenant_id uuid not null,
  source_variant_id uuid not null,
  target_variant_id uuid not null,
  relationship_type text not null check (relationship_type in (
    'complements', 'upgrade_to', 'often_bought_with', 'compatible_with', 'substitute_for'
  )),
  priority integer not null default 100 check (priority between 0 and 1000),
  reason text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source_variant_id, target_variant_id, relationship_type),
  foreign key (tenant_id, source_variant_id) references app.item_variants(tenant_id, id) on delete restrict,
  foreign key (tenant_id, target_variant_id) references app.item_variants(tenant_id, id) on delete restrict,
  check (source_variant_id <> target_variant_id)
);

create table app.recommendation_events (
  id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  commercial_request_id uuid not null,
  recommendation_id uuid not null,
  target_variant_id uuid not null,
  status text not null check (status in ('shown', 'accepted', 'rejected', 'expired')),
  shown_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references app.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, commercial_request_id) references app.commercial_requests(tenant_id, id) on delete restrict,
  foreign key (tenant_id, recommendation_id) references app.product_recommendations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, target_variant_id) references app.item_variants(tenant_id, id) on delete restrict,
  check ((status = 'shown' and responded_at is null) or (status <> 'shown' and responded_at is not null))
);

create unique index recommendation_events_one_open_target_uidx
  on app.recommendation_events(tenant_id, commercial_request_id, target_variant_id)
  where status = 'shown';
create index product_recommendations_source_idx
  on app.product_recommendations(tenant_id, source_variant_id, status, priority);
create index recommendation_events_metrics_idx
  on app.recommendation_events(tenant_id, shown_at desc, status);

alter table app.product_recommendations enable row level security;
alter table app.product_recommendations force row level security;
create policy tenant_isolation on app.product_recommendations
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
alter table app.recommendation_events enable row level security;
alter table app.recommendation_events force row level security;
create policy tenant_isolation on app.recommendation_events
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

grant select, insert, update on app.product_recommendations, app.recommendation_events to commerce_runtime;
grant select on app.product_recommendations, app.recommendation_events to commerce_readonly;

reset role;
