import type { ScriptData, SubtitleLine as PipelineSubtitleLine, VideoMetadata, VideoStyle } from '../src/types/pipeline.ts';
import {
  renderVideo,
  type ExistingScriptDataInput,
  type ExistingSceneInput,
} from './sisyphus-video-engine.ts';

export interface RenderVideoParams {
  jobId: string;
  script: ScriptData;
  subtitles: PipelineSubtitleLine[];
  audioPath: string;
  audioDurationMs: number;
  style: VideoStyle;
  outputDir: string;
}

function sceneArchetype(visualType: string): string {
  switch (visualType) {
    case 'diagram-chart':
      return 'branching-tree';
    case 'data-counter':
      return 'animated-data-counter';
    case 'split-comparison':
      return 'split-comparison';
    case 'punchline-conclusion':
      return 'chronological-timeline';
    case 'metaphor-concept':
      return 'hero-metaphor';
    case 'kinetic-hook':
    default:
      return 'constellation-mesh';
  }
}

/**
 * Bridges Sisyphus's existing millisecond-based ScriptData contract to the
 * standalone engine's seconds-based scene contract. It intentionally preserves
 * the existing renderer call signature so the pipeline can migrate safely.
 */
export async function renderAndEncodeMp4(params: RenderVideoParams): Promise<{
  videoPath: string;
  thumbnailPath: string;
  metadata: VideoMetadata;
}> {
  const { jobId, script, audioPath, audioDurationMs, style, outputDir } = params;

  const scenes: ExistingSceneInput[] = script.scenes.map((scene) => {
    const visual = scene.visualElements;
    const keywords = [
      ...(visual.kineticWords ?? []),
      ...(visual.headlineText ? [visual.headlineText] : []),
      ...(visual.subText ? [visual.subText] : []),
    ].filter(Boolean);

    const mapped: ExistingSceneInput = {
      id: scene.id,
      title: scene.title,
      narration: scene.narration,
      visualDescription: [
        scene.title,
        visual.headlineText,
        visual.subText,
        visual.metaphorIcon,
      ].filter(Boolean).join(' — '),
      visualType: scene.visualType,
      archetype: sceneArchetype(scene.visualType),
      startTime: Math.max(0, scene.startMs / 1000),
      endTime: Math.max(0, scene.endMs / 1000),
      keywords,
      ...(typeof visual.counterTarget === 'number'
        ? {
            metric: {
              value: visual.counterTarget,
              unit: visual.counterSuffix ?? '',
              label: visual.headlineText ?? scene.title,
              verified: false,
            },
          }
        : {}),
      ...(visual.comparisonSides
        ? {
            comparison: {
              left: {
                title: visual.comparisonSides.left,
                points: [visual.comparisonSides.left],
              },
              right: {
                title: visual.comparisonSides.right,
                points: [visual.comparisonSides.right],
              },
            },
          }
        : {}),
      ...(visual.diagramData?.length
        ? { branches: visual.diagramData.map((item) => item.label) }
        : {}),
    };

    return mapped;
  });

  const input: ExistingScriptDataInput = {
    jobId,
    topic: script.topic,
    title: script.title,
    style,
    duration: Math.min(59.9, Math.max(0.5, audioDurationMs / 1000)),
    narration: script.fullNarration,
    scenes,
    wordTimings: params.subtitles.flatMap((line) => line.words.map((word) => ({
      word: word.word,
      start: Math.max(0, word.startMs / 1000),
      end: Math.max(0, word.endMs / 1000),
      aligned: false,
    }))),
  };

  const result = await renderVideo({
    job: input,
    narrationAudioPath: audioPath,
    outputDir,
    outputFileBasename: `${jobId}-video`,
    visualStyle: style,
    onProgress: (event) => {
      if (event.phase === 'completed' || event.phase === 'verifying-output') {
        console.info(`[SISYPHUS RENDER] ${Math.round(event.progressRatio * 100)}% ${event.message}`);
      }
    },
  });

  const measured = result.measuredMetadata;
  if (
    !measured.hasVideoStream ||
    !measured.hasAudioStream ||
    measured.width !== 1080 ||
    measured.height !== 1920 ||
    !measured.fps ||
    measured.durationSeconds >= 60
  ) {
    throw new Error('Video engine returned media that failed Sisyphus output constraints.');
  }

  const metadata: VideoMetadata = {
    width: measured.width,
    height: measured.height,
    aspectRatio: '9:16',
    fps: measured.fps,
    durationSec: Math.round(measured.durationSeconds * 10) / 10,
    format: `${measured.videoCodec ?? 'unknown'} / ${measured.audioCodec ?? 'unknown'}`,
    fileSizeBytes: measured.fileSizeBytes,
    isValidated: true,
  };

  return {
    videoPath: result.videoPath,
    thumbnailPath: result.thumbnailPath,
    metadata,
  };
}
