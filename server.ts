import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes.ts';
import { getMediaToolsStatus } from './server/mediaTools.ts';

async function startServer() {
  const app = express();

  // In AI Studio sandbox development, Nginx reverse-proxies port 8080 to Node on port 3000.
  // In a standalone production container (e.g. Cloud Run, Render), listen on process.env.PORT.
  const isProduction = process.env.NODE_ENV === 'production';
  const port = isProduction && process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : (process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : 3000);

  app.use(express.json());

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Health endpoint reports honest media-tool availability, resolved paths, versions, and runtime
  app.get('/api/health', (_req, res) => {
    const media = getMediaToolsStatus();
    res.json({
      status: 'ok',
      product: 'Sisyphus',
      timestamp: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      mediaTools: {
        ffmpeg: {
          available: media.ffmpeg.available,
          path: media.ffmpeg.resolvedPath,
          version: media.ffmpeg.version,
          error: media.ffmpeg.error,
        },
        ffprobe: {
          available: media.ffprobe.available,
          path: media.ffprobe.resolvedPath,
          version: media.ffprobe.version,
          error: media.ffprobe.error,
        },
        renderingReady: media.operational,
        diagnostic: media.diagnosticMessage,
      },
    });
  });

  if (isProduction) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Mount Vite dev server middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const mediaStatus = getMediaToolsStatus();
  if (!mediaStatus.operational) {
    console.error(`[SISYPHUS] MEDIA TOOLS WARNING: ${mediaStatus.diagnosticMessage}`);
    if (mediaStatus.ffmpeg.error) console.error(`[SISYPHUS] FFmpeg check: ${mediaStatus.ffmpeg.error}`);
    if (mediaStatus.ffprobe.error) console.error(`[SISYPHUS] FFprobe check: ${mediaStatus.ffprobe.error}`);
  } else {
    console.log(`[SISYPHUS] Media tools ready: FFmpeg (${mediaStatus.ffmpeg.version}) | FFprobe (${mediaStatus.ffprobe.version})`);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[SISYPHUS] Automated Video Production Pipeline listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('[SISYPHUS] Fatal server startup error:', err);
  process.exit(1);
});
