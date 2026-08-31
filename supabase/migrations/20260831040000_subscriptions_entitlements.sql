-- Subscriptions/entitlements: the client can only ever READ its own row.
-- The recovered baseline already restricted writes by omitting an
-- insert/update policy (good instinct), but relied on that omission
-- implicitly. This migration restates it explicitly and adds the fields
-- RevenueCat webhooks need, so it's unambiguous that a client can never
-- self-grant a paid entitlement — see the RLS test in
-- supabase/tests/subscriptions_rls.test.sql.

alter table subscriptions drop constraint if exists subscriptions_tier_check;
alter table subscriptions
  add column if not exists product_id text,
  add column if not exists revenuecat_app_user_id text,
  add column if not exists entitlement text not null default 'free' check (entitlement in ('free', 'plus')),
  add column if not exists period_type text check (period_type in ('normal', 'trial', 'intro', 'grace')),
  add column if not exists expires_at timestamptz,
  add column if not exists will_renew boolean not null default false,
  add constraint subscriptions_tier_check check (tier in ('free', 'plus', 'group'));

create index if not exists subscriptions_revenuecat_uid_idx on subscriptions(revenuecat_app_user_id);

drop policy if exists "own subscription" on subscriptions;
create policy "read own subscription" on subscriptions for select using (auth.uid() = user_id);
-- Deliberately no insert/update/delete policy for the authenticated role.
-- All writes happen via the service role from the revenuecat-webhook Edge
-- Function (supabase/functions/revenuecat-webhook), which bypasses RLS.

create or replace function current_entitlement() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select entitlement from subscriptions
     where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())),
    'free'
  );
$$;
grant execute on function current_entitlement() to authenticated;
