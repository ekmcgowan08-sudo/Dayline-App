-- Memory-resurfacing preferences and the AI-captions consent/feature-flag
-- foundation. No facial recognition or content profiling: "on this day"
-- logic is a pure date calculation over the user's own montages.

alter table notification_preferences
  add column if not exists memory_notifications boolean not null default true;

create table if not exists transcription_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consented boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table transcription_consents enable row level security;
create policy "manage own transcription consent" on transcription_consents for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A memory is just "does this user have a ready montage from exactly N days
-- ago". Exposed as a function so the app doesn't need client-side date math
-- across timezones for something server-verifiable.
create or replace function memories_on_this_day() returns setof montages
language sql stable security definer set search_path = public as $$
  select m.* from montages m
  join profiles p on p.id = auth.uid()
  where m.user_id = auth.uid()
    and m.status = 'ready'
    and m.session_date = any(array[
      ((now() at time zone p.timezone)::date - interval '7 days')::date,
      ((now() at time zone p.timezone)::date - interval '30 days')::date,
      ((now() at time zone p.timezone)::date - interval '1 year')::date
    ]);
$$;
grant execute on function memories_on_this_day() to authenticated;
