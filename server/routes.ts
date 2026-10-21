import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { AppSettings, ConnectionConfig, PipelineStageId, VoiceId } from '../src/types/pipeline.ts';
import { createInitialPlatformStatuses } from '../src/utils/platforms.ts';
import { createInitialStages, resetJobFromStage } from '../src/utils/pipelineSteps.ts';
import { getArtifactsPath, getJobById, getJobs, loadDatabase, saveDatabase, saveJob } from './db.ts';
import { generateSpeechAudio } from './gemini.ts';
import { runJobPipeline } from './pipelineRunner.ts';
import { dispatchPublish } from './publisher.ts';

export const apiRouter = Router();

// ==================== VOICES API ====================

// GET all 4 voice profiles & current default
apiRouter.get('/voices', (_req, res) => {
  const db = loadDatabase();
  res.json({
    voices: db.voices,
    defaultVoiceId: db.settings.defaultVoiceId,
  });
});

// POST update default voice
apiRouter.post('/voices/default', (req, res) => {
  const { voiceId } = req.body as { voiceId: VoiceId };
  const db = loadDatabase();
  const exists = db.voices.find((v) => v.id === voiceId);

  if (!exists) {
    res.status(400).json({ error: `Invalid voice ID: ${voiceId}. Must be one of: zephyr, puck, kore, fenrir.` });
    return;
  }

  db.settings.defaultVoiceId = voiceId;
  saveDatabase(db);

  res.json({
    success: true,
    defaultVoiceId: voiceId,
    message: `Default voice set to ${exists.name} (${exists.voiceIdentifier}).`,
  });
});

// GET or synthesize preview audio clip for a voice
apiRouter.get('/voices/:id/sample', async (req, res) => {
  const voiceId = req.params.id as VoiceId;
  const customText = (req.query.text as string) || '';
  const db = loadDatabase();
  const voice = db.voices.find((v) => v.id === voiceId);

  if (!voice) {
    res.status(404).json({ error: 'Voice not found' });
    return;
  }

  const sampleText = customText.trim() || voice.sampleText;
  const samplesDir = path.join(getArtifactsPath(), 'voice_samples');
  if (!fs.existsSync(samplesDir)) fs.mkdirSync(samplesDir, { recursive: true });

  const safeHash = Buffer.from(sampleText).toString('base64url').substring(0, 16);
  const sampleFilePath = path.join(samplesDir, `${voice.id}_${safeHash}.wav`);

  if (!fs.existsSync(sampleFilePath)) {
    try {
      await generateSpeechAudio(sampleText, voice.voiceIdentifier, sampleFilePath);
    } catch (err) {
      console.error(`Voice sample synthesis failed for ${voiceId}:`, err);
      res.status(502).json({
        error: 'Voice preview synthesis failed. Check the Gemini API key, quota, and server logs.',
      });
      return;
    }
  }

  res.setHeader('Content-Type', 'audio/wav');
  fs.createReadStream(sampleFilePath).pipe(res);
});

// ==================== SETTINGS API ====================

apiRouter.get('/settings', (_req, res) => {
  const db = loadDatabase();
  res.json(db.settings);
});

apiRouter.put('/settings', (req, res) => {
  const updates = req.body as Partial<AppSettings>;
  const db = loadDatabase();
  db.settings = { ...db.settings, ...updates };
  saveDatabase(db);
  res.json({ success: true, settings: db.settings });
});

// ==================== CONNECTIONS API ====================

apiRouter.get('/connections', (_req, res) => {
  const db = loadDatabase();
  const requiredEnvironment: Record<string, string[]> = {
    youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
    instagram: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ACCOUNT_ID'],
    facebook: ['FACEBOOK_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID'],
  };

  // Derive configuration status from the server's actual environment, not stale or client-written JSON.
  const connections = db.connections.map((conn) => {
    const required = requiredEnvironment[conn.platform] ?? [];
    const configured = required.length > 0 && required.every((name) => Boolean(process.env[name]?.trim()));
    return {
      ...conn,
      connected: configured,
      credentialsConfigured: configured,
      status: configured ? 'CONFIGURED' : 'SETUP_REQUIRED',
      accountName: configured ? conn.accountName : undefined,
      accountId: configured ? conn.accountId : undefined,
    };
  });
  res.json(connections);
});

apiRouter.post('/connections/:platform', (req, res) => {
  const platform = req.params.platform;
  const { connected } = req.body;
  const db = loadDatabase();
  const conn = db.connections.find((c) => c.platform === platform);

  if (!conn) {
    res.status(404).json({ error: 'Platform not found' });
    return;
  }

  if (typeof connected !== 'boolean') {
    res.status(400).json({ error: '"connected" must be a boolean.' });
    return;
  }

  const requiredEnvironment: Record<string, string[]> = {
    youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
    instagram: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ACCOUNT_ID'],
    facebook: ['FACEBOOK_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID'],
  };
  const required = requiredEnvironment[platform];
  if (!required) {
    res.status(400).json({ error: 'Unsupported platform.' });
    return;
  }

  const missing = required.filter((name) => !process.env[name]?.trim());
  if (connected && missing.length > 0) {
    res.status(409).json({
      error: 'Cannot mark this platform configured while required server environment variables are missing.',
      missingEnvironment: missing,
    });
    return;
  }

  // This endpoint only records configuration presence. It does not perform an OAuth/API
  // verification, so never trust client-supplied account names or IDs as proof of connection.
  conn.credentialsConfigured = connected;
  conn.connected = connected;
  conn.status = connected ? 'CONFIGURED' : 'SETUP_REQUIRED';
  if (!connected) {
    conn.accountName = undefined;
    conn.accountId = undefined;
  }
  conn.lastChecked = new Date().toISOString();

  saveDatabase(db);
  res.json({ success: true, connection: conn });
});

// ==================== JOBS API ====================

apiRouter.get('/jobs', (_req, res) => {
  const jobs = getJobs();
  res.json(jobs);
});

apiRouter.get('/jobs/:id', (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

apiRouter.post('/jobs', async (req, res) => {
  const { topic, creativePrompt, templateId, style, targetDurationSec, voiceId, targetPlatforms } = req.body;
  if (typeof topic !== 'string' || topic.trim().length === 0) {
    res.status(400).json({ error: 'A non-empty video topic is required.' });
    return;
  }
  if (topic.trim().length > 240) {
    res.status(400).json({ error: 'Video topic must be 240 characters or fewer.' });
    return;
  }
  if (targetPlatforms !== undefined && (!Array.isArray(targetPlatforms) ||
      targetPlatforms.some((platform) => !['youtube', 'instagram', 'facebook'].includes(platform)))) {
    res.status(400).json({ error: 'targetPlatforms may only contain youtube, instagram, and facebook.' });
    return;
  }
  const db = loadDatabase();

  const finalVoiceId = voiceId || db.settings.defaultVoiceId;
  const finalStyle = style || db.settings.defaultStyle;
  const finalDuration = Math.min(59, Math.max(20, targetDurationSec || db.settings.defaultDurationSec));
  const platforms = Array.isArray(targetPlatforms) && targetPlatforms.length > 0 ? targetPlatforms : ['youtube'];

  const jobId = `sisyphus-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const initialJob = {
    id: jobId,
    topic: topic.trim(),
    creativePrompt: creativePrompt || '',
    templateId,
    style: finalStyle,
    targetDurationSec: finalDuration,
    voiceId: finalVoiceId,
    targetPlatforms: platforms,
    status: 'running' as const,
    currentStage: 'validate_input' as PipelineStageId,
    progress: 0,
    stages: createInitialStages(),
    publications: createInitialPlatformStatuses(platforms),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveJob(initialJob);

  // Run pipeline asynchronously in background
  runJobPipeline(jobId).catch((err) => {
    console.error(`Pipeline failure for job ${jobId}:`, err);
  });

  res.status(201).json(initialJob);
});

apiRouter.post('/jobs/:id/retry/:stage', async (req, res) => {
  const { id, stage } = req.params;
  const job = getJobById(id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const validStages: PipelineStageId[] = [
    'validate_input', 'generate_script', 'validate_duration', 'generate_audio',
    'align_subtitles', 'render_scenes', 'composite_media', 'encode_mp4',
    'prepare_metadata', 'publish_platforms', 'record_status',
  ];
  if (!validStages.includes(stage as PipelineStageId)) {
    res.status(400).json({ error: `Invalid pipeline stage: ${stage}` });
    return;
  }

  const updatedJob = resetJobFromStage(job, stage as PipelineStageId);
  saveJob(updatedJob);

  // Asynchronously resume pipeline from this stage
  runJobPipeline(id, stage as PipelineStageId).catch((err) => {
    console.error(`Pipeline retry failure for job ${id} at stage ${stage}:`, err);
  });

  res.json(updatedJob);
});

apiRouter.post('/jobs/:id/publish', async (req, res) => {
  const { id } = req.params;
  const { platform } = req.body;
  if (!['youtube', 'instagram', 'facebook'].includes(platform)) {
    res.status(400).json({ error: 'platform must be youtube, instagram, or facebook.' });
    return;
  }
  const job = getJobById(id);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  if (!job.videoUrl || job.stages.encode_mp4?.status !== 'completed') {
    res.status(409).json({ error: 'This job has no verified completed MP4 to publish.' });
    return;
  }

  try {
    const result = await dispatchPublish(job, platform);
    job.publications[platform as 'youtube' | 'instagram' | 'facebook'] = result;
    saveJob(job);
    res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    console.error(`Publish request failed for job ${id} on ${platform}:`, err);
    res.status(502).json({
      platform,
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected publishing error.',
    });
  }
});

// Serve generated artifacts (mp4, wav, jpg, srt)
apiRouter.get('/artifacts/:jobId/:filename', (req, res) => {
  const { jobId, filename } = req.params;
  // Artifact route parameters must never escape the artifact root via ../ or encoded paths.
  if (path.basename(jobId) !== jobId || path.basename(filename) !== filename ||
      jobId.includes('..') || filename.includes('..')) {
    res.status(400).json({ error: 'Invalid artifact path.' });
    return;
  }
  const artifactRoot = path.resolve(getArtifactsPath());
  const filePath = path.resolve(artifactRoot, jobId, filename);
  if (!filePath.startsWith(artifactRoot + path.sep)) {
    res.status(400).json({ error: 'Invalid artifact path.' });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Artifact file not found' });
    return;
  }

  if (filename.endsWith('.mp4')) {
    res.setHeader('Content-Type', 'video/mp4');
  } else if (filename.endsWith('.wav')) {
    res.setHeader('Content-Type', 'audio/wav');
  } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
    res.setHeader('Content-Type', 'image/jpeg');
  }

  fs.createReadStream(filePath).pipe(res);
});
