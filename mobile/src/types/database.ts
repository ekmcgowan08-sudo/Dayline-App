/**
 * Hand-written types mirroring supabase/migrations/*.sql. There is no live
 * Supabase project in this environment to run `supabase gen types
 * typescript`, so these are maintained by hand — regenerate and diff
 * against this file once a real project exists (see docs/DEPLOYMENT.md).
 */

export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;

export type AccountStatus = 'active' | 'suspended' | 'pending_deletion';
export type CaptureMode = 'hourly' | 'randomized' | 'custom';
export type ClipStatus = 'uploaded' | 'processing' | 'used' | 'deleted';
export type ModerationStatus = 'ok' | 'flagged' | 'removed';
export type CaptionStatus = 'none' | 'pending' | 'ready' | 'failed' | 'disabled';
export type CaptureSlotStatus = 'pending' | 'completed' | 'missed' | 'skipped';
export type MontageStatus = 'processing' | 'ready' | 'failed' | 'retrying' | 'expired';
export type MontageKind = 'personal' | 'group';
export type GroupRole = 'owner' | 'admin' | 'member';
export type InviteCodeStatus = 'active' | 'revoked';
export type ReportTargetType = 'clip' | 'montage' | 'user' | 'comment';
export type ReportStatus = 'open' | 'reviewing' | 'actioned' | 'dismissed';
export type DataExportStatus = 'pending' | 'fulfilled';
export type Entitlement = 'free' | 'plus';
export type ReactionEmoji = '❤️' | '😂' | '😮' | '🥹' | '🙌' | '🔥';

export interface Profile {
  id: UUID;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  account_status: AccountStatus;
  onboarding_completed_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface NotificationPreferences {
  user_id: UUID;
  active_days: number[];
  wake_hour: number;
  sleep_hour: number;
  mode: CaptureMode;
  reminders_per_day: number;
  custom_times: string[];
  quiet_start: number | null;
  quiet_end: number | null;
  paused_until: ISODate | null;
  memory_notifications: boolean;
  updated_at: ISODateTime;
}

export interface Clip {
  id: UUID;
  user_id: UUID;
  storage_path: string;
  duration_ms: number;
  captured_at: ISODateTime;
  status: ClipStatus;
  client_capture_id: UUID | null;
  content_type: string;
  width: number | null;
  height: number | null;
  checksum: string | null;
  deleted_at: ISODateTime | null;
  moderation_status: ModerationStatus;
  caption: string | null;
  caption_status: CaptionStatus;
  created_at: ISODateTime;
}

export interface CaptureSlot {
  id: UUID;
  user_id: UUID;
  slot_date: ISODate;
  scheduled_at: ISODateTime;
  status: CaptureSlotStatus;
  clip_id: UUID | null;
  created_at: ISODateTime;
}

export interface Montage {
  id: UUID;
  user_id: UUID | null;
  group_id: UUID | null;
  kind: MontageKind;
  session_date: ISODate;
  storage_path: string | null;
  status: MontageStatus;
  summary: string | null;
  requested_by: UUID | null;
  error_code: string | null;
  retry_count: number;
  idempotency_key: string | null;
  title_card_text: string | null;
  clip_count: number;
  ready_at: ISODateTime | null;
  expires_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface MontageClip {
  montage_id: UUID;
  clip_id: UUID;
  position: number;
  contributor_id: UUID;
  created_at: ISODateTime;
}

export interface Group {
  id: UUID;
  name: string;
  created_by: UUID;
  invite_code: string;
  invite_code_status: InviteCodeStatus;
  invite_code_expires_at: ISODateTime | null;
  max_members: number;
  timezone: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface GroupMember {
  group_id: UUID;
  user_id: UUID;
  role: GroupRole;
  joined_at: ISODateTime;
}

export interface GroupContribution {
  id: UUID;
  clip_id: UUID;
  group_id: UUID;
  contributed_by: UUID;
  created_at: ISODateTime;
}

export interface Reaction {
  id: UUID;
  montage_id: UUID;
  user_id: UUID;
  emoji: ReactionEmoji;
  created_at: ISODateTime;
}

export interface Comment {
  id: UUID;
  montage_id: UUID;
  user_id: UUID;
  body: string;
  deleted_at: ISODateTime | null;
  moderation_status: ModerationStatus;
  created_at: ISODateTime;
}

export interface Report {
  id: UUID;
  reporter_id: UUID;
  target_type: ReportTargetType;
  target_id: UUID;
  reason: string;
  status: ReportStatus;
  resolved_by: UUID | null;
  resolution_notes: string | null;
  resolved_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface Block {
  blocker_id: UUID;
  blocked_id: UUID;
  created_at: ISODateTime;
}

export interface Subscription {
  user_id: UUID;
  tier: 'free' | 'plus' | 'group';
  status: 'active' | 'cancelled' | 'expired';
  entitlement: Entitlement;
  product_id: string | null;
  revenuecat_app_user_id: string | null;
  period_type: 'normal' | 'trial' | 'intro' | 'grace' | null;
  expires_at: ISODateTime | null;
  will_renew: boolean;
  renews_at: ISODateTime | null;
  updated_at: ISODateTime;
}

export interface AcceptanceRecord {
  id: UUID;
  user_id: UUID;
  document: 'terms' | 'privacy' | 'community_rules' | 'age_confirmation';
  version: string;
  accepted_at: ISODateTime;
}

export interface TranscriptionConsent {
  user_id: UUID;
  consented: boolean;
  updated_at: ISODateTime;
}

export interface DataExportRequest {
  id: UUID;
  user_id: UUID;
  requested_at: ISODateTime;
  status: DataExportStatus;
  fulfilled_at: ISODateTime | null;
  storage_path: string | null;
}

/** Result shape returned by the join_group_by_code() RPC (see migration
 * 20260831020000_groups_hardening.sql for why this is a result object
 * instead of a thrown error for expected outcomes). */
export type JoinGroupResult =
  | { ok: true; group: Group }
  | { ok: false; error: 'invalid_or_expired_code' | 'blocked_relationship' | 'group_full' | 'rate_limited' };
