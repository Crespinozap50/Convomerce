# Conversation understanding boundary

## Purpose

Incoming customer language is converted into a stable `ConversationUnderstanding` value before domain flows run. Order, appointment, recommendation, and handoff decisions can therefore evolve independently from deterministic rules or an AI provider.

## Contract

The contract contains:

- canonical BCP 47 locale and its source;
- intent and normalized confidence from `0` to `1`;
- extracted entities;
- requested action;
- missing information;
- human-handoff requirement;
- provider name and version.

The deterministic provider currently extracts normalized commands, confirmations, quantities, fulfillment choices, recommendation actions, catalog search terms, numeric selections, resource-neutral choices, and requested dates. Relative dates are resolved using the tenant timezone supplied with the input, never the application server timezone.

The contract must not contain tenant-specific fields or executable instructions. Provider output is untrusted input to domain validation and never authorizes a database mutation by itself.

## Current provider

`DeterministicUnderstandingProvider` is the only enabled provider. It uses versioned locale resources and stable interactive identifiers. Its output is stored with the outbound message for traceability. Order and appointment flows consume normalized commands, quantities, confirmations, fulfillment choices, and recommendation actions from this contract while remaining authoritative over business validation and state transitions.

## Planned providers

- `OpenAIUnderstandingProvider`: structured extraction for ambiguous language, protected by timeout, schema validation, budgets, and feature flags.
- `HybridUnderstandingProvider`: deterministic fast path, AI escalation below a confidence threshold, and deterministic fallback after any external failure.

OpenAI remains disabled until evaluation fixtures and tenant cost controls are in place.
