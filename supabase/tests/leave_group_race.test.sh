#!/usr/bin/env bash
# Regression test for the leave_group()/join_group_by_code() TOCTOU race
# fixed in 20260903100000_leave_group_race_fix.sql: leave_group() read a
# group's member count, then much later (after deleting the caller's own
# membership, logging a membership event, and firing the owner-departure
# trigger) acted on that stale count to decide whether to delete the
# whole group, with no lock protecting the read against a concurrent
# join_group_by_code() adding a brand new member in the gap. Same reason
# and technique as every other race test in this directory: this needs
# two real concurrent Postgres backends.
#
# Strategy: pull both functions' ACTUAL deployed definitions, assert they
# both still take the 'group_ownership:' advisory lock, then test BOTH
# possible arrival orders by instrumenting each function in turn with a
# delay right after it acquires that lock:
#   1. leave_group() delayed: a sole owner starts leaving a group while a
#      second user concurrently joins via its invite code. Asserts the
#      two outcomes are never split — the join is never reported
#      successful while the group (or the joiner's own membership row in
#      it) doesn't actually exist afterward. Before the fix, this exact
#      scenario let join_group_by_code() return {"ok": true, ...} for a
#      group that leave_group() then silently deleted out from under it,
#      proven against a real Postgres 16 instance during development.
#   2. join_group_by_code() delayed: the same sole owner concurrently
#      calls leave_group(). Asserts the join succeeding means the group
#      truly survives with the joiner really in it, and leave_group()
#      correctly refuses with owner_must_transfer_or_delete rather than
#      destroying anything.
# Restores both real functions from the fix migration afterward.
set -euo pipefail
DB_NAME="${1:?usage: leave_group_race.test.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260903100000_leave_group_race_fix.sql"
LOCK_MARKER="perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || p_group_id::text, 0));"
JOIN_LOCK_MARKER="perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || v_group_id::text, 0));"

DEPLOYED_LEAVE="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('leave_group(uuid)'::regprocedure);")"
if ! grep -qF "${LOCK_MARKER}" <<<"${DEPLOYED_LEAVE}"; then
  echo "FAIL: deployed leave_group() no longer takes the group_ownership advisory lock added in 20260903100000_leave_group_race_fix.sql — the race this test guards against has regressed."
  exit 1
fi
DEPLOYED_JOIN="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('join_group_by_code(text)'::regprocedure);")"
if ! grep -qF "${JOIN_LOCK_MARKER}" <<<"${DEPLOYED_JOIN}"; then
  echo "FAIL: deployed join_group_by_code() no longer takes the group_ownership advisory lock added in 20260903100000_leave_group_race_fix.sql — the race this test guards against has regressed."
  exit 1
fi

echo "--- setting up fixtures: a sole-owner group and a would-be joiner ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('66666666-1111-1111-1111-111111111101', 'leave-race-owner@test.dayline.app'),
  ('66666666-1111-1111-1111-111111111102', 'leave-race-joiner@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in ('66666666-1111-1111-1111-111111111101', '66666666-1111-1111-1111-111111111102')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

delete from rate_limit_events where subject = '66666666-1111-1111-1111-111111111101';
set role authenticated;
select test_login('66666666-1111-1111-1111-111111111101');
select create_group('leave-group-race sole-owner group 1');
SQL

GROUP_ID_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select id from groups where name = 'leave-group-race sole-owner group 1';")"
INVITE_CODE_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'leave-group-race sole-owner group 1';")"

echo "--- race 1: leave_group() delayed, concurrent join_group_by_code() by a second user ---"
LEAVE_DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('leave_group(uuid)'::regprocedure);")"
INSTRUMENTED_LEAVE="$(python3 - "${LEAVE_DEF}" "${LOCK_MARKER}" <<'PY'
import sys
src, marker = sys.argv[1], sys.argv[2]
assert marker in src, "lock marker not found verbatim in deployed leave_group()"
src = src.replace(marker, marker + "\n  perform pg_sleep(0.6); -- test-only: widen window while holding the lock", 1)
print(src)
PY
)"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_LEAVE}" >/dev/null

RESULT_LEAVE="$(mktemp)"
RESULT_JOIN="$(mktemp)"
trap 'rm -f "${RESULT_LEAVE}" "${RESULT_JOIN}"' EXIT

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', '66666666-1111-1111-1111-111111111101', false);
  select leave_group('${GROUP_ID_1}'::uuid);
" > "${RESULT_LEAVE}" 2>&1 &
PID_LEAVE=$!
sleep 0.2
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', '66666666-1111-1111-1111-111111111102', false);
  select join_group_by_code('${INVITE_CODE_1}');
" > "${RESULT_JOIN}" 2>&1 &
PID_JOIN=$!
# leave_group()'s owner_must_transfer_or_delete/not_a_member failures are
# plain `raise exception`, so a losing psql call can exit non-zero — the
# correct, expected outcome, not a test failure (see zero_owner_race.test.sh).
wait "${PID_LEAVE}" || true
wait "${PID_JOIN}" || true

GROUP_EXISTS_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from groups where id = '${GROUP_ID_1}'::uuid;")"
JOINER_IS_MEMBER_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from group_members where group_id = '${GROUP_ID_1}'::uuid and user_id = '66666666-1111-1111-1111-111111111102';")"
JOIN_REPORTED_OK_1=0; if grep -q '"ok": true' "${RESULT_JOIN}"; then JOIN_REPORTED_OK_1=1; fi

echo "leave: $(cat "${RESULT_LEAVE}"), join: $(cat "${RESULT_JOIN}"), group_exists=${GROUP_EXISTS_1}, joiner_is_member=${JOINER_IS_MEMBER_1}"

if [ "${JOIN_REPORTED_OK_1}" = "1" ] && { [ "${GROUP_EXISTS_1}" != "1" ] || [ "${JOINER_IS_MEMBER_1}" != "1" ]; }; then
  echo "FAIL: join_group_by_code() reported ok:true but the group and/or the joiner's membership don't actually exist — the exact silent data-loss bug this migration fixes."
  exit 1
fi
echo "PASS: race 1 — no split between what join_group_by_code() reported and real DB state."

echo "--- restoring the real leave_group() before race 2 ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null

echo "--- race 2: join_group_by_code() delayed, concurrent leave_group() by the sole owner ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
delete from rate_limit_events where subject = '66666666-1111-1111-1111-111111111101';
set role authenticated;
select test_login('66666666-1111-1111-1111-111111111101');
select create_group('leave-group-race sole-owner group 2');
SQL
GROUP_ID_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select id from groups where name = 'leave-group-race sole-owner group 2';")"
INVITE_CODE_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'leave-group-race sole-owner group 2';")"

JOIN_DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('join_group_by_code(text)'::regprocedure);")"
INSTRUMENTED_JOIN="$(python3 - "${JOIN_DEF}" "${JOIN_LOCK_MARKER}" <<'PY'
import sys
src, marker = sys.argv[1], sys.argv[2]
assert marker in src, "lock marker not found verbatim in deployed join_group_by_code()"
src = src.replace(marker, marker + "\n  perform pg_sleep(0.6); -- test-only: widen window while holding the lock", 1)
print(src)
PY
)"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_JOIN}" >/dev/null

RESULT_JOIN2="$(mktemp)"
RESULT_LEAVE2="$(mktemp)"
trap 'rm -f "${RESULT_LEAVE}" "${RESULT_JOIN}" "${RESULT_JOIN2}" "${RESULT_LEAVE2}"' EXIT

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', '66666666-1111-1111-1111-111111111102', false);
  select join_group_by_code('${INVITE_CODE_2}');
" > "${RESULT_JOIN2}" 2>&1 &
PID_JOIN2=$!
sleep 0.2
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', '66666666-1111-1111-1111-111111111101', false);
  select leave_group('${GROUP_ID_2}'::uuid);
" > "${RESULT_LEAVE2}" 2>&1 &
PID_LEAVE2=$!
wait "${PID_JOIN2}" || true
wait "${PID_LEAVE2}" || true

GROUP_EXISTS_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from groups where id = '${GROUP_ID_2}'::uuid;")"
JOINER_IS_MEMBER_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from group_members where group_id = '${GROUP_ID_2}'::uuid and user_id = '66666666-1111-1111-1111-111111111102';")"
JOIN_REPORTED_OK_2=0; if grep -q '"ok": true' "${RESULT_JOIN2}"; then JOIN_REPORTED_OK_2=1; fi

echo "join: $(cat "${RESULT_JOIN2}"), leave: $(cat "${RESULT_LEAVE2}"), group_exists=${GROUP_EXISTS_2}, joiner_is_member=${JOINER_IS_MEMBER_2}"

if [ "${JOIN_REPORTED_OK_2}" = "1" ] && { [ "${GROUP_EXISTS_2}" != "1" ] || [ "${JOINER_IS_MEMBER_2}" != "1" ]; }; then
  echo "FAIL: join_group_by_code() reported ok:true but the group and/or the joiner's membership don't actually exist."
  exit 1
fi
echo "PASS: race 2 — no split between what join_group_by_code() reported and real DB state."

echo "--- restoring the real leave_group()/join_group_by_code() from their migration ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null

echo "PASS: leave_group_race.test.sh"
