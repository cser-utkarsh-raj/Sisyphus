import express from 'express';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes.ts';

async function startServer() {
  const app = express();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Health endpoint also reports media-tool availability so runtime mismatches are visible.
  app.get('/api/health', (_req, res) => {
    const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    const ffprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
    const mediaTools = {
      ffmpeg: { available: !ffmpeg.error && ffmpeg.status === 0, version: ffmpeg.stdout?.split(/\r?\n/, 1)[0] || null, error: ffmpeg.error?.message || null },
      ffprobe: { available: !ffprobe.error && ffprobe.status === 0, version: ffprobe.stdout?.split(/\r?\n/, 1)[0] || null, error: ffprobe.error?.message || null },
    };
    res.json({ status: 'ok', product: 'Sisyphus', timestamp: new Date().toISOString(), runtime: { node: process.version, platform: process.platform }, mediaTools });
  });

  const isProduction = process.env.NODE_ENV === 'production';

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

  const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  const ffprobeCheck = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
  if (ffmpegCheck.error || ffmpegCheck.status !== 0 || ffprobeCheck.error || ffprobeCheck.status !== 0) {
    console.error('[SISYPHUS] MEDIA RUNTIME MISCONFIGURED: ffmpeg and/or ffprobe is missing. Deploy using the repository Dockerfile or install both binaries in the backend runtime PATH.');
    if (ffmpegCheck.error) console.error('[SISYPHUS] ffmpeg check:', ffmpegCheck.error.message);
    if (ffprobeCheck.error) console.error('[SISYPHUS] ffprobe check:', ffprobeCheck.error.message);
  } else {
    console.log('[SISYPHUS] Media tools ready:', ffmpegCheck.stdout.split(/\r?\n/, 1)[0]);
  }
  app.listen(port, '0.0.0.0', () => {
    console.log(`[SISYPHUS] Automated Video Production Pipeline listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('[SISYPHUS] Fatal server startup error:', err);
  process.exit(1);
});
