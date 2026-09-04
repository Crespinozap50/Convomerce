# Internationalization policy

## Language boundaries

- Source code, identifiers, structured logs, metric descriptions, internal errors, and operational messages use English.
- The frontend uses English (`en`) as its source and fallback locale.
- Spanish (`es`) and future languages live only in translation catalogs.
- The interface language is a per-user preference and is independent from a tenant's customer-service language.
- Backend APIs return stable uppercase error codes; clients translate those codes instead of translating free-form server messages.
- Historical applied SQL migrations remain immutable. New migrations and database routines must use English.

## Current persistence

The frontend stores `commerce.uiLanguage` in browser local storage. A future user-preferences migration will persist the same choice per user so it follows them across devices.

## Conversation engine

- Tenant bot configuration accepts canonical BCP 47 tags such as `es-CO`, `en-US`, or `pt-BR`; it is not limited to a TypeScript language union.
- Customer-facing copy, intent vocabulary, and language-specific stop words live under `backend/src/localization/locales/`.
- Commercial and appointment classifiers load patterns, quantities, relative dates, months, and weekdays from language resources; domain services contain no language-specific branches.
- English is the source and fallback catalog. A locale without a catalog keeps running in English until its catalog is added.
- Regional locale tags are retained for currency and date formatting even when copy is selected by base language.
- The effective customer language is persisted per conversation with its source and a possible switch candidate.
- Clear evidence in the first message may select a language immediately. An active conversation changes language only after two consecutive clear messages in the new language.
- Ambiguous messages retain the current conversation language. A contact preference takes precedence at conversation start, followed by detected language and the tenant default.
- Verified business-profile facts, catalog item/variant names, category labels, and knowledge entries can have approved locale variants — sibling `*_localizations` tables keyed by `(tenant_id, entity, locale)`, `left join` + `coalesce` against the base row at read time (D-086, D-110; see `docs/operational-requirements.md`-style rationale in `docs/decisions.md`). Missing variants fall back to the verified base value without an automatic AI translation. This applies both to informational replies (menu/price/FAQ questions) and to the actual order/appointment flow — a name matched or added while a locale variant exists is captured into `request_lines.description_snapshot`/workflow context in that locale at match time, since neither is re-derived per turn. Resource names (staff, spaces) and modifier option/group names are deliberately not localized — the former are proper nouns, the latter remain a known gap.
- Catalog content may contain translated text; domain services, identifiers, comments, logs, errors, and tests remain in English.
- Adding a language requires a catalog, conversation fixtures, and classification/formatting tests; it must not add tenant-specific branches.

## Repository audit boundary

Spanish text is permitted only in Spanish locale catalogs, language fixtures, tenant seed data, documentation written for the project owner, and immutable historical migrations. Production TypeScript, JavaScript, shell scripts, internal diagnostics, and mutable database tests use English.

## Error contract

Every failed HTTP response follows this shape:

```json
{
  "statusCode": 401,
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "Invalid email or password",
  "correlationId": "019..."
}
```

`message` is an English diagnostic fallback. The frontend displays the localized `errors.<code>` catalog entry and only uses `message` when it does not know the code.
