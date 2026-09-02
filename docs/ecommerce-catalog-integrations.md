# External commercial catalog integrations

The assistant uses one tenant-isolated internal commercial offering as its trusted model. Products and services may be entered manually or synchronized from Shopify, Magento / Adobe Commerce, or another API without changing the bot or AI layer.

## Integration boundary

Each provider is implemented as an adapter that maps external products, variants, prices, availability, and categories into the existing `catalog_items` and `item_variants` tables. The external ecommerce remains the source of truth for records owned by that source. The application stores the provider and external reference so synchronization is idempotent.

Synchronization can combine provider webhooks with scheduled reconciliation jobs. Jobs run through BullMQ and record operational failures; provider-specific orchestration remains replaceable and does not enter the core conversation flow.

## Credentials

`catalog_sources.secret_reference` contains only an opaque reference to a server-side secret. Access tokens and API keys must never be returned to the browser or stored directly in PostgreSQL. Each tenant configures and tests its own source through an administrator UI.

## Planned adapters

- `manual`: products managed inside this application.
- `shopify`: Admin API and webhooks.
- `magento`: Magento / Adobe Commerce REST API and webhooks where available.
- `custom_api`: a documented provider-neutral contract for other ecommerce systems.

The first increment exposes business facts, existing FAQs, catalog contents, and planned source status. Creating credentials, synchronization workers, and conflict policy is deliberately deferred until one provider is selected for the pilot.
