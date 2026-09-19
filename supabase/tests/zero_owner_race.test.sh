#!/usr/bin/env bash
# Regression test for the cross-function TOCTOU race fixed in
# 20260903070000_zero_owner_race_fix.sql: transfer_group_ownership()
# reads a target's role, and only if they still exist does it demote the
# caller to 'admin' and promote the target to 'owner' — two separate
# writes. If remove_group_member() deletes that exact target in the gap
# between the read and those writes, the promotion silently affects zero
# rows while the demotion still lands, leaving the group with zero
# owners — stuck, since transfer_group_ownership()/set_group_member_
# role()/delete_group() all require an existing owner. Phase 50's
# `group_members_owner_departure` trigger doesn't cover this: it only
# fires on a DELETE of an owner row, and here the owner's row is
# *updated* to 'admin', never deleted. Same reason and technique as
# rate_limit_race.test.sh/group_limit_race.test.sh/transfer_ownership_
# race.test.sh: this needs two real concurrent Postgres backends.
#
# Strategy: pull both functions' ACTUAL deployed definitions, assert
# both still contain the 'group_ownership:' advisory lock, inject a
# delay into transfer_group_ownership() between its target-existence
# check and its actual role updates (the exact gap the bug lived in),
# fire it concurrently with remove_group_member() targeting the same
# user, assert the group ends up with exactly one owner (whichever
# function's write should have "won" is not asserted — either outcome,
# transfer-wins or remove-wins, is correct as long as no owner is lost),
# then restore both real functions unchanged.
set -euo pipefail
DB_NAME="${1:?usage: zero_owner_race.test.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSFER_FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260903060000_transfer_ownership_race_fix.sql"
REMOVE_FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260903070000_zero_owner_race_fix.sql"
LOCK_MARKER="perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || p_group_id::text, 0));"

for fn in "transfer_group_ownership(uuid,uuid)" "remove_group_member(uuid,uuid)"; do
  DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('${fn}'::regprocedure);")"
  if ! grep -qF "${LOCK_MARKER}" <<<"${DEF}"; then
    echo "FAIL: deployed ${fn} no longer takes the group_ownership advisory lock — the zero-owner race this test guards against has regressed."
    exit 1
  fi
done

echo "--- instrumenting the ACTUAL deployed transfer_group_ownership() with a delay between its target check and its role updates, for this test only ---"
TRANSFER_DEF="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('transfer_group_ownership(uuid,uuid)'::regprocedure);")"
INSTRUMENTED_DEF="$(python3 - "${TRANSFER_DEF}" <<'PY'
import sys
src = sys.argv[1]
marker = "select role into v_target_role from group_members where group_id = p_group_id and user_id = p_new_owner_id;\n  if v_target_role is null then\n    return jsonb_build_object('ok', false, 'error', 'not_a_member');\n  end if;"
assert marker in src, "target-check statement not found verbatim in deployed function"
src = src.replace(marker, marker + "\n  perform pg_sleep(0.7); -- test-only: widen window between the target check and the actual updates", 1)
print(src)
PY
)"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_DEF}" >/dev/null

echo "--- setting up fixtures: an owner, an admin, and a plain target member ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('ffffffff-1111-1111-1111-111111111101', 'zero-owner-race-owner@test.dayline.app'),
  ('ffffffff-1111-1111-1111-111111111102', 'zero-owner-race-admin@test.dayline.app'),
  ('ffffffff-1111-1111-1111-111111111103', 'zero-owner-race-target@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in ('ffffffff-1111-1111-1111-111111111101', 'ffffffff-1111-1111-1111-111111111102', 'ffffffff-1111-1111-1111-111111111103')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('ffffffff-1111-1111-1111-111111111101');
select create_group('zero-owner-race group');
SQL

GROUP_ID="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select id from groups where name = 'zero-owner-race group';")"
INVITE_CODE="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'zero-owner-race group';")"

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "
set role authenticated;
select set_config('request.jwt.claim.sub', 'ffffffff-1111-1111-1111-111111111102', false);
select join_group_by_code('${INVITE_CODE}');
select set_config('request.jwt.claim.sub', 'ffffffff-1111-1111-1111-111111111103', false);
select join_group_by_code('${INVITE_CODE}');
" >/dev/null
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "
update group_members set role = 'admin' where group_id = '${GROUP_ID}'::uuid and user_id = 'ffffffff-1111-1111-1111-111111111102'::uuid;
" >/dev/null

RESULT_A="$(mktemp)"
RESULT_B="$(mktemp)"
trap 'rm -f "${RESULT_A}" "${RESULT_B}"' EXIT

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', 'ffffffff-1111-1111-1111-111111111101', false);
  select transfer_group_ownership('${GROUP_ID}'::uuid, 'ffffffff-1111-1111-1111-111111111103'::uuid);
" > "${RESULT_A}" 2>&1 &
PID_A=$!
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', 'ffffffff-1111-1111-1111-111111111102', false);
  select remove_group_member('${GROUP_ID}'::uuid, 'ffffffff-1111-1111-1111-111111111103'::uuid);
" > "${RESULT_B}" 2>&1 &
PID_B=$!
# remove_group_member()'s failure paths are plain PL/pgSQL `raise
# exception` (not a jsonb return like transfer_group_ownership()'s), so
# when it loses this race the underlying psql call exits non-zero —
# the correct, expected outcome, not a test failure. `wait` on a
# specific PID returns that PID's own exit status, which would trip
# `set -e` and kill this script before it ever reaches the assertion
# below. The actual pass/fail check reads real DB state (OWNER_COUNT),
# not either racer's exit code, so swallow both here.
wait "${PID_A}" || true
wait "${PID_B}" || true

OWNER_COUNT="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from group_members where group_id = '${GROUP_ID}'::uuid and role = 'owner';")"

echo "transfer_group_ownership: $(cat "${RESULT_A}"), remove_group_member: $(cat "${RESULT_B}"), owners: ${OWNER_COUNT}"

if [ "${OWNER_COUNT}" != "1" ]; then
  echo "FAIL: expected the group to end up with exactly 1 owner after the race, got ${OWNER_COUNT} — a group with 0 owners is permanently stuck (transfer_group_ownership/set_group_member_role/delete_group all require an existing owner)."
  exit 1
fi

echo "--- restoring the real functions from their migrations ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${TRANSFER_FIX_MIGRATION}" >/dev/null
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${REMOVE_FIX_MIGRATION}" >/dev/null

echo "PASS: zero_owner_race.test.sh — the group ended up with exactly 1 owner after the transfer/remove race."
