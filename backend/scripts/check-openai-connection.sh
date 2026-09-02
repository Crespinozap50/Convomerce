#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_directory="$(cd "${script_directory}/.." && pwd)"

set -a
source "${backend_directory}/.env"
set +a

if [[ -z "${OPENAI_API_KEY:-}" || -z "${OPENAI_RESPONSE_MODEL:-}" ]]; then
  echo "OPENAI_API_KEY and OPENAI_RESPONSE_MODEL must be configured in backend/.env." >&2
  exit 1
fi

response_file="${TMPDIR:-/tmp}/openai-model-check.json"
http_status="$({ curl \
  --silent \
  --show-error \
  --max-time 10 \
  "https://api.openai.com/v1/models/${OPENAI_RESPONSE_MODEL}" \
  --header "Authorization: Bearer ${OPENAI_API_KEY}" \
  --output "${response_file}" \
  --write-out '%{http_code}'; } || true)"

echo "HTTP ${http_status:-000}"

if [[ "${http_status}" != "200" ]]; then
  echo "Response saved to ${response_file}." >&2
  exit 1
fi

echo "OpenAI model access is working."
