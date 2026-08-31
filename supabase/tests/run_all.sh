#!/usr/bin/env bash
# Fresh migration + full RLS security test run. Exits non-zero on any
# migration error or failed security assertion.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_NAME="dayline_rls_test"

bash "${SCRIPT_DIR}/run_migrations.sh" "${DB_NAME}"
echo "--- running RLS security tests ---"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${SCRIPT_DIR}/rls_security.test.sql"
echo "--- running worker job-claim tests ---"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${SCRIPT_DIR}/worker_claim.test.sql"
