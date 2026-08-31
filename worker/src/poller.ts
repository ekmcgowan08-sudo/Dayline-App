import { config } from './config.js';
import type { HealthState } from './health.js';
import { logger } from './logger.js';
import type { MontageJob } from './render/fetchEligibleClips.js';
import { runJob } from './render/runJob.js';
import { supabaseAdmin } from './supabaseAdmin.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simple single-job-at-a-time polling loop. Deliberately not concurrent —
 * this keeps memory/CPU usage predictable on a small, low-cost container,
 * and montage rendering isn't latency-sensitive enough to need it. Run
 * more replicas of this same container if throughput ever matters; the
 * SKIP LOCKED claim function (see supabase/migrations/
 * 20260831130000_worker_job_claim.sql) makes that safe. */
export async function startPollingLoop(state: HealthState, shouldContinue: () => boolean) {
  logger.info('worker started', { workerId: config.workerId, pollIntervalMs: config.pollIntervalMs });

  while (shouldContinue()) {
    state.lastPollAt = new Date().toISOString();
    try {
      const { data: job, error } = await supabaseAdmin.rpc('claim_next_montage_job', {
        p_worker_id: config.workerId,
        p_stale_after_seconds: config.staleClaimSeconds,
      });

      if (error) {
        state.lastError = error.message;
        logger.error('claim failed', { error: error.message });
      } else if (job) {
        const typedJob = job as MontageJob;
        state.lastJobId = typedJob.id;
        logger.info('claimed job', { montageId: typedJob.id, kind: typedJob.kind });
        await runJob(typedJob);
        state.lastError = null;
      }
    } catch (e) {
      state.lastError = (e as Error).message;
      logger.error('poll loop error', { error: (e as Error).message });
    }

    await sleep(config.pollIntervalMs);
  }

  logger.info('worker shutting down');
}
