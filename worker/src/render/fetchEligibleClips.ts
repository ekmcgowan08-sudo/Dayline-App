import { fromZonedTime } from 'date-fns-tz';
import { logger } from '../logger.js';
import { supabaseAdmin } from '../supabaseAdmin.js';

/**
 * `fromZonedTime` (via `Intl.DateTimeFormat` under the hood) throws for an
 * unrecognized IANA zone name. Both call sites below store timezone strings
 * validated at write time (profile onboarding, `set_group_timezone`), so
 * this should never actually fire — but Node's ICU data and Postgres's
 * timezone database aren't guaranteed to agree on every exotic zone name,
 * and defaulting a render to UTC on a lookup failure is a far better
 * failure mode than the whole montage job crashing over it.
 */
function fromZonedTimeSafe(localDateTime: string, timezone: string | null | undefined): string {
  const tz = timezone ?? 'UTC';
  try {
    return fromZonedTime(localDateTime, tz).toISOString();
  } catch (e) {
    logger.warn('unrecognized timezone; falling back to UTC', { timezone: tz, error: (e as Error).message });
    return fromZonedTime(localDateTime, 'UTC').toISOString();
  }
}

export type EligibleClip = {
  id: string;
  storagePath: string;
  capturedAt: string;
  contributorId: string;
};

export type MontageJob = {
  id: string;
  user_id: string | null;
  group_id: string | null;
  session_date: string;
  kind: 'personal' | 'group';
  retry_count: number;
  title_card_text: string | null;
  requested_by: string | null;
};

/**
 * Returns the day's eligible clips in final playback order. This is the
 * single authoritative eligibility check — it re-queries fresh at render
 * time rather than trusting any client-side snapshot, and it is the only
 * place group privacy is enforced for rendering: a clip is included in a
 * group montage if and only if a `group_contributions` row exists for it
 * (the explicit per-clip opt-in), never just because its owner is a member.
 *
 * Personal montages use the owner's profile timezone for the calendar-day
 * boundary (matching what the user saw as "today" on their Today
 * timeline). Group montages use the group's own `timezone` column (owner/
 * admin-settable, defaults to UTC — see
 * supabase/migrations/20260831190000_group_timezone.sql and
 * `set_group_timezone`), the same as-good-as-it-gets choice a group makes
 * once rather than the app guessing whose clock the "day" should follow.
 */
export async function fetchEligibleClips(job: MontageJob): Promise<EligibleClip[]> {
  if (job.kind === 'personal') {
    if (!job.user_id) throw new Error('personal montage job missing user_id');

    const { data: profile } = await supabaseAdmin.from('profiles').select('timezone').eq('id', job.user_id).maybeSingle();
    const dayStart = fromZonedTimeSafe(`${job.session_date}T00:00:00`, profile?.timezone);
    const dayEnd = fromZonedTimeSafe(`${job.session_date}T23:59:59.999`, profile?.timezone);

    const { data: clips, error } = await supabaseAdmin
      .from('clips')
      .select('id, storage_path, captured_at, user_id')
      .eq('user_id', job.user_id)
      .is('deleted_at', null)
      .eq('moderation_status', 'ok')
      .gte('captured_at', dayStart)
      .lte('captured_at', dayEnd)
      .order('captured_at', { ascending: true });
    if (error) throw error;

    return (clips ?? []).map((c) => ({
      id: c.id,
      storagePath: c.storage_path,
      capturedAt: c.captured_at,
      contributorId: c.user_id,
    }));
  }

  if (!job.group_id) throw new Error('group montage job missing group_id');

  const { data: group } = await supabaseAdmin.from('groups').select('timezone').eq('id', job.group_id).maybeSingle();
  const dayStart = fromZonedTimeSafe(`${job.session_date}T00:00:00`, group?.timezone);
  const dayEnd = fromZonedTimeSafe(`${job.session_date}T23:59:59.999`, group?.timezone);

  const { data: contributions, error } = await supabaseAdmin
    .from('group_contributions')
    .select('clip_id, contributed_by, clips!inner(id, storage_path, captured_at, deleted_at, moderation_status)')
    .eq('group_id', job.group_id)
    .gte('clips.captured_at', dayStart)
    .lte('clips.captured_at', dayEnd);
  if (error) throw error;

  type Row = {
    clip_id: string;
    contributed_by: string;
    clips: { id: string; storage_path: string; captured_at: string; deleted_at: string | null; moderation_status: string };
  };

  return ((contributions ?? []) as unknown as Row[])
    .filter((row) => !row.clips.deleted_at && row.clips.moderation_status === 'ok')
    .sort((a, b) => new Date(a.clips.captured_at).getTime() - new Date(b.clips.captured_at).getTime())
    .map((row) => ({
      id: row.clips.id,
      storagePath: row.clips.storage_path,
      capturedAt: row.clips.captured_at,
      contributorId: row.contributed_by,
    }));
}
