import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialStages,
  canRetryStage,
  resetJobFromStage,
  PIPELINE_STAGE_DEFINITIONS,
} from '../src/utils/pipelineSteps.ts';
import type { Job } from '../src/types/pipeline.ts';

test('createInitialStages creates exactly 11 pending stages', () => {
  const stages = createInitialStages();
  assert.equal(Object.keys(stages).length, 11);
  assert.equal(stages.validate_input.status, 'pending');
  assert.equal(stages.publish_platforms.status, 'pending');
});

test('canRetryStage checks upstream prerequisite completion', () => {
  const stages = createInitialStages();

  // First stage can always run
  assert.equal(canRetryStage(stages, 'validate_input'), true);

  // Second stage cannot run if first is pending
  assert.equal(canRetryStage(stages, 'generate_script'), false);

  // Complete first stage
  stages.validate_input.status = 'completed';
  assert.equal(canRetryStage(stages, 'generate_script'), true);
});

test('resetJobFromStage isolates retry and preserves upstream artifacts', () => {
  const stages = createInitialStages();
  stages.validate_input.status = 'completed';
  stages.generate_script.status = 'completed';
  stages.validate_duration.status = 'completed';
  stages.generate_audio.status = 'completed';
  stages.align_subtitles.status = 'failed';

  const mockJob: Job = {
    id: 'job-test-1',
    topic: 'Existential Paradox',
    style: 'cyber_brutalist_pink',
    targetDurationSec: 35,
    voiceId: 'zephyr',
    targetPlatforms: ['youtube', 'instagram'],
    status: 'failed',
    currentStage: 'align_subtitles',
    progress: 40,
    stages,
    publications: {
      youtube: { platform: 'youtube', status: 'pending', retryCount: 0 },
      instagram: { platform: 'instagram', status: 'pending', retryCount: 0 },
      facebook: { platform: 'facebook', status: 'not_selected', retryCount: 0 },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const reset = resetJobFromStage(mockJob, 'align_subtitles');

  // Upstream stages MUST remain completed
  assert.equal(reset.stages.validate_input.status, 'completed');
  assert.equal(reset.stages.generate_script.status, 'completed');
  assert.equal(reset.stages.generate_audio.status, 'completed');

  // Target stage must now be running
  assert.equal(reset.stages.align_subtitles.status, 'running');

  // Downstream stages must be reset to pending
  assert.equal(reset.stages.render_scenes.status, 'pending');
  assert.equal(reset.stages.encode_mp4.status, 'pending');
});
