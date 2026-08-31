-- Core hardening over the recovered baseline (00000000000001_init.sql):
-- profile richness, consent audit trail, push token registry, idempotent
-- uploads, capture-slot tracking for the Today timeline, and montage
-- metadata needed by a real renderer (vs. the placeholder it shipped with).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists avatar_url text,
  add column if not exists timezone text not null default 'UTC',
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'pending_deletion')),
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------
-- acceptance_records: immutable audit trail of terms/privacy/age/rules
-- acceptance. Never updated or deleted by the client, only appended.
-- ---------------------------------------------------------------------
create table if not exists acceptance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document text not null check (document in ('terms', 'privacy', 'community_rules', 'age_confirmation')),
  version text not null,
  accepted_at timestamptz not null default now()
);
create index if not exists acceptance_records_user_idx on acceptance_records(user_id, document);
alter table acceptance_records enable row level security;
create policy "read own acceptance records" on acceptance_records for select using (auth.uid() = user_id);
create policy "insert own acceptance records" on acceptance_records for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- device_push_tokens: server-side push registration (Expo push tokens).
-- ---------------------------------------------------------------------
create table if not exists device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table device_push_tokens enable row level security;
create policy "manage own push tokens" on device_push_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- clips: idempotent uploads, moderation, soft delete, media metadata.
-- client_capture_id is a UUID generated on-device at record time; retrying
-- an upload reuses it, so a unique index makes retries safe (no duplicate
-- rows even if the network call is repeated after a timeout).
-- ---------------------------------------------------------------------
alter table clips
  add column if not exists client_capture_id uuid,
  add column if not exists content_type text not null default 'video/mp4',
  add column if not exists width int,
  add column if not exists height int,
  add column if not exists checksum text,
  add column if not exists deleted_at timestamptz,
  add column if not exists moderation_status text not null default 'ok'
    check (moderation_status in ('ok', 'flagged', 'removed')),
  add column if not exists caption text,
  add column if not exists caption_status text not null default 'none'
    check (caption_status in ('none', 'pending', 'ready', 'failed', 'disabled'));

create unique index if not exists clips_user_client_capture_uidx
  on clips(user_id, client_capture_id) where client_capture_id is not null;
create index if not exists clips_user_deleted_idx on clips(user_id, deleted_at);

-- ---------------------------------------------------------------------
-- capture_slots: the concrete, timezone-resolved reminder times computed
-- for a given local day. Populated by the app when it (re)computes today's
-- schedule; updated to 'completed' when a clip lands in that slot. This is
-- what powers the Today timeline's per-slot state (not just a raw clip
-- list), independent of whether the reminder notification actually fired.
-- ---------------------------------------------------------------------
create table if not exists capture_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_date date not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'missed', 'skipped')),
  clip_id uuid references clips(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, scheduled_at)
);
create index if not exists capture_slots_user_date_idx on capture_slots(user_id, slot_date);
alter table capture_slots enable row level security;
create policy "manage own capture slots" on capture_slots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- montages: replace the two-state placeholder with a full render lifecycle,
-- plus the fields a real ffmpeg worker needs to be retryable and idempotent.
-- ---------------------------------------------------------------------
alter table montages drop constraint if exists montages_status_check;
alter table montages
  add column if not exists requested_by uuid references auth.users(id) on delete set null,
  add column if not exists kind text not null default 'personal' check (kind in ('personal', 'group')),
  add column if not exists error_code text,
  add column if not exists retry_count int not null default 0,
  add column if not exists idempotency_key text,
  add column if not exists title_card_text text,
  add column if not exists clip_count int not null default 0,
  add column if not exists ready_at timestamptz,
  add column if not exists expires_at timestamptz,
  add constraint montages_status_check check (
    status in ('processing', 'ready', 'failed', 'retrying', 'expired')
  );

-- One montage per user per day, and one per group per day (partial unique
-- indexes since exactly one of user_id/group_id is set per row).
create unique index if not exists montages_user_date_uidx on montages(user_id, session_date) where user_id is not null;
create unique index if not exists montages_group_date_uidx on montages(group_id, session_date) where group_id is not null;
create index if not exists montages_status_idx on montages(status);

-- ---------------------------------------------------------------------
-- montage_clips: explicit, ordered join between a rendered montage and the
-- clips it actually contains. Written only by the worker/RPCs (service
-- role or SECURITY DEFINER functions), never directly by client inserts,
-- so a client can never claim a clip appears in a montage it doesn't.
-- ---------------------------------------------------------------------
create table if not exists montage_clips (
  montage_id uuid not null references montages(id) on delete cascade,
  clip_id uuid not null references clips(id) on delete cascade,
  position int not null,
  contributor_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (montage_id, clip_id)
);
create index if not exists montage_clips_montage_idx on montage_clips(montage_id, position);
alter table montage_clips enable row level security;
create policy "read montage clips via montage access" on montage_clips for select using (
  montage_id in (
    select id from montages
    where user_id = auth.uid()
       or group_id in (select group_id from group_members where user_id = auth.uid())
  )
);
