#!/bin/sh
set -eu

# Restores a backup made by backup.sh, REPLACING the current contents of the
# database. Destructive — asks for confirmation unless -y/--yes is given.
#
# Usage: database/scripts/restore.sh <path-to-.dump-file> [-y|--yes]

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"

backup_file="${1:-}"
confirm="${2:-}"

if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "Usage: $0 <path-to-.dump-file> [-y|--yes]" >&2
  echo "Available backups:" >&2
  ls -1t database/backups/whatsapp_commerce_*.dump 2>/dev/null >&2 || echo "  (none found)" >&2
  exit 1
fi

if [ "$confirm" != "-y" ] && [ "$confirm" != "--yes" ]; then
  printf 'This REPLACES every table in whatsapp_commerce with the contents of %s.\nType "yes" to continue: ' "$backup_file"
  read -r answer
  if [ "$answer" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# Requires database/local/000_local_roles.sql to have already run (any
# `make db-migrate` does this) — --no-owner is deliberately not used here,
# so restored objects keep the commerce_owner ownership the dump recorded
# instead of ending up owned by whichever role runs this restore.
echo "Restoring $backup_file ..."
docker compose exec -T postgres \
  pg_restore -U postgres -d whatsapp_commerce --clean --if-exists \
  < "$backup_file"

echo "Done."
