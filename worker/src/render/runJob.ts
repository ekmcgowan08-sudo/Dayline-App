import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DAYLINE_END_CARD_TEXT } from '../brand.js';
import { config } from '../config.js';
import { DAYLINE_END_CARD_REQUIRED_FOR_FREE, getEntitlement } from '../entitlements.js';
import { logger } from '../logger.js';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { downloadClipToFile, uploadMontageFile } from './downloadClip.js';
import { fetchEligibleClips, type MontageJob } from './fetchEligibleClips.js';
import { renderMontage } from './pipeline.js';

const MAX_CREDITS_LINES = 10; // matches GROUP_LIMITS.maxActiveMembers (mobile/src/constants/brand.ts)

/** Error codes are intentionally generic/non-identifying — safe to display
 * to a user (see docs/SECURITY.md's "error codes safe for display"
 * requirement) rather than leaking stack traces or storage paths. */
const ErrorCode = {
  NoEligibleClips: 'no_eligible_clips',
  ClipDownloadFailed: 'clip_download_failed',
  RenderFailed: 'render_failed',
  MaxRetriesExceeded: 'max_retries_exceeded',
} as const;

export async function runJob(job: MontageJob): Promise<void> {
  const jobWorkDir = path.join(config.tmpDir, job.id);
  await mkdir(jobWorkDir, { recursive: true });

  try {
    const eligibleClips = await fetchEligibleClips(job);
    if (eligibleClips.length === 0) {
      await failJob(job, ErrorCode.NoEligibleClips, false);
      return;
    }

    const localClipPaths: string[] = [];
    const clipMetaByPath = new Map<string, { id: string; contributorId: string }>();
    let downloadFailures = 0;

    for (let i = 0; i < eligibleClips.length; i++) {
      const clip = eligibleClips[i];
      const localPath = path.join(jobWorkDir, `source-${i}.mp4`);
      try {
        await downloadClipToFile(clip.storagePath, localPath);
        localClipPaths.push(localPath);
        clipMetaByPath.set(localPath, { id: clip.id, contributorId: clip.contributorId });
      } catch (e) {
        downloadFailures++;
        logger.warn('clip download failed; will be skipped', {
          montageId: job.id,
          clipId: clip.id,
          error: (e as Error).message,
        });
      }
    }

    if (localClipPaths.length === 0) {
      // Every clip failed to download — likely transient (network/storage
      // hiccup), so this is retryable rather than a dead end.
      await failJob(job, ErrorCode.ClipDownloadFailed, true);
      return;
    }

    const titleCardText = job.title_card_text ?? formatTitleCard(job.session_date);

    // Group montages get a tasteful contributor-credits card — everyone who
    // filmed something for the day, in the order they first appear in the
    // montage, capped so a large group doesn't produce a scrolling wall of
    // names. Personal montages never get one: crediting a user to
    // themselves is noise. Built from `eligibleClips` (what the day's
    // roster actually was), not `renderedClipPaths` (what survived
    // download/normalization) — a clip that failed to download for
    // transient reasons shouldn't silently drop its owner from the credits.
    let creditsText: string | undefined;
    if (job.kind === 'group') {
      const contributorIds = Array.from(new Set(eligibleClips.map((c) => c.contributorId))).slice(0, MAX_CREDITS_LINES);
      const { data: contributorProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name')
        .in('id', contributorIds);
      const nameById = new Map((contributorProfiles ?? []).map((p) => [p.id, p.display_name?.trim() || 'A friend']));
      creditsText = contributorIds.map((id) => nameById.get(id) ?? 'A friend').join('\n');
    }

    // The branded Dayline end card is entitlement-gated for personal
    // montages (the owner's own subscription controls their own export) but
    // always shown for group montages — a shared "Our Day" video has no
    // single subscriber whose personal tier should decide whether everyone
    // else in the group sees branding removed too. See docs/DECISIONS.md.
    let endCardText: string | undefined;
    if (job.kind === 'personal' && job.user_id) {
      const entitlement = await getEntitlement(job.user_id);
      if (entitlement === 'free' && DAYLINE_END_CARD_REQUIRED_FOR_FREE) {
        endCardText = DAYLINE_END_CARD_TEXT;
      }
    } else if (job.kind === 'group') {
      endCardText = DAYLINE_END_CARD_TEXT;
    }

    const skippedDuringRender: string[] = [];

    const result = await renderMontage({
      clipPaths: localClipPaths,
      outputPath: path.join(jobWorkDir, 'output.mp4'),
      workDir: jobWorkDir,
      titleCardText,
      creditsText,
      endCardText,
      onClipError: (err) => {
        skippedDuringRender.push(err.clipPath);
        return true; // one bad clip shouldn't sink an otherwise-good day
      },
    });

    const ownerId = job.kind === 'personal' ? job.user_id! : job.group_id!;
    const outputStoragePath = `${job.kind}/${ownerId}/${randomUUID()}.mp4`;
    await uploadMontageFile(outputStoragePath, result.outputPath);

    const montageClipsRows = result.renderedClipPaths.map((localPath, index) => {
      const meta = clipMetaByPath.get(localPath)!;
      return { montage_id: job.id, clip_id: meta.id, position: index, contributor_id: meta.contributorId };
    });
    if (montageClipsRows.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('montage_clips').insert(montageClipsRows);
      if (insertError) throw new Error(`failed to record montage_clips: ${insertError.message}`);
    }

    const { error: updateError } = await supabaseAdmin
      .from('montages')
      .update({
        status: 'ready',
        storage_path: outputStoragePath,
        clip_count: montageClipsRows.length,
        ready_at: new Date().toISOString(),
        error_code: null,
        title_card_text: titleCardText,
        claimed_at: null,
        claimed_by: null,
      })
      .eq('id', job.id);
    if (updateError) throw new Error(`failed to finalize montage row: ${updateError.message}`);

    // Storage cost control (see docs/COSTS.md): once a clip has been
    // incorporated into its OWNER's OWN personal montage, the raw source
    // is no longer needed for anything this app does with it — mark it
    // 'used' so the scheduled purge-used-clips job can later free its
    // storage object while keeping the row (and montage_clips history)
    // intact. Deliberately NOT done for group montages: a group
    // contribution doesn't mean the owner's own personal montage (which
    // may not exist yet) is done with that clip.
    if (job.kind === 'personal' && montageClipsRows.length > 0) {
      const { error: markUsedError } = await supabaseAdmin
        .from('clips')
        .update({ status: 'used' })
        .in(
          'id',
          montageClipsRows.map((r) => r.clip_id)
        )
        .eq('status', 'uploaded'); // never downgrade a clip some other flow already moved on from
      if (markUsedError) {
        // Non-fatal: the montage already succeeded and is what the user
        // sees. Worst case this batch of clips is picked up by a later
        // job or lingers un-purged a bit longer — not worth failing an
        // otherwise-successful render over.
        logger.warn('failed to mark clips used (non-fatal)', { montageId: job.id, error: markUsedError.message });
      }
    }

    logger.info('montage rendered', {
      montageId: job.id,
      clipCount: montageClipsRows.length,
      skippedClips: skippedDuringRender.length,
      downloadFailures,
    });
  } catch (e) {
    logger.error('job failed', { montageId: job.id, error: (e as Error).message });
    await failJob(job, ErrorCode.RenderFailed, true);
  } finally {
    await rm(jobWorkDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function failJob(job: MontageJob, errorCode: string, retryable: boolean) {
  const nextRetryCount = job.retry_count + 1;
  const exhausted = nextRetryCount >= config.maxRetries;
  const status = retryable && !exhausted ? 'retrying' : 'failed';
  const finalErrorCode = retryable && exhausted ? ErrorCode.MaxRetriesExceeded : errorCode;

  await supabaseAdmin
    .from('montages')
    .update({ status, error_code: finalErrorCode, retry_count: nextRetryCount, claimed_at: null, claimed_by: null })
    .eq('id', job.id);

  logger.warn('job marked as failed/retrying', { montageId: job.id, status, errorCode: finalErrorCode, nextRetryCount });
}

function formatTitleCard(sessionDate: string): string {
  const [y, m, d] = sessionDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}
