import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface MediaToolInfo {
  configuredPath: string;
  resolvedPath: string;
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface MediaToolsStatus {
  ffmpeg: MediaToolInfo;
  ffprobe: MediaToolInfo;
  allAvailable: boolean;
  operational: boolean;
  diagnosticMessage: string;
}

const CANDIDATE_FFMPEG_PATHS = [
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  'ffmpeg',
];

const CANDIDATE_FFPROBE_PATHS = [
  '/usr/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/opt/homebrew/bin/ffprobe',
  'ffprobe',
];

/**
 * Resolves the executable path for FFmpeg.
 * Priority:
 *  1. Process environment variable FFMPEG_PATH (if set)
 *  2. Known standard system executable paths if they exist
 *  3. Default 'ffmpeg' on system PATH
 */
export function resolveFfmpegBinary(): string {
  const envPath = process.env.FFMPEG_PATH?.trim();
  if (envPath) {
    return envPath;
  }

  for (const candidate of CANDIDATE_FFMPEG_PATHS) {
    if (candidate.startsWith('/') && fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue searching
      }
    }
  }

  return 'ffmpeg';
}

/**
 * Resolves the executable path for FFprobe.
 * Priority:
 *  1. Process environment variable FFPROBE_PATH (if set)
 *  2. Known standard system executable paths if they exist
 *  3. Default 'ffprobe' on system PATH
 */
export function resolveFfprobeBinary(): string {
  const envPath = process.env.FFPROBE_PATH?.trim();
  if (envPath) {
    return envPath;
  }

  for (const candidate of CANDIDATE_FFPROBE_PATHS) {
    if (candidate.startsWith('/') && fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue searching
      }
    }
  }

  return 'ffprobe';
}

/**
 * Probes an executable binary to verify availability and version info.
 */
function probeBinary(binPath: string): { available: boolean; version: string | null; error: string | null } {
  try {
    const res = spawnSync(binPath, ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });

    if (res.error) {
      return {
        available: false,
        version: null,
        error: res.error.message,
      };
    }

    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split(/\r?\n/, 1)[0]?.trim() || null;
      return {
        available: true,
        version: firstLine,
        error: null,
      };
    }

    return {
      available: false,
      version: null,
      error: res.stderr ? res.stderr.split(/\r?\n/, 1)[0]?.trim() : `Exited with status ${res.status}`,
    };
  } catch (err) {
    return {
      available: false,
      version: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Returns comprehensive media-tools diagnostics for runtime health checks and pre-flight validation.
 */
export function getMediaToolsStatus(): MediaToolsStatus {
  const ffmpegConfigured = process.env.FFMPEG_PATH?.trim() || 'default (ffmpeg)';
  const ffprobeConfigured = process.env.FFPROBE_PATH?.trim() || 'default (ffprobe)';

  const ffmpegResolved = resolveFfmpegBinary();
  const ffprobeResolved = resolveFfprobeBinary();

  const ffmpegProbe = probeBinary(ffmpegResolved);
  const ffprobeProbe = probeBinary(ffprobeResolved);

  const allAvailable = ffmpegProbe.available && ffprobeProbe.available;

  let diagnosticMessage = 'Media processing tools are ready and operational.';
  if (!allAvailable) {
    const missing: string[] = [];
    if (!ffmpegProbe.available) missing.push(`FFmpeg [${ffmpegResolved}] (${ffmpegProbe.error ?? 'not found'})`);
    if (!ffprobeProbe.available) missing.push(`FFprobe [${ffprobeResolved}] (${ffprobeProbe.error ?? 'not found'})`);
    diagnosticMessage = `Media binaries unavailable: ${missing.join('; ')}. Ensure FFmpeg is installed in the container or set FFMPEG_PATH/FFPROBE_PATH.`;
  }

  return {
    ffmpeg: {
      configuredPath: ffmpegConfigured,
      resolvedPath: ffmpegResolved,
      available: ffmpegProbe.available,
      version: ffmpegProbe.version,
      error: ffmpegProbe.error,
    },
    ffprobe: {
      configuredPath: ffprobeConfigured,
      resolvedPath: ffprobeResolved,
      available: ffprobeProbe.available,
      version: ffprobeProbe.version,
      error: ffprobeProbe.error,
    },
    allAvailable,
    operational: allAvailable,
    diagnosticMessage,
  };
}

/**
 * Asserts that both FFmpeg and FFprobe are available.
 * Throws an actionable error if either is missing, detailing the exact fix required.
 */
export function assertMediaToolsAvailable(): void {
  const status = getMediaToolsStatus();
  if (!status.allAvailable) {
    const details = [
      `Media rendering engine prerequisite check failed:`,
      `• FFmpeg: ${status.ffmpeg.available ? 'AVAILABLE (' + status.ffmpeg.version + ')' : 'MISSING at "' + status.ffmpeg.resolvedPath + '" - ' + (status.ffmpeg.error || 'not executable')}`,
      `• FFprobe: ${status.ffprobe.available ? 'AVAILABLE (' + status.ffprobe.version + ')' : 'MISSING at "' + status.ffprobe.resolvedPath + '" - ' + (status.ffprobe.error || 'not executable')}`,
      ``,
      `How to fix:`,
      `1. If running in a container: ensure "ffmpeg" and "ffprobe" are installed via your system package manager (e.g. apt-get update && apt-get install -y ffmpeg) using the repository Dockerfile.`,
      `2. If binaries are installed in a non-standard location: set the FFMPEG_PATH and FFPROBE_PATH environment variables pointing directly to the executables.`,
      `3. Verify via GET /api/health before dispatching video generation jobs.`,
    ].join('\n');

    throw new Error(details);
  }
}
