import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FfmpegError, runFfmpeg } from '../ffmpegExec.js';

// Proves the fix for docs/IMPLEMENTATION_STATUS.md Phase 53: node:child_process.execFile
// has no default timeout, so a genuinely hung ffmpeg process (corrupt/
// pathological input, a stuck read) previously blocked this worker's
// single-job-at-a-time poll loop forever. A named pipe with no writer is
// a real, deterministic way to make ffmpeg block on its input indefinitely
// — not a mock of a hang, an actual one.

let workDir: string;
let fifoPath: string;

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'dayline-ffmpeg-timeout-test-'));
  fifoPath = path.join(workDir, 'input.fifo');
  execFileSync('mkfifo', [fifoPath]);
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test('runFfmpeg times out (instead of hanging forever) on a genuinely stuck process', async () => {
  const outputPath = path.join(workDir, 'never-produced.mp4');
  const startedAt = Date.now();

  await assert.rejects(
    () => runFfmpeg(['-i', fifoPath, '-t', '1', outputPath], { timeoutMs: 300 }),
    (err: unknown) => {
      assert.ok(err instanceof FfmpegError, 'expected a FfmpegError');
      assert.match((err as FfmpegError).message, /timed out/);
      return true;
    }
  );

  const elapsedMs = Date.now() - startedAt;
  // Generous upper bound for process-kill overhead; the point is this
  // resolves in ~300ms, not that it hangs until some much larger ceiling.
  assert.ok(elapsedMs < 5000, `expected the timeout to fire quickly, took ${elapsedMs}ms`);
});
