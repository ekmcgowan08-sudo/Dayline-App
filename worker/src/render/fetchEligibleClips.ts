import { fromZonedTime } from 'date-fns-tz';
import { supabaseAdmin } from '../supabaseAdmin.js';

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
 * timeline). Group montages use a plain UTC calendar day — there's no
 * single canonical timezone for a group of people, so this is a
 * documented simplification (see docs/DECISIONS.md) rather than an
 * attempt to guess whose clock the "day" should follow.
 */
export async function fetchEligibleClips(job: MontageJob): Promise<EligibleClip[]> {
  if (job.kind === 'personal') {
    if (!job.user_id) throw new Error('personal montage job missing user_id');

    const { data: profile } = await supabaseAdmin.from('profiles').select('timezone').eq('id', job.user_id).maybeSingle();
    const timezone = profile?.timezone ?? 'UTC';
    const dayStart = fromZonedTime(`${job.session_date}T00:00:00`, timezone).toISOString();
    const dayEnd = fromZonedTime(`${job.session_date}T23:59:59.999`, timezone).toISOString();

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
  const dayStart = `${job.session_date}T00:00:00.000Z`;
  const dayEnd = `${job.session_date}T23:59:59.999Z`;

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
