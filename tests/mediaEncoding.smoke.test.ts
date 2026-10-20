import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  getMediaToolsStatus,
  resolveFfmpegBinary,
  resolveFfprobeBinary,
} from '../server/mediaTools.ts';
import {
  renderVideo,
  validateRenderedVideo,
  probeMediaFile,
  type ExistingScriptDataInput,
} from '../server/sisyphus-video-engine.ts';

/**
 * Creates a valid 16-bit mono 24 kHz PCM WAV file in memory.
 */
function createSyntheticWavBuffer(durationSeconds: number, sampleRate = 24000): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1 size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24); // Sample rate
  buffer.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  buffer.writeUInt16LE(2, 32); // Block align
  buffer.writeUInt16LE(16, 34); // Bits per sample

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write a gentle 440 Hz test tone with smooth envelope
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples); // Hann window
    const sampleVal = Math.sin(2 * Math.PI * 440 * t) * envelope * 0.4;
    const intVal = Math.floor(sampleVal * 32767);
    buffer.writeInt16LE(intVal, 44 + i * 2);
  }

  return buffer;
}

test('Media tools resolution and availability test', () => {
  const status = getMediaToolsStatus();
  assert.ok(status.ffmpeg.resolvedPath, 'FFmpeg path must be resolved');
  assert.ok(status.ffprobe.resolvedPath, 'FFprobe path must be resolved');

  assert.equal(
    status.allAvailable,
    true,
    `FFmpeg and FFprobe must both be available in the runtime. Diagnostics: ${status.diagnosticMessage}`
  );
  assert.ok(status.ffmpeg.version?.includes('ffmpeg'), 'FFmpeg version string must be valid');
  assert.ok(status.ffprobe.version?.includes('ffprobe'), 'FFprobe version string must be valid');
});

test('Real short MP4 encoding smoke test with FFmpeg, FFprobe and 9:16 validation', async (t) => {
  const status = getMediaToolsStatus();
  if (!status.allAvailable) {
    t.skip(`Skipping smoke test: FFmpeg/FFprobe missing (${status.diagnosticMessage})`);
    return;
  }

  const tmpDir = path.join(os.tmpdir(), `sisyphus-smoke-${Date.now()}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const testAudioPath = path.join(tmpDir, 'smoke_narration.wav');
  const wavBuffer = createSyntheticWavBuffer(2.0, 24000);
  await fsp.writeFile(testAudioPath, wavBuffer);

  const testJob: ExistingScriptDataInput = {
    jobId: 'smoke-test-run',
    topic: 'Paradox Smoke Test',
    title: 'The Paradox of Motion',
    style: 'cyber-brutalist-pink',
    duration: 2.0,
    narration: 'Stop scrolling. What if motion itself is an illusion? Consider the arrow paradox.',
    scenes: [
      {
        id: 'scene-smoke-1',
        title: 'Arrow in Flight',
        narration: 'Stop scrolling. What if motion itself is an illusion?',
        visualDescription: 'Kinetic arrow frozen in temporal slice',
        archetype: 'hero-metaphor',
        startTime: 0.0,
        endTime: 1.0,
        duration: 1.0,
        keywords: ['ARROW', 'ILLUSION', 'TIME'],
      },
      {
        id: 'scene-smoke-2',
        title: 'Temporal Paradox',
        narration: 'Consider the arrow paradox.',
        visualDescription: 'Divided time segments in discrete sequence',
        archetype: 'chronological-timeline',
        startTime: 1.0,
        endTime: 2.0,
        duration: 1.0,
        keywords: ['DISCRETE', 'QUANTUM', 'SPACE'],
      },
    ],
  };

  try {
    const renderResult = await renderVideo({
      job: testJob,
      narrationAudioPath: testAudioPath,
      outputDir: tmpDir,
      outputFileBasename: 'smoke-output',
      visualStyle: 'cyber-brutalist-pink',
      ffmpegBinary: resolveFfmpegBinary(),
      ffprobeBinary: resolveFfprobeBinary(),
    });

    // 1. Verify files exist and have non-zero size
    assert.ok(fs.existsSync(renderResult.videoPath), 'Rendered MP4 file must exist');
    assert.ok(fs.existsSync(renderResult.thumbnailPath), 'Thumbnail file must exist');

    const videoStat = fs.statSync(renderResult.videoPath);
    const thumbStat = fs.statSync(renderResult.thumbnailPath);

    assert.ok(videoStat.size > 20000, `Video size (${videoStat.size} bytes) should be substantial`);
    assert.ok(thumbStat.size > 1000, `Thumbnail size (${thumbStat.size} bytes) should be valid PNG`);

    // 2. Validate with ffprobe
    const probed = await probeMediaFile(renderResult.videoPath, resolveFfprobeBinary());

    assert.equal(probed.hasVideoStream, true, 'Output must have a video stream');
    assert.equal(probed.hasAudioStream, true, 'Output must have an audio stream');
    assert.equal(probed.width, 1080, 'Output video width must be exactly 1080');
    assert.equal(probed.height, 1920, 'Output video height must be exactly 1920');
    assert.equal(probed.videoCodec, 'h264', 'Video codec must be h264');
    assert.equal(probed.audioCodec, 'aac', 'Audio codec must be aac');
    assert.equal(probed.pixelFormat, 'yuv420p', 'Pixel format must be yuv420p for mobile playback');
    assert.ok(probed.fps && Math.abs(probed.fps - 30) <= 1, `FPS (${probed.fps}) must be near 30`);
    assert.ok(probed.durationSeconds > 0 && probed.durationSeconds < 60, `Duration (${probed.durationSeconds}s) must be strictly < 60s`);

    // 3. Engine-level strict validation
    const validated = await validateRenderedVideo(renderResult.videoPath, {
      expectedDurationSeconds: 2.0,
      durationToleranceSeconds: 1.0,
      ffprobeBinary: resolveFfprobeBinary(),
    });
    assert.ok(validated.hasVideoStream, 'Validated metadata confirms video stream');
  } finally {
    // Cleanup temporary files
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
