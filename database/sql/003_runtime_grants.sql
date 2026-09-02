-- DISEÑO INICIAL REVISABLE; TODAVÍA NO EJECUTADO.

set role commerce_owner;

revoke all on schema app from public;
grant usage on schema app to commerce_runtime, commerce_outbox, commerce_readonly;
revoke all on function app.current_tenant_id() from public;
grant execute on function app.current_tenant_id() to commerce_runtime, commerce_readonly;

-- Entidades mutables. No se concede DELETE: retención y anonimización tendrán
-- operaciones explícitas cuando su política sea aprobada.
grant select, insert, update on
  app.tenant_users,
  app.channels,
  app.contacts,
  app.contact_identities,
  app.conversations,
  app.catalogs,
  app.catalog_items,
  app.item_variants,
  app.modifier_groups,
  app.modifier_options,
  app.item_modifier_groups,
  app.knowledge_entries,
  app.tenant_policies,
  app.prompt_versions,
  app.commercial_requests,
  app.request_lines,
  app.request_line_modifiers,
  app.human_handoffs,
  app.processing_events,
  app.ai_usage
to commerce_runtime;

-- Registros append-only: se insertan y consultan, pero no se sobrescriben.
grant select, insert on
  app.conversation_results,
  app.audit_events,
  app.processed_events
to commerce_runtime;

-- El mensaje es inmutable excepto por el estado de entrega.
grant select, insert on app.messages to commerce_runtime;
grant update (delivery_status) on app.messages to commerce_runtime;

-- El runtime crea eventos; el publicador técnico administra su entrega.
grant select, insert on app.outbox_events to commerce_runtime;

grant select on all tables in schema app to commerce_readonly;
revoke all on app.tenants, app.users from commerce_readonly;

grant select, update on app.outbox_events to commerce_outbox;

-- No se configuran privilegios por defecto. Cada tabla nueva debe declarar grants
-- explícitos para evitar acceso accidental a entidades globales o append-only.

reset role;
