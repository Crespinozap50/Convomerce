-- DISEÑO INICIAL REVISABLE; TODAVÍA NO EJECUTADO.
-- Todas las tablas listadas contienen tenant_id y fallan cerradas sin contexto.

set role commerce_owner;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenant_users', 'channels', 'contacts', 'contact_identities',
    'conversations', 'messages', 'conversation_results', 'catalogs',
    'catalog_items', 'item_variants', 'modifier_groups', 'modifier_options',
    'item_modifier_groups', 'knowledge_entries', 'tenant_policies',
    'prompt_versions', 'commercial_requests', 'request_lines',
    'request_line_modifiers', 'human_handoffs', 'processing_events',
    'outbox_events', 'processed_events', 'audit_events', 'ai_usage'
  ]
  loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('alter table app.%I force row level security', table_name);
    execute format(
      'create policy tenant_isolation on app.%I using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id())',
      table_name
    );
  end loop;
end
$$;

-- tenants y users son tablas globales: no se otorgan directamente al runtime.
-- Su acceso se realizará mediante funciones o servicios explícitamente autorizados.

reset role;
