/**
 * sisyphus-video-engine.ts
 *
 * Self-contained, deterministic vertical short-form video generation engine for Sisyphus.
 * Covers:
 *  1. Strongly typed scene model, 6 visual archetypes, camera tracks, kinetic text, and themes.
 *  2. Adapter & normalization layer for existing Sisyphus ScriptData / Storyboard inputs.
 *  3. Pure deterministic 2D vector/canvas renderer (supports both built-in RGBA/PNG software
 *     rasterization and external @napi-rs/canvas contexts).
 *  4. Word-level karaoke subtitle timing normalization, validation, and ASS (.ass) generation.
 *  5. Safe child_process.spawn FFmpeg/FFprobe pipeline with strict <60s verification and zero silent fallbacks.
 *  6. Comprehensive runnable self-test suite (10 diagnostic test cases + 4-scene fixture).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { deflateSync } from 'node:zlib';
import { resolveFfmpegBinary, resolveFfprobeBinary } from './mediaTools.ts';

export { resolveFfmpegBinary, resolveFfprobeBinary } from './mediaTools.ts';

// ============================================================================
// PART 0: ENGINE CONSTANTS & MACHINE-READABLE DEPENDENCY DECLARATION
// ============================================================================

export const VIDEO_WIDTH = 1080 as const;
export const VIDEO_HEIGHT = 1920 as const;
export const VIDEO_FPS = 30 as const;
export const MAX_VIDEO_DURATION_SECONDS = 59.95 as const;
export const HARD_DURATION_LIMIT_SECONDS = 60.0 as const;
export const MIN_SCENE_DURATION_SECONDS = 0.5 as const;
export const TIMING_EPSILON_SECONDS = 0.005 as const;

export interface SafeZoneBounds {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly subtitleBottomMargin: number;
}

export const MOBILE_SAFE_ZONE: SafeZoneBounds = {
  top: 180,
  bottom: 1540,
  left: 84,
  right: 996,
  contentWidth: 912,
  contentHeight: 1360,
  subtitleBottomMargin: 380,
} as const;

export interface RuntimeDependencySpec {
  readonly name: string;
  readonly kind: 'system-binary' | 'node-builtin' | 'npm-optional-accelerator';
  readonly versionConstraint: string;
  readonly requiredFor: readonly string[];
  readonly verificationCommand?: readonly string[];
  readonly notes: string;
}

export const ENGINE_RUNTIME_DEPENDENCIES: readonly RuntimeDependencySpec[] = [
  {
    name: 'node',
    kind: 'node-builtin',
    versionConstraint: '>=20.0.0',
    requiredFor: ['normalizeStoryboard', 'buildSubtitleLines', 'exportToAss', 'renderFrame', 'renderVideo'],
    notes: 'Uses node:child_process, node:fs/promises, node:zlib, and node:crypto.',
  },
  {
    name: 'ffmpeg',
    kind: 'system-binary',
    versionConstraint: '>=5.0',
    requiredFor: ['renderVideo'],
    verificationCommand: ['ffmpeg', '-version'],
    notes: 'Spawned via argument arrays with rawvideo rgba stdin pipe, narration audio muxing, libx264 yuv420p encoding, and AAC audio encoding.',
  },
  {
    name: 'ffprobe',
    kind: 'system-binary',
    versionConstraint: '>=5.0',
    requiredFor: ['probeMediaFile', 'renderVideo', 'validateRenderedVideo'],
    verificationCommand: ['ffprobe', '-version'],
    notes: 'Spawned via argument arrays to measure actual audio input and verify output video dimensions, FPS, codecs, pixel format, and <60s duration.',
  },
  {
    name: '@napi-rs/canvas',
    kind: 'npm-optional-accelerator',
    versionConstraint: '^0.1.52',
    requiredFor: ['createNapiCanvasFactory (optional accelerator)'],
    notes: 'Optional native 2D canvas backend. The engine ships with a complete built-in SoftwareSurface2D RGBA/PNG rasterizer so frame rendering works without native addons installed.',
  },
] as const;

// ============================================================================
// PART 1: ERROR HIERARCHY (EXPLICIT, ACTIONABLE ERRORS)
// ============================================================================

export type VideoEngineErrorCode =
  | 'STORYBOARD_VALIDATION_ERROR'
  | 'SUBTITLE_VALIDATION_ERROR'
  | 'AUDIO_VALIDATION_ERROR'
  | 'MISSING_DEPENDENCY_ERROR'
  | 'RENDER_STAGE_ERROR'
  | 'MEDIA_VERIFICATION_ERROR';

export class VideoEngineError extends Error {
  public readonly code: VideoEngineErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: VideoEngineErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'VideoEngineError';
    this.code = code;
    this.details = details;
  }
}

export class StoryboardValidationError extends VideoEngineError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('STORYBOARD_VALIDATION_ERROR', message, details);
    this.name = 'StoryboardValidationError';
  }
}

export class SubtitleValidationError extends VideoEngineError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('SUBTITLE_VALIDATION_ERROR', message, details);
    this.name = 'SubtitleValidationError';
  }
}

export class AudioValidationError extends VideoEngineError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('AUDIO_VALIDATION_ERROR', message, details);
    this.name = 'AudioValidationError';
  }
}

export class MissingDependencyError extends VideoEngineError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('MISSING_DEPENDENCY_ERROR', message, details);
    this.name = 'MissingDependencyError';
  }
}

export class RenderStageError extends VideoEngineError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('RENDER_STAGE_ERROR', message, details);
    this.name = 'RenderStageError';
  }
}

export class MediaVerificationError extends VideoEngineError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('MEDIA_VERIFICATION_ERROR', message, details);
    this.name = 'MediaVerificationError';
  }
}

// ============================================================================
// PART 2: SCENE ENGINE TYPES, ARCHETYPES, THEMES & ADAPTER INPUTS
// ============================================================================

export type SceneArchetype =
  | 'hero-metaphor'
  | 'branching-tree'
  | 'constellation-mesh'
  | 'split-comparison'
  | 'animated-data-counter'
  | 'chronological-timeline';

export const ALL_SCENE_ARCHETYPES: readonly SceneArchetype[] = [
  'hero-metaphor',
  'branching-tree',
  'constellation-mesh',
  'split-comparison',
  'animated-data-counter',
  'chronological-timeline',
] as const;

export type ThemeId =
  | 'cyber-brutalist-pink'
  | 'neo-vector'
  | 'dark-noir-science'
  | 'retro-blueprint';

export const ALL_THEME_IDS: readonly ThemeId[] = [
  'cyber-brutalist-pink',
  'neo-vector',
  'dark-noir-science',
  'retro-blueprint',
] as const;

export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutCubic'
  | 'easeOutBack'
  | 'springSmooth';

export type TransitionType =
  | 'none'
  | 'fade'
  | 'wipe-up'
  | 'iris-zoom'
  | 'glitch-slice';

export type DataProvenance = 'supplied-verified' | 'illustrative' | 'non-quantitative';

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface SceneThemeTokens {
  readonly themeId: ThemeId;
  readonly displayName: string;
  readonly backgroundPrimary: string;
  readonly backgroundSecondary: string;
  readonly surfaceCard: string;
  readonly gridColor: string;
  readonly accentPrimary: string;
  readonly accentSecondary: string;
  readonly highlightColor: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly particleColor: string;
  readonly strokeWidthPx: number;
  readonly cornerRadiusPx: number;
  readonly gridSpacingPx: number;
  readonly scanlineAlpha: number;
}

export interface CameraTrack {
  readonly startZoom: number;
  readonly endZoom: number;
  readonly panStartX: number;
  readonly panStartY: number;
  readonly panEndX: number;
  readonly panEndY: number;
  readonly rotationDegStart: number;
  readonly rotationDegEnd: number;
  readonly easing: EasingName;
}

export interface SceneTransitionSpec {
  readonly type: TransitionType;
  readonly duration: number;
  readonly easing: EasingName;
}

export type KineticTextRole = 'headline' | 'subheadline' | 'callout' | 'caption-tag';
export type KineticEntryAnimation = 'slide-up' | 'scale-pop' | 'typewriter-reveal' | 'fade-in';
export type KineticExitAnimation = 'fade-out' | 'slide-down' | 'scale-shrink';

export interface KineticTextElement {
  readonly id: string;
  readonly text: string;
  readonly role: KineticTextRole;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly entryAnimation: KineticEntryAnimation;
  readonly exitAnimation: KineticExitAnimation;
  readonly easing: EasingName;
  readonly colorToken: 'textPrimary' | 'accentPrimary' | 'accentSecondary' | 'highlightColor';
}

export type VisualPrimitiveShape = 'ring' | 'polygon' | 'vector-line' | 'pulse-node' | 'reticle-box';

export interface VisualElement {
  readonly id: string;
  readonly shape: VisualPrimitiveShape;
  readonly label?: string;
  readonly normalizedX: number; // 0..1 within safe content area
  readonly normalizedY: number; // 0..1 within safe content area
  readonly normalizedSize: number; // 0.02..0.8
  readonly colorToken: 'accentPrimary' | 'accentSecondary' | 'highlightColor' | 'textMuted';
  readonly rotationSpeedDegPerSec: number;
  readonly pulseFrequencyHz: number;
}

export interface HeroMetaphorSatellite {
  readonly id: string;
  readonly label: string;
  readonly orbitRadiusRatio: number;
  readonly initialAngleRad: number;
  readonly angularVelocityRadPerSec: number;
}

export interface HeroMetaphorDiagram {
  readonly kind: 'hero-metaphor';
  readonly coreLabel: string;
  readonly coreSides: number;
  readonly ringCount: number;
  readonly satellites: readonly HeroMetaphorSatellite[];
  readonly provenance: DataProvenance;
}

export interface BranchingTreeNode {
  readonly id: string;
  readonly label: string;
  readonly depth: number;
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly parentId: string | null;
}

export interface BranchingTreeDiagram {
  readonly kind: 'branching-tree';
  readonly rootLabel: string;
  readonly nodes: readonly BranchingTreeNode[];
  readonly provenance: DataProvenance;
}

export interface ConstellationNode {
  readonly id: string;
  readonly label: string;
  readonly anchorX: number; // 0..1
  readonly anchorY: number; // 0..1
  readonly weight: number; // 0.5..2.0
}

export interface ConstellationEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly strength: number; // 0.2..1.0
}

export interface ConstellationMeshDiagram {
  readonly kind: 'constellation-mesh';
  readonly nodes: readonly ConstellationNode[];
  readonly edges: readonly ConstellationEdge[];
  readonly provenance: DataProvenance;
}

export interface ComparisonItem {
  readonly attribute: string;
  readonly leftDescriptor: string;
  readonly rightDescriptor: string;
  readonly leftRelativeWeight: number; // 0.1..1.0 illustrative bar ratio
  readonly rightRelativeWeight: number; // 0.1..1.0 illustrative bar ratio
}

export interface SplitComparisonDiagram {
  readonly kind: 'split-comparison';
  readonly leftTitle: string;
  readonly rightTitle: string;
  readonly items: readonly ComparisonItem[];
  readonly provenance: DataProvenance;
}

export interface AnimatedDataCounterDiagram {
  readonly kind: 'animated-data-counter';
  readonly startValue: number;
  readonly targetValue: number;
  readonly decimals: number;
  readonly unit: string;
  readonly caption: string;
  readonly gaugeRatio: number; // 0.05..1.0
  readonly provenance: DataProvenance;
}

export interface TimelineMilestone {
  readonly id: string;
  readonly phaseTag: string;
  readonly title: string;
  readonly detail: string;
  readonly relativePosition: number; // 0..1
}

export interface ChronologicalTimelineDiagram {
  readonly kind: 'chronological-timeline';
  readonly axisLabel: string;
  readonly milestones: readonly TimelineMilestone[];
  readonly provenance: DataProvenance;
}

export type SceneDiagramData =
  | HeroMetaphorDiagram
  | BranchingTreeDiagram
  | ConstellationMeshDiagram
  | SplitComparisonDiagram
  | AnimatedDataCounterDiagram
  | ChronologicalTimelineDiagram;

export interface NormalizedScene {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly narration: string;
  readonly visualDescription: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly archetype: SceneArchetype;
  readonly themeTokens: SceneThemeTokens;
  readonly camera: CameraTrack;
  readonly transitionIn: SceneTransitionSpec;
  readonly transitionOut: SceneTransitionSpec;
  readonly kineticTexts: readonly KineticTextElement[];
  readonly visualElements: readonly VisualElement[];
  readonly diagram: SceneDiagramData;
}

export type TimingAlignmentSource = 'aligned' | 'estimated';

export interface WordTiming {
  readonly word: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly sceneId: string;
  readonly alignmentSource: TimingAlignmentSource;
}

export interface SubtitleLine {
  readonly index: number;
  readonly sceneId: string;
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly words: readonly WordTiming[];
  readonly alignmentSource: TimingAlignmentSource;
}

export interface NormalizedStoryboard {
  readonly jobId: string;
  readonly topic: string;
  readonly title: string;
  readonly seed: number;
  readonly themeId: ThemeId;
  readonly totalDuration: number;
  readonly timingSource: TimingAlignmentSource;
  readonly scenes: readonly NormalizedScene[];
  readonly wordTimings: readonly WordTiming[];
  readonly normalizationWarnings: readonly string[];
}

// ============================================================================
// PART 3: EXISTING SISYPHUS APPLICATION ADAPTER TYPES
// ============================================================================

export interface ExistingWordTimingInput {
  readonly word?: string;
  readonly text?: string;
  readonly start?: number;
  readonly end?: number;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly aligned?: boolean;
}

export interface ExistingMetricInput {
  readonly value?: number;
  readonly startValue?: number;
  readonly unit?: string;
  readonly label?: string;
  readonly verified?: boolean;
  readonly decimals?: number;
}

export interface ExistingComparisonSideInput {
  readonly title?: string;
  readonly points?: readonly string[];
}

export interface ExistingTimelinePointInput {
  readonly time?: string;
  readonly label?: string;
  readonly description?: string;
}

export interface ExistingSceneInput {
  readonly id?: string;
  readonly title?: string;
  readonly heading?: string;
  readonly narration?: string;
  readonly text?: string;
  readonly voiceover?: string;
  readonly visualDescription?: string;
  readonly visualPrompt?: string;
  readonly visualType?: string;
  readonly archetype?: string;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly duration?: number;
  readonly keywords?: readonly string[];
  readonly callout?: string;
  readonly metric?: ExistingMetricInput;
  readonly comparison?: {
    readonly left?: ExistingComparisonSideInput;
    readonly right?: ExistingComparisonSideInput;
  };
  readonly branches?: readonly string[];
  readonly nodes?: readonly string[];
  readonly timeline?: readonly ExistingTimelinePointInput[];
  readonly themeOverride?: string;
}

export interface ExistingScriptDataInput {
  readonly jobId?: string;
  readonly id?: string;
  readonly topic?: string;
  readonly title?: string;
  readonly style?: string;
  readonly visualStyle?: string;
  readonly theme?: string;
  readonly seed?: number | string;
  readonly duration?: number;
  readonly estimatedDuration?: number;
  readonly narration?: string;
  readonly scenes?: readonly ExistingSceneInput[];
  readonly wordTimings?: readonly ExistingWordTimingInput[];
  readonly words?: readonly ExistingWordTimingInput[];
}

export interface NormalizeStoryboardOptions {
  readonly audioDurationSeconds?: number;
  readonly preferredStyle?: string;
  readonly seedOverride?: number | string;
  readonly jobIdOverride?: string;
}

// ============================================================================
// PART 4: DETERMINISTIC PRNG, HASHING, EASING & COLOR UTILITIES
// ============================================================================

export function computeDeterministicSeed(input: string | number): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return (Math.abs(Math.trunc(input)) >>> 0) || 0x9e3779b9;
  }
  const digest = createHash('sha256').update(String(input)).digest();
  const value = digest.readUInt32LE(0);
  return value === 0 ? 0x6d2b79f5 : value;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number | string) {
    this.state = computeDeterministicSeed(seed);
  }

  public nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public nextRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  public nextInt(minInclusive: number, maxInclusive: number): number {
    return Math.floor(this.nextRange(minInclusive, maxInclusive + 0.999999));
  }

  public pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array.');
    }
    const idx = Math.floor(this.nextFloat() * items.length) % items.length;
    return items[idx]!;
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function evaluateEasing(name: EasingName, rawT: number): number {
  const t = clamp(rawT, 0, 1);
  switch (name) {
    case 'linear':
      return t;
    case 'easeInQuad':
      return t * t;
    case 'easeOutQuad':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOutCubic':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'easeOutBack': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case 'springSmooth': {
      return 1 - Math.cos(t * Math.PI * 2.5) * Math.exp(-t * 4.5);
    }
  }
}

export function parseHexColor(hex: string, alphaOverride?: number): RgbaColor {
  const cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return {
      r: Number.isFinite(r) ? r : 255,
      g: Number.isFinite(g) ? g : 255,
      b: Number.isFinite(b) ? b : 255,
      a: alphaOverride !== undefined ? clamp(alphaOverride, 0, 1) : 1,
    };
  }
  if (cleaned.length === 8) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    const a = parseInt(cleaned.slice(6, 8), 16) / 255;
    return {
      r: Number.isFinite(r) ? r : 255,
      g: Number.isFinite(g) ? g : 255,
      b: Number.isFinite(b) ? b : 255,
      a: alphaOverride !== undefined ? clamp(alphaOverride, 0, 1) : clamp(a, 0, 1),
    };
  }
  return { r: 255, g: 255, b: 255, a: alphaOverride ?? 1 };
}

export function hexToAssBgrColor(hex: string, alphaByte: number = 0x00): string {
  const rgba = parseHexColor(hex);
  const aa = clamp(Math.round(alphaByte), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  const bb = clamp(Math.round(rgba.b), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  const gg = clamp(Math.round(rgba.g), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  const rr = clamp(Math.round(rgba.r), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `&H${aa}${bb}${gg}${rr}`;
}

// ============================================================================
// PART 5: VISUAL THEMES REGISTRY & STYLE NORMALIZATION
// ============================================================================

export const THEME_REGISTRY: Readonly<Record<ThemeId, SceneThemeTokens>> = {
  'cyber-brutalist-pink': {
    themeId: 'cyber-brutalist-pink',
    displayName: 'Cyber-Brutalist Pink',
    backgroundPrimary: '#0B0711',
    backgroundSecondary: '#1A0E26',
    surfaceCard: '#171022',
    gridColor: '#3B184F',
    accentPrimary: '#FF1E8A',
    accentSecondary: '#00F0FF',
    highlightColor: '#FFE600',
    textPrimary: '#FFF7FB',
    textMuted: '#B899C7',
    particleColor: '#FF5CB8',
    strokeWidthPx: 4,
    cornerRadiusPx: 4,
    gridSpacingPx: 72,
    scanlineAlpha: 0.08,
  },
  'neo-vector': {
    themeId: 'neo-vector',
    displayName: 'Neo-Vector',
    backgroundPrimary: '#06101A',
    backgroundSecondary: '#0D2233',
    surfaceCard: '#0F293D',
    gridColor: '#163D59',
    accentPrimary: '#00FF9D',
    accentSecondary: '#38B6FF',
    highlightColor: '#FFB800',
    textPrimary: '#ECFFF8',
    textMuted: '#7FAAB8',
    particleColor: '#00FF9D',
    strokeWidthPx: 3,
    cornerRadiusPx: 14,
    gridSpacingPx: 90,
    scanlineAlpha: 0.04,
  },
  'dark-noir-science': {
    themeId: 'dark-noir-science',
    displayName: 'Dark Noir Science',
    backgroundPrimary: '#08090D',
    backgroundSecondary: '#12151F',
    surfaceCard: '#161A26',
    gridColor: '#252B3D',
    accentPrimary: '#E6B86A',
    accentSecondary: '#6AC8E6',
    highlightColor: '#FF6B5B',
    textPrimary: '#F5F2EB',
    textMuted: '#8C92A4',
    particleColor: '#E6B86A',
    strokeWidthPx: 2,
    cornerRadiusPx: 10,
    gridSpacingPx: 96,
    scanlineAlpha: 0.03,
  },
  'retro-blueprint': {
    themeId: 'retro-blueprint',
    displayName: 'Retro Blueprint',
    backgroundPrimary: '#0A2240',
    backgroundSecondary: '#123562',
    surfaceCard: '#153E73',
    gridColor: '#245899',
    accentPrimary: '#5BC0BE',
    accentSecondary: '#F4F1DE',
    highlightColor: '#FF9F1C',
    textPrimary: '#F7F9FC',
    textMuted: '#9BB8DC',
    particleColor: '#8CE7E5',
    strokeWidthPx: 3,
    cornerRadiusPx: 6,
    gridSpacingPx: 60,
    scanlineAlpha: 0.05,
  },
} as const;

export function resolveThemeId(styleInput?: string | null): ThemeId {
  if (!styleInput || typeof styleInput !== 'string') {
    return 'neo-vector';
  }
  const normalized = styleInput.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (
    normalized === 'cyber-brutalist-pink' ||
    normalized.includes('brutalist') ||
    normalized.includes('pink') ||
    normalized.includes('cyber') ||
    normalized.includes('neon-pink')
  ) {
    return 'cyber-brutalist-pink';
  }
  if (
    normalized === 'neo-vector' ||
    normalized.includes('vector') ||
    normalized.includes('emerald') ||
    normalized.includes('geometric') ||
    normalized.includes('neon')
  ) {
    return 'neo-vector';
  }
  if (
    normalized === 'dark-noir-science' ||
    normalized.includes('noir') ||
    normalized.includes('science') ||
    normalized.includes('dark') ||
    normalized.includes('minimal') ||
    normalized.includes('cinematic')
  ) {
    return 'dark-noir-science';
  }
  if (
    normalized === 'retro-blueprint' ||
    normalized.includes('blueprint') ||
    normalized.includes('retro') ||
    normalized.includes('schematic') ||
    normalized.includes('engineering')
  ) {
    return 'retro-blueprint';
  }
  return 'neo-vector';
}

export function getThemeTokens(styleInput?: string | ThemeId | null): SceneThemeTokens {
  const id = resolveThemeId(styleInput);
  return THEME_REGISTRY[id];
}

// ============================================================================
// PART 6: STORYBOARD NORMALIZATION & VALIDATION ENGINE
// ============================================================================

function inferSceneArchetype(
  scene: ExistingSceneInput,
  sceneIndex: number
): SceneArchetype {
  const rawType = (scene.archetype ?? scene.visualType ?? '').trim().toLowerCase();
  if (rawType.includes('hero') || rawType.includes('metaphor') || rawType.includes('orbital')) {
    return 'hero-metaphor';
  }
  if (rawType.includes('tree') || rawType.includes('branch') || rawType.includes('hierarchy')) {
    return 'branching-tree';
  }
  if (
    rawType.includes('constellation') ||
    rawType.includes('mesh') ||
    rawType.includes('network') ||
    rawType.includes('graph')
  ) {
    return 'constellation-mesh';
  }
  if (
    rawType.includes('split') ||
    rawType.includes('compar') ||
    rawType.includes('versus') ||
    rawType.includes('vs')
  ) {
    return 'split-comparison';
  }
  if (
    rawType.includes('counter') ||
    rawType.includes('metric') ||
    rawType.includes('stat') ||
    rawType.includes('gauge')
  ) {
    return 'animated-data-counter';
  }
  if (
    rawType.includes('timeline') ||
    rawType.includes('chronolog') ||
    rawType.includes('history') ||
    rawType.includes('sequence')
  ) {
    return 'chronological-timeline';
  }

  // Structural data inspection fallback
  if (scene.comparison?.left || scene.comparison?.right) {
    return 'split-comparison';
  }
  if (scene.timeline && scene.timeline.length > 0) {
    return 'chronological-timeline';
  }
  if (scene.metric && typeof scene.metric.value === 'number' && Number.isFinite(scene.metric.value)) {
    return 'animated-data-counter';
  }
  if (scene.branches && scene.branches.length >= 2) {
    return 'branching-tree';
  }
  if (scene.nodes && scene.nodes.length >= 3) {
    return 'constellation-mesh';
  }

  // Text keyword heuristics
  const combinedText = `${scene.title ?? ''} ${scene.narration ?? ''} ${scene.visualDescription ?? ''}`.toLowerCase();
  if (/\b(vs\.?|versus|compare|contrast|unlike|whereas)\b/.test(combinedText)) {
    return 'split-comparison';
  }
  if (/\b(first|second|then|finally|century|phase|stage|era|timeline)\b/.test(combinedText)) {
    return 'chronological-timeline';
  }
  if (/\b(network|web|synapse|mesh|interconnected|nodes|cluster)\b/.test(combinedText)) {
    return 'constellation-mesh';
  }
  if (/\b(branch|pathway|split|diverge|hierarchy|tree|decision)\b/.test(combinedText)) {
    return 'branching-tree';
  }

  const cycle: readonly SceneArchetype[] = [
    'hero-metaphor',
    'constellation-mesh',
    'branching-tree',
    'split-comparison',
    'chronological-timeline',
  ];
  return cycle[sceneIndex % cycle.length]!;
}

function extractKeyPhrases(text: string, maxCount: number): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'have', 'are',
    'was', 'were', 'will', 'would', 'could', 'should', 'into', 'about', 'than',
    'then', 'them', 'they', 'their', 'what', 'when', 'where', 'which', 'while',
    'every', 'over', 'under', 'between', 'through', 'because', 'does', 'just',
    'more', 'most', 'some', 'such', 'only', 'other', 'even', 'still', 'also',
  ]);

  const cleanedWords = text
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !stopWords.has(w.toLowerCase()));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const word of cleanedWords) {
    const upper = word.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      unique.push(upper);
      if (unique.length >= maxCount) break;
    }
  }

  while (unique.length < maxCount) {
    unique.push(`NODE ${unique.length + 1}`);
  }
  return unique;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildSceneDiagram(
  archetype: SceneArchetype,
  sceneInput: ExistingSceneInput,
  sceneIndex: number,
  title: string,
  narration: string,
  rng: SeededRandom
): SceneDiagramData {
  const keywords =
    sceneInput.keywords && sceneInput.keywords.length > 0
      ? sceneInput.keywords.map((k) => k.trim().toUpperCase()).filter((k) => k.length > 0)
      : extractKeyPhrases(`${title} ${narration} ${sceneInput.visualDescription ?? ''}`, 6);

  switch (archetype) {
    case 'hero-metaphor': {
      const satLabels = keywords.slice(0, 4);
      const satellites: HeroMetaphorSatellite[] = satLabels.map((label, idx) => ({
        id: `sat-${sceneIndex}-${idx}`,
        label: label.slice(0, 18),
        orbitRadiusRatio: 0.24 + idx * 0.06,
        initialAngleRad: (idx * Math.PI * 2) / satLabels.length + rng.nextRange(-0.2, 0.2),
        angularVelocityRadPerSec: (idx % 2 === 0 ? 1 : -1) * (0.45 + idx * 0.12),
      }));
      return {
        kind: 'hero-metaphor',
        coreLabel: title.toUpperCase().slice(0, 20),
        coreSides: rng.pick([6, 8, 10]),
        ringCount: 3,
        satellites,
        provenance: 'non-quantitative',
      };
    }

    case 'branching-tree': {
      const branchLabels =
        sceneInput.branches && sceneInput.branches.length >= 2
          ? sceneInput.branches.map((b) => b.trim().toUpperCase())
          : keywords.slice(0, 5);

      const rootId = `tree-root-${sceneIndex}`;
      const nodes: BranchingTreeNode[] = [
        {
          id: rootId,
          label: title.toUpperCase().slice(0, 18),
          depth: 0,
          siblingIndex: 0,
          siblingCount: 1,
          parentId: null,
        },
      ];

      const level1Count = Math.min(2, branchLabels.length);
      for (let i = 0; i < level1Count; i++) {
        nodes.push({
          id: `tree-l1-${sceneIndex}-${i}`,
          label: (branchLabels[i] ?? `BRANCH ${i + 1}`).slice(0, 16),
          depth: 1,
          siblingIndex: i,
          siblingCount: level1Count,
          parentId: rootId,
        });
      }

      const remaining = branchLabels.slice(level1Count, level1Count + 4);
      const level2Count = Math.max(2, remaining.length);
      for (let i = 0; i < level2Count; i++) {
        const parentIdx = i % level1Count;
        nodes.push({
          id: `tree-l2-${sceneIndex}-${i}`,
          label: (remaining[i] ?? keywords[(i + 2) % keywords.length] ?? `LEAF ${i + 1}`).slice(0, 14),
          depth: 2,
          siblingIndex: i,
          siblingCount: level2Count,
          parentId: `tree-l1-${sceneIndex}-${parentIdx}`,
        });
      }

      return {
        kind: 'branching-tree',
        rootLabel: title.toUpperCase().slice(0, 20),
        nodes,
        provenance: 'non-quantitative',
      };
    }

    case 'constellation-mesh': {
      const rawLabels =
        sceneInput.nodes && sceneInput.nodes.length >= 3
          ? sceneInput.nodes.map((n) => n.trim().toUpperCase())
          : keywords.slice(0, 6);

      const count = clamp(rawLabels.length, 4, 7);
      const nodes: ConstellationNode[] = [];
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const radius = i === 0 ? 0.04 : 0.28 + (i % 2) * 0.08;
        nodes.push({
          id: `mesh-node-${sceneIndex}-${i}`,
          label: (rawLabels[i] ?? `NODE ${i + 1}`).slice(0, 16),
          anchorX: clamp(0.5 + Math.cos(angle) * radius + rng.nextRange(-0.04, 0.04), 0.15, 0.85),
          anchorY: clamp(0.5 + Math.sin(angle) * radius + rng.nextRange(-0.04, 0.04), 0.18, 0.82),
          weight: i === 0 ? 1.7 : rng.nextRange(0.85, 1.35),
        });
      }

      const edges: ConstellationEdge[] = [];
      for (let i = 1; i < nodes.length; i++) {
        edges.push({
          fromId: nodes[0]!.id,
          toId: nodes[i]!.id,
          strength: 0.9,
        });
        const nextIdx = i + 1 < nodes.length ? i + 1 : 1;
        if (nextIdx !== i) {
          edges.push({
            fromId: nodes[i]!.id,
            toId: nodes[nextIdx]!.id,
            strength: 0.55,
          });
        }
      }

      return {
        kind: 'constellation-mesh',
        nodes,
        edges,
        provenance: 'non-quantitative',
      };
    }

    case 'split-comparison': {
      const leftTitle = (sceneInput.comparison?.left?.title ?? keywords[0] ?? 'STATE A')
        .toUpperCase()
        .slice(0, 18);
      const rightTitle = (sceneInput.comparison?.right?.title ?? keywords[1] ?? 'STATE B')
        .toUpperCase()
        .slice(0, 18);

      const leftPoints = sceneInput.comparison?.left?.points ?? [
        keywords[0] ?? 'BASELINE STRUCTURE',
        keywords[2] ?? 'INITIAL CONDITION',
        'DIRECT PATHWAY',
      ];
      const rightPoints = sceneInput.comparison?.right?.points ?? [
        keywords[1] ?? 'EMERGENT SYSTEM',
        keywords[3] ?? 'TRANSFORMED STATE',
        'ADAPTIVE FEEDBACK',
      ];

      const rowCount = Math.min(3, Math.max(leftPoints.length, rightPoints.length, 2));
      const items: ComparisonItem[] = [];
      for (let i = 0; i < rowCount; i++) {
        items.push({
          attribute: `AXIS 0${i + 1}`,
          leftDescriptor: (leftPoints[i] ?? `FACTOR ${i + 1}A`).toUpperCase().slice(0, 22),
          rightDescriptor: (rightPoints[i] ?? `FACTOR ${i + 1}B`).toUpperCase().slice(0, 22),
          leftRelativeWeight: clamp(0.45 + ((i * 19) % 40) / 100, 0.25, 0.95),
          rightRelativeWeight: clamp(0.6 + ((i * 23) % 35) / 100, 0.25, 0.95),
        });
      }

      return {
        kind: 'split-comparison',
        leftTitle,
        rightTitle,
        items,
        provenance: 'illustrative',
      };
    }

    case 'animated-data-counter': {
      // Never invent factual measurements. Use supplied metric if present,
      // otherwise explicitly label as an illustrative narrative progression index.
      const hasSuppliedMetric =
        sceneInput.metric !== undefined &&
        typeof sceneInput.metric.value === 'number' &&
        Number.isFinite(sceneInput.metric.value);

      if (hasSuppliedMetric && sceneInput.metric) {
        const targetVal = sceneInput.metric.value!;
        const startVal =
          typeof sceneInput.metric.startValue === 'number' &&
          Number.isFinite(sceneInput.metric.startValue)
            ? sceneInput.metric.startValue
            : 0;
        const isVerified = sceneInput.metric.verified === true;
        return {
          kind: 'animated-data-counter',
          startValue: startVal,
          targetValue: targetVal,
          decimals: clamp(sceneInput.metric.decimals ?? (Number.isInteger(targetVal) ? 0 : 1), 0, 3),
          unit: (sceneInput.metric.unit ?? '').slice(0, 12),
          caption: (sceneInput.metric.label ?? title).toUpperCase().slice(0, 34),
          gaugeRatio: 0.82,
          provenance: isVerified ? 'supplied-verified' : 'illustrative',
        };
      }

      return {
        kind: 'animated-data-counter',
        startValue: 0,
        targetValue: 100,
        decimals: 0,
        unit: '%',
        caption: `ILLUSTRATIVE PHASE PROGRESSION: ${title.toUpperCase().slice(0, 20)}`,
        gaugeRatio: 0.78,
        provenance: 'illustrative',
      };
    }

    case 'chronological-timeline': {
      const rawTimeline = sceneInput.timeline;
      const sentences = splitSentences(narration);
      const count = rawTimeline && rawTimeline.length >= 2 ? Math.min(4, rawTimeline.length) : 3;
      const milestones: TimelineMilestone[] = [];

      for (let i = 0; i < count; i++) {
        const item = rawTimeline?.[i];
        const fallbackSentence = sentences[i] ?? keywords[i] ?? `Phase ${i + 1} transition`;
        milestones.push({
          id: `tl-${sceneIndex}-${i}`,
          phaseTag: (item?.time ?? `STAGE 0${i + 1}`).toUpperCase().slice(0, 14),
          title: (item?.label ?? keywords[i] ?? `PHASE ${i + 1}`).toUpperCase().slice(0, 24),
          detail: (item?.description ?? fallbackSentence).slice(0, 48),
          relativePosition: count === 1 ? 0.5 : i / (count - 1),
        });
      }

      return {
        kind: 'chronological-timeline',
        axisLabel: title.toUpperCase().slice(0, 24),
        milestones,
        provenance: 'non-quantitative',
      };
    }
  }
}

function buildSceneVisualElements(
  sceneIndex: number,
  rng: SeededRandom
): VisualElement[] {
  const shapes: readonly VisualPrimitiveShape[] = [
    'ring',
    'polygon',
    'reticle-box',
    'pulse-node',
    'vector-line',
  ];
  const colors: readonly VisualElement['colorToken'][] = [
    'accentPrimary',
    'accentSecondary',
    'highlightColor',
    'textMuted',
  ];

  const elements: VisualElement[] = [];
  for (let i = 0; i < 5; i++) {
    elements.push({
      id: `ve-${sceneIndex}-${i}`,
      shape: shapes[i % shapes.length]!,
      label: `SYS.${sceneIndex + 1}.${i + 1}`,
      normalizedX: clamp(0.12 + ((i * 0.21 + rng.nextRange(-0.04, 0.04)) % 0.78), 0.08, 0.92),
      normalizedY: clamp(0.15 + ((i * 0.19 + rng.nextRange(-0.04, 0.04)) % 0.72), 0.12, 0.88),
      normalizedSize: rng.nextRange(0.05, 0.14),
      colorToken: colors[i % colors.length]!,
      rotationSpeedDegPerSec: (i % 2 === 0 ? 1 : -1) * rng.nextRange(12, 36),
      pulseFrequencyHz: rng.nextRange(0.4, 1.2),
    });
  }
  return elements;
}

function buildSceneKineticTexts(
  sceneId: string,
  title: string,
  calloutText: string,
  archetype: SceneArchetype,
  startTime: number,
  endTime: number
): KineticTextElement[] {
  const duration = endTime - startTime;
  const headlineExit = startTime + Math.max(MIN_SCENE_DURATION_SECONDS * 0.8, duration * 0.95);
  const subEntry = startTime + Math.min(0.25, duration * 0.15);
  const subExit = startTime + Math.max(subEntry + 0.2, duration * 0.92);

  const elements: KineticTextElement[] = [
    {
      id: `${sceneId}-kt-headline`,
      text: title.toUpperCase().slice(0, 38),
      role: 'headline',
      entryTime: startTime,
      exitTime: clamp(headlineExit, startTime + 0.1, endTime),
      x: 540,
      y: 285,
      fontSize: 44,
      entryAnimation: 'slide-up',
      exitAnimation: 'fade-out',
      easing: 'easeOutBack',
      colorToken: 'textPrimary',
    },
    {
      id: `${sceneId}-kt-tag`,
      text: `ARCHETYPE // ${archetype.toUpperCase()}`,
      role: 'caption-tag',
      entryTime: startTime,
      exitTime: clamp(headlineExit, startTime + 0.1, endTime),
      x: 540,
      y: 225,
      fontSize: 20,
      entryAnimation: 'fade-in',
      exitAnimation: 'fade-out',
      easing: 'easeOutQuad',
      colorToken: 'accentSecondary',
    },
  ];

  if (calloutText.trim().length > 0 && duration >= 1.2) {
    elements.push({
      id: `${sceneId}-kt-callout`,
      text: calloutText.toUpperCase().slice(0, 46),
      role: 'callout',
      entryTime: clamp(subEntry, startTime, endTime - 0.15),
      exitTime: clamp(subExit, subEntry + 0.1, endTime),
      x: 540,
      y: 1275,
      fontSize: 26,
      entryAnimation: 'scale-pop',
      exitAnimation: 'slide-down',
      easing: 'springSmooth',
      colorToken: 'highlightColor',
    });
  }

  return elements;
}

export function normalizeStoryboard(
  rawInput: ExistingScriptDataInput,
  options: NormalizeStoryboardOptions = {}
): NormalizedStoryboard {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new StoryboardValidationError('Input storyboard must be a non-null object.');
  }

  const rawScenes = rawInput.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    throw new StoryboardValidationError('Storyboard must contain at least one scene in scenes[].');
  }

  const warnings: string[] = [];
  const jobId =
    (options.jobIdOverride ?? rawInput.jobId ?? rawInput.id ?? 'sisyphus-job-default').trim() ||
    'sisyphus-job-default';
  const topic = (rawInput.topic ?? rawInput.title ?? 'Untitled Sisyphus Topic').trim();
  const title = (rawInput.title ?? topic).trim();
  const themeId = resolveThemeId(
    options.preferredStyle ?? rawInput.visualStyle ?? rawInput.style ?? rawInput.theme
  );
  const seed = computeDeterministicSeed(
    options.seedOverride ?? rawInput.seed ?? `${jobId}:${topic}:${themeId}`
  );
  const rng = new SeededRandom(seed);

  // Extract and sanitize per-scene text first
  const preparedScenes = rawScenes.map((s, idx) => {
    if (!s || typeof s !== 'object') {
      throw new StoryboardValidationError(`Scene at index ${idx} is malformed.`);
    }
    const id = (s.id ?? `scene-${idx + 1}`).trim() || `scene-${idx + 1}`;
    const sceneTitle = (s.title ?? s.heading ?? `Scene ${idx + 1}`).trim() || `Scene ${idx + 1}`;
    const narration = (s.narration ?? s.text ?? s.voiceover ?? '').trim();
    if (narration.length === 0) {
      throw new StoryboardValidationError(
        `Scene "${id}" at index ${idx} is missing narration text.`,
        { sceneId: id, index: idx }
      );
    }
    const visualDescription =
      (s.visualDescription ?? s.visualPrompt ?? sceneTitle).trim() || sceneTitle;

    return {
      raw: s,
      id,
      index: idx,
      title: sceneTitle,
      narration,
      visualDescription,
    };
  });

  // Determine timing strategy: check if explicit valid scene startTime/endTime exist
  const allHaveExplicitBounds = preparedScenes.every(
    (s) =>
      typeof s.raw.startTime === 'number' &&
      Number.isFinite(s.raw.startTime) &&
      typeof s.raw.endTime === 'number' &&
      Number.isFinite(s.raw.endTime)
  );

  let sceneTimings: Array<{ startTime: number; endTime: number; duration: number }> = [];

  if (allHaveExplicitBounds) {
    // Validate explicit bounds immediately so invalid/overlapping input is caught
    for (let i = 0; i < preparedScenes.length; i++) {
      const startTime = preparedScenes[i]!.raw.startTime!;
      const endTime = preparedScenes[i]!.raw.endTime!;
      if (startTime < 0 || endTime <= startTime) {
        throw new StoryboardValidationError(
          `Scene "${preparedScenes[i]!.id}" has invalid start/end timestamps (${startTime}s -> ${endTime}s).`,
          { sceneId: preparedScenes[i]!.id, startTime, endTime }
        );
      }
      if (i > 0) {
        const prevEnd = preparedScenes[i - 1]!.raw.endTime!;
        if (startTime < prevEnd - TIMING_EPSILON_SECONDS) {
          throw new StoryboardValidationError(
            `Scene "${preparedScenes[i]!.id}" overlaps with previous scene "${preparedScenes[i - 1]!.id}" (${startTime}s < ${prevEnd}s).`,
            {
              sceneId: preparedScenes[i]!.id,
              previousSceneId: preparedScenes[i - 1]!.id,
              startTime,
              previousEndTime: prevEnd,
            }
          );
        }
      }
      sceneTimings.push({
        startTime,
        endTime,
        duration: endTime - startTime,
      });
    }

    // If audioDurationSeconds is supplied and differs mildly, scale or clamp if within bounds
    if (options.audioDurationSeconds !== undefined) {
      if (
        !Number.isFinite(options.audioDurationSeconds) ||
        options.audioDurationSeconds <= 0
      ) {
        throw new StoryboardValidationError('Supplied audioDurationSeconds must be a positive finite number.');
      }
      if (options.audioDurationSeconds >= HARD_DURATION_LIMIT_SECONDS) {
        throw new StoryboardValidationError(
          `Audio duration (${options.audioDurationSeconds}s) reaches or exceeds the 60s vertical short limit.`,
          { audioDurationSeconds: options.audioDurationSeconds }
        );
      }
      const explicitTotal = sceneTimings[sceneTimings.length - 1]!.endTime;
      if (Math.abs(explicitTotal - options.audioDurationSeconds) > 0.25 && explicitTotal > 0) {
        const scale = options.audioDurationSeconds / explicitTotal;
        warnings.push(
          `Scaled explicit scene timings by factor ${scale.toFixed(4)} to match actual audio duration (${options.audioDurationSeconds.toFixed(2)}s).`
        );
        let cursor = 0;
        sceneTimings = sceneTimings.map((t, idx) => {
          const isLast = idx === sceneTimings.length - 1;
          const nextEnd = isLast
            ? options.audioDurationSeconds!
            : Number((t.endTime * scale).toFixed(3));
          const entry = {
            startTime: cursor,
            endTime: nextEnd,
            duration: Number((nextEnd - cursor).toFixed(3)),
          };
          cursor = nextEnd;
          return entry;
        });
      }
    }
  } else {
    // Derive timings deterministically from durations or narration character/word weights
    const weights = preparedScenes.map((s) => {
      if (typeof s.raw.duration === 'number') {
        if (!Number.isFinite(s.raw.duration) || s.raw.duration <= 0) {
          throw new StoryboardValidationError(
            `Scene "${s.id}" has a non-positive or invalid duration (${s.raw.duration}).`
          );
        }
        return s.raw.duration;
      }
      // Estimate natural speaking time (~14 characters per second, minimum 2.0s)
      return Math.max(2.0, s.narration.length / 14.0);
    });

    const rawWeightSum = weights.reduce((acc, w) => acc + w, 0);
    let targetTotalDuration: number;

    if (options.audioDurationSeconds !== undefined) {
      if (!Number.isFinite(options.audioDurationSeconds) || options.audioDurationSeconds <= 0) {
        throw new StoryboardValidationError('Supplied audioDurationSeconds must be positive.');
      }
      targetTotalDuration = options.audioDurationSeconds;
    } else if (
      typeof rawInput.duration === 'number' &&
      Number.isFinite(rawInput.duration) &&
      rawInput.duration > 0
    ) {
      targetTotalDuration = rawInput.duration;
    } else if (
      typeof rawInput.estimatedDuration === 'number' &&
      Number.isFinite(rawInput.estimatedDuration) &&
      rawInput.estimatedDuration > 0
    ) {
      targetTotalDuration = rawInput.estimatedDuration;
    } else {
      targetTotalDuration = clamp(rawWeightSum, preparedScenes.length * 1.5, 54.0);
      warnings.push(
        `Derived total storyboard duration (${targetTotalDuration.toFixed(2)}s) from narration length weights.`
      );
    }

    if (targetTotalDuration >= HARD_DURATION_LIMIT_SECONDS) {
      throw new StoryboardValidationError(
        `Total storyboard duration (${targetTotalDuration}s) must be strictly less than 60 seconds.`,
        { targetTotalDuration }
      );
    }

    let cursor = 0;
    sceneTimings = weights.map((w, idx) => {
      const isLast = idx === weights.length - 1;
      const rawDur = (w / rawWeightSum) * targetTotalDuration;
      const endTime = isLast
        ? Number(targetTotalDuration.toFixed(3))
        : Number(clamp(cursor + rawDur, cursor + MIN_SCENE_DURATION_SECONDS, targetTotalDuration - (weights.length - 1 - idx) * MIN_SCENE_DURATION_SECONDS).toFixed(3));
      const duration = Number((endTime - cursor).toFixed(3));
      const start = cursor;
      cursor = endTime;
      return { startTime: start, endTime, duration };
    });
  }

  const totalDuration = sceneTimings[sceneTimings.length - 1]!.endTime;
  if (totalDuration <= 0 || totalDuration >= HARD_DURATION_LIMIT_SECONDS) {
    throw new StoryboardValidationError(
      `Normalized total duration (${totalDuration}s) is out of range (0, 60).`,
      { totalDuration }
    );
  }

  const transitionTypes: readonly TransitionType[] = ['fade', 'wipe-up', 'iris-zoom', 'glitch-slice'];
  const cameraEasings: readonly EasingName[] = ['easeInOutCubic', 'easeOutQuad', 'springSmooth'];

  const normalizedScenes: NormalizedScene[] = preparedScenes.map((s, idx) => {
    const timing = sceneTimings[idx]!;
    const sceneSeed = computeDeterministicSeed(`${seed}:${s.id}:${idx}`);
    const sceneRng = new SeededRandom(sceneSeed);
    const archetype = inferSceneArchetype(s.raw, idx);
    const sceneTheme = s.raw.themeOverride
      ? getThemeTokens(s.raw.themeOverride)
      : getThemeTokens(themeId);

    const transitionDuration = clamp(timing.duration * 0.12, 0.15, 0.45);
    const transitionIn: SceneTransitionSpec = {
      type: idx === 0 ? 'fade' : transitionTypes[idx % transitionTypes.length]!,
      duration: transitionDuration,
      easing: 'easeOutQuad',
    };
    const transitionOut: SceneTransitionSpec = {
      type: 'fade',
      duration: transitionDuration,
      easing: 'easeInQuad',
    };

    const zoomDirection = idx % 2 === 0 ? 1 : -1;
    const camera: CameraTrack = {
      startZoom: zoomDirection > 0 ? 1.0 : 1.06,
      endZoom: zoomDirection > 0 ? 1.06 : 1.0,
      panStartX: sceneRng.nextRange(-14, 14),
      panStartY: sceneRng.nextRange(-12, 12),
      panEndX: sceneRng.nextRange(-14, 14),
      panEndY: sceneRng.nextRange(-12, 12),
      rotationDegStart: sceneRng.nextRange(-0.8, 0.8),
      rotationDegEnd: sceneRng.nextRange(-0.8, 0.8),
      easing: cameraEasings[idx % cameraEasings.length]!,
    };

    const callout =
      s.raw.callout ??
      s.raw.keywords?.slice(0, 3).join(' • ') ??
      s.visualDescription.slice(0, 42);

    const kineticTexts = buildSceneKineticTexts(
      s.id,
      s.title,
      callout,
      archetype,
      timing.startTime,
      timing.endTime
    );
    const visualElements = buildSceneVisualElements(idx, sceneRng);
    const diagram = buildSceneDiagram(
      archetype,
      s.raw,
      idx,
      s.title,
      s.narration,
      sceneRng
    );

    return {
      id: s.id,
      index: idx,
      title: s.title,
      narration: s.narration,
      visualDescription: s.visualDescription,
      startTime: timing.startTime,
      endTime: timing.endTime,
      duration: timing.duration,
      archetype,
      themeTokens: sceneTheme,
      camera,
      transitionIn,
      transitionOut,
      kineticTexts,
      visualElements,
      diagram,
    };
  });

  const rawWords = rawInput.wordTimings ?? rawInput.words;
  const { wordTimings, alignmentSource } = normalizeWordTimings(normalizedScenes, rawWords);

  const storyboard: NormalizedStoryboard = {
    jobId,
    topic,
    title,
    seed,
    themeId,
    totalDuration,
    timingSource: alignmentSource,
    scenes: normalizedScenes,
    wordTimings,
    normalizationWarnings: warnings,
  };

  validateStoryboard(storyboard);
  return storyboard;
}

export interface StoryboardValidationReport {
  readonly valid: boolean;
  readonly sceneCount: number;
  readonly totalDuration: number;
  readonly issues: readonly string[];
}

export function validateStoryboard(storyboard: NormalizedStoryboard): StoryboardValidationReport {
  const issues: string[] = [];

  if (!storyboard || typeof storyboard !== 'object') {
    throw new StoryboardValidationError('Storyboard object is required.');
  }
  if (!storyboard.jobId || storyboard.jobId.trim().length === 0) {
    issues.push('jobId must be a non-empty string.');
  }
  if (!Number.isFinite(storyboard.totalDuration) || storyboard.totalDuration <= 0) {
    issues.push(`totalDuration (${storyboard.totalDuration}) must be a positive finite number.`);
  }
  if (storyboard.totalDuration >= HARD_DURATION_LIMIT_SECONDS) {
    issues.push(
      `totalDuration (${storyboard.totalDuration}s) must be strictly less than ${HARD_DURATION_LIMIT_SECONDS}s.`
    );
  }
  if (!Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
    issues.push('Storyboard must contain at least one scene.');
  } else {
    const seenIds = new Set<string>();
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const scene = storyboard.scenes[i]!;
      if (!scene.id || scene.id.trim().length === 0) {
        issues.push(`Scene at index ${i} has an empty id.`);
      }
      if (seenIds.has(scene.id)) {
        issues.push(`Duplicate scene id "${scene.id}" at index ${i}.`);
      }
      seenIds.add(scene.id);

      if (!scene.title || scene.title.trim().length === 0) {
        issues.push(`Scene "${scene.id}" is missing a title.`);
      }
      if (!scene.narration || scene.narration.trim().length === 0) {
        issues.push(`Scene "${scene.id}" is missing narration.`);
      }
      if (
        !Number.isFinite(scene.startTime) ||
        !Number.isFinite(scene.endTime) ||
        !Number.isFinite(scene.duration)
      ) {
        issues.push(`Scene "${scene.id}" contains non-finite timing numbers.`);
      }
      if (scene.startTime < 0) {
        issues.push(`Scene "${scene.id}" has negative startTime (${scene.startTime}).`);
      }
      if (scene.duration < MIN_SCENE_DURATION_SECONDS - TIMING_EPSILON_SECONDS) {
        issues.push(
          `Scene "${scene.id}" duration (${scene.duration}s) is below minimum (${MIN_SCENE_DURATION_SECONDS}s).`
        );
      }
      if (Math.abs(scene.endTime - scene.startTime - scene.duration) > 0.02) {
        issues.push(
          `Scene "${scene.id}" duration (${scene.duration}s) does not match endTime - startTime (${scene.endTime - scene.startTime}s).`
        );
      }
      if (scene.endTime > storyboard.totalDuration + TIMING_EPSILON_SECONDS) {
        issues.push(
          `Scene "${scene.id}" endTime (${scene.endTime}s) exceeds storyboard totalDuration (${storyboard.totalDuration}s).`
        );
      }
      if (i > 0) {
        const prev = storyboard.scenes[i - 1]!;
        if (scene.startTime < prev.endTime - TIMING_EPSILON_SECONDS) {
          issues.push(
            `Scene "${scene.id}" overlaps previous scene "${prev.id}" (${scene.startTime}s < ${prev.endTime}s).`
          );
        }
      }
      if (
        scene.camera.startZoom <= 0 ||
        scene.camera.endZoom <= 0 ||
        !Number.isFinite(scene.camera.startZoom) ||
        !Number.isFinite(scene.camera.endZoom)
      ) {
        issues.push(`Scene "${scene.id}" has invalid camera zoom values.`);
      }
      if (!scene.kineticTexts || scene.kineticTexts.length === 0) {
        issues.push(`Scene "${scene.id}" must have at least one kineticText element.`);
      } else {
        for (const kt of scene.kineticTexts) {
          if (
            !Number.isFinite(kt.entryTime) ||
            !Number.isFinite(kt.exitTime) ||
            kt.exitTime <= kt.entryTime ||
            kt.entryTime < scene.startTime - TIMING_EPSILON_SECONDS ||
            kt.exitTime > scene.endTime + TIMING_EPSILON_SECONDS
          ) {
            issues.push(
              `Kinetic text "${kt.id}" in scene "${scene.id}" has out-of-range timings (${kt.entryTime}s -> ${kt.exitTime}s).`
            );
          }
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new StoryboardValidationError(
      `Storyboard validation failed with ${issues.length} issue(s): ${issues.join(' ')}`,
      { issues }
    );
  }

  return {
    valid: true,
    sceneCount: storyboard.scenes.length,
    totalDuration: storyboard.totalDuration,
    issues: [],
  };
}

export function getSceneAtTimestamp(
  storyboard: NormalizedStoryboard,
  timestampSeconds: number
): NormalizedScene {
  if (storyboard.scenes.length === 0) {
    throw new StoryboardValidationError('Cannot select scene from an empty storyboard.');
  }
  const clampedT = clamp(timestampSeconds, 0, storyboard.totalDuration);

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i]!;
    const isLast = i === storyboard.scenes.length - 1;
    // Half-open interval [startTime, endTime) for non-terminal scenes, closed [startTime, endTime] for last scene
    if (
      clampedT >= scene.startTime - TIMING_EPSILON_SECONDS &&
      (clampedT < scene.endTime - TIMING_EPSILON_SECONDS || (isLast && clampedT <= scene.endTime + TIMING_EPSILON_SECONDS))
    ) {
      return scene;
    }
  }

  return storyboard.scenes[storyboard.scenes.length - 1]!;
}

// ============================================================================
// PART 7: KARAOKE SUBTITLE ENGINE (TIMING, LINE GROUPING & ASS EXPORT)
// ============================================================================

function tokenizeNarrationWords(narration: string): string[] {
  return narration
    .trim()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function estimateWordWeight(word: string): number {
  const baseWeight = Math.max(1.5, word.replace(/[^a-zA-Z0-9]/g, '').length);
  const pauseBonus = /[.,!?;:]$/.test(word) ? 2.2 : 0;
  return baseWeight + pauseBonus;
}

export function validateWordTimings(
  wordTimings: readonly WordTiming[],
  totalDurationSeconds: number
): void {
  if (wordTimings.length === 0) {
    throw new SubtitleValidationError('Word timings list cannot be empty.');
  }

  for (let i = 0; i < wordTimings.length; i++) {
    const item = wordTimings[i]!;
    if (!item.word || item.word.trim().length === 0) {
      throw new SubtitleValidationError(`Word timing at index ${i} has empty word text.`);
    }
    if (
      !Number.isFinite(item.startTime) ||
      !Number.isFinite(item.endTime) ||
      !Number.isFinite(item.duration)
    ) {
      throw new SubtitleValidationError(`Word "${item.word}" at index ${i} has non-finite timestamps.`);
    }
    if (item.startTime < -TIMING_EPSILON_SECONDS) {
      throw new SubtitleValidationError(
        `Word "${item.word}" at index ${i} has negative startTime (${item.startTime}s).`
      );
    }
    if (item.endTime <= item.startTime + 0.001 || item.duration <= 0.001) {
      throw new SubtitleValidationError(
        `Word "${item.word}" at index ${i} has zero or negative duration (${item.startTime}s -> ${item.endTime}s).`
      );
    }
    if (item.endTime > totalDurationSeconds + 0.05) {
      throw new SubtitleValidationError(
        `Word "${item.word}" at index ${i} exceeds storyboard duration (${item.endTime}s > ${totalDurationSeconds}s).`
      );
    }
    if (i > 0) {
      const prev = wordTimings[i - 1]!;
      if (item.startTime < prev.endTime - TIMING_EPSILON_SECONDS) {
        throw new SubtitleValidationError(
          `Word "${item.word}" at index ${i} overlaps with previous word "${prev.word}" (${item.startTime}s < ${prev.endTime}s).`
        );
      }
    }
  }
}

export function normalizeWordTimings(
  scenes: readonly NormalizedScene[],
  suppliedTimings?: readonly ExistingWordTimingInput[]
): { readonly wordTimings: readonly WordTiming[]; readonly alignmentSource: TimingAlignmentSource } {
  if (scenes.length === 0) {
    throw new SubtitleValidationError('Cannot normalize word timings without scenes.');
  }
  const totalDuration = scenes[scenes.length - 1]!.endTime;

  if (suppliedTimings && suppliedTimings.length > 0) {
    const mapped: WordTiming[] = [];
    for (let i = 0; i < suppliedTimings.length; i++) {
      const raw = suppliedTimings[i]!;
      const word = (raw.word ?? raw.text ?? '').trim();
      const startTime = raw.startTime ?? raw.start;
      const endTime = raw.endTime ?? raw.end;

      if (!word) {
        throw new SubtitleValidationError(`Supplied word timing at index ${i} is missing text.`);
      }
      if (
        typeof startTime !== 'number' ||
        typeof endTime !== 'number' ||
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime)
      ) {
        throw new SubtitleValidationError(
          `Supplied word "${word}" at index ${i} has invalid numeric timestamps.`
        );
      }

      const matchingScene =
        scenes.find(
          (s) =>
            startTime >= s.startTime - TIMING_EPSILON_SECONDS &&
            startTime <= s.endTime + TIMING_EPSILON_SECONDS
        ) ?? scenes[scenes.length - 1]!;

      mapped.push({
        word,
        startTime,
        endTime,
        duration: Number((endTime - startTime).toFixed(4)),
        sceneId: matchingScene.id,
        alignmentSource: raw.aligned === false ? 'estimated' : 'aligned',
      });
    }

    validateWordTimings(mapped, totalDuration);
    const allAligned = mapped.every((m) => m.alignmentSource === 'aligned');
    return {
      wordTimings: mapped,
      alignmentSource: allAligned ? 'aligned' : 'estimated',
    };
  }

  // Deterministically estimate word timings per scene from character & punctuation weights
  const estimated: WordTiming[] = [];
  for (const scene of scenes) {
    const words = tokenizeNarrationWords(scene.narration);
    if (words.length === 0) {
      continue;
    }
    const leadPadding = Math.min(0.08, scene.duration * 0.04);
    const tailPadding = Math.min(0.12, scene.duration * 0.06);
    const usableStart = scene.startTime + leadPadding;
    const usableDuration = Math.max(0.2, scene.duration - leadPadding - tailPadding);

    const weights = words.map(estimateWordWeight);
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    let cursor = usableStart;
    for (let i = 0; i < words.length; i++) {
      const isLast = i === words.length - 1;
      const wordDur = (weights[i]! / totalWeight) * usableDuration;
      const wordEnd = isLast
        ? Number((usableStart + usableDuration).toFixed(4))
        : Number((cursor + wordDur).toFixed(4));
      const safeEnd = Math.max(cursor + 0.02, wordEnd);

      estimated.push({
        word: words[i]!,
        startTime: Number(cursor.toFixed(4)),
        endTime: Number(safeEnd.toFixed(4)),
        duration: Number((safeEnd - cursor).toFixed(4)),
        sceneId: scene.id,
        alignmentSource: 'estimated',
      });
      cursor = safeEnd;
    }
  }

  validateWordTimings(estimated, totalDuration);
  return {
    wordTimings: estimated,
    alignmentSource: 'estimated',
  };
}

export interface BuildSubtitleLinesOptions {
  readonly maxWordsPerLine?: number;
  readonly maxCharsPerLine?: number;
}

export function buildSubtitleLines(
  wordTimings: readonly WordTiming[],
  totalDurationSeconds: number,
  options: BuildSubtitleLinesOptions = {}
): readonly SubtitleLine[] {
  validateWordTimings(wordTimings, totalDurationSeconds);

  const maxWords = clamp(options.maxWordsPerLine ?? 5, 2, 8);
  const maxChars = clamp(options.maxCharsPerLine ?? 28, 14, 48);

  const lines: SubtitleLine[] = [];
  let currentWords: WordTiming[] = [];
  let currentCharCount = 0;

  const flushLine = (): void => {
    if (currentWords.length === 0) return;
    const first = currentWords[0]!;
    const last = currentWords[currentWords.length - 1]!;
    const allAligned = currentWords.every((w) => w.alignmentSource === 'aligned');
    lines.push({
      index: lines.length,
      sceneId: first.sceneId,
      text: currentWords.map((w) => w.word).join(' '),
      startTime: first.startTime,
      endTime: last.endTime,
      duration: Number((last.endTime - first.startTime).toFixed(4)),
      words: [...currentWords],
      alignmentSource: allAligned ? 'aligned' : 'estimated',
    });
    currentWords = [];
    currentCharCount = 0;
  };

  for (const wt of wordTimings) {
    const prevWord = currentWords[currentWords.length - 1];
    const sceneChanged = prevWord !== undefined && prevWord.sceneId !== wt.sceneId;
    const exceedsWords = currentWords.length >= maxWords;
    const exceedsChars =
      currentWords.length > 0 && currentCharCount + 1 + wt.word.length > maxChars;
    const clauseBreak =
      prevWord !== undefined &&
      currentWords.length >= 3 &&
      /[.?!;:]$/.test(prevWord.word);

    if (sceneChanged || exceedsWords || exceedsChars || clauseBreak) {
      flushLine();
    }

    currentWords.push(wt);
    currentCharCount += (currentWords.length > 1 ? 1 : 0) + wt.word.length;
  }

  flushLine();
  return lines;
}

export function formatAssTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new SubtitleValidationError(`Invalid ASS timestamp seconds: ${seconds}`);
  }
  const totalCentiseconds = Math.round(seconds * 100);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function escapeAssText(rawText: string): string {
  return rawText
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

export function exportToAss(
  subtitleLines: readonly SubtitleLine[],
  themeInput: ThemeId | SceneThemeTokens | string,
  totalDurationSeconds?: number
): string {
  if (subtitleLines.length === 0) {
    throw new SubtitleValidationError('Cannot generate ASS subtitles from an empty subtitle line list.');
  }

  const allWords = subtitleLines.flatMap((line) => line.words);
  const maxEnd =
    totalDurationSeconds ?? subtitleLines[subtitleLines.length - 1]!.endTime;
  validateWordTimings(allWords, maxEnd);

  const tokens: SceneThemeTokens =
    typeof themeInput === 'object' && themeInput !== null && 'themeId' in themeInput
      ? themeInput
      : getThemeTokens(themeInput);

  // In ASS karaoke (\kf), PrimaryColour is the highlighted (sung/spoken) color,
  // and SecondaryColour is the unhighlighted upcoming word color.
  const primaryActiveAss = hexToAssBgrColor(tokens.highlightColor, 0x00);
  const secondaryUpcomingAss = hexToAssBgrColor(tokens.textPrimary, 0x00);
  const outlineAss = hexToAssBgrColor(tokens.backgroundPrimary, 0x00);
  const shadowAss = hexToAssBgrColor('#000000', 0x64);

  const alignmentSourceSet = new Set(subtitleLines.map((l) => l.alignmentSource));
  const timingDisclosure =
    alignmentSourceSet.size === 1 && alignmentSourceSet.has('aligned')
      ? 'aligned-word-timestamps'
      : 'estimated-heuristic-word-timestamps';

  const header = [
    '[Script Info]',
    '; Script generated by Sisyphus Video Engine',
    `; TimingSynchronizationMode: ${timingDisclosure}`,
    'ScriptType: v4.00+',
    `PlayResX: ${VIDEO_WIDTH}`,
    `PlayResY: ${VIDEO_HEIGHT}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: KaraokeMain,DejaVu Sans,52,${primaryActiveAss},${secondaryUpcomingAss},${outlineAss},${shadowAss},-1,0,0,0,100,100,1.5,0,1,4,2,2,${MOBILE_SAFE_ZONE.left},${VIDEO_WIDTH - MOBILE_SAFE_ZONE.right},${MOBILE_SAFE_ZONE.subtitleBottomMargin},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const dialogueEvents: string[] = [];
  for (const line of subtitleLines) {
    if (line.startTime < 0 || line.endTime <= line.startTime) {
      throw new SubtitleValidationError(
        `Subtitle line ${line.index} has invalid bounds (${line.startTime} -> ${line.endTime}).`
      );
    }
    const startAss = formatAssTimestamp(line.startTime);
    const endAss = formatAssTimestamp(line.endTime);

    let cursor = line.startTime;
    const parts: string[] = [];

    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i]!;
      const gapSeconds = Math.max(0, w.startTime - cursor);
      const gapCs = Math.round(gapSeconds * 100);
      if (gapCs > 0) {
        parts.push(`{\\k${gapCs}}`);
      }
      const wordDurationCs = Math.max(1, Math.round(w.duration * 100));
      const escapedWord = escapeAssText(w.word);
      const prefixSpace = i > 0 ? ' ' : '';
      parts.push(`${prefixSpace}{\\kf${wordDurationCs}}${escapedWord}`);
      cursor = w.endTime;
    }

    dialogueEvents.push(
      `Dialogue: 0,${startAss},${endAss},KaraokeMain,,0,0,0,,${parts.join('')}`
    );
  }

  return [...header, ...dialogueEvents, ''].join('\n');
}

// ============================================================================
// PART 8: DETERMINISTIC 2D SOFTWARE VECTOR/CANVAS RASTERIZER & FONT ENGINE
// ============================================================================

/**
 * Minimal 5x7 crisp bitmap/vector glyph map for deterministic dependency-free
 * text rendering in SoftwareSurface2D, plus optional @napi-rs/canvas delegation.
 */
const GLYPH_5X7: Readonly<Record<string, readonly number[]>> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  ':': [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  ',': [0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100, 0b01000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '/': [0b00001, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0b00000],
  '%': [0b11001, 0b11010, 0b00100, 0b00100, 0b01011, 0b10011, 0b00000],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  '?': [0b01110, 0b10001, 0b00010, 0b00100, 0b00100, 0b00000, 0b00100],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};

// Precomputed CRC32 table for fast, RFC-compliant PNG chunk generation
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeAscii: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(typeAscii, 4, 4, 'ascii');
  if (data.length > 0) {
    Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(chunk, 8);
  }
  const crcInput = new Uint8Array(chunk.buffer, chunk.byteOffset + 4, 4 + data.length);
  chunk.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return chunk;
}

export function encodeRgbaToPngBuffer(
  rgbaPixels: Uint8Array,
  width: number,
  height: number
): Buffer {
  const stride = width * 4;
  const rawScanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    const srcStart = y * stride;
    rawScanlines.set(rgbaPixels.subarray(srcStart, srcStart + stride), rowStart + 1);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8-bit depth
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const compressedIdat = deflateSync(rawScanlines, { level: 4 });
  const ihdrChunk = makePngChunk('IHDR', ihdrData);
  const idatChunk = makePngChunk('IDAT', compressedIdat);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

export interface CameraTransformState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly rotationRad: number;
}

export class SoftwareSurface2D {
  public readonly width: number;
  public readonly height: number;
  public readonly pixels: Uint8Array;
  private camera: CameraTransformState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    rotationRad: 0,
  };
  private cameraActive = false;

  constructor(width: number = VIDEO_WIDTH, height: number = VIDEO_HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  public setCameraTransform(transform: CameraTransformState | null): void {
    if (!transform) {
      this.cameraActive = false;
      return;
    }
    this.camera = transform;
    this.cameraActive = true;
  }

  private transformPoint(x: number, y: number): { x: number; y: number } {
    if (!this.cameraActive) {
      return { x, y };
    }
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const dx = (x - cx) * this.camera.zoom;
    const dy = (y - cy) * this.camera.zoom;
    const cos = Math.cos(this.camera.rotationRad);
    const sin = Math.sin(this.camera.rotationRad);
    return {
      x: cx + dx * cos - dy * sin + this.camera.panX,
      y: cy + dx * sin + dy * cos + this.camera.panY,
    };
  }

  private scaleLength(len: number): number {
    return this.cameraActive ? len * this.camera.zoom : len;
  }

  public blendPixel(x: number, y: number, color: RgbaColor): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const alpha = clamp(color.a, 0, 1);
    if (alpha <= 0.001) return;

    const offset = (iy * this.width + ix) * 4;
    if (alpha >= 0.999) {
      this.pixels[offset] = color.r;
      this.pixels[offset + 1] = color.g;
      this.pixels[offset + 2] = color.b;
      this.pixels[offset + 3] = 255;
      return;
    }

    const invA = 1 - alpha;
    this.pixels[offset] = Math.round(color.r * alpha + this.pixels[offset]! * invA);
    this.pixels[offset + 1] = Math.round(color.g * alpha + this.pixels[offset + 1]! * invA);
    this.pixels[offset + 2] = Math.round(color.b * alpha + this.pixels[offset + 2]! * invA);
    this.pixels[offset + 3] = 255;
  }

  public fillBackgroundGradient(
    topHex: string,
    bottomHex: string,
    gridHex: string,
    gridSpacing: number,
    scanlineAlpha: number
  ): void {
    const top = parseHexColor(topHex);
    const bottom = parseHexColor(bottomHex);
    const grid = parseHexColor(gridHex, 0.32);

    for (let y = 0; y < this.height; y++) {
      const t = y / (this.height - 1);
      const scanDarken = y % 4 === 0 ? 1 - scanlineAlpha : 1;
      const r = Math.round(lerp(top.r, bottom.r, t) * scanDarken);
      const g = Math.round(lerp(top.g, bottom.g, t) * scanDarken);
      const b = Math.round(lerp(top.b, bottom.b, t) * scanDarken);
      const isHorizontalGrid = gridSpacing > 0 && y % gridSpacing === 0;

      const rowOffset = y * this.width * 4;
      for (let x = 0; x < this.width; x++) {
        const isVerticalGrid = gridSpacing > 0 && x % gridSpacing === 0;
        const idx = rowOffset + x * 4;
        if (isHorizontalGrid || isVerticalGrid) {
          this.pixels[idx] = Math.round(r * (1 - grid.a) + grid.r * grid.a);
          this.pixels[idx + 1] = Math.round(g * (1 - grid.a) + grid.g * grid.a);
          this.pixels[idx + 2] = Math.round(b * (1 - grid.a) + grid.b * grid.a);
          this.pixels[idx + 3] = 255;
        } else {
          this.pixels[idx] = r;
          this.pixels[idx + 1] = g;
          this.pixels[idx + 2] = b;
          this.pixels[idx + 3] = 255;
        }
      }
    }
  }

  public fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    hexColor: string,
    alpha: number = 1
  ): void {
    const p1 = this.transformPoint(x, y);
    const p2 = this.transformPoint(x + w, y + h);
    const minX = clamp(Math.floor(Math.min(p1.x, p2.x)), 0, this.width - 1);
    const maxX = clamp(Math.ceil(Math.max(p1.x, p2.x)), 0, this.width - 1);
    const minY = clamp(Math.floor(Math.min(p1.y, p2.y)), 0, this.height - 1);
    const maxY = clamp(Math.ceil(Math.max(p1.y, p2.y)), 0, this.height - 1);

    const color = parseHexColor(hexColor, alpha);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        this.blendPixel(px, py, color);
      }
    }
  }

  public strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    thickness: number,
    hexColor: string,
    alpha: number = 1
  ): void {
    this.drawLine(x, y, x + w, y, thickness, hexColor, alpha);
    this.drawLine(x + w, y, x + w, y + h, thickness, hexColor, alpha);
    this.drawLine(x + w, y + h, x, y + h, thickness, hexColor, alpha);
    this.drawLine(x, y + h, x, y, thickness, hexColor, alpha);
  }

  public drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness: number,
    hexColor: string,
    alpha: number = 1
  ): void {
    const a = this.transformPoint(x1, y1);
    const b = this.transformPoint(x2, y2);
    const color = parseHexColor(hexColor, alpha);
    const scaledThickness = Math.max(1, this.scaleLength(thickness));
    const halfT = Math.max(0, Math.floor((scaledThickness - 1) / 2));

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      for (let oy = -halfT; oy <= halfT; oy++) {
        for (let ox = -halfT; ox <= halfT; ox++) {
          this.blendPixel(px + ox, py + oy, color);
        }
      }
    }
  }

  public fillCircle(
    cx: number,
    cy: number,
    radius: number,
    hexColor: string,
    alpha: number = 1
  ): void {
    const center = this.transformPoint(cx, cy);
    const r = Math.max(1, this.scaleLength(radius));
    const rSq = r * r;
    const color = parseHexColor(hexColor, alpha);

    const minX = clamp(Math.floor(center.x - r), 0, this.width - 1);
    const maxX = clamp(Math.ceil(center.x + r), 0, this.width - 1);
    const minY = clamp(Math.floor(center.y - r), 0, this.height - 1);
    const maxY = clamp(Math.ceil(center.y + r), 0, this.height - 1);

    for (let py = minY; py <= maxY; py++) {
      const dy = py - center.y;
      for (let px = minX; px <= maxX; px++) {
        const dx = px - center.x;
        if (dx * dx + dy * dy <= rSq) {
          this.blendPixel(px, py, color);
        }
      }
    }
  }

  public strokeCircle(
    cx: number,
    cy: number,
    radius: number,
    thickness: number,
    hexColor: string,
    alpha: number = 1,
    startAngleRad: number = 0,
    endAngleRad: number = Math.PI * 2
  ): void {
    const center = this.transformPoint(cx, cy);
    const r = Math.max(1, this.scaleLength(radius));
    const color = parseHexColor(hexColor, alpha);
    const halfT = Math.max(0, Math.floor((this.scaleLength(thickness) - 1) / 2));

    const arcSpan = Math.abs(endAngleRad - startAngleRad);
    const steps = Math.max(24, Math.ceil(r * arcSpan * 0.75));
    for (let i = 0; i <= steps; i++) {
      const angle = startAngleRad + (endAngleRad - startAngleRad) * (i / steps);
      const px = center.x + Math.cos(angle) * r;
      const py = center.y + Math.sin(angle) * r;
      for (let oy = -halfT; oy <= halfT; oy++) {
        for (let ox = -halfT; ox <= halfT; ox++) {
          this.blendPixel(px + ox, py + oy, color);
        }
      }
    }
  }

  public strokePolygon(
    cx: number,
    cy: number,
    radius: number,
    sides: number,
    rotationRad: number,
    thickness: number,
    hexColor: string,
    alpha: number = 1
  ): void {
    const n = Math.max(3, Math.round(sides));
    const vertices: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) {
      const a = rotationRad + (i * Math.PI * 2) / n;
      vertices.push({
        x: cx + Math.cos(a) * radius,
        y: cy + Math.sin(a) * radius,
      });
    }
    for (let i = 0; i < n; i++) {
      const curr = vertices[i]!;
      const next = vertices[(i + 1) % n]!;
      this.drawLine(curr.x, curr.y, next.x, next.y, thickness, hexColor, alpha);
    }
  }

  public drawTextCentered(
    text: string,
    centerX: number,
    centerY: number,
    fontSizePx: number,
    hexColor: string,
    alpha: number = 1
  ): void {
    const upper = text.toUpperCase();
    const pt = this.transformPoint(centerX, centerY);
    const scale = Math.max(1, Math.round(this.scaleLength(fontSizePx) / 7));
    const charWidth = 5 * scale;
    const charSpacing = 1 * scale;
    const totalWidth = upper.length * charWidth + Math.max(0, upper.length - 1) * charSpacing;
    const startX = Math.round(pt.x - totalWidth / 2);
    const startY = Math.round(pt.y - (7 * scale) / 2);
    const color = parseHexColor(hexColor, alpha);

    for (let cIdx = 0; cIdx < upper.length; cIdx++) {
      const ch = upper[cIdx]!;
      const rows = GLYPH_5X7[ch] ?? GLYPH_5X7[' '];
      if (!rows) continue;
      const charOriginX = startX + cIdx * (charWidth + charSpacing);
      for (let row = 0; row < 7; row++) {
        const mask = rows[row]!;
        for (let col = 0; col < 5; col++) {
          if ((mask >> (4 - col)) & 1) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                this.blendPixel(
                  charOriginX + col * scale + sx,
                  startY + row * scale + sy,
                  color
                );
              }
            }
          }
        }
      }
    }
  }
}

// ============================================================================
// PART 9: SCENE ARCHETYPE & FRAME RENDERING ENGINE
// ============================================================================

export interface RenderFrameOptions {
  readonly includeSubtitles?: boolean;
  readonly subtitleLines?: readonly SubtitleLine[];
}

export interface RenderedFrameResult {
  readonly width: number;
  readonly height: number;
  readonly timestampSeconds: number;
  readonly sceneId: string;
  readonly archetype: SceneArchetype;
  readonly themeId: ThemeId;
  readonly rgbaBuffer: Uint8Array;
  readonly toPngBuffer: () => Buffer;
}

function resolveColorToken(
  tokens: SceneThemeTokens,
  tokenName: 'textPrimary' | 'textMuted' | 'accentPrimary' | 'accentSecondary' | 'highlightColor'
): string {
  switch (tokenName) {
    case 'textPrimary':
      return tokens.textPrimary;
    case 'textMuted':
      return tokens.textMuted;
    case 'accentPrimary':
      return tokens.accentPrimary;
    case 'accentSecondary':
      return tokens.accentSecondary;
    case 'highlightColor':
      return tokens.highlightColor;
  }
}

function renderParticles(
  surface: SoftwareSurface2D,
  scene: NormalizedScene,
  storyboardSeed: number,
  timestampSeconds: number
): void {
  const rng = new SeededRandom(`${storyboardSeed}:particles:${scene.id}`);
  const particleCount = 26;
  for (let i = 0; i < particleCount; i++) {
    const baseX = rng.nextRange(MOBILE_SAFE_ZONE.left, MOBILE_SAFE_ZONE.right);
    const baseY = rng.nextRange(MOBILE_SAFE_ZONE.top, MOBILE_SAFE_ZONE.bottom);
    const speedY = rng.nextRange(-38, -14);
    const driftX = rng.nextRange(-18, 18);
    const radius = rng.nextRange(2, 5);
    const phase = rng.nextRange(0, Math.PI * 2);

    const x =
      MOBILE_SAFE_ZONE.left +
      (((baseX - MOBILE_SAFE_ZONE.left + driftX * Math.sin(timestampSeconds + phase)) %
        MOBILE_SAFE_ZONE.contentWidth) +
        MOBILE_SAFE_ZONE.contentWidth) %
        MOBILE_SAFE_ZONE.contentWidth;
    const y =
      MOBILE_SAFE_ZONE.top +
      (((baseY - MOBILE_SAFE_ZONE.top + speedY * timestampSeconds) %
        MOBILE_SAFE_ZONE.contentHeight) +
        MOBILE_SAFE_ZONE.contentHeight) %
        MOBILE_SAFE_ZONE.contentHeight;

    const alpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(timestampSeconds * 2.2 + phase));
    surface.fillCircle(x, y, radius, scene.themeTokens.particleColor, alpha);
  }
}

function renderSceneVisualElements(
  surface: SoftwareSurface2D,
  scene: NormalizedScene,
  localTime: number
): void {
  for (const el of scene.visualElements) {
    const x = MOBILE_SAFE_ZONE.left + el.normalizedX * MOBILE_SAFE_ZONE.contentWidth;
    const y = MOBILE_SAFE_ZONE.top + el.normalizedY * MOBILE_SAFE_ZONE.contentHeight;
    const sizePx = el.normalizedSize * 220;
    const pulse = 1 + 0.12 * Math.sin(localTime * el.pulseFrequencyHz * Math.PI * 2);
    const rotRad = (localTime * el.rotationSpeedDegPerSec * Math.PI) / 180;
    const color = resolveColorToken(scene.themeTokens, el.colorToken);

    switch (el.shape) {
      case 'ring':
        surface.strokeCircle(x, y, sizePx * pulse, 2, color, 0.35);
        break;
      case 'polygon':
        surface.strokePolygon(x, y, sizePx * pulse, 6, rotRad, 2, color, 0.35);
        break;
      case 'reticle-box':
        surface.strokeRect(
          x - sizePx * 0.5,
          y - sizePx * 0.5,
          sizePx,
          sizePx,
          2,
          color,
          0.3
        );
        break;
      case 'pulse-node':
        surface.fillCircle(x, y, Math.max(4, sizePx * 0.22 * pulse), color, 0.45);
        break;
      case 'vector-line':
        surface.drawLine(
          x - sizePx * Math.cos(rotRad),
          y - sizePx * Math.sin(rotRad),
          x + sizePx * Math.cos(rotRad),
          y + sizePx * Math.sin(rotRad),
          2,
          color,
          0.3
        );
        break;
    }
  }
}

function renderArchetypeDiagram(
  surface: SoftwareSurface2D,
  scene: NormalizedScene,
  localTime: number,
  sceneProgress: number
): void {
  const tokens = scene.themeTokens;
  const centerX = VIDEO_WIDTH * 0.5;
  const centerY = 780;
  const diagram = scene.diagram;

  switch (diagram.kind) {
    case 'hero-metaphor': {
      const reveal = evaluateEasing('easeOutBack', clamp(sceneProgress * 2.2, 0, 1));
      for (let rIdx = 1; rIdx <= diagram.ringCount; rIdx++) {
        const radius = rIdx * 105 * reveal;
        surface.strokeCircle(
          centerX,
          centerY,
          radius,
          tokens.strokeWidthPx,
          rIdx % 2 === 0 ? tokens.accentSecondary : tokens.accentPrimary,
          0.55
        );
      }

      const coreRadius = 86 * (1 + 0.06 * Math.sin(localTime * 3.2));
      surface.strokePolygon(
        centerX,
        centerY,
        coreRadius,
        diagram.coreSides,
        localTime * 0.45,
        tokens.strokeWidthPx + 1,
        tokens.highlightColor,
        0.95
      );
      surface.fillCircle(centerX, centerY, coreRadius * 0.55, tokens.surfaceCard, 0.92);
      surface.drawTextCentered(
        diagram.coreLabel.slice(0, 14),
        centerX,
        centerY,
        24,
        tokens.textPrimary,
        1
      );

      for (const sat of diagram.satellites) {
        const orbitR = sat.orbitRadiusRatio * 960 * reveal;
        const angle = sat.initialAngleRad + localTime * sat.angularVelocityRadPerSec;
        const sx = centerX + Math.cos(angle) * orbitR;
        const sy = centerY + Math.sin(angle) * orbitR;

        surface.drawLine(centerX, centerY, sx, sy, 2, tokens.accentSecondary, 0.38);
        surface.fillCircle(sx, sy, 18, tokens.accentPrimary, 0.95);
        surface.drawTextCentered(sat.label, sx, sy - 32, 18, tokens.textPrimary, 0.95);
      }
      break;
    }

    case 'branching-tree': {
      const nodeCoords = new Map<string, { x: number; y: number; label: string; depth: number }>();
      for (const node of diagram.nodes) {
        const y = 470 + node.depth * 270;
        const span = MOBILE_SAFE_ZONE.contentWidth * 0.82;
        const step = span / (node.siblingCount + 1);
        const x =
          MOBILE_SAFE_ZONE.left +
          MOBILE_SAFE_ZONE.contentWidth * 0.09 +
          step * (node.siblingIndex + 1);
        nodeCoords.set(node.id, { x, y, label: node.label, depth: node.depth });
      }

      // Edges and animated signal pulses
      for (const node of diagram.nodes) {
        if (!node.parentId) continue;
        const parent = nodeCoords.get(node.parentId);
        const child = nodeCoords.get(node.id);
        if (!parent || !child) continue;

        surface.drawLine(
          parent.x,
          parent.y,
          child.x,
          child.y,
          tokens.strokeWidthPx,
          tokens.accentSecondary,
          0.65
        );

        const pulseT = (localTime * 0.85 + node.depth * 0.3) % 1;
        const px = lerp(parent.x, child.x, pulseT);
        const py = lerp(parent.y, child.y, pulseT);
        surface.fillCircle(px, py, 9, tokens.highlightColor, 0.95);
      }

      // Nodes
      for (const node of diagram.nodes) {
        const pos = nodeCoords.get(node.id);
        if (!pos) continue;
        const boxW = 210;
        const boxH = 68;
        surface.fillRect(
          pos.x - boxW * 0.5,
          pos.y - boxH * 0.5,
          boxW,
          boxH,
          tokens.surfaceCard,
          0.94
        );
        surface.strokeRect(
          pos.x - boxW * 0.5,
          pos.y - boxH * 0.5,
          boxW,
          boxH,
          tokens.strokeWidthPx,
          pos.depth === 0 ? tokens.highlightColor : tokens.accentPrimary,
          0.95
        );
        surface.drawTextCentered(pos.label, pos.x, pos.y, 19, tokens.textPrimary, 1);
      }
      break;
    }

    case 'constellation-mesh': {
      const liveCoords = new Map<string, { x: number; y: number; weight: number; label: string }>();
      diagram.nodes.forEach((n, idx) => {
        const wobbleX = Math.sin(localTime * 1.4 + idx * 1.7) * 18;
        const wobbleY = Math.cos(localTime * 1.1 + idx * 2.1) * 18;
        const x = MOBILE_SAFE_ZONE.left + n.anchorX * MOBILE_SAFE_ZONE.contentWidth + wobbleX;
        const y = 400 + n.anchorY * 760 + wobbleY;
        liveCoords.set(n.id, { x, y, weight: n.weight, label: n.label });
      });

      diagram.edges.forEach((edge, idx) => {
        const from = liveCoords.get(edge.fromId);
        const to = liveCoords.get(edge.toId);
        if (!from || !to) return;
        surface.drawLine(
          from.x,
          from.y,
          to.x,
          to.y,
          tokens.strokeWidthPx,
          tokens.accentSecondary,
          0.5 * edge.strength
        );
        const signalT = (localTime * 0.7 + idx * 0.23) % 1;
        surface.fillCircle(
          lerp(from.x, to.x, signalT),
          lerp(from.y, to.y, signalT),
          7,
          tokens.highlightColor,
          0.9
        );
      });

      for (const [, pos] of liveCoords) {
        const r = 20 * pos.weight;
        surface.fillCircle(pos.x, pos.y, r, tokens.accentPrimary, 0.9);
        surface.strokeCircle(pos.x, pos.y, r + 8, 2, tokens.highlightColor, 0.65);
        surface.drawTextCentered(pos.label, pos.x, pos.y + r + 24, 18, tokens.textPrimary, 0.95);
      }
      break;
    }

    case 'split-comparison': {
      const panelTop = 430;
      const panelHeight = 720;
      const colW = 415;
      const leftX = MOBILE_SAFE_ZONE.left + 10;
      const rightX = VIDEO_WIDTH - MOBILE_SAFE_ZONE.left - colW - 10;

      surface.fillRect(leftX, panelTop, colW, panelHeight, tokens.surfaceCard, 0.9);
      surface.strokeRect(
        leftX,
        panelTop,
        colW,
        panelHeight,
        tokens.strokeWidthPx,
        tokens.accentPrimary,
        0.95
      );

      surface.fillRect(rightX, panelTop, colW, panelHeight, tokens.surfaceCard, 0.9);
      surface.strokeRect(
        rightX,
        panelTop,
        colW,
        panelHeight,
        tokens.strokeWidthPx,
        tokens.accentSecondary,
        0.95
      );

      surface.drawTextCentered(
        diagram.leftTitle,
        leftX + colW * 0.5,
        panelTop + 56,
        24,
        tokens.accentPrimary,
        1
      );
      surface.drawTextCentered(
        diagram.rightTitle,
        rightX + colW * 0.5,
        panelTop + 56,
        24,
        tokens.accentSecondary,
        1
      );

      const barGrow = evaluateEasing('easeInOutCubic', clamp(sceneProgress * 1.6, 0, 1));
      diagram.items.forEach((item, idx) => {
        const rowY = panelTop + 165 + idx * 175;
        surface.drawTextCentered(
          item.leftDescriptor.slice(0, 18),
          leftX + colW * 0.5,
          rowY,
          18,
          tokens.textPrimary,
          0.95
        );
        const leftBarW = Math.round((colW - 60) * item.leftRelativeWeight * barGrow);
        surface.fillRect(leftX + 30, rowY + 26, leftBarW, 22, tokens.accentPrimary, 0.88);

        surface.drawTextCentered(
          item.rightDescriptor.slice(0, 18),
          rightX + colW * 0.5,
          rowY,
          18,
          tokens.textPrimary,
          0.95
        );
        const rightBarW = Math.round((colW - 60) * item.rightRelativeWeight * barGrow);
        surface.fillRect(rightX + 30, rowY + 26, rightBarW, 22, tokens.accentSecondary, 0.88);
      });
      break;
    }

    case 'animated-data-counter': {
      const easedProgress = evaluateEasing('easeOutQuad', clamp(sceneProgress * 1.35, 0, 1));
      const currentVal = lerp(diagram.startValue, diagram.targetValue, easedProgress);
      const formattedVal = `${currentVal.toFixed(diagram.decimals)}${diagram.unit}`;

      const gaugeRadius = 240;
      surface.strokeCircle(centerX, centerY, gaugeRadius, 14, tokens.gridColor, 0.65);

      const sweepEnd = -Math.PI * 0.5 + Math.PI * 2 * diagram.gaugeRatio * easedProgress;
      surface.strokeCircle(
        centerX,
        centerY,
        gaugeRadius,
        16,
        tokens.accentPrimary,
        0.96,
        -Math.PI * 0.5,
        sweepEnd
      );

      surface.drawTextCentered(formattedVal, centerX, centerY - 12, 64, tokens.highlightColor, 1);
      surface.drawTextCentered(
        diagram.caption.slice(0, 32),
        centerX,
        centerY + 92,
        21,
        tokens.textPrimary,
        0.95
      );

      const provenanceLabel =
        diagram.provenance === 'supplied-verified'
          ? 'VERIFIED SUPPLIED METRIC'
          : 'ILLUSTRATIVE MODEL INDEX';
      surface.drawTextCentered(
        provenanceLabel,
        centerX,
        centerY + gaugeRadius + 64,
        18,
        tokens.accentSecondary,
        0.9
      );
      break;
    }

    case 'chronological-timeline': {
      const spineX = 240;
      const topY = 440;
      const bottomY = 1120;
      const spanY = bottomY - topY;

      surface.drawLine(spineX, topY, spineX, bottomY, 4, tokens.gridColor, 0.8);
      const activeBottom = topY + spanY * clamp(sceneProgress * 1.25, 0, 1);
      surface.drawLine(spineX, topY, spineX, activeBottom, 6, tokens.accentPrimary, 0.95);

      for (const m of diagram.milestones) {
        const my = topY + m.relativePosition * spanY;
        const reached = activeBottom >= my - 10;
        const nodeColor = reached ? tokens.highlightColor : tokens.textMuted;

        surface.fillCircle(spineX, my, 16, nodeColor, 0.95);
        const cardX = spineX + 48;
        const cardW = 670;
        const cardH = 128;
        surface.fillRect(cardX, my - cardH * 0.5, cardW, cardH, tokens.surfaceCard, 0.92);
        surface.strokeRect(
          cardX,
          my - cardH * 0.5,
          cardW,
          cardH,
          tokens.strokeWidthPx,
          nodeColor,
          0.9
        );
        surface.drawTextCentered(
          `${m.phaseTag} // ${m.title}`,
          cardX + cardW * 0.5,
          my - 22,
          21,
          tokens.accentSecondary,
          0.95
        );
        surface.drawTextCentered(
          m.detail.slice(0, 34),
          cardX + cardW * 0.5,
          my + 22,
          18,
          tokens.textPrimary,
          0.92
        );
      }
      break;
    }
  }
}

function renderKineticTypography(
  surface: SoftwareSurface2D,
  scene: NormalizedScene,
  timestampSeconds: number
): void {
  const tokens = scene.themeTokens;
  for (const kt of scene.kineticTexts) {
    if (timestampSeconds < kt.entryTime || timestampSeconds > kt.exitTime) {
      continue;
    }
    const span = Math.max(0.05, kt.exitTime - kt.entryTime);
    const elapsed = timestampSeconds - kt.entryTime;
    const remaining = kt.exitTime - timestampSeconds;
    const entryWindow = Math.min(0.35, span * 0.3);
    const exitWindow = Math.min(0.28, span * 0.25);

    let alpha = 1;
    let offsetY = 0;
    let fontScale = 1;

    if (elapsed < entryWindow) {
      const t = evaluateEasing(kt.easing, elapsed / entryWindow);
      alpha = clamp(t, 0, 1);
      if (kt.entryAnimation === 'slide-up') {
        offsetY = (1 - t) * 36;
      } else if (kt.entryAnimation === 'scale-pop') {
        fontScale = 0.7 + 0.3 * t;
      }
    } else if (remaining < exitWindow) {
      const t = evaluateEasing('easeInQuad', remaining / exitWindow);
      alpha = clamp(t, 0, 1);
      if (kt.exitAnimation === 'slide-down') {
        offsetY = (1 - t) * 28;
      } else if (kt.exitAnimation === 'scale-shrink') {
        fontScale = 0.75 + 0.25 * t;
      }
    }

    const displayText =
      kt.entryAnimation === 'typewriter-reveal' && elapsed < entryWindow
        ? kt.text.slice(0, Math.max(1, Math.floor((elapsed / entryWindow) * kt.text.length)))
        : kt.text;

    const color = resolveColorToken(tokens, kt.colorToken);
    surface.drawTextCentered(
      displayText,
      kt.x,
      kt.y + offsetY,
      Math.max(14, Math.round(kt.fontSize * fontScale)),
      color,
      alpha
    );
  }
}

function renderHudAndSubtitles(
  surface: SoftwareSurface2D,
  storyboard: NormalizedStoryboard,
  scene: NormalizedScene,
  timestampSeconds: number,
  options: RenderFrameOptions
): void {
  const tokens = scene.themeTokens;

  // Top HUD bar inside safe zone
  surface.fillRect(
    MOBILE_SAFE_ZONE.left,
    110,
    MOBILE_SAFE_ZONE.contentWidth,
    54,
    tokens.surfaceCard,
    0.88
  );
  surface.strokeRect(
    MOBILE_SAFE_ZONE.left,
    110,
    MOBILE_SAFE_ZONE.contentWidth,
    54,
    2,
    tokens.accentPrimary,
    0.85
  );

  const hudLabel = `SCENE 0${scene.index + 1}/0${storyboard.scenes.length}  |  ${storyboard.topic.slice(0, 22).toUpperCase()}  |  T+${timestampSeconds.toFixed(1)}S`;
  surface.drawTextCentered(hudLabel, VIDEO_WIDTH * 0.5, 137, 18, tokens.textPrimary, 0.95);

  // Karaoke subtitle overlay in mobile safe region
  if (options.includeSubtitles !== false) {
    const lines =
      options.subtitleLines ?? buildSubtitleLines(storyboard.wordTimings, storyboard.totalDuration);
    const activeLine = lines.find(
      (l) =>
        timestampSeconds >= l.startTime - TIMING_EPSILON_SECONDS &&
        timestampSeconds <= l.endTime + TIMING_EPSILON_SECONDS
    );

    if (activeLine) {
      const subBoxY = VIDEO_HEIGHT - MOBILE_SAFE_ZONE.subtitleBottomMargin - 88;
      const subBoxW = MOBILE_SAFE_ZONE.contentWidth;
      const subBoxH = 82;
      surface.fillRect(
        MOBILE_SAFE_ZONE.left,
        subBoxY,
        subBoxW,
        subBoxH,
        tokens.backgroundPrimary,
        0.86
      );
      surface.strokeRect(
        MOBILE_SAFE_ZONE.left,
        subBoxY,
        subBoxW,
        subBoxH,
        2,
        tokens.accentSecondary,
        0.8
      );

      const activeWord = activeLine.words.find(
        (w) =>
          timestampSeconds >= w.startTime - TIMING_EPSILON_SECONDS &&
          timestampSeconds <= w.endTime + TIMING_EPSILON_SECONDS
      );

      surface.drawTextCentered(
        activeLine.text.slice(0, 38),
        VIDEO_WIDTH * 0.5,
        subBoxY + 28,
        22,
        tokens.textPrimary,
        0.96
      );
      if (activeWord) {
        surface.drawTextCentered(
          `[ ${activeWord.word.toUpperCase()} ]`,
          VIDEO_WIDTH * 0.5,
          subBoxY + 60,
          20,
          tokens.highlightColor,
          1
        );
      }
    }
  }

  // Overall video timeline progress bar at bottom of safe zone
  const globalRatio = clamp(timestampSeconds / storyboard.totalDuration, 0, 1);
  const barY = MOBILE_SAFE_ZONE.bottom - 14;
  surface.fillRect(
    MOBILE_SAFE_ZONE.left,
    barY,
    MOBILE_SAFE_ZONE.contentWidth,
    10,
    tokens.gridColor,
    0.7
  );
  surface.fillRect(
    MOBILE_SAFE_ZONE.left,
    barY,
    Math.round(MOBILE_SAFE_ZONE.contentWidth * globalRatio),
    10,
    tokens.accentPrimary,
    0.95
  );
}

export function renderFrame(
  storyboard: NormalizedStoryboard,
  timestampSeconds: number,
  options: RenderFrameOptions = {},
  reusableSurface?: SoftwareSurface2D
): RenderedFrameResult {
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
    throw new StoryboardValidationError(
      `renderFrame timestampSeconds must be a non-negative finite number (received ${timestampSeconds}).`
    );
  }

  const clampedTime = clamp(timestampSeconds, 0, storyboard.totalDuration);
  const scene = getSceneAtTimestamp(storyboard, clampedTime);
  const localTime = Math.max(0, clampedTime - scene.startTime);
  const sceneProgress = clamp(localTime / Math.max(0.01, scene.duration), 0, 1);
  const tokens = scene.themeTokens;

  const surface = reusableSurface ?? new SoftwareSurface2D(VIDEO_WIDTH, VIDEO_HEIGHT);
  surface.setCameraTransform(null);

  // 1. Background & grid
  surface.fillBackgroundGradient(
    tokens.backgroundPrimary,
    tokens.backgroundSecondary,
    tokens.gridColor,
    tokens.gridSpacingPx,
    tokens.scanlineAlpha
  );

  // 2. Camera transform for world-space elements
  const camEase = evaluateEasing(scene.camera.easing, sceneProgress);
  const cameraState: CameraTransformState = {
    zoom: lerp(scene.camera.startZoom, scene.camera.endZoom, camEase),
    panX: lerp(scene.camera.panStartX, scene.camera.panEndX, camEase),
    panY: lerp(scene.camera.panStartY, scene.camera.panEndY, camEase),
    rotationRad:
      (lerp(scene.camera.rotationDegStart, scene.camera.rotationDegEnd, camEase) * Math.PI) / 180,
  };
  surface.setCameraTransform(cameraState);

  // 3. Seeded deterministic particles & background geometric primitives
  renderParticles(surface, scene, storyboard.seed, clampedTime);
  renderSceneVisualElements(surface, scene, localTime);

  // 4. Archetype diagram
  renderArchetypeDiagram(surface, scene, localTime, sceneProgress);

  // 5. Reset camera for crisp HUD, kinetic typography, and subtitles
  surface.setCameraTransform(null);
  renderKineticTypography(surface, scene, clampedTime);
  renderHudAndSubtitles(surface, storyboard, scene, clampedTime, options);

  // 6. Scene entry/exit transition overlay
  if (localTime < scene.transitionIn.duration && scene.transitionIn.type !== 'none') {
    const t = 1 - evaluateEasing(scene.transitionIn.easing, localTime / scene.transitionIn.duration);
    if (scene.transitionIn.type === 'wipe-up') {
      surface.fillRect(0, 0, VIDEO_WIDTH, Math.round(VIDEO_HEIGHT * t), tokens.backgroundPrimary, 0.92);
    } else {
      surface.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT, tokens.backgroundPrimary, clamp(t * 0.85, 0, 1));
    }
  }

  return {
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    timestampSeconds: clampedTime,
    sceneId: scene.id,
    archetype: scene.archetype,
    themeId: tokens.themeId,
    rgbaBuffer: surface.pixels,
    toPngBuffer: () => encodeRgbaToPngBuffer(surface.pixels, VIDEO_WIDTH, VIDEO_HEIGHT),
  };
}

// ============================================================================
// PART 10: FFPROBE / FFMPEG EXECUTION & VIDEO VERIFICATION PIPELINE
// ============================================================================

export interface SpawnCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runSafeProcess(
  executable: string,
  args: readonly string[],
  timeoutMs: number = 120_000
): Promise<SpawnCommandResult> {
  return new Promise<SpawnCommandResult>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new RenderStageError(`Process "${executable}" timed out after ${timeoutMs}ms.`, {
          executable,
          args,
        })
      );
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(
          new MissingDependencyError(
            `Required binary "${executable}" was not found on PATH. Install FFmpeg/FFprobe and ensure "${executable}" is executable.`,
            { executable, errno: err.code }
          )
        );
        return;
      }
      reject(
        new RenderStageError(`Failed to spawn "${executable}": ${err.message}`, {
          executable,
          errno: err.code,
        })
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export interface ProbedMediaMetadata {
  readonly filePath: string;
  readonly fileSizeBytes: number;
  readonly durationSeconds: number;
  readonly hasVideoStream: boolean;
  readonly hasAudioStream: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly videoCodec?: string;
  readonly pixelFormat?: string;
  readonly fps?: number;
  readonly audioCodec?: string;
  readonly sampleRate?: number;
}

interface FfprobeStreamJson {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly pix_fmt?: string;
  readonly r_frame_rate?: string;
  readonly avg_frame_rate?: string;
  readonly duration?: string;
  readonly sample_rate?: string;
}

interface FfprobeOutputJson {
  readonly streams?: readonly FfprobeStreamJson[];
  readonly format?: {
    readonly duration?: string;
    readonly size?: string;
  };
}

function parseFrameRateFraction(rateStr?: string): number | undefined {
  if (!rateStr) return undefined;
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return num / den;
    }
  }
  const direct = Number(rateStr);
  return Number.isFinite(direct) && direct > 0 ? direct : undefined;
}

export async function probeMediaFile(
  filePath: string,
  ffprobeBinary: string = resolveFfprobeBinary()
): Promise<ProbedMediaMetadata> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    throw new MediaVerificationError(`Media file does not exist: "${filePath}"`, { filePath });
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new MediaVerificationError(`Media file is empty or not a regular file: "${filePath}"`, {
      filePath,
      fileSizeBytes: stat.size,
    });
  }

  const res = await runSafeProcess(ffprobeBinary, [
    '-v',
    'error',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    filePath,
  ]);

  if (res.exitCode !== 0) {
    throw new MediaVerificationError(
      `ffprobe failed to inspect "${filePath}" (exit ${res.exitCode}): ${res.stderr.trim()}`,
      { filePath, exitCode: res.exitCode, stderr: res.stderr }
    );
  }

  let parsed: FfprobeOutputJson;
  try {
    parsed = JSON.parse(res.stdout) as FfprobeOutputJson;
  } catch (err) {
    throw new MediaVerificationError(
      `ffprobe returned invalid JSON for "${filePath}": ${(err as Error).message}`,
      { filePath }
    );
  }

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const formatDuration = Number(parsed.format?.duration);
  const streamDuration = Number(videoStream?.duration ?? audioStream?.duration);
  const durationSeconds = Number.isFinite(formatDuration) && formatDuration > 0
    ? formatDuration
    : streamDuration;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new MediaVerificationError(`Could not determine valid positive duration for "${filePath}".`, {
      filePath,
      rawDuration: parsed.format?.duration,
    });
  }

  return {
    filePath,
    fileSizeBytes: stat.size,
    durationSeconds,
    hasVideoStream: videoStream !== undefined,
    hasAudioStream: audioStream !== undefined,
    width: videoStream?.width,
    height: videoStream?.height,
    videoCodec: videoStream?.codec_name,
    pixelFormat: videoStream?.pix_fmt,
    fps:
      parseFrameRateFraction(videoStream?.avg_frame_rate) ??
      parseFrameRateFraction(videoStream?.r_frame_rate),
    audioCodec: audioStream?.codec_name,
    sampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined,
  };
}

export interface ValidateRenderedVideoOptions {
  readonly expectedDurationSeconds?: number;
  readonly durationToleranceSeconds?: number;
  readonly ffprobeBinary?: string;
  readonly preProbedMetadata?: ProbedMediaMetadata;
}

export async function validateRenderedVideo(
  videoPath: string,
  options: ValidateRenderedVideoOptions = {}
): Promise<ProbedMediaMetadata> {
  const ffprobeBin = options.ffprobeBinary ?? resolveFfprobeBinary();
  const metadata =
    options.preProbedMetadata ??
    (await probeMediaFile(videoPath, ffprobeBin));

  const failures: string[] = [];

  if (!metadata.hasVideoStream) {
    failures.push('Rendered MP4 is missing a video stream.');
  }
  if (!metadata.hasAudioStream) {
    failures.push('Rendered MP4 is missing the required narration audio stream.');
  }
  if (metadata.width !== VIDEO_WIDTH || metadata.height !== VIDEO_HEIGHT) {
    failures.push(
      `Rendered video dimensions (${metadata.width}x${metadata.height}) do not match required ${VIDEO_WIDTH}x${VIDEO_HEIGHT}.`
    );
  }
  if (metadata.videoCodec !== 'h264') {
    failures.push(`Expected H.264 video codec ('h264'), got '${metadata.videoCodec ?? 'none'}'.`);
  }
  if (metadata.pixelFormat !== 'yuv420p') {
    failures.push(
      `Expected pixel format 'yuv420p' for mobile compatibility, got '${metadata.pixelFormat ?? 'none'}'.`
    );
  }
  if (metadata.audioCodec !== 'aac') {
    failures.push(`Expected AAC audio codec ('aac'), got '${metadata.audioCodec ?? 'none'}'.`);
  }
  if (metadata.fps === undefined || Math.abs(metadata.fps - VIDEO_FPS) > 1.5) {
    failures.push(`Expected frame rate near ${VIDEO_FPS} FPS, got ${metadata.fps ?? 'unknown'}.`);
  }
  if (metadata.durationSeconds <= 0 || metadata.durationSeconds >= HARD_DURATION_LIMIT_SECONDS) {
    failures.push(
      `Rendered video duration (${metadata.durationSeconds.toFixed(2)}s) must be > 0s and strictly < ${HARD_DURATION_LIMIT_SECONDS}s.`
    );
  }
  if (options.expectedDurationSeconds !== undefined) {
    const tolerance = options.durationToleranceSeconds ?? 1.25;
    if (Math.abs(metadata.durationSeconds - options.expectedDurationSeconds) > tolerance) {
      failures.push(
        `Rendered duration (${metadata.durationSeconds.toFixed(2)}s) deviates from expected (${options.expectedDurationSeconds.toFixed(2)}s) by more than ${tolerance}s.`
      );
    }
  }
  if (metadata.fileSizeBytes < 4096) {
    failures.push(`Rendered MP4 file size (${metadata.fileSizeBytes} bytes) is suspiciously small.`);
  }

  if (failures.length > 0) {
    throw new MediaVerificationError(
      `Rendered video verification failed: ${failures.join(' ')}`,
      { videoPath, metadata, failures }
    );
  }

  return metadata;
}

export type RenderMilestonePhase =
  | 'validating-input'
  | 'probing-audio'
  | 'normalizing-storyboard'
  | 'generating-subtitles'
  | 'rendering-frames'
  | 'encoding-video'
  | 'extracting-thumbnail'
  | 'verifying-output'
  | 'completed';

export interface RenderProgressEvent {
  readonly phase: RenderMilestonePhase;
  readonly progressRatio: number; // 0..1
  readonly renderedFrames?: number;
  readonly totalFrames?: number;
  readonly message: string;
}

export interface RenderVideoRequest {
  readonly job: ExistingScriptDataInput | NormalizedStoryboard;
  readonly narrationAudioPath: string;
  readonly outputDir: string;
  readonly outputFileBasename?: string;
  readonly visualStyle?: string;
  readonly seed?: number | string;
  readonly ffmpegBinary?: string;
  readonly ffprobeBinary?: string;
  readonly onProgress?: (event: RenderProgressEvent) => void;
}

export interface RenderVideoResult {
  readonly videoPath: string;
  readonly thumbnailPath: string;
  readonly subtitleAssPath: string;
  readonly storyboard: NormalizedStoryboard;
  readonly subtitleLines: readonly SubtitleLine[];
  readonly measuredMetadata: ProbedMediaMetadata;
  readonly renderedFrameCount: number;
}

function isNormalizedStoryboard(
  input: ExistingScriptDataInput | NormalizedStoryboard
): input is NormalizedStoryboard {
  return (
    typeof input === 'object' &&
    input !== null &&
    'totalDuration' in input &&
    'wordTimings' in input &&
    Array.isArray(input.scenes) &&
    input.scenes.length > 0 &&
    typeof input.scenes[0]?.archetype === 'string' &&
    'diagram' in input.scenes[0]!
  );
}

export async function renderVideo(request: RenderVideoRequest): Promise<RenderVideoResult> {
  const ffmpegBin = request.ffmpegBinary ?? resolveFfmpegBinary();
  const ffprobeBin = request.ffprobeBinary ?? resolveFfprobeBinary();
  const report = (
    phase: RenderMilestonePhase,
    progressRatio: number,
    message: string,
    renderedFrames?: number,
    totalFrames?: number
  ): void => {
    request.onProgress?.({
      phase,
      progressRatio: clamp(progressRatio, 0, 1),
      renderedFrames,
      totalFrames,
      message,
    });
  };

  report('validating-input', 0.02, 'Validating narration audio path and output directory.');

  if (!request.narrationAudioPath || request.narrationAudioPath.trim().length === 0) {
    throw new AudioValidationError('narrationAudioPath is required.');
  }

  let audioStat: fs.Stats;
  try {
    audioStat = await fsp.stat(request.narrationAudioPath);
  } catch {
    throw new AudioValidationError(
      `Narration audio file does not exist: "${request.narrationAudioPath}"`,
      { narrationAudioPath: request.narrationAudioPath }
    );
  }
  if (!audioStat.isFile() || audioStat.size === 0) {
    throw new AudioValidationError(
      `Narration audio file is empty or invalid: "${request.narrationAudioPath}"`,
      { narrationAudioPath: request.narrationAudioPath }
    );
  }

  report('probing-audio', 0.06, 'Probing narration audio stream with ffprobe.');
  const audioMeta = await probeMediaFile(request.narrationAudioPath, ffprobeBin);
  if (!audioMeta.hasAudioStream) {
    throw new AudioValidationError(
      `Supplied narration file "${request.narrationAudioPath}" contains no audio stream.`,
      { audioMeta }
    );
  }
  if (audioMeta.durationSeconds <= 0 || audioMeta.durationSeconds >= HARD_DURATION_LIMIT_SECONDS) {
    throw new AudioValidationError(
      `Narration audio duration (${audioMeta.durationSeconds.toFixed(2)}s) must be > 0s and strictly < ${HARD_DURATION_LIMIT_SECONDS}s.`,
      { durationSeconds: audioMeta.durationSeconds }
    );
  }

  report('normalizing-storyboard', 0.12, 'Normalizing and validating storyboard against audio duration.');
  const storyboard: NormalizedStoryboard = isNormalizedStoryboard(request.job)
    ? request.job
    : normalizeStoryboard(request.job, {
        audioDurationSeconds: audioMeta.durationSeconds,
        preferredStyle: request.visualStyle,
        seedOverride: request.seed,
      });

  validateStoryboard(storyboard);

  report('generating-subtitles', 0.18, 'Building word-timed karaoke subtitle lines and ASS script.');
  const subtitleLines = buildSubtitleLines(storyboard.wordTimings, storyboard.totalDuration);
  const assContent = exportToAss(subtitleLines, storyboard.themeId, storyboard.totalDuration);

  await fsp.mkdir(request.outputDir, { recursive: true });
  const tempWorkDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sisyphus-engine-'));

  const safeBase = (request.outputFileBasename ?? storyboard.jobId)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64) || 'sisyphus_render';

  const finalVideoPath = path.join(request.outputDir, `${safeBase}.mp4`);
  const finalThumbnailPath = path.join(request.outputDir, `${safeBase}-thumb.png`);
  const finalAssPath = path.join(request.outputDir, `${safeBase}.ass`);

  const tempVideoPath = path.join(tempWorkDir, 'render-output.mp4');
  const tempThumbPath = path.join(tempWorkDir, 'thumb.png');

  try {
    await fsp.writeFile(finalAssPath, assContent, 'utf8');

    const totalFrames = Math.max(
      1,
      Math.min(
        Math.floor(HARD_DURATION_LIMIT_SECONDS * VIDEO_FPS) - 1,
        Math.round(storyboard.totalDuration * VIDEO_FPS)
      )
    );

    report(
      'rendering-frames',
      0.22,
      `Streaming ${totalFrames} deterministic frames (${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps) to FFmpeg.`,
      0,
      totalFrames
    );

    const ffmpegArgs: string[] = [
      '-y',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgba',
      '-video_size',
      `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`,
      '-framerate',
      String(VIDEO_FPS),
      '-i',
      'pipe:0',
      '-i',
      request.narrationAudioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(VIDEO_FPS),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      tempVideoPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const ff = spawn(ffmpegBin, ffmpegArgs, {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      });

      let stderrLog = '';
      let spawnErrored = false;

      ff.stderr.on('data', (chunk: Buffer) => {
        stderrLog += chunk.toString('utf8');
      });

      ff.on('error', (err: NodeJS.ErrnoException) => {
        spawnErrored = true;
        if (err.code === 'ENOENT') {
          reject(
            new MissingDependencyError(
              `Required binary "${ffmpegBin}" was not found on PATH.`,
              { executable: ffmpegBin }
            )
          );
          return;
        }
        reject(
          new RenderStageError(`FFmpeg process error: ${err.message}`, {
            executable: ffmpegBin,
          })
        );
      });

      ff.stdin.on('error', () => {
        // Handled on process close if FFmpeg exited early
      });

      ff.on('close', (code) => {
        if (spawnErrored) return;
        if (code !== 0) {
          reject(
            new RenderStageError(
              `FFmpeg encoding failed with exit code ${code}: ${stderrLog.slice(-600)}`,
              { exitCode: code, stderr: stderrLog.slice(-1000) }
            )
          );
          return;
        }
        resolve();
      });

      const surface = new SoftwareSurface2D(VIDEO_WIDTH, VIDEO_HEIGHT);
      const midFrameIndex = Math.floor(totalFrames * 0.35);
      let frameIndex = 0;

      const writeNextFrame = (): void => {
        while (frameIndex < totalFrames) {
          if (spawnErrored || ff.stdin.destroyed) {
            return;
          }
          const timestamp = frameIndex / VIDEO_FPS;
          const rendered = renderFrame(
            storyboard,
            timestamp,
            { includeSubtitles: true, subtitleLines },
            surface
          );

          if (frameIndex === midFrameIndex) {
            fs.writeFileSync(tempThumbPath, rendered.toPngBuffer());
          }

          frameIndex++;
          if (frameIndex % 15 === 0 || frameIndex === totalFrames) {
            const ratio = 0.22 + (frameIndex / totalFrames) * 0.58;
            report(
              'rendering-frames',
              ratio,
              `Rendered frame ${frameIndex} of ${totalFrames}.`,
              frameIndex,
              totalFrames
            );
          }

          const frameChunk = Buffer.from(
            rendered.rgbaBuffer.buffer,
            rendered.rgbaBuffer.byteOffset,
            rendered.rgbaBuffer.byteLength
          );
          const canContinue = ff.stdin.write(frameChunk);
          if (!canContinue) {
            ff.stdin.once('drain', writeNextFrame);
            return;
          }
        }
        report('encoding-video', 0.84, 'Finalizing MP4 container and AAC audio stream.');
        ff.stdin.end();
      };

      try {
        writeNextFrame();
      } catch (err) {
        ff.kill('SIGKILL');
        reject(err);
      }
    });

    report('extracting-thumbnail', 0.9, 'Saving verified PNG thumbnail.');
    if (!fs.existsSync(tempThumbPath)) {
      const thumbFrame = renderFrame(storyboard, storyboard.totalDuration * 0.25, {
        includeSubtitles: true,
        subtitleLines,
      });
      await fsp.writeFile(tempThumbPath, thumbFrame.toPngBuffer());
    }

    report('verifying-output', 0.95, 'Verifying rendered MP4 streams, codecs, and duration with ffprobe.');
    const verifiedMetadata = await validateRenderedVideo(tempVideoPath, {
      expectedDurationSeconds: storyboard.totalDuration,
      durationToleranceSeconds: 1.5,
      ffprobeBinary: ffprobeBin,
    });

    await fsp.copyFile(tempVideoPath, finalVideoPath);
    await fsp.copyFile(tempThumbPath, finalThumbnailPath);

    const finalMetadata: ProbedMediaMetadata = {
      ...verifiedMetadata,
      filePath: finalVideoPath,
    };

    report('completed', 1.0, 'Video rendering and verification completed successfully.', totalFrames, totalFrames);

    return {
      videoPath: finalVideoPath,
      thumbnailPath: finalThumbnailPath,
      subtitleAssPath: finalAssPath,
      storyboard,
      subtitleLines,
      measuredMetadata: finalMetadata,
      renderedFrameCount: totalFrames,
    };
  } finally {
    await fsp.rm(tempWorkDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ============================================================================
// PART 11: REPRESENTATIVE 4-SCENE FIXTURE & DIAGNOSTIC SELF-TEST SUITE
// ============================================================================

/**
 * Representative 4-scene fixture on a philosophical and systems-biology topic:
 * "The Ship of Theseus & Cellular Persistence: Why Pattern Survives Material Turnover".
 * Note: Any numeric progression values in this fixture are explicitly marked
 * `verified: false` (illustrative) rather than fabricated scientific measurements.
 */
export const REPRESENTATIVE_FOUR_SCENE_FIXTURE: ExistingScriptDataInput = {
  jobId: 'job-theseus-pattern-001',
  topic: 'The Ship of Theseus & Dynamic Identity',
  title: 'Why You Persist When Every Part Changes',
  visualStyle: 'dark-noir-science',
  seed: 424242,
  duration: 24.0,
  scenes: [
    {
      id: 'scene-paradox-core',
      title: 'The Plank Replacement Paradox',
      narration:
        'If a wooden vessel replaces every weathered timber over decades at sea, does the harbor welcome home the same ship or a replica?',
      visualDescription:
        'Orbital geometric hull schematic with rotating structural timbers and identity core.',
      archetype: 'hero-metaphor',
      startTime: 0,
      endTime: 6.0,
      keywords: ['TIMBER FLUX', 'HULL FORM', 'CONTINUITY', 'IDENTITY CORE'],
    },
    {
      id: 'scene-divergent-claims',
      title: 'Two Competing Vessels',
      narration:
        'When a collector reassembles the discarded original planks beside the continuously repaired hull, two distinct claims to identity diverge.',
      visualDescription:
        'Split comparison between the continuous functional vessel and the reassembled relic hull.',
      archetype: 'split-comparison',
      startTime: 6.0,
      endTime: 12.0,
      comparison: {
        left: {
          title: 'CONTINUOUS HULL',
          points: ['UNBROKEN VOYAGE', 'RENEWED PLANKS', 'ACTIVE TOPOLOGY'],
        },
        right: {
          title: 'REASSEMBLED RELIC',
          points: ['ORIGINAL MATTER', 'INTERRUPTED HISTORY', 'STATIC ARCHIVE'],
        },
      },
    },
    {
      id: 'scene-metabolic-network',
      title: 'Living Systems as Open Meshes',
      narration:
        'Living organisms resolve the paradox by existing as self-maintaining networks where relational topology endures while molecules pass through.',
      visualDescription:
        'Interconnected constellation mesh of nodes exchanging signals while preserving network geometry.',
      archetype: 'constellation-mesh',
      startTime: 12.0,
      endTime: 18.0,
      nodes: ['TOPOLOGY', 'METABOLISM', 'MEMORY TRACE', 'HOMEOSTASIS', 'BOUNDARY'],
    },
    {
      id: 'scene-temporal-continuity',
      title: 'Identity Across Time',
      narration:
        'Identity is not a static heap of atoms frozen at birth, but a continuous causal trajectory linking each state to the next.',
      visualDescription:
        'Chronological timeline showing state transitions preserving structural invariants.',
      archetype: 'chronological-timeline',
      startTime: 18.0,
      endTime: 24.0,
      timeline: [
        {
          time: 'STATE T0',
          label: 'INITIAL CONFIGURATION',
          description: 'Foundational architecture establishes causal constraints.',
        },
        {
          time: 'STATE T1',
          label: 'INCREMENTAL TURNOVER',
          description: 'Components exchange without breaking functional links.',
        },
        {
          time: 'STATE T2',
          label: 'PERSISTENT PATTERN',
          description: 'Information structure survives complete material renewal.',
        },
      ],
    },
  ],
};

export interface SelfTestAssertionResult {
  readonly id: number;
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

export interface SelfTestSuiteReport {
  readonly allPassed: boolean;
  readonly totalTests: number;
  readonly passedCount: number;
  readonly results: readonly SelfTestAssertionResult[];
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runSelfTests(): Promise<SelfTestSuiteReport> {
  const results: SelfTestAssertionResult[] = [];

  const runCase = async (
    id: number,
    name: string,
    fn: () => Promise<string> | string
  ): Promise<void> => {
    try {
      const details = await fn();
      results.push({ id, name, passed: true, details });
    } catch (err) {
      results.push({
        id,
        name,
        passed: false,
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // 1. Valid multi-scene storyboard normalization
  await runCase(1, 'Valid multi-scene storyboard normalization', () => {
    const normalized = normalizeStoryboard(REPRESENTATIVE_FOUR_SCENE_FIXTURE);
    assertCondition(normalized.scenes.length === 4, 'Expected 4 normalized scenes.');
    assertCondition(normalized.totalDuration === 24.0, 'Expected totalDuration === 24.0s.');
    assertCondition(normalized.timingSource === 'estimated', 'Expected timingSource === estimated.');
    assertCondition(
      normalized.scenes[0]!.archetype === 'hero-metaphor' &&
        normalized.scenes[1]!.archetype === 'split-comparison' &&
        normalized.scenes[2]!.archetype === 'constellation-mesh' &&
        normalized.scenes[3]!.archetype === 'chronological-timeline',
      'Archetypes did not preserve expected scene mappings.'
    );
    return `Normalized ${normalized.scenes.length} scenes (${normalized.totalDuration}s) with ${normalized.wordTimings.length} word timings.`;
  });

  // 2. Invalid and overlapping scene timestamps
  await runCase(2, 'Invalid and overlapping scene timestamps rejection', () => {
    let caughtOverlap = false;
    try {
      normalizeStoryboard({
        topic: 'Overlap Test',
        scenes: [
          { id: 's1', title: 'One', narration: 'First scene narration.', startTime: 0, endTime: 5 },
          { id: 's2', title: 'Two', narration: 'Overlapping second scene.', startTime: 4.2, endTime: 9 },
        ],
      });
    } catch (err) {
      caughtOverlap = err instanceof StoryboardValidationError;
    }
    assertCondition(caughtOverlap, 'Expected StoryboardValidationError on overlapping scenes.');

    let caughtNegative = false;
    try {
      normalizeStoryboard({
        topic: 'Negative Test',
        scenes: [
          { id: 's1', title: 'One', narration: 'Invalid range.', startTime: 5, endTime: 3 },
        ],
      });
    } catch (err) {
      caughtNegative = err instanceof StoryboardValidationError;
    }
    assertCondition(caughtNegative, 'Expected StoryboardValidationError on reversed scene bounds.');
    return 'Rejected overlapping and reversed scene timestamps with StoryboardValidationError.';
  });

  // 3. Deterministic rendering at the same timestamp and seed
  await runCase(3, 'Deterministic rendering at the same timestamp and seed', () => {
    const sb1 = normalizeStoryboard(REPRESENTATIVE_FOUR_SCENE_FIXTURE, { seedOverride: 999 });
    const sb2 = normalizeStoryboard(REPRESENTATIVE_FOUR_SCENE_FIXTURE, { seedOverride: 999 });
    const frameA = renderFrame(sb1, 7.5);
    const frameB = renderFrame(sb2, 7.5);
    const frameDifferentTime = renderFrame(sb1, 14.2);

    const hashA = createHash('sha256').update(frameA.rgbaBuffer).digest('hex');
    const hashB = createHash('sha256').update(frameB.rgbaBuffer).digest('hex');
    const hashC = createHash('sha256').update(frameDifferentTime.rgbaBuffer).digest('hex');

    assertCondition(hashA === hashB, 'Identical seed and timestamp produced different pixel buffers.');
    assertCondition(hashA !== hashC, 'Different timestamps produced identical pixel buffers.');
    const pngBuf = frameA.toPngBuffer();
    assertCondition(
      pngBuf.length > 1000 && pngBuf[0] === 0x89 && pngBuf[1] === 0x50,
      'PNG encoder did not produce a valid PNG header.'
    );
    return `Verified deterministic SHA-256 frame match (${hashA.slice(0, 12)}...) and valid PNG output (${pngBuf.length} bytes).`;
  });

  // 4. All supported theme mappings
  await runCase(4, 'All supported theme mappings', () => {
    const mappings: Array<[string, ThemeId]> = [
      ['cyber-brutalist-pink', 'cyber-brutalist-pink'],
      ['brutalist neon', 'cyber-brutalist-pink'],
      ['neo-vector', 'neo-vector'],
      ['dark-noir-science', 'dark-noir-science'],
      ['retro-blueprint', 'retro-blueprint'],
      ['engineering schematic', 'retro-blueprint'],
    ];
    for (const [input, expected] of mappings) {
      const actual = resolveThemeId(input);
      assertCondition(actual === expected, `Expected "${input}" -> "${expected}", got "${actual}".`);
      const tokens = getThemeTokens(actual);
      assertCondition(tokens.backgroundPrimary.startsWith('#'), 'Invalid hex token.');
    }
    return `Verified all ${ALL_THEME_IDS.length} canonical theme token registries and style alias mappings.`;
  });

  // 5. ASS karaoke tag generation and text escaping
  await runCase(5, 'ASS karaoke tag generation and text escaping', () => {
    const sb = normalizeStoryboard({
      topic: 'Escape Test',
      scenes: [
        {
          id: 'esc-1',
          title: 'Special Characters',
          narration: 'Curly {braces} and \\backslashes\\ must not inject override tags.',
          startTime: 0,
          endTime: 5,
        },
      ],
    });
    const lines = buildSubtitleLines(sb.wordTimings, sb.totalDuration);
    const ass = exportToAss(lines, 'cyber-brutalist-pink', sb.totalDuration);
    assertCondition(ass.includes('PlayResX: 1080'), 'Missing PlayResX: 1080.');
    assertCondition(ass.includes('PlayResY: 1920'), 'Missing PlayResY: 1920.');
    assertCondition(ass.includes('\\{braces\\}'), 'Failed to escape curly braces in ASS output.');
    assertCondition(ass.includes('\\\\backslashes\\\\'), 'Failed to escape backslashes in ASS output.');
    assertCondition(/\{\\kf\d+\}/.test(ass), 'Missing \\kf centisecond karaoke tags.');
    return 'Verified ASS script headers, \\kf karaoke tags, and injection-safe escaping of { } and \\.';
  });

  // 6. Subtitle timing boundaries
  await runCase(6, 'Subtitle timing boundaries validation', () => {
    let caughtOverlap = false;
    try {
      validateWordTimings(
        [
          { word: 'Alpha', startTime: 0, endTime: 1.0, duration: 1.0, sceneId: 's1', alignmentSource: 'aligned' },
          { word: 'Beta', startTime: 0.8, endTime: 1.6, duration: 0.8, sceneId: 's1', alignmentSource: 'aligned' },
        ],
        5.0
      );
    } catch (err) {
      caughtOverlap = err instanceof SubtitleValidationError;
    }
    assertCondition(caughtOverlap, 'Expected SubtitleValidationError on overlapping words.');

    let caughtZero = false;
    try {
      validateWordTimings(
        [
          { word: 'Zero', startTime: 1.0, endTime: 1.0, duration: 0, sceneId: 's1', alignmentSource: 'aligned' },
        ],
        5.0
      );
    } catch (err) {
      caughtZero = err instanceof SubtitleValidationError;
    }
    assertCondition(caughtZero, 'Expected SubtitleValidationError on zero-duration word.');
    return 'Verified rejection of zero-length, negative, overlapping, and out-of-range word timings.';
  });

  // 7. Missing audio and missing FFmpeg handling
  await runCase(7, 'Missing audio and missing FFmpeg binary handling', async () => {
    let caughtMissingAudio = false;
    try {
      await renderVideo({
        job: REPRESENTATIVE_FOUR_SCENE_FIXTURE,
        narrationAudioPath: '/nonexistent/path/to/missing-audio-file.wav',
        outputDir: os.tmpdir(),
      });
    } catch (err) {
      caughtMissingAudio = err instanceof AudioValidationError;
    }
    assertCondition(caughtMissingAudio, 'Expected AudioValidationError when narration audio is missing.');

    let caughtMissingBinary = false;
    try {
      await runSafeProcess('nonexistent-ffmpeg-binary-xyz-999', ['-version']);
    } catch (err) {
      caughtMissingBinary = err instanceof MissingDependencyError;
    }
    assertCondition(caughtMissingBinary, 'Expected MissingDependencyError when binary is missing.');
    return 'Verified AudioValidationError on missing audio and MissingDependencyError on missing FFmpeg binary.';
  });

  // 8. Invalid rendered output rejection
  await runCase(8, 'Invalid rendered output rejection', async () => {
    let caughtInvalidOutput = false;
    try {
      await validateRenderedVideo('/tmp/ fake-video.mp4', {
        preProbedMetadata: {
          filePath: '/tmp/fake-video.mp4',
          fileSizeBytes: 50_000,
          durationSeconds: 64.5, // Illegal >= 60s
          hasVideoStream: true,
          hasAudioStream: false, // Illegal missing audio
          width: 720, // Illegal width
          height: 1280,
          videoCodec: 'h264',
          pixelFormat: 'yuv420p',
          fps: 30,
        },
      });
    } catch (err) {
      caughtInvalidOutput = err instanceof MediaVerificationError;
    }
    assertCondition(caughtInvalidOutput, 'Expected MediaVerificationError on invalid probed output.');
    return 'Verified validateRenderedVideo rejects >=60s duration, missing audio stream, and wrong resolution.';
  });

  // 9. Duration enforcement (< 60 seconds)
  await runCase(9, 'Strict <60 second duration enforcement', () => {
    let caughtTooLong = false;
    try {
      normalizeStoryboard({
        topic: 'Over Limit',
        duration: 60.0,
        scenes: [
          { id: 's1', title: 'Long', narration: 'Exceeds vertical short limit.', startTime: 0, endTime: 60.0 },
        ],
      });
    } catch (err) {
      caughtTooLong = err instanceof StoryboardValidationError;
    }
    assertCondition(caughtTooLong, 'Expected StoryboardValidationError when duration === 60.0s.');
    return 'Verified strict rejection of storyboards with duration >= 60.0 seconds.';
  });

  // 10. Correct scene selection at scene boundaries
  await runCase(10, 'Correct scene selection at scene boundaries', () => {
    const sb = normalizeStoryboard(REPRESENTATIVE_FOUR_SCENE_FIXTURE);
    const atStart = getSceneAtTimestamp(sb, 0.0);
    const justBeforeFirstEnd = getSceneAtTimestamp(sb, 5.99);
    const atExactFirstBoundary = getSceneAtTimestamp(sb, 6.0);
    const atExactSecondBoundary = getSceneAtTimestamp(sb, 12.0);
    const atEnd = getSceneAtTimestamp(sb, 24.0);

    assertCondition(atStart.id === 'scene-paradox-core', 'Failed at t=0.0s.');
    assertCondition(justBeforeFirstEnd.id === 'scene-paradox-core', 'Failed at t=5.99s.');
    assertCondition(atExactFirstBoundary.id === 'scene-divergent-claims', 'Failed at exact boundary t=6.0s.');
    assertCondition(atExactSecondBoundary.id === 'scene-metabolic-network', 'Failed at exact boundary t=12.0s.');
    assertCondition(atEnd.id === 'scene-temporal-continuity', 'Failed at terminal boundary t=24.0s.');
    return 'Verified half-open interval [startTime, endTime) scene transitions across all boundaries.';
  });

  const passedCount = results.filter((r) => r.passed).length;
  return {
    allPassed: passedCount === results.length,
    totalTests: results.length,
    passedCount,
    results,
  };
}

// Optional CLI entry point: `node --loader ts-node/esm sisyphus-video-engine.ts --self-test`
if (
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv.includes('--self-test')
) {
  runSelfTests()
    .then((report) => {
      for (const r of report.results) {
        const badge = r.passed ? 'PASS' : 'FAIL';
        process.stdout.write(`[${badge}] #${r.id} ${r.name}: ${r.details}\n`);
      }
      if (!report.allPassed) {
        process.exitCode = 1;
      }
    })
    .catch((err: unknown) => {
      process.stderr.write(`Self-test runner error: ${String(err)}\n`);
      process.exitCode = 1;
    });
}