set role commerce_owner;

-- D-164 (docs/decisions.md): a new AI purpose ('business_faq') answers
-- informational questions (hours/location/payments/policies...) that
-- classifyMessage()'s fixed keyword lists miss, using the tenant's real
-- business data as grounding context — same shared budget/reservation
-- mechanism as response_rewriting/consultative_recommendation, just a new
-- allowed value on the existing purpose check.
alter table app.ai_usage_reservations drop constraint if exists ai_usage_reservations_purpose_check;
alter table app.ai_usage_reservations add constraint ai_usage_reservations_purpose_check
  check (purpose in ('response_rewriting','consultative_recommendation','business_faq'));

reset role;
