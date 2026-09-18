#!/usr/bin/env bash
# Regression test for the transfer_group_ownership() TOCTOU race fixed in
# 20260903060000_transfer_ownership_race_fix.sql: the function checks the
# caller currently holds role = 'owner', then updates two rows (demote
# caller to 'admin', promote the target to 'owner') further down, with no
# lock between the check and the writes. Two concurrent transfer calls by
# the same owner to two different targets could both pass the "is owner"
# check before either commits, so both succeed — nothing in the schema
# stops a group from ending up with two 'owner' rows. Same reason and
# same technique as rate_limit_race.test.sh/group_limit_race.test.sh:
# this needs two real concurrent Postgres backends, which a single-
# connection .sql file can't express.
#
# Strategy: pull the function's ACTUAL deployed definition, assert it
# still contains the pg_advisory_xact_lock fix, then inject a pg_sleep
# right after it acquires the lock — this widens the window while the
# lock is HELD, so a genuinely fixed function still has to prove it
# serializes correctly (the second caller blocks on the lock, then its
# own "is owner" check correctly fails once it wakes), while the pre-fix
# function (proved against a real instance during this fix's development)
# lets both callers race past. Fires two concurrent transfer_group_
# ownership() calls for an owner with two other members, to two
# different targets, asserts exactly one succeeds and the group ends up
# with exactly one owner, then restores the real function unchanged.
set -euo pipefail
DB_NAME="${1:?usage: transfer_ownership_race.test.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260903060000_transfer_ownership_race_fix.sql"
LOCK_MARKER="perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || p_group_id::text, 0));"

DEPLOYED_DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc \
  "select pg_get_functiondef('transfer_group_ownership(uuid,uuid)'::regprocedure);")"

if ! grep -qF "${LOCK_MARKER}" <<<"${DEPLOYED_DEF}"; then
  echo "FAIL: deployed transfer_group_ownership() no longer takes the group_ownership advisory lock added in 20260903060000_transfer_ownership_race_fix.sql — the race this test guards against has regressed."
  exit 1
fi

echo "--- instrumenting the ACTUAL deployed transfer_group_ownership() with a delay right after it acquires its lock, for this test only ---"
INSTRUMENTED_DEF="$(python3 - "${DEPLOYED_DEF}" "${LOCK_MARKER}" <<'PY'
import sys
src, marker = sys.argv[1], sys.argv[2]
assert marker in src, "lock marker not found verbatim in deployed function"
src = src.replace(marker, marker + "\n  perform pg_sleep(0.5); -- test-only: widen window while holding the lock", 1)
print(src)
PY
)"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_DEF}" >/dev/null

echo "--- setting up fixtures: an owner with two other members ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('dddddddd-1111-1111-1111-111111111101', 'transfer-race-owner@test.dayline.app'),
  ('dddddddd-1111-1111-1111-111111111102', 'transfer-race-a@test.dayline.app'),
  ('dddddddd-1111-1111-1111-111111111103', 'transfer-race-b@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in ('dddddddd-1111-1111-1111-111111111101', 'dddddddd-1111-1111-1111-111111111102', 'dddddddd-1111-1111-1111-111111111103')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('dddddddd-1111-1111-1111-111111111101');
select create_group('transfer-ownership-race group');
SQL

GROUP_ID="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select id from groups where name = 'transfer-ownership-race group';")"
INVITE_CODE="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'transfer-ownership-race group';")"

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-1111-1111-1111-111111111102', false);
select join_group_by_code('${INVITE_CODE}');
select set_config('request.jwt.claim.sub', 'dddddddd-1111-1111-1111-111111111103', false);
select join_group_by_code('${INVITE_CODE}');
" >/dev/null

run_transfer() {
  local target="$1" out="$2"
  psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
    set role authenticated;
    select set_config('request.jwt.claim.sub', 'dddddddd-1111-1111-1111-111111111101', false);
    select transfer_group_ownership('${GROUP_ID}'::uuid, '${target}'::uuid);
  " > "${out}" 2>&1
}

RESULT_A="$(mktemp)"
RESULT_B="$(mktemp)"
trap 'rm -f "${RESULT_A}" "${RESULT_B}"' EXIT

run_transfer 'dddddddd-1111-1111-1111-111111111102' "${RESULT_A}" &
PID_A=$!
run_transfer 'dddddddd-1111-1111-1111-111111111103' "${RESULT_B}" &
PID_B=$!
wait "${PID_A}" "${PID_B}"

OK_COUNT="$( (grep -o '"ok": true' "${RESULT_A}" "${RESULT_B}" || true) | wc -l | tr -d ' ')"
OWNER_COUNT="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from group_members where group_id = '${GROUP_ID}'::uuid and role = 'owner';")"

echo "call A: $(cat "${RESULT_A}"), call B: $(cat "${RESULT_B}"), owners: ${OWNER_COUNT}"

if [ "${OK_COUNT}" != "1" ]; then
  echo "FAIL: expected exactly one of two concurrent transfer_group_ownership() calls to succeed, got ${OK_COUNT}."
  exit 1
fi
if [ "${OWNER_COUNT}" != "1" ]; then
  echo "FAIL: expected the group to end up with exactly 1 owner, got ${OWNER_COUNT}."
  exit 1
fi

echo "--- restoring the real transfer_group_ownership() from its migration ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null

echo "PASS: transfer_ownership_race.test.sh — exactly one racer transferred ownership, group stayed at 1 owner."
