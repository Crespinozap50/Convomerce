set role commerce_owner;

-- Found live: notifying a customer that their accepted order is being
-- prepared (CommercialRequestsService.notifyOrderAccepted) needs the
-- tenant's default_locale as a fallback when a conversation has no
-- language_locale resolved yet — commerce_runtime's existing column grant
-- on app.tenants (048/049) never included it, so the very first real call
-- failed outright with "permission denied for table tenants".
grant select (id, display_name, timezone, default_locale) on app.tenants to commerce_runtime;

reset role;
