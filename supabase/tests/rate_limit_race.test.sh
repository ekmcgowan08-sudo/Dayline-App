#!/usr/bin/env bash
# Regression test for the check_rate_limit() TOCTOU race fixed in
# 20260902000000_rate_limit_race_fix.sql: two concurrent callers for the
# same (bucket, subject) could both read the pre-race event count and both
# insert, letting the caller's limit be exceeded. That requires real
# concurrency — two separate Postgres backends racing each other — which a
# single-connection .sql file (like every other test in this directory)
# can't express, hence this standalone bash script.
#
# Strategy: pull the function's ACTUAL deployed definition (whatever the
# migrations produced, not a hand-written stand-in — so a regression to the
# real migration is what this test would actually catch), assert it still
# contains the pg_advisory_xact_lock fix, then mechanically inject a
# pg_sleep between its read and its insert so two concurrent psql
# connections are guaranteed to overlap there. Fire them concurrently
# against max_events=1, assert exactly one succeeds and exactly one row
# lands, then restore the real function from its migration file untouched.
set -euo pipefail
DB_NAME="${1:?usage: rate_limit_race.test.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260902000000_rate_limit_race_fix.sql"

DEPLOYED_DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc \
  "select pg_get_functiondef('check_rate_limit(text,text,int,int)'::regprocedure);")"

if ! grep -q 'pg_advisory_xact_lock' <<<"${DEPLOYED_DEF}"; then
  echo "FAIL: deployed check_rate_limit() no longer takes the advisory lock added in 20260902000000_rate_limit_race_fix.sql — the race this test guards against has regressed."
  exit 1
fi
if ! grep -q 'select count(\*) into v_count from rate_limit_events' <<<"${DEPLOYED_DEF}"; then
  echo "FAIL: deployed check_rate_limit()'s read statement doesn't match what this test expects to inject a delay after — update this test to match the current function body."
  exit 1
fi

echo "--- instrumenting the ACTUAL deployed check_rate_limit() with a delay between its read and its insert, for this test only ---"
INSTRUMENTED_DEF="$(python3 - "${DEPLOYED_DEF}" <<'PY'
import sys
src = sys.argv[1]
marker = "select count(*) into v_count from rate_limit_events\n  where bucket = p_bucket and subject = p_subject and created_at > now() - make_interval(secs => p_window_seconds);"
assert marker in src, "read statement not found verbatim in deployed function"
src = src.replace(
    marker,
    marker + "\n  perform pg_sleep(0.5); -- test-only: widens the window so two concurrent callers are guaranteed to overlap here",
    1,
)
print(src)
PY
)"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_DEF}" >/dev/null

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c \
  "delete from rate_limit_events where bucket = 'race-test-bucket' and subject = 'race-test-user';" >/dev/null

RESULT_A="$(mktemp)"
RESULT_B="$(mktemp)"
trap 'rm -f "${RESULT_A}" "${RESULT_B}"' EXIT

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc \
  "select check_rate_limit('race-test-bucket', 'race-test-user', 1, 3600);" > "${RESULT_A}" &
PID_A=$!
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc \
  "select check_rate_limit('race-test-bucket', 'race-test-user', 1, 3600);" > "${RESULT_B}" &
PID_B=$!
wait "${PID_A}" "${PID_B}"

A="$(cat "${RESULT_A}")"
B="$(cat "${RESULT_B}")"
COUNT="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc \
  "select count(*) from rate_limit_events where bucket = 'race-test-bucket' and subject = 'race-test-user';")"

echo "--- restoring the real check_rate_limit() from its migration ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null

echo "call A: '${A}', call B: '${B}', rows inserted: ${COUNT}"

if [ "${A}" = "t" ] && [ "${B}" = "t" ]; then
  echo "FAIL: both concurrent calls succeeded — the max_events=1 limit was exceeded (race not fixed)."
  exit 1
fi
if [ "${A}" != "t" ] && [ "${B}" != "t" ]; then
  echo "FAIL: neither concurrent call succeeded — expected exactly one to pass."
  exit 1
fi
if [ "${COUNT}" != "1" ]; then
  echo "FAIL: expected exactly 1 row inserted for max_events=1, got ${COUNT}."
  exit 1
fi

echo "PASS: exactly one of two concurrent racers passed the max_events=1 limit, exactly 1 row inserted."
