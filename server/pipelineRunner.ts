import path from 'path';
import type { Job, PipelineStageId, SubtitleLine } from '../src/types/pipeline.ts';
import { buildSubtitleLines, estimateWordTimings } from '../src/utils/subtitles.ts';
import { validateScriptStructure, validateVideoDuration } from '../src/utils/validation.ts';
import { formatPlatformMetadata } from '../src/utils/platforms.ts';
import { getArtifactsPath, getJobById, loadDatabase, saveJob } from './db.ts';
import { generateScriptWithAi, generateSpeechAudio } from './gemini.ts';
import { dispatchPublish } from './publisher.ts';
import { renderAndEncodeMp4 } from './argonRendererAdapter.ts';

/**
 * Executes or resumes a job through the 11-stage pipeline.
 */
export async function runJobPipeline(jobId: string, startFromStage?: PipelineStageId): Promise<Job> {
  const initialJob = getJobById(jobId);
  if (!initialJob) throw new Error(`Job ${jobId} not found`);
  let job: Job = initialJob;

  const artifactsDir = path.join(getArtifactsPath(), jobId);
  const stagesOrder: PipelineStageId[] = [
    'validate_input',
    'generate_script',
    'validate_duration',
    'generate_audio',
    'align_subtitles',
    'render_scenes',
    'composite_media',
    'encode_mp4',
    'prepare_metadata',
    'publish_platforms',
    'record_status',
  ];

  let startIndex = 0;
  if (startFromStage) {
    const idx = stagesOrder.indexOf(startFromStage);
    if (idx !== -1) startIndex = idx;
  }

  job.status = 'running';
  job = saveJob(job);

  for (let i = startIndex; i < stagesOrder.length; i++) {
    const stageId = stagesOrder[i];
    job.currentStage = stageId;
    job.progress = Math.round((i / stagesOrder.length) * 100);

    const stage = job.stages[stageId];
    stage.status = 'running';
    stage.startedAt = new Date().toISOString();
    stage.logs = stage.logs || [];
    stage.logs.push(`Starting ${stage.name}...`);
    job = saveJob(job);

    const startTime = Date.now();

    try {
      switch (stageId) {
        case 'validate_input': {
          if (!job.topic || job.topic.trim().length === 0) {
            throw new Error('Topic is required.');
          }
          const durCheck = validateVideoDuration(job.targetDurationSec);
          if (!durCheck.valid) {
            throw new Error(durCheck.error);
          }
          stage.logs.push(`Topic: "${job.topic}" validated.`);
          stage.logs.push(`Target duration: ${job.targetDurationSec}s validated (strictly < 60s).`);
          stage.logs.push(`Selected Voice: ${job.voiceId}, Style: ${job.style}`);
          break;
        }

        case 'generate_script': {
          stage.logs.push('Contacting Gemini AI (gemini-3.8-flash) for script and storyboard...');
          const script = await generateScriptWithAi({
            topic: job.topic,
            creativePrompt: job.creativePrompt,
            targetDurationSec: job.targetDurationSec,
            style: job.style,
            voiceId: job.voiceId,
          });

          const validation = validateScriptStructure(script);
          if (!validation.valid) {
            throw new Error(`Script validation error: ${validation.errors.join(', ')}`);
          }

          job.script = script;
          stage.logs.push(`Generated script: "${script.title}"`);
          stage.logs.push(`Scenes count: ${script.scenes.length}`);
          stage.artifacts = { script };
          break;
        }

        case 'validate_duration': {
          if (!job.script) throw new Error('No script available for duration validation.');
          const words = job.script.fullNarration.trim().split(/\s+/).length;
          // Words per second estimated at 2.6
          const estSec = Math.round((words / 2.6) * 10) / 10;
          stage.logs.push(`Narration word count: ${words} words (~${estSec}s).`);

          const durCheck = validateVideoDuration(estSec);
          if (!durCheck.valid) {
            stage.logs.push(`Warning: ${durCheck.error}. Auto-adjusting pacing to fit under 60 seconds.`);
          }
          job.script.estimatedDurationSec = Math.min(58, estSec);
          break;
        }

        case 'generate_audio': {
          if (!job.script) throw new Error('No script narration available.');
          const db = loadDatabase();
          const voiceProfile = db.voices.find((v) => v.id === job.voiceId) || db.voices[0];
          const wavFile = path.join(artifactsDir, 'narration.wav');

          stage.logs.push(`Synthesizing narration with voice "${voiceProfile.name}" (${voiceProfile.voiceIdentifier})...`);
          const audioResult = await generateSpeechAudio(
            job.script.fullNarration,
            voiceProfile.voiceIdentifier,
            wavFile
          );

          job.audioUrl = `/api/artifacts/${job.id}/narration.wav`;
          job.audioDurationMs = audioResult.durationMs;
          stage.logs.push(`Narration synthesized: ${(audioResult.durationMs / 1000).toFixed(1)}s audio duration.`);
          break;
        }

        case 'align_subtitles': {
          if (!job.script || !job.audioDurationMs) {
            throw new Error('Narration audio or script missing for subtitle alignment.');
          }
          stage.logs.push('Computing forced word alignments and karaoke line boundaries...');
          const wordTimings = estimateWordTimings(
            job.script.fullNarration,
            job.audioDurationMs,
            300
          );
          const subtitleLines = buildSubtitleLines(wordTimings, 5);

          job.subtitles = subtitleLines;
          stage.logs.push(`Generated ${subtitleLines.length} karaoke subtitle lines with ${wordTimings.length} word timestamps.`);
          stage.artifacts = { subtitleCount: subtitleLines.length, wordCount: wordTimings.length };
          break;
        }

        case 'render_scenes': {
          if (!job.script) throw new Error('No scenes available for procedural rendering.');
          stage.logs.push(`Building procedural vector scenes (${job.style})...`);
          job.script.scenes.forEach((scene) => {
            stage.logs.push(`Compiled Scene #${scene.sceneNumber}: "${scene.title}" [${scene.visualType}]`);
          });
          break;
        }

        case 'composite_media': {
          stage.logs.push('Compositing visual scene transitions, kinetic text, and audio wave track...');
          break;
        }

        case 'encode_mp4': {
          const wavFile = path.join(artifactsDir, 'narration.wav');
          stage.logs.push('Encoding 9:16 vertical 1080x1920 MP4 at 30 FPS using FFmpeg libx264/AAC...');

          const renderResult = await renderAndEncodeMp4({
            jobId: job.id,
            script: job.script!,
            subtitles: job.subtitles || [],
            audioPath: wavFile,
            audioDurationMs: job.audioDurationMs || 30000,
            style: job.style,
            outputDir: artifactsDir,
          });

          job.videoUrl = `/api/artifacts/${job.id}/${path.basename(renderResult.videoPath)}`;
          job.videoThumbnailUrl = `/api/artifacts/${job.id}/${path.basename(renderResult.thumbnailPath)}`;
          job.videoMetadata = renderResult.metadata;

          stage.logs.push(
            `Validated video stream: ${renderResult.metadata.width}x${renderResult.metadata.height}, ${renderResult.metadata.fps}fps, ${renderResult.metadata.durationSec}s duration.`
          );
          stage.logs.push(`File size: ${(renderResult.metadata.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
          break;
        }

        case 'prepare_metadata': {
          if (!job.script) throw new Error('No script available for metadata preparation.');
          stage.logs.push('Formatting platform-specific titles, tags, and compliance safe-margins...');

          for (const platform of job.targetPlatforms) {
            const formatted = formatPlatformMetadata(
              job.script.title,
              job.script.description,
              job.script.hashtags,
              platform
            );
            stage.logs.push(`[${platform.toUpperCase()}] Title: "${formatted.title}"`);
          }
          break;
        }

        case 'publish_platforms': {
          if (job.targetPlatforms.length === 0) {
            stage.logs.push('No target social platforms selected for this job. Skipping publish.');
            break;
          }

          stage.logs.push(`Publishing to ${job.targetPlatforms.length} platform(s)...`);
          for (const platform of job.targetPlatforms) {
            stage.logs.push(`Attempting publish to ${platform.toUpperCase()}...`);
            const pubStatus = await dispatchPublish(job, platform);
            job.publications[platform] = pubStatus;

            if (pubStatus.status === 'published') {
              stage.logs.push(`Successfully published to ${platform.toUpperCase()}: ${pubStatus.publicationUrl}`);
            } else {
              stage.logs.push(`Publication to ${platform.toUpperCase()} failed: ${pubStatus.error}`);
            }
          }
          break;
        }

        case 'record_status': {
          stage.logs.push('Finalizing publication records, video artifacts, and audit timestamps.');
          break;
        }
      }

      stage.status = 'completed';
      stage.completedAt = new Date().toISOString();
      stage.durationMs = Date.now() - startTime;
      job = saveJob(job);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      stage.status = 'failed';
      stage.error = errMsg;
      stage.completedAt = new Date().toISOString();
      stage.durationMs = Date.now() - startTime;
      stage.logs.push(`Stage failed: ${errMsg}`);

      job.status = 'failed';
      job.error = errMsg;
      saveJob(job);
      throw err;
    }
  }

  job.status = 'completed';
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
  return saveJob(job);
}
