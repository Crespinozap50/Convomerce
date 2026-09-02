#!/bin/sh
set -eu

# Dumps the whole database (schema + data) to database/backups/, in
# pg_dump's custom format (-Fc): compressed, and restorable with
# restore.sh/pg_restore, including selectively if ever needed. Run this
# before any destructive local operation (bulk delete, purge, a risky
# migration) — see docs/decisions.md D-060 for the incident that made this
# script exist: a purge tested directly against shared dev data, with no
# backup to fall back on, permanently lost 46 real customer messages.

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"

backup_dir="database/backups"
mkdir -p "$backup_dir"

timestamp=$(date +%Y%m%d_%H%M%S)
backup_file="$backup_dir/whatsapp_commerce_${timestamp}.dump"

echo "Backing up to $backup_file ..."
docker compose exec -T postgres \
  pg_dump -U postgres -d whatsapp_commerce -Fc --no-owner \
  > "$backup_file"

echo "Done: $backup_file ($(du -h "$backup_file" | cut -f1))"

# Keeps the 10 most recent backups; older ones are removed so this directory
# doesn't grow unbounded on a machine nobody is watching.
keep=10
count=$(ls -1 "$backup_dir"/whatsapp_commerce_*.dump 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt "$keep" ]; then
  ls -1t "$backup_dir"/whatsapp_commerce_*.dump | tail -n "+$((keep + 1))" | while IFS= read -r old; do
    echo "Removing old backup: $old"
    rm -f "$old"
  done
fi
