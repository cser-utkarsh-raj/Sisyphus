import type { Job, PipelineStageId, StageExecution } from '../types/pipeline.ts';

export const PIPELINE_STAGE_DEFINITIONS: {
  id: PipelineStageId;
  name: string;
  description: string;
}[] = [
  { id: 'validate_input', name: 'Input Validation', description: 'Validate topic, prompt, duration limits, and parameters' },
  { id: 'generate_script', name: 'Script & Storyboard', description: 'AI generation of educational script and scene-by-scene plan' },
  { id: 'validate_duration', name: 'Duration & Pacing Check', description: 'Ensure script fits strictly under 60-second limit (20-59s)' },
  { id: 'generate_audio', name: 'Voice Narration', description: 'Synthesize speech track using persistent voice profile' },
  { id: 'align_subtitles', name: 'Karaoke Word Alignment', description: 'Extract accurate word-level timestamps and subtitle lines' },
  { id: 'render_scenes', name: 'Procedural Animation', description: 'Render vector infographics, kinetic charts, and motion elements' },
  { id: 'composite_media', name: 'Compositing & Sound', description: 'Blend narration, dynamic score, visuals, and subtitles' },
  { id: 'encode_mp4', name: 'Encode & Verify MP4', description: 'FFmpeg encoding (9:16, 1080x1920, 30fps) and stream integrity' },
  { id: 'prepare_metadata', name: 'Platform Metadata', description: 'Format title, descriptions, and hashtags for Shorts and Reels' },
  { id: 'publish_platforms', name: 'Social Publishing', description: 'Publish video via official APIs to enabled social accounts' },
  { id: 'record_status', name: 'Archive & Status', description: 'Store platform IDs, URLs, and update execution history' },
];

export function createInitialStages(): Record<PipelineStageId, StageExecution> {
  const stages: Partial<Record<PipelineStageId, StageExecution>> = {};
  for (const def of PIPELINE_STAGE_DEFINITIONS) {
    stages[def.id] = {
      id: def.id,
      name: def.name,
      description: def.description,
      status: 'pending',
      logs: [],
    };
  }
  return stages as Record<PipelineStageId, StageExecution>;
}

/**
 * Checks whether an upstream stage can be retried independently without discarding
 * previously completed upstream artifacts.
 */
export function canRetryStage(
  stages: Record<PipelineStageId, StageExecution>,
  stageId: PipelineStageId
): boolean {
  const index = PIPELINE_STAGE_DEFINITIONS.findIndex((s) => s.id === stageId);
  if (index === -1) return false;

  // The very first stage can always be run
  if (index === 0) return true;

  // Previous stage must have succeeded
  const prevStageDef = PIPELINE_STAGE_DEFINITIONS[index - 1];
  const prevStage = stages[prevStageDef.id];
  return prevStage?.status === 'completed';
}

/**
 * Resets a specific stage and all subsequent stages to pending/running
 * while preserving all successful upstream stage artifacts.
 */
export function resetJobFromStage(job: Job, targetStageId: PipelineStageId): Job {
  const targetIndex = PIPELINE_STAGE_DEFINITIONS.findIndex((s) => s.id === targetStageId);
  if (targetIndex === -1) return job;

  const updatedStages = { ...job.stages };

  for (let i = targetIndex; i < PIPELINE_STAGE_DEFINITIONS.length; i++) {
    const stageId = PIPELINE_STAGE_DEFINITIONS[i].id;
    updatedStages[stageId] = {
      ...updatedStages[stageId],
      status: i === targetIndex ? 'running' : 'pending',
      startedAt: i === targetIndex ? new Date().toISOString() : undefined,
      completedAt: undefined,
      durationMs: undefined,
      error: undefined,
      logs: i === targetIndex ? [`Retrying stage ${stageId}...`] : [],
    };
  }

  return {
    ...job,
    status: 'running',
    currentStage: targetStageId,
    stages: updatedStages,
    error: undefined,
    updatedAt: new Date().toISOString(),
  };
}
