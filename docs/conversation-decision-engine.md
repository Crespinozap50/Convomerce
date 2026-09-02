# Conversation decision engine

## Responsibility

`ConversationDecisionEngine` is the only orchestrator allowed to select a domain capability for an understood inbound message. Its current priority is:

1. appointment workflows and appointment operations;
2. commercial order workflows and recommendations;
3. verified business knowledge and fallback handling.

The event consumer does not know this ordering and does not call domain flows directly.

## Decision contract

A decision records:

- outcome (`respond` or `handoff`);
- selected capability;
- intent and requested action;
- understanding confidence;
- verified sources;
- deterministic reason;
- response plan.

Understanding and decision metadata are stored with the outbound message. This supports evaluation and incident diagnosis without storing hidden model reasoning.

## Safety boundary

The engine delegates mutations to domain capabilities. It never treats provider confidence as authorization and never bypasses tenant context, catalog availability, appointment constraints, or workflow transitions.

Decisions pass through `LocalizedResponseComposer`. Verified knowledge uses `verified_content`; commercial orders and appointments use typed localized templates and composite plans. A domain capability returning content without a structured plan is rejected instead of being silently rendered.
