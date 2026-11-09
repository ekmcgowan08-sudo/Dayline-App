#!/usr/bin/env bash
# Regression test for the account-deletion side of the bug fixed in
# 20260903110000_orphaned_group_on_departure_fix.sql. The plain-SQL
# companion test (orphaned_group_on_departure.test.sql) proves the
# non-racy case: a solo member deleting their account now deletes the
# group too, instead of orphaning it. This test proves the fix's other
# half holds under real concurrency: the group_members_owner_departure
# trigger (fired by account deletion's cascade onto group_members) now
# takes the same 'group_ownership:' advisory lock join_group_by_code()
# does, so a concurrent join can no longer land in the gap between the
# trigger's "is anyone else here" check and the account's actual
# departure. Needs two real concurrent Postgres backends, same reason
# and technique as every other race test in this directory.
#
# Strategy: instrument the ACTUAL deployed trigger function with a delay
# right after it acquires its lock, then race a concurrent
# join_group_by_code() against a held-open `delete from auth.users` for
# the group's sole member, in both possible arrival orders:
#   1. The departure gets the lock first: the join must block until the
#      departure (and the group deletion it does once it sees nobody
#      left) fully resolves, then cleanly fail with
#      invalid_or_expired_code -- never a "successful" join into a
#      group that was simultaneously destroyed out from under it.
#   2. The join gets the lock first: it must succeed, and the trigger,
#      once unblocked, must see the new member and promote them to
#      owner -- not leave a member with nobody in charge.
set -euo pipefail
DB_NAME="${1:?usage: orphaned_group_race.test.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_MIGRATION="${SCRIPT_DIR}/../migrations/20260903110000_orphaned_group_on_departure_fix.sql"
LOCK_MARKER="perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || old.group_id::text, 0));"

DEPLOYED_TRIGGER_FN="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('reassign_group_owner_on_departure()'::regprocedure);")"
if ! grep -qF "${LOCK_MARKER}" <<<"${DEPLOYED_TRIGGER_FN}"; then
  echo "FAIL: deployed reassign_group_owner_on_departure() no longer takes the group_ownership advisory lock added in 20260903110000_orphaned_group_on_departure_fix.sql — the race this test guards against has regressed."
  exit 1
fi

echo "--- instrumenting the ACTUAL deployed trigger function with a delay right after it acquires its lock, for this test only ---"
INSTRUMENTED_TRIGGER_FN="$(python3 - "${DEPLOYED_TRIGGER_FN}" "${LOCK_MARKER}" <<'PY'
import sys
src, marker = sys.argv[1], sys.argv[2]
assert marker in src, "lock marker not found verbatim in deployed function"
src = src.replace(marker, marker + "\n    perform pg_sleep(0.6); -- test-only: widen window while holding the lock", 1)
print(src)
PY
)"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_TRIGGER_FN}" >/dev/null

echo "--- race 1: account deletion delayed, concurrent join by a second user ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('88888888-9999-9999-9999-999999999901', 'orphan-race-owner1@test.dayline.app'),
  ('88888888-9999-9999-9999-999999999902', 'orphan-race-joiner1@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in ('88888888-9999-9999-9999-999999999901', '88888888-9999-9999-9999-999999999902')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('88888888-9999-9999-9999-999999999901');
select create_group('orphan-group-race sole-owner group 1');
SQL
GROUP_ID_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select id from groups where name = 'orphan-group-race sole-owner group 1';")"
INVITE_CODE_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'orphan-group-race sole-owner group 1';")"

RESULT_DEL="$(mktemp)"
RESULT_JOIN="$(mktemp)"
trap 'rm -f "${RESULT_DEL}" "${RESULT_JOIN}"' EXIT

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "delete from auth.users where id = '88888888-9999-9999-9999-999999999901';" > "${RESULT_DEL}" 2>&1 &
PID_DEL=$!
sleep 0.2
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', '88888888-9999-9999-9999-999999999902', false);
  select join_group_by_code('${INVITE_CODE_1}');
" > "${RESULT_JOIN}" 2>&1 &
PID_JOIN=$!
wait "${PID_DEL}" || true
wait "${PID_JOIN}" || true

GROUP_EXISTS_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from groups where id = '${GROUP_ID_1}'::uuid;")"
JOINER_ROLE_1="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select coalesce((select role from group_members where group_id = '${GROUP_ID_1}'::uuid and user_id = '88888888-9999-9999-9999-999999999902'), 'none');")"
JOIN_REPORTED_OK_1=0; if grep -q '"ok": true' "${RESULT_JOIN}"; then JOIN_REPORTED_OK_1=1; fi

echo "delete: $(cat "${RESULT_DEL}"), join: $(cat "${RESULT_JOIN}"), group_exists=${GROUP_EXISTS_1}, joiner_role=${JOINER_ROLE_1}"

if [ "${JOIN_REPORTED_OK_1}" = "1" ] && [ "${GROUP_EXISTS_1}" = "1" ] && [ "${JOINER_ROLE_1}" != "owner" ]; then
  echo "FAIL: the join succeeded into a surviving group but the joiner ended up as '${JOINER_ROLE_1}', not 'owner' — a group with a member but nobody in charge, the exact bug this migration fixes."
  exit 1
fi
if [ "${JOIN_REPORTED_OK_1}" = "1" ] && [ "${GROUP_EXISTS_1}" != "1" ]; then
  echo "FAIL: join_group_by_code() reported ok:true but the group doesn't actually exist."
  exit 1
fi
echo "PASS: race 1 — either the join was cleanly rejected because the group is genuinely gone, or it succeeded and the joiner is the group's owner."

echo "--- restoring the real trigger before race 2 ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_TRIGGER_FN}" >/dev/null

echo "--- race 2: join delayed instead, concurrent account deletion ---"
INSTRUMENTED_JOIN_FN="$(python3 - "$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select pg_get_functiondef('join_group_by_code(text)'::regprocedure);")" <<'PY'
import sys
src = sys.argv[1]
marker = "perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || v_group_id::text, 0));"
assert marker in src, "join_group_by_code lock marker not found verbatim"
src = src.replace(marker, marker + "\n  perform pg_sleep(0.6); -- test-only: widen window while holding the lock", 1)
print(src)
PY
)"
# Restore the trigger to its clean, non-instrumented form for this half —
# only join_group_by_code() should be delayed here.
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "${INSTRUMENTED_JOIN_FN}" >/dev/null

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('88888888-9999-9999-9999-999999999903', 'orphan-race-owner2@test.dayline.app'),
  ('88888888-9999-9999-9999-999999999904', 'orphan-race-joiner2@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in ('88888888-9999-9999-9999-999999999903', '88888888-9999-9999-9999-999999999904')
  on conflict (id) do nothing;

set role authenticated;
select test_login('88888888-9999-9999-9999-999999999903');
select create_group('orphan-group-race sole-owner group 2');
SQL
GROUP_ID_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select id from groups where name = 'orphan-group-race sole-owner group 2';")"
INVITE_CODE_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select invite_code from groups where name = 'orphan-group-race sole-owner group 2';")"

RESULT_JOIN2="$(mktemp)"
RESULT_DEL2="$(mktemp)"
trap 'rm -f "${RESULT_DEL}" "${RESULT_JOIN}" "${RESULT_JOIN2}" "${RESULT_DEL2}"' EXIT

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "
  set role authenticated;
  select set_config('request.jwt.claim.sub', '88888888-9999-9999-9999-999999999904', false);
  select join_group_by_code('${INVITE_CODE_2}');
" > "${RESULT_JOIN2}" 2>&1 &
PID_JOIN2=$!
sleep 0.2
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "delete from auth.users where id = '88888888-9999-9999-9999-999999999903';" > "${RESULT_DEL2}" 2>&1 &
PID_DEL2=$!
wait "${PID_JOIN2}" || true
wait "${PID_DEL2}" || true

GROUP_EXISTS_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select count(*) from groups where id = '${GROUP_ID_2}'::uuid;")"
JOINER_ROLE_2="$(psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -tAc "select coalesce((select role from group_members where group_id = '${GROUP_ID_2}'::uuid and user_id = '88888888-9999-9999-9999-999999999904'), 'none');")"
JOIN_REPORTED_OK_2=0; if grep -q '"ok": true' "${RESULT_JOIN2}"; then JOIN_REPORTED_OK_2=1; fi

echo "join: $(cat "${RESULT_JOIN2}"), delete: $(cat "${RESULT_DEL2}"), group_exists=${GROUP_EXISTS_2}, joiner_role=${JOINER_ROLE_2}"

if [ "${JOIN_REPORTED_OK_2}" = "1" ] && [ "${GROUP_EXISTS_2}" = "1" ] && [ "${JOINER_ROLE_2}" != "owner" ]; then
  echo "FAIL: the join succeeded into a surviving group but the joiner ended up as '${JOINER_ROLE_2}', not 'owner'."
  exit 1
fi
if [ "${JOIN_REPORTED_OK_2}" = "1" ] && [ "${GROUP_EXISTS_2}" != "1" ]; then
  echo "FAIL: join_group_by_code() reported ok:true but the group doesn't actually exist."
  exit 1
fi
echo "PASS: race 2 — same guarantee held with the arrival order reversed."

echo "--- restoring the real join_group_by_code()/trigger from their migration ---"
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${FIX_MIGRATION}" >/dev/null

echo "PASS: orphaned_group_race.test.sh"
