import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runFfmpeg } from '../render/ffmpegExec.js';

/** Generates small synthetic fixture clips (no binaries committed to the
 * repo) for tests: a landscape clip with audio, a portrait silent clip,
 * a deliberately corrupt "clip" (empty file), and one deliberately
 * longer than pipeline.ts's MAX_CLIP_SECONDS cap (for proving a
 * bypassed 5-second recording limit gets trimmed, not rendered in
 * full). */
export async function generateFixtures(dir: string) {
  const landscapeWithAudio = path.join(dir, 'landscape-with-audio.mp4');
  const portraitSilent = path.join(dir, 'portrait-silent.mp4');
  const corrupt = path.join(dir, 'corrupt.mp4');
  const overLong = path.join(dir, 'over-long.mp4');

  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x480:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-shortest',
    landscapeWithAudio,
  ]);

  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1080x1920:rate=30:duration=1.5',
    '-c:v',
    'libx264',
    '-an',
    portraitSilent,
  ]);

  await writeFile(corrupt, Buffer.from('not a real video file'));

  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x480:rate=30:duration=12',
    '-c:v',
    'libx264',
    '-an',
    overLong,
  ]);

  return { landscapeWithAudio, portraitSilent, corrupt, overLong };
}
