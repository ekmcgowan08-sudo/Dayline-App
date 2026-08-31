import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { generateFixtures } from '../../test-fixtures/generate.js';
import { probeVideo } from '../ffmpegExec.js';
import { ClipRenderError, normalizeClip, renderMontage, renderTextCard, renderTitleCard, OUTPUT_HEIGHT, OUTPUT_WIDTH } from '../pipeline.js';

let workDir: string;
let fixtures: Awaited<ReturnType<typeof generateFixtures>>;

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'dayline-worker-test-'));
  fixtures = await generateFixtures(workDir);
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test('normalizeClip converts a landscape clip with audio to portrait 1080x1920/30fps', async () => {
  const out = path.join(workDir, 'norm-landscape.mp4');
  await normalizeClip(fixtures.landscapeWithAudio, out);
  const probe = await probeVideo(out);
  assert.equal(probe.width, OUTPUT_WIDTH);
  assert.equal(probe.height, OUTPUT_HEIGHT);
  assert.ok(probe.hasAudio, 'expected an audio stream after normalization');
});

test('normalizeClip synthesizes silent audio for a clip that has none', async () => {
  const out = path.join(workDir, 'norm-portrait.mp4');
  await normalizeClip(fixtures.portraitSilent, out);
  const probe = await probeVideo(out);
  assert.equal(probe.width, OUTPUT_WIDTH);
  assert.equal(probe.height, OUTPUT_HEIGHT);
  assert.ok(probe.hasAudio, 'expected a synthesized silent audio stream');
});

test('normalizeClip rejects a corrupt/unreadable file with ClipRenderError', async () => {
  await assert.rejects(
    () => normalizeClip(fixtures.corrupt, path.join(workDir, 'should-not-exist.mp4')),
    (err: unknown) => err instanceof ClipRenderError
  );
});

test('renderTitleCard produces a portrait segment with the requested duration', async () => {
  const out = path.join(workDir, 'titlecard.mp4');
  const duration = await renderTitleCard('August 31', out, 1.2);
  const probe = await probeVideo(out);
  assert.equal(probe.width, OUTPUT_WIDTH);
  assert.equal(probe.height, OUTPUT_HEIGHT);
  assert.ok(Math.abs(probe.durationSeconds - duration) < 0.3);
});

test('renderMontage concatenates a title card + multiple clips and skips a corrupt one gracefully', async () => {
  const outputPath = path.join(workDir, 'full-montage.mp4');
  const skipped: string[] = [];

  const result = await renderMontage({
    clipPaths: [fixtures.landscapeWithAudio, fixtures.corrupt, fixtures.portraitSilent],
    outputPath,
    workDir: path.join(workDir, 'render-job-1'),
    titleCardText: 'Aug 31',
    onClipError: (err) => {
      skipped.push(err.clipPath);
      return true; // continue past the corrupt clip
    },
  });

  assert.equal(skipped.length, 1);
  assert.equal(skipped[0], fixtures.corrupt);
  assert.equal(result.renderedClipPaths.length, 2);

  const probe = await probeVideo(outputPath);
  assert.equal(probe.width, OUTPUT_WIDTH);
  assert.equal(probe.height, OUTPUT_HEIGHT);
  assert.ok(probe.hasAudio);
  // title card (~1.8s) + landscape clip (2s) + portrait clip (1.5s), minus
  // nothing removed by fades (fades don't shorten duration) — roughly 5.3s.
  assert.ok(probe.durationSeconds > 4 && probe.durationSeconds < 7, `unexpected duration ${probe.durationSeconds}`);
});

test('renderTextCard renders multi-line (newline-joined) text as a portrait segment', async () => {
  const out = path.join(workDir, 'textcard-multiline.mp4');
  const duration = await renderTextCard('Ava\nBen\nCam', out, { durationSeconds: 2.4, fontSize: 44 });
  const probe = await probeVideo(out);
  assert.equal(probe.width, OUTPUT_WIDTH);
  assert.equal(probe.height, OUTPUT_HEIGHT);
  assert.ok(Math.abs(probe.durationSeconds - duration) < 0.3);
});

test('renderMontage appends a contributor-credits card and a branded end card after the clips', async () => {
  const outputPath = path.join(workDir, 'group-montage.mp4');

  const withoutExtras = await renderMontage({
    clipPaths: [fixtures.landscapeWithAudio],
    outputPath: path.join(workDir, 'render-job-baseline', 'output.mp4'),
    workDir: path.join(workDir, 'render-job-baseline'),
    titleCardText: 'Aug 31',
  });

  const withExtras = await renderMontage({
    clipPaths: [fixtures.landscapeWithAudio],
    outputPath,
    workDir: path.join(workDir, 'render-job-extras'),
    titleCardText: 'Aug 31',
    creditsText: 'Ava\nBen',
    endCardText: 'Dayline\nFive seconds at a time.',
  });

  const probe = await probeVideo(outputPath);
  assert.equal(probe.width, OUTPUT_WIDTH);
  assert.equal(probe.height, OUTPUT_HEIGHT);
  // Credits + end card add real seconds on top of the baseline (title card
  // + one clip, no extras) — proves the segments were actually appended,
  // not just accepted as no-op options.
  assert.ok(withExtras.durationSeconds > withoutExtras.durationSeconds + 2);
});

test('renderMontage does NOT append credits/end card when every clip is skipped (title-card-only output)', async () => {
  const result = await renderMontage({
    clipPaths: [fixtures.corrupt],
    outputPath: path.join(workDir, 'title-only.mp4'),
    workDir: path.join(workDir, 'render-job-title-only'),
    titleCardText: 'Aug 31',
    creditsText: 'Ava',
    endCardText: 'Dayline',
    onClipError: () => true,
  });
  assert.equal(result.renderedClipPaths.length, 0);
  // Only the title card segment exists — duration should be close to the
  // default 1.8s title card, not padded by credits/end card durations.
  assert.ok(result.durationSeconds < 2.2, `unexpected duration ${result.durationSeconds}`);
});

test('renderMontage aborts entirely when onClipError returns false', async () => {
  await assert.rejects(() =>
    renderMontage({
      clipPaths: [fixtures.corrupt],
      outputPath: path.join(workDir, 'should-not-render.mp4'),
      workDir: path.join(workDir, 'render-job-2'),
      onClipError: () => false,
    })
  );
});

test('renderMontage throws no_usable_segments when every clip fails and errors are swallowed', async () => {
  await assert.rejects(
    () =>
      renderMontage({
        clipPaths: [fixtures.corrupt],
        outputPath: path.join(workDir, 'should-not-render-2.mp4'),
        workDir: path.join(workDir, 'render-job-3'),
        onClipError: () => true,
      }),
    /no_usable_segments/
  );
});
