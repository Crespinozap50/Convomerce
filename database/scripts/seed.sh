#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"

for seed in database/seeds/*.sql; do
  docker compose exec -T postgres \
    psql -X -U postgres -d whatsapp_commerce -v ON_ERROR_STOP=1 \
    -f "/workspace/$seed"
done
