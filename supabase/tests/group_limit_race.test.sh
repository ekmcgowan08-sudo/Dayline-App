#!/usr/bin/env bash
# Regression test for the create_group()/join_group_by_code() TOCTOU race
# fixed in 20260903040000_group_limit_race_fix.sql: both functions read the
# caller's current group_members count and compare it to their entitlement
# limit, then insert a new membership row further down, with no lock
# between. Two concurrent calls for the same user — two devices, or one of
# each function racing itself — could both read the pre-race count and
# both succeed, letting the caller's own group limit be exceeded. That
# requires real concurrency, which a single-connection .sql file (like
# every other test in this directory) can't express, hence this
# standalone bash script — same reason and same technique as
# rate_limit_race.test.sh.
#
# Strategy: pull both functions' ACTUAL deployed definitions, assert they
# still contain the pg_advisory_xact_lock fix, then mechanically inject a
# pg_sleep right after each function acquires its lock — this widens the
# window while the lock is HELD, so a genuinely fixed function still
# serializes correctly (the second caller blocks on the lock, then sees
# the up-to-date count once it wakes), while an unfixed function (sleep
# injected after an unprotected read, as manually verified against a real
# Postgres 16 instance during Phase 56's investigation) would let both
# callers race past. Fires two concurrent join_group_by_code calls for
# different codes (same-function race), then one create_group + one
# join_group_by_code (cross-function race — join_group_by_code never
# calls check_rate_limit(), so it shares no lock with create_group except
# the one this fix adds), for a free-tier user sitting at 1 of their 2
# allowed groups. Asserts exactly one caller succeeds in each case and the
# user ends up a member of exactly 2 groups, then restores the real
# functions from their migration file untouched.
set -euo pipefail
DB_NAME="${1:?usage: group_limit_race.test.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260903040000_group_limit_race_fix.sql"
# join_group_by_code() is redefined again by 20260903080000 (Phase 61,
# the invite-code attempt-rate-limit fix) — restoring only from this
# migration would silently regress that later fix for the rest of a
# run_all.sh run, since create-or-replace overwrites whichever version
# ran last. Re-applied after FIX_MIGRATION below so both fixes stack.
LATER_JOIN_MIGRATION="${SCRIPT_DIR}/../migrations/20260903080000_invite_attempts_race_fix.sql"
LOCK_MARKER="perform pg_advisory_xact_lock(hashtextextended('group_limit:' || auth.uid()::text, 0));"

for fn in "create_group(text,text)" "join_group_by_code(text)"; do
  DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('${fn}'::regprocedure);")"
  if ! grep -qF "${LOCK_MARKER}" <<<"${DEF}"; then
    echo "FAIL: deployed ${fn} no longer takes the group_limit advisory lock added in 20260903040000_group_limit_race_fix.sql — the race this test guards against has regressed."
    exit 1
  fi
done

echo "--- instrumenting the ACTUAL deployed create_group()/join_group_by_code() with a delay right after each acquires its lock, for this test only ---"
for fn_sig in "create_group(text,text)" "join_group_by_code(text)"; do
  DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('${fn_sig}'::regprocedure);")"
  INSTRUMENTED="$(python3 - "${DEF}" "${LOCK_MARKER}" <<'PY'
import sys
src, marker = sys.argv[1], sys.argv[2]
assert marker in src, f"lock marker not found verbatim in {sys.argv[1][:60]}..."
src = src.replace(marker, marker + "\n  perform pg_sleep(0.5); -- test-only: widen window while holding the lock", 1)
print(src)
PY
)"
  psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED}" >/dev/null
done

echo "--- setting up fixtures: a free-tier user at 1 of 2 allowed groups, plus two other users' groups to join into ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999901', 'race-joiner@test.dayline.app'),
  ('99999999-9999-9999-9999-999999999902', 'race-owner-a@test.dayline.app'),
  ('99999999-9999-9999-9999-999999999903', 'race-owner-b@test.dayline.app')
on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in ('99999999-9999-9999-9999-999999999901','99999999-9999-9999-9999-999999999902','99999999-9999-9999-9999-999999999903')
on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('99999999-9999-9999-9999-999999999901');
select create_group('race-joiner existing group');

select test_login('99999999-9999-9999-9999-999999999902');
select create_group('race-owner-a target group');

select test_login('99999999-9999-9999-9999-999999999903');
select create_group('race-owner-b target group');
SQL

CODE_A="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'race-owner-a target group';")"
CODE_B="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'race-owner-b target group';")"

run_join() {
  local code="$1" out="$2"
  psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
    set role authenticated;
    select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999901', false);
    select join_group_by_code('${code}');
  " > "${out}" 2>&1
}
run_create() {
  local out="$1"
  psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
    set role authenticated;
    select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999901', false);
    select create_group('race new group');
  " > "${out}" 2>&1
}

RESULT_A="$(mktemp)"
RESULT_B="$(mktemp)"
trap 'rm -f "${RESULT_A}" "${RESULT_B}"' EXIT

echo "--- race 1: two concurrent join_group_by_code() calls for different codes, same user ---"
run_join "${CODE_A}" "${RESULT_A}" &
PID_A=$!
run_join "${CODE_B}" "${RESULT_B}" &
PID_B=$!
wait "${PID_A}" "${PID_B}"

OK_COUNT="$( (grep -o '"ok": true' "${RESULT_A}" "${RESULT_B}" || true) | wc -l | tr -d ' ')"
TOTAL_GROUPS="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from group_members where user_id = '99999999-9999-9999-9999-999999999901';")"

echo "call A: $(cat "${RESULT_A}"), call B: $(cat "${RESULT_B}"), total groups: ${TOTAL_GROUPS}"
if [ "${OK_COUNT}" != "1" ]; then
  echo "FAIL: expected exactly one of two concurrent join_group_by_code() calls to succeed, got ${OK_COUNT}."
  exit 1
fi
if [ "${TOTAL_GROUPS}" != "2" ]; then
  echo "FAIL: expected the free-tier user to end up in exactly 2 groups (their stated limit), got ${TOTAL_GROUPS}."
  exit 1
fi
echo "PASS: race 1 — exactly one join_group_by_code() racer passed the group limit, user stayed at 2 groups."

echo "--- race 2: concurrent create_group() + join_group_by_code(), same user, cross-function ---"
# Undo race 1's successful join so the user is back at 1 of 2 groups.
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "
  delete from group_members where user_id = '99999999-9999-9999-9999-999999999901'
    and group_id != (select id from groups where name = 'race-joiner existing group');
" >/dev/null

run_create "${RESULT_A}" &
PID_A=$!
run_join "${CODE_A}" "${RESULT_B}" &
PID_B=$!
# create_group()'s failure paths are plain PL/pgSQL `raise exception`
# (unlike join_group_by_code()'s jsonb-return failures), so when it
# loses this race the underlying psql call exits non-zero — the
# correct, expected outcome, not a test failure. `wait` on a specific
# PID returns that PID's own exit status, which would trip `set -e`
# and kill this script before it reaches the assertion below, which
# reads real DB state rather than either racer's exit code.
wait "${PID_A}" || true
wait "${PID_B}" || true

CREATE_OK=0; if grep -qF "race new group" "${RESULT_A}"; then CREATE_OK=1; fi
JOIN_OK=0; if grep -q '"ok": true' "${RESULT_B}"; then JOIN_OK=1; fi
OK_COUNT=$((CREATE_OK + JOIN_OK))
TOTAL_GROUPS="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from group_members where user_id = '99999999-9999-9999-9999-999999999901';")"

echo "create_group: $(cat "${RESULT_A}"), join_group_by_code: $(cat "${RESULT_B}"), total groups: ${TOTAL_GROUPS}"
if [ "${OK_COUNT}" != "1" ]; then
  echo "FAIL: expected exactly one of the concurrent create_group()/join_group_by_code() calls to succeed, got ${OK_COUNT}."
  exit 1
fi
if [ "${TOTAL_GROUPS}" != "2" ]; then
  echo "FAIL: expected the free-tier user to end up in exactly 2 groups (their stated limit) after the cross-function race, got ${TOTAL_GROUPS}."
  exit 1
fi
echo "PASS: race 2 — exactly one of create_group()/join_group_by_code() passed the group limit, user stayed at 2 groups."

echo "--- restoring the real create_group()/join_group_by_code() from their migrations ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${LATER_JOIN_MIGRATION}" >/dev/null

echo "PASS: group_limit_race.test.sh"
