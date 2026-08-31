#!/usr/bin/env bash
# Applies the stub platform schema + every migration, in order, to a throwaway
# local Postgres database. Used both for local dev bootstrap verification and
# as a prerequisite for the RLS pgTAP-style tests in this directory.
set -euo pipefail
DB_NAME="${1:-dayline_migration_check}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../migrations" && pwd)"

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "drop database if exists ${DB_NAME};" postgres
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "create database ${DB_NAME};" postgres

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${SCRIPT_DIR}/_supabase_stub.sql"

for f in "${MIGRATIONS_DIR}"/*.sql; do
  echo "--- applying $(basename "$f") ---"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$f"
done

echo "All migrations applied cleanly to ${DB_NAME}."
