import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { FfmpegError, probeVideo, runFfmpeg } from './ffmpegExec.js';

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920; // portrait-first 9:16, per the product spec
export const OUTPUT_FPS = 30;
const FADE_SECONDS = 0.3;

export class ClipRenderError extends Error {
  constructor(
    message: string,
    public readonly clipPath: string
  ) {
    super(message);
    this.name = 'ClipRenderError';
  }
}

/**
 * Normalizes one source clip to the montage's common format: portrait
 * 1080x1920, 30fps, h264/yuv420p video, aac/44.1kHz/stereo audio (a silent
 * track is synthesized if the source has none, so every normalized
 * segment has an identical stream layout), with a short fade in/out.
 * ffmpeg auto-applies any rotation metadata on decode, so re-encoding here
 * also normalizes orientation for clips recorded in different rotations.
 * Returns the segment's final duration in seconds.
 */
export async function normalizeClip(inputPath: string, outputPath: string): Promise<number> {
  let probe;
  try {
    probe = await probeVideo(inputPath);
  } catch (e) {
    throw new ClipRenderError(`could not read clip (missing or corrupt): ${(e as Error).message}`, inputPath);
  }
  if (probe.durationSeconds <= 0 || probe.width <= 0 || probe.height <= 0) {
    throw new ClipRenderError('clip has no usable video stream', inputPath);
  }

  const duration = probe.durationSeconds;
  const fadeOutStart = Math.max(0, duration - FADE_SECONDS);

  const vf = [
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
    `fps=${OUTPUT_FPS}`,
    'format=yuv420p',
    'setsar=1',
    `fade=t=in:st=0:d=${FADE_SECONDS}`,
    `fade=t=out:st=${fadeOutStart}:d=${FADE_SECONDS}`,
  ].join(',');
  const af = `afade=t=in:st=0:d=${FADE_SECONDS},afade=t=out:st=${fadeOutStart}:d=${FADE_SECONDS}`;

  const args = ['-i', inputPath];
  if (!probe.hasAudio) {
    args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }
  args.push(
    '-vf',
    vf,
    '-af',
    af,
    '-map',
    '0:v:0',
    '-map',
    probe.hasAudio ? '0:a:0' : '1:a:0',
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-shortest',
    outputPath
  );

  try {
    await runFfmpeg(args);
  } catch (e) {
    if (e instanceof FfmpegError) throw new ClipRenderError(`normalization failed: ${e.message}`, inputPath);
    throw e;
  }
  return duration;
}

/** Renders a simple date/title card as its own segment, using the same
 * output format as normalized clips so it can be concatenated seamlessly. */
export async function renderTitleCard(text: string, outputPath: string, durationSeconds = 1.8): Promise<number> {
  const escaped = text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const fadeOutStart = Math.max(0, durationSeconds - FADE_SECONDS);

  const args = [
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:r=${OUTPUT_FPS}:d=${durationSeconds}`,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t',
    String(durationSeconds),
    '-vf',
    [
      `drawtext=fontfile=${config.titleCardFontPath}:text='${escaped}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2`,
      `fade=t=in:st=0:d=${FADE_SECONDS}`,
      `fade=t=out:st=${fadeOutStart}:d=${FADE_SECONDS}`,
      'format=yuv420p',
    ].join(','),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-ac',
    '2',
    outputPath,
  ];
  await runFfmpeg(args);
  return durationSeconds;
}

/** Concatenates already-normalized (identical format) segments via the
 * concat demuxer with stream copy — fast and lossless since every segment
 * shares the same codec parameters by construction. */
export async function concatSegments(segmentPaths: string[], outputPath: string, workDir: string): Promise<void> {
  const listPath = path.join(workDir, 'concat-list.txt');
  const listContents = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listPath, listContents, 'utf8');
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
}

export type RenderResult = { outputPath: string; durationSeconds: number; renderedClipPaths: string[] };

export type RenderOptions = {
  /** Absolute local paths to already-downloaded source clips, in the final
   * playback order (see docs/DECISIONS.md for the ordering rule: captured_at
   * ascending for personal montages, contribution order for group ones). */
  clipPaths: string[];
  outputPath: string;
  workDir: string;
  titleCardText?: string;
  /** Called for each clip that fails to normalize; returning true skips it
   * and continues, false aborts the whole render. This is how "graceful
   * handling of missing or corrupt clips" is implemented — one bad clip
   * doesn't sink an otherwise-good day. */
  onClipError?: (error: ClipRenderError) => boolean;
};

export async function renderMontage(options: RenderOptions): Promise<RenderResult> {
  await mkdir(options.workDir, { recursive: true });
  const segmentPaths: string[] = [];
  const renderedClipPaths: string[] = [];
  let totalDuration = 0;

  if (options.titleCardText) {
    const titleCardPath = path.join(options.workDir, 'segment-titlecard.mp4');
    const d = await renderTitleCard(options.titleCardText, titleCardPath);
    segmentPaths.push(titleCardPath);
    totalDuration += d;
  }

  for (let i = 0; i < options.clipPaths.length; i++) {
    const clipPath = options.clipPaths[i];
    const segmentPath = path.join(options.workDir, `segment-${i}.mp4`);
    try {
      const d = await normalizeClip(clipPath, segmentPath);
      segmentPaths.push(segmentPath);
      renderedClipPaths.push(clipPath);
      totalDuration += d;
    } catch (e) {
      const clipError = e instanceof ClipRenderError ? e : new ClipRenderError(String(e), clipPath);
      logger.warn('clip failed to normalize; skipping', { clip: i, error: clipError.message });
      const shouldContinue = options.onClipError ? options.onClipError(clipError) : true;
      if (!shouldContinue) throw clipError;
    }
  }

  if (segmentPaths.length === 0) {
    throw new Error('no_usable_segments');
  }

  await concatSegments(segmentPaths, options.outputPath, options.workDir);
  return { outputPath: options.outputPath, durationSeconds: totalDuration, renderedClipPaths };
}
