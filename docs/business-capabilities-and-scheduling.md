# Business capabilities and scheduling

The platform is designed for many business models without tenant-specific code. Initial examples include restaurants, car washes, spas, technology stores, and sportswear stores, but the core vocabulary must remain cross-industry.

## Shared model

Every tenant uses the same building blocks:

- business profile and locations;
- published knowledge and policies;
- commercial offerings;
- availability;
- orders, requests, or appointments;
- external sources;
- conversations and human handoff.

A commercial offering has one of these types: `product`, `service`, `prepared_product`, `appointment`, or `package`. Variants and attributes express differences such as size, color, vehicle class, preparation options, session duration, or equipment requirements. New industries configure data and capabilities instead of introducing branches in application code.

## Tenant capabilities

Each tenant can independently enable:

- `commercial_offerings`;
- `inventory`;
- `orders`;
- `appointments`;
- `delivery`.

Capabilities determine which administration and conversational flows are available. They do not create a different schema or deployment per tenant.

## Global conversational workflows

Orders, appointments, services, and quotes share one provider-neutral workflow engine. The engine stores the active step and context in `conversation_workflows`; tenant configuration determines which customer data is required for each operation and fulfillment type.

For example, an order delivered to a customer requires an address, while pickup and on-site consumption do not. An at-home appointment may require an address, while an appointment at the business does not. These differences are rows in `customer_data_requirements`, not custom code for restaurants, spas, car washes, or stores.

The first implemented vertical slice is a conversational cart: detect explicit purchase intent, select real catalog items, interpret quantities, aggregate repeated variants, add multiple lines, change quantities, remove lines without erasing their history, collect missing customer data, choose fulfillment, optionally reuse or save a consented address, present a summary, and explicitly confirm or cancel. Appointments, services, structured modifiers, payment, and inventory validation remain subsequent increments built on the same workflow model.

Global commands are evaluated before the current workflow step. A customer can view the catalog, request help, go back, change the product, fulfillment method or address, cancel, or ask for a person without the current field accidentally consuming that message as data. Informational navigation preserves the active process; cancellation closes it explicitly; human handoff preserves its state so an agent can inspect the context.

## Multiple schedules

A tenant may connect zero, one, or many schedule sources. The canonical providers currently anticipated are an internal schedule, Google Calendar, Microsoft Outlook, Calendly, and a custom API.

Scheduling separates:

- the service being booked;
- the customer contact;
- the resource, which may be a person, space, equipment, or another constrained asset;
- the external calendar source;
- the appointment and its idempotency key.

Examples include a therapist and room for a spa, a wash bay for a car wash, a table for a restaurant, or a technician for a technology service. Availability and booking confirmation are deterministic operations. AI may interpret intent and explain options, but it must never invent or reserve a slot without the scheduling service revalidating it.

Each resource owns zero or more weekly availability rules and temporary exceptions. Services are linked to every compatible resource, so a barbershop can assign the same haircut to several barbers while preserving a different schedule for each person. A car wash can use one resource per wash bay. Active appointments are protected by a transactional overlap check per tenant and resource.

The administration API and Agenda screen manage resources, weekly time ranges, and compatible services. All records use tenant-scoped foreign keys and forced RLS. Availability history is disabled rather than deleted.

The availability engine generates candidate slots in 15-minute increments using each resource's timezone, service duration, weekly rules, date ranges, exceptions, active holds, and confirmed appointments. Selecting a slot creates a ten-minute hold and revalidates availability inside the write transaction. Confirmation, rescheduling, cancellation, and completion produce transactional outbox events for external calendar adapters. Expired holds stop blocking availability automatically.

## Integration boundary

External commerce and scheduling systems are adapters around the canonical model. Tokens are represented by opaque secret references and are never returned to the browser or stored directly as application data. BullMQ handles synchronization and reconciliation jobs. Transactional outbox events connect state changes to replaceable external adapters.

Google Calendar will use one OAuth connection (`calendar_sources`) with one or more external calendar links (`resource_calendar_links`). A tenant may map each barber or wash station to a different Google calendar, or map several internal resources to calendars from the same Workspace account. Google events are synchronized into the canonical appointment model; Google is not the source of business rules, tenant authorization, or overlap validation.

## Google Calendar OAuth setup

1. In Google Cloud, enable the Google Calendar API and create an OAuth 2.0 **Web application** client.
2. Register `http://localhost:3000/v1/integrations/google-calendar/callback` as an authorized redirect URI for local development.
3. Configure `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, and a private random `CREDENTIAL_ENCRYPTION_KEY` in `backend/.env`.
4. Restart the backend and use **Agenda → Connect Google**. The backend requests offline access and encrypts the refresh token before storing it; the browser never receives the credential.

OAuth connection and credential rotation are implemented. Calendar selection per resource, free/busy import, and event push remain separate adapter steps so internal scheduling continues to be the source of truth when Google is unavailable.

## Delivery sequence

1. Configure tenant capabilities.
2. Administer products and services using the canonical offering model.
3. Administer FAQs and policies.
4. Add internal resources and availability.
5. Connect the first pilot calendar provider.
6. Let the AI consume only published knowledge and verified availability.
