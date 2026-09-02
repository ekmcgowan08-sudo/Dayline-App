-- Found empirically, not assumed: device_push_tokens.expo_push_token is
-- globally unique, and the mobile client registers it with a plain
-- `.upsert(..., { onConflict: 'expo_push_token' })`. When a different
-- user logs in on a device that previously registered a token under
-- someone else's account (borrowed phone, shared family device,
-- reinstall + new sign-in, a developer's test devices), that upsert's
-- ON CONFLICT DO UPDATE path re-checks the row's RLS UPDATE policy
-- against the EXISTING row — which belongs to the other user, not the
-- caller — and Postgres raises "new row violates row-level security
-- policy (USING expression)" rather than silently reassigning it.
-- Verified directly against real Postgres 16 in this session before
-- writing this fix, not assumed from RLS+ON CONFLICT documentation.
--
-- The practical effect: the new user's push registration fails outright
-- every time, and the previous user's stale row keeps sitting on that
-- device — so a push meant for the previous user's account could still
-- land on a physical device someone else is now signed into, a real
-- notification-privacy leak, not just a registration inconvenience.
--
-- register_push_token() is a SECURITY DEFINER RPC that reassigns the
-- token atomically regardless of which user (if any) it currently
-- belongs to — the same "wrap the cross-user side effect in an RPC"
-- pattern already used throughout this schema wherever a client-facing
-- table's RLS can't express what's needed.
create or replace function register_push_token(p_expo_push_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid_platform';
  end if;

  delete from device_push_tokens where expo_push_token = p_expo_push_token and user_id <> auth.uid();

  insert into device_push_tokens (user_id, expo_push_token, platform, last_seen_at)
    values (auth.uid(), p_expo_push_token, p_platform, now())
  on conflict (expo_push_token) do update set last_seen_at = now();
end;
$$;
revoke all on function register_push_token(text, text) from public;
grant execute on function register_push_token(text, text) to authenticated;
