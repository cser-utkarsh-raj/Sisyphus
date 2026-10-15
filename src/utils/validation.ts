import type { ScriptData, TargetPlatform } from '../types/pipeline.ts';

/**
 * Validates video duration against short-form platform constraints.
 * Must be strictly under 60 seconds (max 59.5s) and at least 15 seconds.
 */
export function validateVideoDuration(durationSec: number): {
  valid: boolean;
  durationSec: number;
  error?: string;
} {
  if (typeof durationSec !== 'number' || isNaN(durationSec)) {
    return { valid: false, durationSec: 0, error: 'Duration must be a valid number.' };
  }

  if (durationSec < 15) {
    return {
      valid: false,
      durationSec,
      error: `Video duration (${durationSec.toFixed(1)}s) is too short. Minimum duration is 15 seconds for informational pacing.`,
    };
  }

  if (durationSec >= 60) {
    return {
      valid: false,
      durationSec,
      error: `Video duration (${durationSec.toFixed(1)}s) exceeds strict 60-second limit for YouTube Shorts / Reels. Must be <= 59.5s.`,
    };
  }

  return { valid: true, durationSec };
}

/**
 * Validates script JSON output returned from Gemini AI.
 */
export function validateScriptStructure(script: unknown): {
  valid: boolean;
  errors: string[];
  script?: ScriptData;
} {
  const errors: string[] = [];

  if (!script || typeof script !== 'object') {
    return { valid: false, errors: ['Script payload is empty or not an object.'] };
  }

  const s = script as Partial<ScriptData>;

  if (!s.title || typeof s.title !== 'string' || s.title.trim().length === 0) {
    errors.push('Script missing required title.');
  }

  if (!s.fullNarration || typeof s.fullNarration !== 'string' || s.fullNarration.trim().length < 20) {
    errors.push('Script full narration must be at least 20 characters.');
  }

  if (!Array.isArray(s.scenes) || s.scenes.length === 0) {
    errors.push('Script must contain at least one scene in storyboard.');
  } else {
    s.scenes.forEach((scene, idx) => {
      if (!scene.narration) {
        errors.push(`Scene #${idx + 1} is missing narration.`);
      }
      if (!scene.visualType) {
        errors.push(`Scene #${idx + 1} is missing visualType.`);
      }
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], script: s as ScriptData };
}

/**
 * Validates platform-specific publication metadata
 */
export function validatePlatformMetadata(
  title: string,
  description: string,
  hashtags: string[],
  platform: TargetPlatform
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!title || title.trim().length === 0) {
    errors.push(`${platform}: Title is required.`);
  }

  if (platform === 'youtube') {
    if (title.length > 100) {
      errors.push('YouTube Shorts: Title cannot exceed 100 characters.');
    }
    if (description.length > 5000) {
      errors.push('YouTube Shorts: Description cannot exceed 5000 characters.');
    }
  } else if (platform === 'instagram') {
    const fullCaption = `${title}\n\n${description}\n\n${hashtags.join(' ')}`;
    if (fullCaption.length > 2200) {
      errors.push('Instagram Reels: Caption cannot exceed 2,200 characters.');
    }
    if (hashtags.length > 30) {
      errors.push('Instagram Reels: Cannot exceed 30 hashtags.');
    }
  } else if (platform === 'facebook') {
    if (title.length > 255) {
      errors.push('Facebook Reels: Title cannot exceed 255 characters.');
    }
  }

  return { valid: errors.length === 0, errors };
}
