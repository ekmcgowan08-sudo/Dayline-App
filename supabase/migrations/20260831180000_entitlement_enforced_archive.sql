-- Server-enforced memory-archive limit. Previously
-- `ENTITLEMENT_LIMITS.free.memoryArchiveDays` (mobile/src/constants/
-- entitlements.ts) existed only as a documented UI hypothesis — the
-- client queried `montages` directly, so nothing actually stopped a free
-- user from seeing their entire history regardless of tier. These RPCs
-- are the real enforcement point; the mobile client's listPersonalMontages
-- / listGroupMontages now call them instead of selecting the table
-- directly (see mobile/src/services/montages.ts).
--
-- The day counts below (30 / unlimited) must be kept in sync with
-- ENTITLEMENT_LIMITS in mobile/src/constants/entitlements.ts by hand —
-- there's no shared source of truth between Postgres and the TS bundle in
-- this build. Both sides carry a comment pointing at the other on
-- purpose, so this doesn't silently drift.

create or replace function list_my_personal_montages() returns setof montages
language plpgsql stable security definer set search_path = public as $$
declare
  v_entitlement text := current_entitlement();
  v_cutoff date;
begin
  if v_entitlement = 'plus' then
    v_cutoff := '0001-01-01'::date; -- effectively unlimited
  else
    v_cutoff := (now() at time zone 'UTC')::date - interval '30 days'; -- keep in sync with ENTITLEMENT_LIMITS.free.memoryArchiveDays
  end if;

  return query
    select * from montages
    where user_id = auth.uid()
      and session_date >= v_cutoff
    order by session_date desc;
end;
$$;
grant execute on function list_my_personal_montages() to authenticated;

create or replace function list_my_group_montages() returns setof montages
language plpgsql stable security definer set search_path = public as $$
declare
  v_entitlement text := current_entitlement();
  v_cutoff date;
begin
  if v_entitlement = 'plus' then
    v_cutoff := '0001-01-01'::date;
  else
    v_cutoff := (now() at time zone 'UTC')::date - interval '30 days'; -- keep in sync with ENTITLEMENT_LIMITS.free.memoryArchiveDays
  end if;

  return query
    select m.* from montages m
    where m.group_id in (select group_id from group_members where user_id = auth.uid())
      and m.session_date >= v_cutoff
    order by m.session_date desc;
end;
$$;
grant execute on function list_my_group_montages() to authenticated;
