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
 * interpreted as shell syntax. */
export async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(config.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new FfmpegError(`ffmpeg failed: ${err.message}`, err.stderr ?? '');
  }
}

export type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  rotation: number;
};

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(config.ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
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
