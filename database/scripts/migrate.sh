#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"

docker compose exec -T postgres \
  psql -X -U postgres -d whatsapp_commerce -v ON_ERROR_STOP=1 \
  -f /workspace/database/local/000_local_roles.sql

for migration in database/sql/[0-9][0-9][0-9]_*.sql; do
  version=$(basename "$migration" | cut -d_ -f1)
  name=$(basename "$migration")

  # Migration 000 documents infrastructure roles. Local development uses its own
  # idempotent provisioning, so application migrations begin at 001.
  if [ "$version" = "000" ]; then
    continue
  fi
  checksum=$(sha256sum "$migration" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$migration" | cut -d' ' -f1)

  applied_checksum=$(docker compose exec -T postgres \
    psql -X -U postgres -d whatsapp_commerce -Atqc \
    "select checksum from app.schema_migrations where version = '$version'" 2>/dev/null || true)

  if [ -n "$applied_checksum" ]; then
    if [ "$applied_checksum" != "$checksum" ]; then
      echo "ERROR: migration $name changed after it was applied." >&2
      exit 1
    fi
    echo "Already applied: $name"
    continue
  fi

  echo "Applying: $name"
  docker compose exec -T postgres \
    psql -X -U postgres -d whatsapp_commerce -v ON_ERROR_STOP=1 \
    -f "/workspace/$migration"
  docker compose exec -T postgres \
    psql -X -U postgres -d whatsapp_commerce -v ON_ERROR_STOP=1 \
    -c "insert into app.schema_migrations(version, name, checksum) values ('$version', '$name', '$checksum')"
done
