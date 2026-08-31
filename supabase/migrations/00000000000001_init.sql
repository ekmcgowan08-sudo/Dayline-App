-- Dayline initial schema. Run via `supabase db push` or the SQL editor.
-- All tables use Row Level Security so users can only see their own data
-- or data from groups they belong to. No table is publicly readable.

create extension if not exists "uuid-ossp";

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wake_hour int not null default 8,
  sleep_hour int not null default 23,
  mode text not null default 'randomized' check (mode in ('hourly','randomized','custom')),
  reminders_per_day int not null default 8,
  quiet_start int,
  quiet_end int,
  paused_until date,
  updated_at timestamptz not null default now()
);

create table clips (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  duration_ms int not null,
  captured_at timestamptz not null default now(),
  status text not null default 'uploaded' check (status in ('uploaded','processing','used','deleted')),
  created_at timestamptz not null default now()
);
create index clips_user_captured_idx on clips(user_id, captured_at);

create table daily_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, session_date)
);

-- NOTE (fixed during audit, see docs/DECISIONS.md): the recovered file had
-- `montages` created before `groups`, but `montages.group_id` references
-- `groups(id)` — a forward reference that fails on a fresh database
-- ("relation groups does not exist"). Reordered below; no other content
-- changed from the recovered original.
create table groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique,
  max_members int not null default 10,
  created_at timestamptz not null default now()
);

create table montages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references groups(id) on delete cascade,
  session_date date not null,
  storage_path text,
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  summary text,
  created_at timestamptz not null default now(),
  check ((user_id is not null) or (group_id is not null))
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table reactions (
  id uuid primary key default uuid_generate_v4(),
  montage_id uuid not null references montages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now()
);

create table comments (
  id uuid primary key default uuid_generate_v4(),
  montage_id uuid not null references montages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('clip','montage','user','comment')),
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table analytics_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  properties jsonb,
  created_at timestamptz not null default now()
);

-- Subscriptions/entitlements: source of truth is RevenueCat webhooks writing here.
create table subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','plus','group')),
  status text not null default 'active' check (status in ('active','cancelled','expired')),
  renews_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Row Level Security
alter table profiles enable row level security;
alter table notification_preferences enable row level security;
alter table clips enable row level security;
alter table daily_sessions enable row level security;
alter table montages enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table reactions enable row level security;
alter table comments enable row level security;
alter table reports enable row level security;
alter table blocks enable row level security;
alter table subscriptions enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id);
create policy "own notif prefs" on notification_preferences for all using (auth.uid() = user_id);
create policy "own clips" on clips for all using (auth.uid() = user_id);
create policy "own sessions" on daily_sessions for all using (auth.uid() = user_id);
create policy "own subscription" on subscriptions for select using (auth.uid() = user_id);

create policy "read own or group montages" on montages for select using (
  auth.uid() = user_id
  or group_id in (select group_id from group_members where user_id = auth.uid())
);

create policy "members read their groups" on groups for select using (
  id in (select group_id from group_members where user_id = auth.uid())
);
create policy "creator manages group" on groups for update using (auth.uid() = created_by);

create policy "members see membership" on group_members for select using (
  group_id in (select group_id from group_members gm where gm.user_id = auth.uid())
);
create policy "user can join or leave" on group_members for insert with check (auth.uid() = user_id);
create policy "user can leave" on group_members for delete using (auth.uid() = user_id);

create policy "group members react" on reactions for all using (
  montage_id in (
    select id from montages where group_id in (select group_id from group_members where user_id = auth.uid())
    or user_id = auth.uid()
  )
);
create policy "group members comment" on comments for all using (
  montage_id in (
    select id from montages where group_id in (select group_id from group_members where user_id = auth.uid())
    or user_id = auth.uid()
  )
);

create policy "user files own reports" on reports for insert with check (auth.uid() = reporter_id);
create policy "user manages own blocks" on blocks for all using (auth.uid() = blocker_id);

-- Storage buckets (run once): clips (private), montages (private)
-- insert into storage.buckets (id, name, public) values ('clips', 'clips', false);
-- insert into storage.buckets (id, name, public) values ('montages', 'montages', false);
