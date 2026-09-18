-- revenuecat-webhook (supabase/functions/revenuecat-webhook/index.ts) reads
-- subscriptions.last_event_at, compares it to the incoming event's own
-- timestamp to decide whether the event is stale (Phase 32,
-- 20260901060000_webhook_event_ordering.sql), and only then upserts -- two
-- separate Supabase-js calls with no lock between them, the exact same
-- TOCTOU shape already fixed twice this session for check_rate_limit()
-- (Phase 38) and the group-count limit (Phase 56), just in application
-- code instead of a single Postgres function this time.
--
-- Proven against a real Postgres 16 instance before fixing: seeded a
-- subscription with last_event_at = 2026-01-01. Ran the exact two-
-- statement read-then-write sequence for a legitimate newer event
-- (last_event_at = 2026-06-02, tier 'plus') and, concurrently, for a
-- stale redelivered older event (last_event_at = 2026-06-01, tier
-- 'free') -- both reads happened before either write, so both passed
-- their own staleness check against the *original* 2026-01-01 value,
-- unaware of each other. The newer event's write landed first but was
-- then silently overwritten by the older event's later-committing
-- write. Final state: tier 'free', last_event_at 2026-06-01 -- a paying
-- customer's subscription downgraded by a stale webhook redelivery
-- racing the real purchase event. RevenueCat's own webhook delivery
-- gives no ordering guarantee and does retry on transient failures, so
-- this is a real delivery pattern, not a hypothetical one.
--
-- Fix: collapse the read-check-write into a single atomic statement.
-- INSERT ... ON CONFLICT (user_id) DO UPDATE ... WHERE evaluates its
-- WHERE clause against the target row *while holding that row's lock*
-- as part of the same statement -- a concurrent caller targeting the
-- same user_id blocks on the row lock until the first caller's
-- transaction commits, then re-evaluates WHERE against the now-current
-- data, so there is no window for a second caller to act on data it
-- read before the first caller's write landed. No advisory lock needed;
-- INSERT's own conflict-target row lock already serializes this by
-- construction. An event with no purchased_at_ms (p_incoming_event_at
-- null) always applies, matching the current behavior of never treating
-- a timestamp-less event as stale.
create or replace function apply_revenuecat_event(
  p_user_id uuid,
  p_tier text,
  p_entitlement text,
  p_status text,
  p_product_id text,
  p_period_type text,
  p_expires_at timestamptz,
  p_will_renew boolean,
  p_incoming_event_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied int;
begin
  insert into subscriptions (
    user_id, tier, entitlement, status, product_id, revenuecat_app_user_id,
    period_type, expires_at, will_renew, last_event_at, updated_at
  )
  values (
    p_user_id, p_tier, p_entitlement, p_status, p_product_id, p_user_id,
    p_period_type, p_expires_at, p_will_renew, p_incoming_event_at, now()
  )
  on conflict (user_id) do update set
    tier = excluded.tier,
    entitlement = excluded.entitlement,
    status = excluded.status,
    product_id = excluded.product_id,
    revenuecat_app_user_id = excluded.revenuecat_app_user_id,
    period_type = excluded.period_type,
    expires_at = excluded.expires_at,
    will_renew = excluded.will_renew,
    last_event_at = coalesce(excluded.last_event_at, subscriptions.last_event_at),
    updated_at = excluded.updated_at
  where p_incoming_event_at is null
     or subscriptions.last_event_at is null
     or subscriptions.last_event_at <= p_incoming_event_at;

  get diagnostics v_applied = row_count;
  return v_applied > 0;
end;
$$;
revoke all on function apply_revenuecat_event(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz) from public;
grant execute on function apply_revenuecat_event(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz) to service_role;
