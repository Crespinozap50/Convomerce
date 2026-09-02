# Response composition boundary

## Responsibility

`LocalizedResponseComposer` is the only component that turns a domain response plan into outbound customer-facing content. The event consumer receives a composed response and does not interpolate templates, select locale catalogs, or modify interactive payloads.

## Supported plans

- `localized_template`: typed commercial or appointment template plus interpolation values;
- `composite`: ordered localized templates, verified domain data, and line breaks, with an optional interactive payload;
- `verified_content`: tenant-configured or database-backed content that must be preserved.

There is no legacy rendered-body variant. Commercial and appointment capabilities must return a structured response plan; the decision engine rejects a domain response that bypasses this boundary.

Commercial and appointment flows have completed this migration. Simple outcomes use typed namespace templates, while carts, summaries, recommendations, resources, and available-slot lists use `composite` plans. Product names, quantities, prices, addresses, resources, schedules, and recommendation facts remain verified values or segments and are never translated as static copy.

## WhatsApp validation

Before persistence and transport, the composer:

- canonicalizes the BCP 47 locale;
- rejects empty output;
- enforces the 4,096-character text limit;
- enforces the 1,024-character interactive-body limit;
- reuses the complete composed body as the interactive body;
- validates option count, stable identifiers, uniqueness, and button-title length.

This prevents the stored answer and the WhatsApp-visible answer from diverging.

## Future AI composition

An optional AI-assisted layer can now rewrite eligible simple templates for tone. It must preserve interpolated facts, and any timeout, schema failure, policy failure, or validation failure falls back to this deterministic composer. Composite and interactive plans remain deterministic. See [natural-response-rewriting.md](natural-response-rewriting.md).
