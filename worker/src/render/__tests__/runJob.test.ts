import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import type { MontageJob } from '../fetchEligibleClips.js';

/**
 * Regression test for a real bug: if every eligible clip downloads fine but
 * fails to *normalize* (corrupt/unreadable video — a different failure
 * point than "failed to download", which runJob already guarded),
 * renderMontage() still "succeeds": with a title card present, its
 * segmentPaths list never goes empty (see the existing pipeline.test.ts
 * case "does NOT append credits/end card when every clip is skipped"),
 * so it renders and returns a video containing nothing but a blank date
 * card. Before this fix, runJob uploaded that as the finished montage and
 * marked the row 'ready' with clip_count: 0 — a "successful" day with zero
 * actual footage. It should fail the job instead, the same as the
 * all-clips-failed-to-download case.
 */

const montagesUpdateCalls: Array<Record<string, unknown>> = [];
const uploadMontageFileCalls: string[] = [];
const pushCalls: string[] = [];

mock.module('../../entitlements.js', {
  namedExports: {
    getEntitlement: async () => 'free',
    DAYLINE_END_CARD_REQUIRED_FOR_FREE: true,
  },
});

mock.module('../../pushNotifications.js', {
  namedExports: {
    sendMontageReadyPush: async (userId: string) => {
      pushCalls.push(userId);
    },
    sendGroupMontageReadyPush: async (groupId: string) => {
      pushCalls.push(groupId);
    },
  },
});

mock.module('../../supabaseAdmin.js', {
  namedExports: {
    supabaseAdmin: {
      from: (_table: string) => ({
        update: (fields: Record<string, unknown>) => ({
          eq: async (_col: string, _val: string) => {
            montagesUpdateCalls.push(fields);
            return { data: null, error: null };
          },
        }),
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => ({ error: null }),
        select: () => ({ in: async () => ({ data: [] }) }),
      }),
    },
  },
});

mock.module('../fetchEligibleClips.js', {
  namedExports: {
    fetchEligibleClips: async () => [
      { id: 'clip-1', storagePath: 'clips/user-1/clip-1.mp4', capturedAt: new Date().toISOString(), contributorId: 'user-1' },
    ],
  },
});

mock.module('../downloadClip.js', {
  namedExports: {
    downloadClipToFile: async () => {},
    uploadMontageFile: async (storagePath: string) => {
      uploadMontageFileCalls.push(storagePath);
    },
  },
});

mock.module('../pipeline.js', {
  namedExports: {
    // Simulates every clip failing to normalize: renderMontage still
    // "succeeds" (it doesn't throw), but renderedClipPaths is empty.
    renderMontage: async () => ({
      outputPath: '/tmp/dayline-worker-test-fake-output.mp4',
      durationSeconds: 1.8,
      renderedClipPaths: [],
    }),
  },
});

const { runJob } = await import('../runJob.js');

test('runJob fails the job (not marks it ready) when every clip fails to normalize, even though renderMontage itself succeeds with a title-card-only video', async () => {
  const job: MontageJob = {
    id: 'job-1',
    user_id: 'user-1',
    group_id: null,
    session_date: '2026-09-09',
    kind: 'personal',
    retry_count: 0,
    title_card_text: null,
    requested_by: 'user-1',
  };

  await runJob(job);

  assert.equal(uploadMontageFileCalls.length, 0, 'must not upload a title-card-only video as the finished montage');
  assert.equal(pushCalls.length, 0, 'must not send a "your day is ready" push for a montage with no real clips');

  assert.equal(montagesUpdateCalls.length, 1);
  const update = montagesUpdateCalls[0]!;
  assert.notEqual(update.status, 'ready');
  assert.equal(update.status, 'retrying');
  assert.equal(update.error_code, 'clip_download_failed');
});
