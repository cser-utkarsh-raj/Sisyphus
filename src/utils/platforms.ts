import type { TargetPlatform, PlatformPublishStatus } from '../types/pipeline.ts';

export interface FormattedPlatformPost {
  title: string;
  caption: string;
  tags: string[];
  safeAreaNotice?: string;
}

/**
 * Prepares compliant publication metadata according to platform specs
 */
export function formatPlatformMetadata(
  title: string,
  description: string,
  hashtags: string[],
  platform: TargetPlatform
): FormattedPlatformPost {
  const cleanTags = hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`));

  if (platform === 'youtube') {
    // Ensure #Shorts is present in YouTube title/description for Shorts shelf indexing
    const hasShortsTag = cleanTags.some((t) => t.toLowerCase() === '#shorts');
    const tagsWithShorts = hasShortsTag ? cleanTags : ['#Shorts', ...cleanTags];

    // YouTube Shorts title max 100 chars
    let ytTitle = title.trim();
    if (!ytTitle.toLowerCase().includes('#shorts')) {
      if (ytTitle.length + 8 <= 100) {
        ytTitle = `${ytTitle} #Shorts`;
      }
    }
    if (ytTitle.length > 100) {
      ytTitle = ytTitle.substring(0, 97) + '...';
    }

    const caption = `${description}\n\n${tagsWithShorts.join(' ')}`;

    return {
      title: ytTitle,
      caption,
      tags: tagsWithShorts,
      safeAreaNotice: 'Keep subtitles between 15% and 80% screen height to avoid Shorts action buttons on right and sound drawer at bottom.',
    };
  }

  if (platform === 'instagram') {
    // Instagram Reels: caption max 2200 chars, max 30 hashtags
    const cappedTags = cleanTags.slice(0, 28);
    const fullCaption = `${title}\n\n${description}\n\n${cappedTags.join(' ')}`.substring(0, 2200);

    return {
      title: title.substring(0, 150),
      caption: fullCaption,
      tags: cappedTags,
      safeAreaNotice: 'Right side 120px reserved for Like, Comment, Share buttons. Bottom 240px reserved for caption drawer.',
    };
  }

  // Facebook Reels
  const fbTitle = title.substring(0, 255);
  const fbCaption = `${description}\n\n${cleanTags.join(' ')}`;

  return {
    title: fbTitle,
    caption: fbCaption,
    tags: cleanTags,
    safeAreaNotice: 'Standard 9:16 vertical margins with bottom header allowance.',
  };
}

export function createInitialPlatformStatuses(
  targetPlatforms: TargetPlatform[]
): Record<TargetPlatform, PlatformPublishStatus> {
  const platforms: TargetPlatform[] = ['youtube', 'instagram', 'facebook'];
  const result: Partial<Record<TargetPlatform, PlatformPublishStatus>> = {};

  for (const p of platforms) {
    result[p] = {
      platform: p,
      status: targetPlatforms.includes(p) ? 'pending' : 'not_selected',
      retryCount: 0,
    };
  }

  return result as Record<TargetPlatform, PlatformPublishStatus>;
}
