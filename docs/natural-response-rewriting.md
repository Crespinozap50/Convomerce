# Natural response rewriting

## Goal

`NaturalResponseRewriter` is an optional presentation layer after deterministic response composition. It may improve warmth and conversational flow, but it cannot select business actions, query unverified knowledge, or mutate domain state.

## Initial eligibility

The first version only rewrites an explicit allowlist of non-interactive
`localized_template` responses where tone or empathy materially improves the
experience. Short operational prompts, confirmations, composite responses,
verified knowledge, carts, recommendations, resource lists, slot lists, and
interactive messages remain deterministic.

The initial allowlist covers recovery and clarification outcomes such as an
unknown item, an empty cart, unavailable appointment slots, missing active
orders or appointments, and expired recommendations. This prevents an OpenAI
call for every step of a transactional flow while keeping the layer useful when
the customer needs a clearer or warmer explanation.

This narrow eligibility avoids allowing a language model to restructure prices, schedules, product lists, or stable action identifiers before specialized validators exist.

## Safety and fallback

The OpenAI adapter uses the Responses API with:

- structured JSON output containing only `body`;
- `store: false`;
- a short configurable timeout;
- a small output-token limit;
- exact preservation checks for every interpolated fact value;
- deterministic fallback for disabled, ineligible, timeout, provider, parsing, length, or fact-preservation failures.

The selected mode, model, and fallback reason are stored in outbound decision metadata. API credentials must come from runtime secrets and are never stored in tenant configuration or source control.

For accepted OpenAI rewrites, evaluation metadata also stores the deterministic baseline and protected interpolation values. This enables tenant-scoped blind review without reconstructing the original response or exposing provider identity to the reviewer.

## Configuration

- `OPENAI_RESPONSE_REWRITING_ENABLED=false`
- `OPENAI_RESPONSE_MODEL=gpt-5.4-nano`
- `OPENAI_RESPONSE_TIMEOUT_MS=8000`
- `OPENAI_API_KEY=`
- `OPENAI_INPUT_COST_MINOR_PER_MILLION=100`
- `OPENAI_OUTPUT_COST_MINOR_PER_MILLION=400`

Cost rates are deployment configuration, not hard-coded pricing. They must be reviewed when the selected model or provider pricing changes.

The global feature flag is an emergency kill switch and remains disabled by default. Each tenant also has an independent policy with enablement, deterministic rollout percentage, daily request limit, monthly cost limit, and currency. Both the global flag and tenant policy must allow a request.

Budget capacity is reserved atomically before the provider call and settled afterward. This prevents concurrent conversations from independently observing stale capacity and exceeding the tenant limit. Every attempted provider call creates an `ai_usage` record with tokens, estimated cost, latency, model, and success state. Reservations and counters use short independent transactions, so the provider call does not hold their database locks. Abandoned reservations expire after five minutes and are reclaimed before subsequent reservations.

## Approved response library

Before reserving budget or contacting OpenAI, eligible templates query
`app.approved_response_variants` using the template namespace and key, locale,
template version, and protected facts. The functional identity intentionally
ignores punctuation and incidental changes in the deterministic wording. Facts
are represented by a SHA-256 identity, so a variant cannot be reused when a
price, product, date, name, or other protected value differs. A deliberate
semantic template change increments `template_version` and requires review.

Validated OpenAI results are stored automatically as tenant-scoped candidates.
Candidates and rejected variants block repeated provider calls but are not
reused: the deterministic response remains active until an administrator
approves the proposed text. Only an approved exact match uses `mode=library`,
increments `use_count`, and avoids an AI reservation or `ai_usage` row. The
panel labels this as a learned response rather than implying a new provider
call.

The schema also supports global curated variants. Runtime services may read
global rows but can only create or update rows for the active tenant. Approval,
editing, and rejection are available in the tenant knowledge panel. Promotion
to global scope remains a platform-administration operation, preventing tenant
tone or business identity from leaking across companies.

## Next controls

1. Build multilingual golden conversation evaluations.
2. Add an operational usage and response-library dashboard with alerts and
   approve, reject, and promote controls.
3. ✅ Composite validator added (2026-08-31, see "Expanding eligibility to the
   happy path" below) — scoped to `commercial.orderConfirmation` only.
   Interactive plans remain excluded; other composites need their own
   `rewriteKey` decision before they can be added.
4. Roll out to a small percentage of eligible Santos Tacos conversations and compare fallback, latency, conversion, and escalation rates.

## Expanding eligibility to the happy path (D-041)

Audit finding (2026-08-30): the allowlist covered only recovery/edge
templates. Greeting, order confirmation, appointment confirmation, and
recommendation presentation — the majority of real traffic — never reached
OpenAI. The bot sounded templated in most normal conversations by design, not
by budget. **Partially implemented (2026-08-31)**: appointment confirmation
templates and order confirmation are now eligible; greeting, recommendation,
and appointment slot/resource lists remain deliberately out of scope (see
below).

### Composite eligibility mechanism (implemented)

Unlike a `localized_template` plan (identified by `{namespace, key}`), a
`composite` plan is just an array of segments with no identifier. Eligibility
is opt-in per composite via an optional `rewriteKey?: string` field on the
`composite` variant of `ResponsePlan`
(`response-composition/response-plan.types.ts`): a flow service sets it only
on the specific composite it deliberately wants to expose to rewriting.
`CommercialFlowService.summary()` sets `rewriteKey: "commercial.orderConfirmation"`
on the plan it returns; every other composite (cart display, "more items",
appointment resource/slot lists, recommendation presentation) omits it and
stays `"ineligible"`, exactly as before this change. `NaturalResponseRewriter`
checks the key against a small `Set<string>` (`isEligibleComposite`), separate
from the `localized_template` whitelist since composite keys aren't backed by
a `CommercialCopyKey`/`AppointmentCopyKey` union.

### Validator (implemented)

`protectedFacts()` now handles composite plans: it collects every interpolated
value from `template` segments **plus** the full text of every `verified_text`
segment (rendered cart lines, addresses, totals — these are already-rendered
facts, not decorative text). The existing substring-presence check then
applies uniformly. A second check, `preservesFactOrder()`, closes a gap the
substring check alone misses: a rewrite could keep every cart line intact but
reorder them (e.g. put the total before the line items) and still pass a
pure substring check. `preservesFactOrder()` walks the protected facts in
extraction order and requires each to appear strictly after the previous one
in the rewritten body (natural connective phrasing between them is still
allowed — only reordering is rejected). Both checks reuse the existing
`fallbackReason: "fact_mismatch"`, no new enum value was added. Applied only
to `composite` plans — `localized_template` has no meaningful "order" to
violate with 1-3 interpolated values in a single sentence.

### Explicitly deferred, not resolved by this phase

- **Greeting composite** (`prependGreeting`/`assistantGreeting`): wraps
  different underlying composites (cart display, "more items", or the order
  confirmation itself) depending on call site, so a single `rewriteKey` would
  conflate shapes with different fact density. Needs its own design.
- **Recommendation presentation and appointment `resourcePrompt`/`slotPrompt`**:
  numbered lists the customer must reply to by exact index. Rewriting risks
  breaking that contract; these stay fully deterministic, consistent with
  `interactive` plans remaining hard-excluded regardless of `rewriteKey`.
- **`ApprovedResponseVariantService.identity()` for composites**: evaluated
  and deferred. `protectedFacts()` returns a deduplicated, unordered `Set` —
  two structurally different carts could collapse to the same fact-set hash
  and incorrectly reuse an approved variant's phrasing. Order confirmations
  vary far more combinatorially than the near-identical edge-case templates
  the variant cache was designed for, so the cache-hit payoff is low relative
  to that risk. Every eligible order confirmation calls OpenAI fresh each
  time (subject to the existing per-tenant budget and rollout), never the
  `library` fast path, until this is revisited with production data.

### Rollout discipline

Each newly eligible template still goes through the existing per-tenant
policy, atomic budget reservation, and rollout percentage (see "Budget"
above) — nothing here bypasses D-034. A new template should launch at a low
rollout percentage and require a blind naturalness evaluation pass before
increasing toward 100%.

### Low-cost complement: deterministic variant pools

Independent of OpenAI eligibility, add 3-5 deterministic phrasing variants
per template key for greeting and confirmation templates, rotated
per-conversation. This gives tenants without an AI budget (or during OpenAI
fallback) some variation without incurring provider cost or risk. It is a
complement, not a substitute — it does not adapt to conversation context the
way a rewrite can.
