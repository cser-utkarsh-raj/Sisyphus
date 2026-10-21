export type VoiceId = 'zephyr' | 'puck' | 'kore' | 'fenrir';

export interface VoiceProfile {
  id: VoiceId;
  name: string;
  tone: string;
  personality: string;
  gender: 'neutral' | 'male' | 'female';
  provider: 'gemini-tts' | 'system-tts';
  voiceIdentifier: string;
  language: string;
  sampleAudioUrl?: string;
  sampleText: string;
  accentColor: string;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface SubtitleLine {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  words: WordTiming[];
}

export type SceneVisualType =
  | 'kinetic-hook'
  | 'diagram-chart'
  | 'data-counter'
  | 'metaphor-concept'
  | 'split-comparison'
  | 'punchline-conclusion';

export interface DiagramItem {
  label: string;
  value: number;
  color?: string;
}

export interface SceneVisualElements {
  primaryShape: 'circle' | 'square' | 'triangle' | 'waveform' | 'helix' | 'nodes' | 'orbit';
  accentColor: string;
  headlineText?: string;
  subText?: string;
  kineticWords?: string[];
  diagramData?: DiagramItem[];
  counterTarget?: number;
  counterPrefix?: string;
  counterSuffix?: string;
  metaphorIcon?: string;
  comparisonSides?: { left: string; right: string; leftScore: number; rightScore: number };
}

export interface ScenePlan {
  id: string;
  sceneNumber: number;
  title: string;
  narration: string;
  startMs: number;
  endMs: number;
  visualType: SceneVisualType;
  visualElements: SceneVisualElements;
}

export type PipelineStageId =
  | 'validate_input'
  | 'generate_script'
  | 'validate_duration'
  | 'generate_audio'
  | 'align_subtitles'
  | 'render_scenes'
  | 'composite_media'
  | 'encode_mp4'
  | 'prepare_metadata'
  | 'publish_platforms'
  | 'record_status';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StageExecution {
  id: PipelineStageId;
  name: string;
  description: string;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  logs: string[];
  artifacts?: Record<string, unknown>;
}

export type VideoStyle =
  | 'cyber_brutalist_pink'
  | 'neo_vector_infographic'
  | 'dark_noir_science'
  | 'retro_blueprint';

export type TargetPlatform = 'youtube' | 'instagram' | 'facebook';

export type PlatformStatus =
  | 'not_selected'
  | 'awaiting_auth'
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'published'
  | 'failed';

export interface PlatformPublishStatus {
  platform: TargetPlatform;
  status: PlatformStatus;
  publicationId?: string;
  publicationUrl?: string;
  publishedAt?: string;
  error?: string;
  retryCount: number;
  title?: string;
  caption?: string;
  hashtags?: string[];
}

export interface VideoMetadata {
  width: number; // 1080
  height: number; // 1920
  aspectRatio: string; // '9:16'
  fps: number; // 30
  durationSec: number; // strictly < 60
  format: string; // 'H.264 / AAC'
  fileSizeBytes: number;
  isValidated: boolean;
}

export interface ScriptData {
  title: string;
  topic: string;
  fullNarration: string;
  targetDurationSec: number;
  estimatedDurationSec: number;
  scenes: ScenePlan[];
  hook: string;
  callToAction: string;
  hashtags: string[];
  description: string;
}

export interface Job {
  id: string;
  topic: string;
  creativePrompt?: string;
  templateId?: string;
  style: VideoStyle;
  targetDurationSec: number;
  voiceId: VoiceId;
  targetPlatforms: TargetPlatform[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStage: PipelineStageId;
  progress: number;
  stages: Record<PipelineStageId, StageExecution>;
  script?: ScriptData;
  subtitles?: SubtitleLine[];
  audioUrl?: string;
  audioDurationMs?: number;
  videoUrl?: string;
  videoThumbnailUrl?: string;
  videoMetadata?: VideoMetadata;
  publications: Record<TargetPlatform, PlatformPublishStatus>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionConfig {
  platform: TargetPlatform;
  displayName: string;
  connected: boolean;
  status: 'CONNECTED' | 'CONFIGURED' | 'SETUP_REQUIRED' | 'EXPIRED' | 'ERROR';
  accountName?: string;
  accountId?: string;
  lastChecked?: string;
  quotaRemaining?: string;
  credentialsConfigured: boolean;
  requiredScopes: string[];
  instructions: {
    title: string;
    steps: string[];
    docsUrl: string;
  };
}

export interface AppSettings {
  defaultVoiceId: VoiceId;
  defaultStyle: VideoStyle;
  defaultDurationSec: number;
  safeMarginGuideEnabled: boolean;
  outputResolution: '1080x1920';
  targetFps: 30;
  maxDurationSec: 59;
  defaultHashtags: string[];
  dailySchedule: {
    enabled: boolean;
    timeOfDayUtc: string; // e.g. "09:00"
    topicTemplate: string;
    voiceId: VoiceId;
    targetPlatforms: TargetPlatform[];
    lastRunAt?: string;
    nextRunAt?: string;
  };
}
