#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_directory="$(cd "${script_directory}/.." && pwd)"

set -a
source "${backend_directory}/.env"
set +a

response_file="${TMPDIR:-/tmp}/openai-response-check.json"
request_file="${TMPDIR:-/tmp}/openai-response-request.json"

node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  model: process.env.OPENAI_RESPONSE_MODEL,
  store: false,
  max_output_tokens: 180,
  instructions: "Rewrite the supplied customer-service message so it sounds concise, warm, and natural in the specified locale. Preserve every fact token exactly. Do not add facts, promises, discounts, products, prices, dates, identifiers, or actions. Return JSON only.",
  input: JSON.stringify({
    locale: "es",
    message: "No tienes un proceso activo para cancelar.",
    factTokens: [],
  }),
  text: {
    format: {
      type: "json_schema",
      name: "natural_response",
      strict: true,
      schema: {
        type: "object",
        properties: { body: { type: "string" } },
        required: ["body"],
        additionalProperties: false,
      },
    },
  },
}));
' "${request_file}"

http_status="$({ curl \
  --silent \
  --show-error \
  --max-time 15 \
  'https://api.openai.com/v1/responses' \
  --header "Authorization: Bearer ${OPENAI_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data-binary "@${request_file}" \
  --output "${response_file}" \
  --write-out '%{http_code}'; } || true)"

echo "HTTP ${http_status:-000}"

node -e '
const fs = require("fs");
const path = process.argv[1];
if (!fs.existsSync(path)) process.exit(0);
const payload = JSON.parse(fs.readFileSync(path, "utf8"));
if (payload.error) {
  console.log(JSON.stringify({ error: payload.error }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ id: payload.id, model: payload.model, status: payload.status, output_text: payload.output_text, usage: payload.usage }, null, 2));
' "${response_file}"
