-- Comments and reactions were the last two user-generated-content insert
-- paths with no rate limit at all (reports, montage requests, account
-- deletion, transcription, and group-join attempts all already use
-- check_rate_limit()). Both are inserted via direct table .insert() calls
-- through an RLS INSERT policy rather than an RPC wrapper, so the same
-- check_rate_limit(bucket, subject, max, window) call used by
-- report_hardening.sql's WITH CHECK clause is reused directly here — no
-- trigger needed, since RLS WITH CHECK expressions can call any
-- SQL-callable function.
--
-- Limits are deliberately generous (real conversation/reacting shouldn't
-- ever hit them) and tunable like every other rate-limit bucket in this
-- codebase: comments 20/5min, reactions 30/5min. Only inserts are limited;
-- deleting a reaction (un-reacting) stays unrestricted, matching every
-- other delete policy in this schema.
drop policy if exists "insert own comment on visible montages" on comments;
create policy "insert own comment on visible montages" on comments for insert with check (
  auth.uid() = user_id
  and length(trim(body)) > 0
  and length(body) <= 500
  and montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
  and check_rate_limit('comment-post', auth.uid()::text, 20, 300)
);

drop policy if exists "insert own reaction on visible montages" on reactions;
create policy "insert own reaction on visible montages" on reactions for insert with check (
  auth.uid() = user_id
  and montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
  and check_rate_limit('reaction-post', auth.uid()::text, 30, 300)
);
