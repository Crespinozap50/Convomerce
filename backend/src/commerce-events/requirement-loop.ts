// Pure, stateless helpers shared by CommercialFlowService and
// AppointmentFlowService to consult and validate configurable operational
// requirements (D-039/D-040, docs/operational-requirements.md). Neither flow
// service's state machine is modeled here on purpose: they build different
// response segment types and decide what happens after the requirement loop
// differently, so only the field-selection and validation logic is shared.
//
// Also holds a few smaller pure helpers (applyRequirementValue, singularize,
// describeLineItem) that used to be byte-identical copies in both flow
// services — consolidated here since both already import from this file.

import { escapeRegExp, normalizeForMatching as normalize } from "../localization/localization";

export type RequirementDataType =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "address"
  | "phone";

export type AddressValidationRule = {
  min_length?: number;
  min_words?: number;
  require_number?: boolean;
  structure_pattern?: "colombian_urban" | "generic_numbered" | "none";
};

export type PendingRequirement = {
  id: string;
  fieldKey: string;
  dataType: RequirementDataType;
  isRequired: boolean;
  displayOrder: number;
  validationRule: Record<string, unknown>;
  sensitivity: "none" | "pii" | "sensitive";
  requiresConfirmation: boolean;
  reuseFromContactMemory: boolean;
  label: string | null;
  helpText: string | null;
  options: { value: string; label: string }[];
};

// The colombian_urban pattern is the historical hardcoded behavior of the
// original isAddressDetailedEnough: it is kept as the default so tenants with
// no validation_rule configured (validation_rule='{}') see no change.
export const isAddressDetailedEnough = (
  value: string,
  rule: AddressValidationRule = {},
) => {
  const address = value.trim().replace(/\s+/g, " ");
  const minLength = rule.min_length ?? 12;
  const minWords = rule.min_words ?? 3;
  const requireNumber = rule.require_number ?? true;
  const pattern = rule.structure_pattern ?? "colombian_urban";
  const hasStructure =
    pattern === "none"
      ? true
      : pattern === "generic_numbered"
        ? /\d/.test(address)
        : /^\d+\s/.test(address) ||
          /[#,]/.test(address) ||
          /\d+\s*-\s*\d+/.test(address) ||
          // Real users on WhatsApp rarely type the "#" separator (e.g.
          // "Calle 52F 90 sur 130" instead of "Calle 52F # 90-130"). Two or
          // more distinct number groups still signals a complete
          // street-number + door-number address without requiring it.
          (address.match(/\d+/g) ?? []).length >= 2;
  return (
    address.length >= minLength &&
    address.split(" ").length >= minWords &&
    (!requireNumber || /\d/.test(address)) &&
    hasStructure
  );
};

// Selects the first still-unfilled requirement in display order. Requirements
// are expected to already be filtered to is_active/is_required by the caller
// (OperationalRequirementsService.getPendingRequirements) — this function only
// picks the next one, it does not re-apply eligibility rules.
export const nextPendingStep = (
  requirements: PendingRequirement[],
  alreadyFilledFieldKeys: string[],
): PendingRequirement | null => {
  const filled = new Set(alreadyFilledFieldKeys);
  return requirements.find((requirement) => !filled.has(requirement.fieldKey)) ?? null;
};

export type RequirementValueValidation =
  | { valid: true; value: string }
  | { valid: false };

// Shared by validateRequirementValue's select case and
// extractPendingRequirementValues below, so a select answer is recognized
// the same way whether it's the exact text of a targeted single-field
// prompt ("Corto") or embedded in a longer natural sentence ("Corto y sí
// quiero que me arreglen la barba también"). Conservative: only resolves
// when exactly one option's normalized value/label appears as a whole word
// (see the D-040 comment below for why 1-char candidates are excluded).
const findSelectOptionInText = (
  text: string,
  options: { value: string; label: string }[],
): { value: string; label: string } | null => {
  const normalizedText = normalize(text);
  const matches = options.filter((option) => {
    const candidates = [normalize(option.value), normalize(option.label)].filter(
      (candidate) => candidate.length >= 2,
    );
    return candidates.some((candidate) =>
      new RegExp(`\\b${escapeRegExp(candidate)}\\b`).test(normalizedText),
    );
  });
  return matches.length === 1 ? matches[0] : null;
};

export const validateRequirementValue = (
  raw: string,
  requirement: PendingRequirement,
): RequirementValueValidation => {
  const value = raw.trim();
  const rule = requirement.validationRule ?? {};
  switch (requirement.dataType) {
    case "text": {
      const minLength =
        typeof rule.min_length === "number" ? rule.min_length : 2;
      const maxLength =
        typeof rule.max_length === "number" ? rule.max_length : 500;
      return value.length >= minLength && value.length <= maxLength
        ? { valid: true, value }
        : { valid: false };
    }
    case "number": {
      const numeric = Number(value.replace(",", "."));
      if (!Number.isFinite(numeric)) return { valid: false };
      if (typeof rule.min === "number" && numeric < rule.min)
        return { valid: false };
      if (typeof rule.max === "number" && numeric > rule.max)
        return { valid: false };
      return { valid: true, value: String(numeric) };
    }
    case "select": {
      const byIndex = /^\d+$/.test(value)
        ? requirement.options[Number(value) - 1]
        : undefined;
      const byExact = requirement.options.find(
        (option) =>
          option.value.toLowerCase() === value.toLowerCase() ||
          option.label.toLowerCase() === value.toLowerCase(),
      );
      const match =
        byIndex ?? byExact ?? findSelectOptionInText(value, requirement.options);
      return match ? { valid: true, value: match.value } : { valid: false };
    }
    case "phone":
      return value.replace(/[^0-9+]/g, "").length >= 7
        ? { valid: true, value }
        : { valid: false };
    case "address":
      return isAddressDetailedEnough(value, rule as AddressValidationRule)
        ? { valid: true, value: value.slice(0, 500) }
        : { valid: false };
    case "boolean":
      // Boolean requirements are resolved from the understanding provider's
      // affirmative/negative entity, not raw text — callers must not reach
      // this branch for a boolean field.
      return { valid: false };
  }
};

// Resolves a boolean requirement from the understanding provider's
// affirmative/negative entity (see conversation-copy.ts matchesResponse) —
// this only fires when the whole message is a bare yes/no reply. A message
// that mentions a yes/no attribute mid-sentence ("...sin cera") will not
// trigger this; tenants should model that as a `select` with explicit
// options instead, which extractPendingRequirementValues below can find
// anywhere in the message.
export const resolveBooleanRequirementValue = (
  entities: Record<string, unknown>,
): "true" | "false" | null =>
  entities.response === "affirmative"
    ? "true"
    : entities.response === "negative"
      ? "false"
      : null;

// Returns the single standalone numeric token in the message, or null when
// there are zero or more than one — ambiguous either way, and deliberately
// NOT the same as parseQuantity (commercial-flow.service.ts), which defaults
// to 1 when no number is found. That default is correct for cart quantity
// ("2 tacos" implies at least 1) but wrong here: silently writing "1" into an
// unrelated custom numeric field the message never mentioned would be an
// invented value, exactly what D-040's conservative fallback rule forbids.
const extractStandaloneNumber = (body: string): string | null => {
  const matches = body.match(/\b\d{1,4}(?:[.,]\d+)?\b/g);
  return matches && matches.length === 1 ? matches[0].replace(",", ".") : null;
};

export type ExtractedRequirementValue = { fieldKey: string; value: string };

// D-040: conservative multi-field extraction. `pending` must already exclude
// "name"/"delivery_address" — callers filter those out first, since both keep
// bespoke single-purpose sub-flows (contact display name, saved-address
// reuse) that don't fit this generic model. A field is only resolved when
// there is exactly one candidate for it and no competing ambiguity; anything
// else is left out of the result and falls back to the existing one-field-
// at-a-time flow. text/address/phone are never attempted here, even when
// they are the only pending field — there is no reliable way to bound
// confidence over free text without real NLP.
export const extractPendingRequirementValues = (
  body: string,
  entities: Record<string, unknown>,
  pending: PendingRequirement[],
): ExtractedRequirementValue[] => {
  const resolved: ExtractedRequirementValue[] = [];

  const booleanFields = pending.filter((r) => r.dataType === "boolean");
  if (booleanFields.length === 1) {
    const value = resolveBooleanRequirementValue(entities);
    if (value !== null)
      resolved.push({ fieldKey: booleanFields[0].fieldKey, value });
  }

  const numberFields = pending.filter((r) => r.dataType === "number");
  if (numberFields.length === 1) {
    const raw = extractStandaloneNumber(body);
    if (raw !== null) {
      const validated = validateRequirementValue(raw, numberFields[0]);
      if (validated.valid)
        resolved.push({ fieldKey: numberFields[0].fieldKey, value: validated.value });
    }
  }

  for (const requirement of pending.filter((r) => r.dataType === "select")) {
    const match = findSelectOptionInText(body, requirement.options);
    if (match) {
      const validated = validateRequirementValue(match.value, requirement);
      if (validated.valid)
        resolved.push({ fieldKey: requirement.fieldKey, value: validated.value });
    }
  }

  return resolved;
};

// A requirement marked requires_confirmation always goes through an explicit
// yes/no step before landing in context.values, regardless of extraction
// confidence (D-040, golden rule 9) — a value en route to confirmation is
// staged separately so it never gets treated as already-filled.
export const applyRequirementValue = (
  requirement: PendingRequirement,
  value: string,
  context: Record<string, unknown>,
): Record<string, unknown> => {
  if (requirement.requiresConfirmation)
    return {
      ...context,
      pendingConfirmations: {
        ...((context.pendingConfirmations as Record<string, string>) ?? {}),
        [requirement.fieldKey]: value,
      },
    };
  return {
    ...context,
    values: {
      ...((context.values as Record<string, string>) ?? {}),
      [requirement.fieldKey]: value,
    },
  };
};

// Naive Spanish singularizer so "quesadillas" matches a catalog item named
// "Quesadilla" in token-based scoring; catalog items are stored singular but
// customers naturally order in plural ("quiero 2 quesadillas").
export const singularize = (word: string): string => {
  if (word.length <= 3) return word;
  if (/[aeiou]s$/.test(word)) return word.slice(0, -1);
  if (/[^aeiou]es$/.test(word)) return word.slice(0, -2);
  return word;
};

// The exact snapshot text frozen into request_lines.description_snapshot at
// add time (D-110: name/variant_name already carry the customer's locale by
// the time they reach here) — never re-derived per turn, see D-110.
export const describeLineItem = (item: { name: string; variant_name: string }): string =>
  `${item.name} (${item.variant_name})`;
