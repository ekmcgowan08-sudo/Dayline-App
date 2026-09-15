import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

export class FfmpegError extends Error {
  constructor(
    message: string,
    public readonly stderr: string
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

/** Runs ffmpeg with the given args, resolving on exit code 0. Never uses a
 * shell (execFile, not exec) — args are passed as an array, so clip file
 * paths (which include user-controlled-ish content like a UUID we
 * generate ourselves, but defense in depth costs nothing) can never be
 * interpreted as shell syntax.
 *
 * Always runs under a timeout (see config.ffmpegTimeoutMs) — execFile has
 * no default one, so without this a hung process would block the
 * worker's single-job poll loop forever. `timeoutMs` is only ever
 * overridden by tests; production call sites use the configured default.
 *
 * killSignal is deliberately SIGKILL, not execFile's own SIGTERM default:
 * proved empirically (see ffmpegExec.test.ts, a real ffmpeg blocked on a
 * named pipe with no writer) that ffmpeg does NOT die on SIGTERM while
 * stuck opening an input that never produces data — it installs its own
 * SIGTERM handler meant for a graceful stop mid-encode, which a process
 * still blocked in that low-level open()/read() never reaches. SIGTERM
 * alone would have left this "fix" just as capable of hanging forever as
 * having no timeout at all. */
export async function runFfmpeg(args: string[], options: { timeoutMs?: number } = {}): Promise<void> {
  try {
    await execFileAsync(config.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      maxBuffer: 1024 * 1024 * 32,
      timeout: options.timeoutMs ?? config.ffmpegTimeoutMs,
      killSignal: 'SIGKILL',
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string; killed?: boolean; signal?: string | null };
    const timedOut = Boolean(err.killed && err.signal === 'SIGKILL');
    throw new FfmpegError(`ffmpeg failed${timedOut ? ' (timed out)' : ''}: ${err.message}`, err.stderr ?? '');
  }
}

export type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  rotation: number;
};

export async function probeVideo(filePath: string, options: { timeoutMs?: number } = {}): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    config.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 1024 * 1024, timeout: options.timeoutMs ?? config.ffmpegTimeoutMs, killSignal: 'SIGKILL' }
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      tags?: Record<string, string>;
      side_data_list?: Array<{ rotation?: number }>;
    }>;
  };
  const videoStream = data.streams.find((s) => s.codec_type === 'video');
  const audioStream = data.streams.find((s) => s.codec_type === 'audio');
  if (!videoStream) throw new Error('no video stream found');

  const rotateTag = videoStream.tags?.rotate;
  const rotationFromSideData = videoStream.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation;
  const rotation = rotationFromSideData ?? (rotateTag ? Number(rotateTag) : 0);

  return {
    durationSeconds: Number(data.format?.duration ?? 0),
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    hasAudio: Boolean(audioStream),
    rotation,
  };
}
