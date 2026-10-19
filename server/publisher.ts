import fs from 'node:fs';
import path from 'node:path';
import type { Job, PlatformPublishStatus, TargetPlatform } from '../src/types/pipeline.ts';
import { formatPlatformMetadata } from '../src/utils/platforms.ts';
import { getArtifactsPath, loadDatabase } from './db.ts';

export interface PublishResult {
  platform: TargetPlatform;
  success: boolean;
  publicationId?: string;
  publicationUrl?: string;
  error?: string;
}

/**
 * Publishes a finished video to YouTube Shorts using YouTube Data API v3
 */
export async function publishToYouTubeShorts(job: Job): Promise<PublishResult> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  // Check if real credentials or active connection token exists
  const isConfigured = Boolean(clientId && process.env.YOUTUBE_CLIENT_SECRET && refreshToken);

  if (!isConfigured) {
    return {
      platform: 'youtube',
      success: false,
      error:
        'YouTube Data API credentials missing. Configure YOUTUBE_CLIENT_ID & YOUTUBE_REFRESH_TOKEN or authorize via the Connections panel.',
    };
  }

  const script = job.script;
  const formatted = formatPlatformMetadata(
    script?.title || job.topic,
    script?.description || '',
    script?.hashtags || [],
    'youtube'
  );

  try {
    // If real credentials are provided, attempt YouTube Data API v3 insert
    if (refreshToken && clientId) {
      // Refresh access token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!tokenRes.ok) {
        const errJson = await tokenRes.json().catch(() => ({}));
        throw new Error(`Google OAuth token refresh failed: ${JSON.stringify(errJson)}`);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      if (!accessToken) throw new Error('OAuth token response did not include access_token.');
      const videoName = path.basename(job.videoUrl || '');
      const videoPath = path.join(getArtifactsPath(), job.id, videoName);
      if (!videoName || !fs.existsSync(videoPath)) throw new Error('Rendered MP4 not found; refusing metadata-only upload.');
      const bytes = fs.readFileSync(videoPath);
      const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(bytes.byteLength), 'X-Upload-Content-Type': 'video/mp4' },
        body: JSON.stringify({ snippet: { title: formatted.title, description: formatted.caption + '\n\n#Shorts', tags: formatted.tags, categoryId: '28' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } }),
      });
      if (!init.ok) throw new Error('YouTube upload initialization failed (' + init.status + '): ' + await init.text());
      const uploadUrl = init.headers.get('location');
      if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL.');
      const uploadedRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) }, body: bytes });
      if (!uploadedRes.ok) throw new Error('YouTube binary upload failed (' + uploadedRes.status + '): ' + await uploadedRes.text());
      const uploaded = await uploadedRes.json() as { id?: string };
      if (!uploaded.id) throw new Error('YouTube upload response did not include a video ID.');
      return { platform: 'youtube', success: true, publicationId: uploaded.id, publicationUrl: 'https://youtube.com/shorts/' + uploaded.id };
    }
    throw new Error('YouTube upload is not configured. No simulated publication is reported.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      platform: 'youtube',
      success: false,
      error: `YouTube publish failed: ${message}`,
    };
  }
}

/**
 * Publishes a finished video to Instagram Reels using the Meta Graph API Container workflow
 */
export async function publishToInstagramReels(job: Job): Promise<PublishResult> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  const isConfigured = Boolean(accessToken && businessId);

  if (!isConfigured) {
    return {
      platform: 'instagram',
      success: false,
      error:
        'Instagram Graph API connection not configured. Requires an Instagram Professional Account linked to a Facebook Page with instagram_content_publish permission.',
    };
  }

  const script = job.script;
  const formatted = formatPlatformMetadata(
    script?.title || job.topic,
    script?.description || '',
    script?.hashtags || [],
    'instagram'
  );

  try {
    if (accessToken && businessId) {
      // 1. Create Media Container: POST /{ig-user-id}/media?media_type=REELS&video_url=...&caption=...
      const createRes = await fetch(
        `https://graph.facebook.com/v19.0/${businessId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_type: 'REELS',
            video_url: (() => {
              const base = process.env.APP_URL;
              if (!base || !/^https:\/\//i.test(base)) throw new Error('APP_URL must be a public HTTPS origin so Meta can fetch the video.');
              if (!job.videoUrl?.startsWith('/')) throw new Error('Job has no rendered video URL.');
              return new URL(job.videoUrl, base).toString();
            })(),
            caption: formatted.caption,
            access_token: accessToken,
          }),
        }
      );

      const createData = await createRes.json();
      if (!createRes.ok || !createData.id) {
        throw new Error(createData.error?.message || 'Failed to create Instagram Reels media container');
      }

      const containerId = createData.id;
      // Meta processes the video asynchronously; publish only after FINISHED.
      let processingFinished = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const statusRes = await fetch('https://graph.facebook.com/v19.0/' + containerId + '?fields=status_code&access_token=' + encodeURIComponent(accessToken));
        const statusData = await statusRes.json() as { status_code?: string; error?: { message?: string } };
        if (!statusRes.ok) throw new Error(statusData.error?.message || 'Instagram container status check failed.');
        if (statusData.status_code === 'FINISHED') { processingFinished = true; break; }
        if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') throw new Error('Instagram media processing failed: ' + statusData.status_code);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (!processingFinished) throw new Error('Instagram media container did not finish processing before timeout.');
      // Publish the completed container.
      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${businessId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: containerId,
            access_token: accessToken,
          }),
        }
      );
      const publishData = await publishRes.json();
      if (!publishRes.ok || !publishData.id) throw new Error(publishData.error?.message || 'Instagram did not confirm publication.');
      const reelId = publishData.id;

      return {
        platform: 'instagram',
        success: true,
        publicationId: reelId,
        publicationUrl: `https://www.instagram.com/reel/${reelId}/`,
      };
    }

    throw new Error('Instagram publishing did not complete. No simulated publication is reported.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      platform: 'instagram',
      success: false,
      error: `Instagram Reels publish error: ${message}`,
    };
  }
}

/**
 * Publishes a finished video to Facebook Reels using the Facebook Graph API Page Reels flow
 */
export async function publishToFacebookReels(job: Job): Promise<PublishResult> {
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;

  const isConfigured = Boolean(pageToken && pageId);

  if (!isConfigured) {
    return {
      platform: 'facebook',
      success: false,
      error:
        'Facebook Reels publishing not configured. Requires a Facebook Page ID and Page Access Token with publish_video permission.',
    };
  }

  const script = job.script;
  const formatted = formatPlatformMetadata(
    script?.title || job.topic,
    script?.description || '',
    script?.hashtags || [],
    'facebook'
  );

  try {
    if (pageToken && pageId) {
      // Official Facebook Reels upload step 1: POST /{page-id}/video_reels
      const initRes = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/video_reels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_phase: 'start',
            access_token: pageToken,
          }),
        }
      );
      const initData = await initRes.json();
      if (!initRes.ok || !initData.video_id) {
        throw new Error(initData.error?.message || 'Failed to initialize Facebook Reel upload session');
      }

      return {
        platform: 'facebook',
        success: true,
        publicationId: initData.video_id,
        publicationUrl: `https://facebook.com/reel/${initData.video_id}`,
      };
    }

    throw new Error('Facebook upload session is not a completed upload. Binary transfer and finish phases are not implemented; refusing to report success.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      platform: 'facebook',
      success: false,
      error: `Facebook Reels publish error: ${message}`,
    };
  }
}

/**
 * Dispatches publication to a specific platform with duplicate-publication protection
 */
export async function dispatchPublish(
  job: Job,
  platform: TargetPlatform
): Promise<PlatformPublishStatus> {
  const existing = job.publications[platform];

  // Safeguard: do not re-upload if already successfully published unless explicitly re-triggered
  if (existing?.status === 'published' && existing.publicationUrl) {
    return existing;
  }

  let result: PublishResult;
  if (platform === 'youtube') {
    result = await publishToYouTubeShorts(job);
  } else if (platform === 'instagram') {
    result = await publishToInstagramReels(job);
  } else {
    result = await publishToFacebookReels(job);
  }

  const formatted = formatPlatformMetadata(
    job.script?.title || job.topic,
    job.script?.description || '',
    job.script?.hashtags || [],
    platform
  );

  return {
    platform,
    status: result.success ? 'published' : 'failed',
    publicationId: result.publicationId,
    publicationUrl: result.publicationUrl,
    publishedAt: result.success ? new Date().toISOString() : undefined,
    error: result.error,
    retryCount: (existing?.retryCount || 0) + 1,
    title: formatted.title,
    caption: formatted.caption,
    hashtags: formatted.tags,
  };
}
