#!/usr/bin/env bash
# Regression test for the invite-code brute-force guard TOCTOU race
# fixed in 20260903080000_invite_attempts_race_fix.sql:
# join_group_by_code() read how many attempts this user made in the
# last 10 minutes, compared that to 20, and only *then* inserted a new
# attempt row -- two separate statements, no lock between them. Same
# reason and technique as rate_limit_race.test.sh and friends: this
# needs real concurrency, which a single-connection .sql file can't
# express.
#
# Strategy: pull the function's ACTUAL deployed definition, assert it
# still contains the 'invite_attempts:' advisory lock, inject a delay
# right after it acquires that lock (so a genuinely fixed function
# still has to prove it serializes correctly), then fire 25 concurrent
# calls with a deliberately invalid code for the same user and assert
# at most 20 of them get past the rate check (the rest must come back
# rate_limited) and that invite_code_attempts ends up with exactly 20
# rows for that user, then restore the real function unchanged.
set -euo pipefail
DB_NAME="${1:?usage: invite_attempts_race.test.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260903080000_invite_attempts_race_fix.sql"
# join_group_by_code() is redefined again by 20260903090000 (Phase 62,
# account suspension enforcement) — restoring only from FIX_MIGRATION
# below would silently strip that later check out of join_group_by_code()
# for the rest of a run_all.sh run, the same staleness hazard already hit
# once in group_limit_race.test.sh. Reapplied after FIX_MIGRATION so both
# fixes stack.
LATER_SUSPENSION_MIGRATION="${SCRIPT_DIR}/../migrations/20260903090000_account_suspension_enforcement.sql"
# join_group_by_code() is redefined YET AGAIN by 20260903100000 (Phase 63,
# the leave_group() zero-owner-race fix) — same hazard one level further.
# Reapplied last of all.
LATEST_LEAVE_GROUP_MIGRATION="${SCRIPT_DIR}/../migrations/20260903100000_leave_group_race_fix.sql"
LOCK_MARKER="perform pg_advisory_xact_lock(hashtextextended('invite_attempts:' || auth.uid()::text, 0));"

DEPLOYED_DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('join_group_by_code(text)'::regprocedure);")"
if ! grep -qF "${LOCK_MARKER}" <<<"${DEPLOYED_DEF}"; then
  echo "FAIL: deployed join_group_by_code() no longer takes the invite_attempts advisory lock added in 20260903080000_invite_attempts_race_fix.sql — the race this test guards against has regressed."
  exit 1
fi

echo "--- instrumenting the ACTUAL deployed join_group_by_code() with a delay right after it acquires its invite_attempts lock, for this test only ---"
INSTRUMENTED_DEF="$(python3 - "${DEPLOYED_DEF}" "${LOCK_MARKER}" <<'PY'
import sys
src, marker = sys.argv[1], sys.argv[2]
assert marker in src, "lock marker not found verbatim in deployed function"
src = src.replace(marker, marker + "\n  perform pg_sleep(0.5); -- test-only: widen window while holding the lock", 1)
print(src)
PY
)"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_DEF}" >/dev/null

echo "--- setting up fixtures: a fresh user with no prior invite-code attempts ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
insert into auth.users (id, email) values ('bbbbbbbb-9999-9999-9999-999999999901', 'invite-race@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values ('bbbbbbbb-9999-9999-9999-999999999901', 'invite-racer')
  on conflict (id) do nothing;
delete from invite_code_attempts where user_id = 'bbbbbbbb-9999-9999-9999-999999999901';
SQL

RESULT_DIR="$(mktemp -d)"
trap 'rm -rf "${RESULT_DIR}"' EXIT

PIDS=()
for i in $(seq 1 25); do
  psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
    set role authenticated;
    select set_config('request.jwt.claim.sub', 'bbbbbbbb-9999-9999-9999-999999999901', false);
    select join_group_by_code('BADCODE');
  " > "${RESULT_DIR}/${i}.log" 2>&1 &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "${pid}"; done

PASSED_COUNT="$(grep -l '"ok": false, "error": "invalid_or_expired_code"' "${RESULT_DIR}"/*.log | wc -l | tr -d ' ')"
RATE_LIMITED_COUNT="$(grep -l '"ok": false, "error": "rate_limited"' "${RESULT_DIR}"/*.log | wc -l | tr -d ' ')"
ROW_COUNT="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from invite_code_attempts where user_id = 'bbbbbbbb-9999-9999-9999-999999999901';")"

echo "passed rate check: ${PASSED_COUNT}, rate_limited: ${RATE_LIMITED_COUNT}, attempt rows: ${ROW_COUNT}"

if [ "${PASSED_COUNT}" != "20" ]; then
  echo "FAIL: expected exactly 20 of 25 concurrent callers to pass the rate check (the stated limit), got ${PASSED_COUNT}."
  exit 1
fi
if [ "${RATE_LIMITED_COUNT}" != "5" ]; then
  echo "FAIL: expected exactly 5 of 25 concurrent callers to be rejected as rate_limited, got ${RATE_LIMITED_COUNT}."
  exit 1
fi
if [ "${ROW_COUNT}" != "20" ]; then
  echo "FAIL: expected exactly 20 invite_code_attempts rows for this user, got ${ROW_COUNT}."
  exit 1
fi

echo "--- restoring the real join_group_by_code() from its migration ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${LATER_SUSPENSION_MIGRATION}" >/dev/null
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${LATEST_LEAVE_GROUP_MIGRATION}" >/dev/null

echo "PASS: invite_attempts_race.test.sh — exactly 20 of 25 concurrent racers passed the invite-code attempt limit."
