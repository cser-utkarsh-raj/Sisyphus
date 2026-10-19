# Sisyphus

**An automated short-form video production pipeline for vertical videos under 60 seconds.**

Sisyphus turns a topic into a narrated, scene-based video workflow: script and storyboard generation, speech audio, word-timed subtitles, visual rendering, MP4 encoding, metadata preparation, and publishing workflow tracking. It is designed for educational, science, and entertaining short-form content for YouTube Shorts, Instagram Reels, and Facebook Reels.

> **Project status:** This repository contains an active implementation of the production workflow, but not every external publishing/OAuth path should be assumed production-ready. Configure credentials and verify each integration end-to-end before relying on automated publishing.

## Features

- **AI-assisted scripts and storyboards** using the Google Gemini API.
- **Voice profiles** with four built-in options: Zephyr, Puck, Kore, and Fenrir.
- **Visual styles** for infographic-oriented short-form videos.
- **11-stage pipeline** with per-stage progress, logs, status, and retry-from-stage support.
- **Karaoke-style subtitle timing utilities**; current timing is estimated from narration duration, not true acoustic forced alignment.
- **Vertical video output** targeting 1080 × 1920 (9:16), 30 FPS, and a duration below 60 seconds.
- **Pipeline and artifact library** for tracking jobs and accessing generated outputs.
- **Connection and settings screens** for configuring platform preferences and defaults.
- **Express API and Vite development server** served together from one Node.js process.

## How the pipeline works

A job moves through these stages:

1. Validate input
2. Generate script
3. Validate duration
4. Generate narration audio
5. Align subtitles
6. Render scenes
7. Composite media
8. Encode MP4
9. Prepare metadata
10. Publish to selected platforms
11. Record final status

Jobs run asynchronously after creation. The UI can track progress and inspect stage logs; failed stages can be retried where supported. Scene-plan validation is recorded separately; the rendering engine performs motion-graphic rendering, subtitle compositing, audio muxing, encoding, and output verification during the compositing stage.

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Styling and UI | Tailwind CSS, Lucide icons, Motion |
| Backend/API | Node.js, Express, TypeScript |
| AI | Google Gemini via `@google/genai` |
| Video processing | FFmpeg-based rendering and encoding |
| Persistence | Local JSON store and generated files (single-instance/local deployment only) |
| Build checks | TypeScript type-checking and Vite production build |

## Requirements

- Node.js version compatible with Vite 8 (Node.js **22.12+** is a practical choice).
- pnpm, or another package manager if you prefer to install from `package.json`.
- FFmpeg installed and available on your system `PATH` for video rendering/encoding.
- A Google Gemini API key for Gemini-backed script and narration generation.
- Platform API credentials only if you intend to configure external publishing integrations.

Check your installations:

```bash
node --version
pnpm --version
ffmpeg -version
```

## Deploy the backend with FFmpeg

The video renderer requires both `ffmpeg` and `ffprobe` to exist as operating-system executables on the **backend runtime's PATH**. Installing JavaScript dependencies does not install these binaries. If the job log says `/bin/sh: ffmpeg: not found`, the deployed backend image does not contain FFmpeg.

This repository now includes a `Dockerfile` that installs FFmpeg/FFprobe, verifies both commands, builds the frontend, runs the engine self-tests, and starts the Express server with `tsx`. It also includes a `render.yaml` blueprint for a Docker-based Render web service.

### Render deployment

1. Push the latest `main` branch and create a new Blueprint instance from this repository in Render, or create a Web Service using the Docker runtime and the repository's `Dockerfile`.
2. Set `GEMINI_API_KEY` in the service environment. Set `APP_URL` to the deployed public HTTPS origin (for example, your Render service URL) for integrations that need it.
3. Deploy, then open `/api/health` on the service. A healthy HTTP response confirms the server is running; it does **not** by itself confirm video rendering.
4. Run a real short test job and verify that the Encode & Verify MP4 stage succeeds. The deployment logs should show that FFmpeg and FFprobe are available during image build.

**Important:** a Dockerfile only takes effect on platforms configured to build and run this repository as a Docker service. If your current host is a static-site deployment or a managed workspace that ignores Dockerfiles, redeploy the Express backend using Docker or configure that host's system packages to install FFmpeg. A Vercel static frontend alone is not a suitable runtime for this long-running FFmpeg worker.

The current job store and artifacts are local filesystem-based. Before relying on restarts, multiple instances, or production publishing, configure persistent storage and a durable job database/object store; this Docker setup solves the missing executable, not that separate persistence issue.

## Run locally

### 1. Clone and install

```bash
git clone https://github.com/cser-utkarsh-raj/Sisyphus.git
cd Sisyphus
pnpm install
```

If you use npm instead, run `npm install` and use `npm run <script>` for the commands below.

### 2. Configure environment variables

Copy `.env.example` to `.env` and replace placeholder values with your own credentials:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
APP_URL=http://localhost:3000
```

The example file also documents optional YouTube, Instagram, and Facebook credentials. Only add the credentials needed for the integrations you are configuring.

**Keep secrets server-side.** Do not commit `.env`, expose API keys in frontend code, or use a `VITE_` prefix for server-only credentials.

### 3. Start the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The Express server mounts the API under `/api` and uses Vite middleware for frontend development.

### 4. Run checks and build

```bash
pnpm lint
pnpm build
```

- `pnpm lint` runs the TypeScript compiler with `noEmit`.
- `pnpm build` creates the frontend production bundle in `dist/`.

The repository currently defines no dedicated `test` or `format` package script. Check the available scripts in `package.json` before assuming those workflows exist.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side Gemini API access for AI-backed generation |
| `APP_URL` | Public base URL used by application links and integration callbacks |
| `YOUTUBE_CLIENT_ID` | YouTube OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | YouTube OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | YouTube OAuth refresh token |
| `INSTAGRAM_APP_ID` | Meta app ID for Instagram integration |
| `INSTAGRAM_APP_SECRET` | Meta app secret |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram/Meta access token |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram professional account ID |
| `FACEBOOK_PAGE_ID` | Facebook Page ID |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Facebook Page access token |

Some integrations may require additional permissions, OAuth setup, account eligibility, or implementation work beyond setting environment variables. Consult the Connections screen and the official platform documentation before enabling them.

### Publishing behavior and limitations

- **YouTube:** With `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REFRESH_TOKEN`, Sisyphus uploads the generated MP4 through the YouTube resumable upload API. Uploads default to **private**; change visibility in YouTube Studio after verifying the result.
- **Instagram Reels:** Requires `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, and a publicly reachable HTTPS `APP_URL`. Meta fetches the rendered MP4 from the job's artifact URL, processes the media container, and the publisher waits for processing to finish before calling `media_publish`. The artifact URL must be accessible to Meta without local-only networking or authentication barriers.
- **Facebook Reels:** The publisher now initializes a Reels upload, transfers the actual MP4 bytes, calls the finish/publish phase, and verifies that Graph API can resolve the resulting video. This still needs a credentialed live test on an eligible Facebook Page.
- Missing Gemini credentials or failed script/TTS requests now fail the job instead of silently substituting a fabricated script or tone audio. Set `SISYPHUS_ALLOW_DEMO_FALLBACK=true` only for local demos; do not enable it for production.
- Missing credentials, API errors, missing media IDs, and unfinished processing are failures—not simulated success. A connection marked connected in the UI does not substitute for valid server-side credentials.
- YouTube uploads are checked with a follow-up `videos.list` request. Instagram waits for container processing to finish before publishing. Facebook's three upload phases are implemented, but all social publishers still require live account-level verification.

## Data and generated files

The backend stores application state in:

- `data/sisyphus-store.json` — jobs, voice profiles, connection state, and settings.
- `data/artifacts/` — generated audio, video, subtitles, thumbnails, and related artifacts.

These are local filesystem paths, not managed cloud storage. Back up the data directory if you need to preserve jobs and generated output. A deployment with ephemeral disks can lose this data when the instance is replaced or restarted; use persistent storage before hosting real workloads.

## API overview

The Express API is mounted at `/api`. Main routes include:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Basic server health response |
| `GET /api/jobs` | List jobs |
| `POST /api/jobs` | Create and start a pipeline job |
| `GET /api/jobs/:id` | Read one job |
| `POST /api/jobs/:id/retry/:stage` | Resume a job from a pipeline stage |
| `GET /api/voices` | List voice profiles and the default voice |
| `GET /api/settings` / `PUT /api/settings` | Read or update settings |
| `GET /api/connections` | Read publishing connection state |

For the authoritative route list and request shapes, inspect `server/routes.ts` and the types in `src/types/pipeline.ts`.

## Deployment notes

Sisyphus is a **full-stack application**, not just a static Vite site. The UI depends on the Express API, server-side Gemini calls, FFmpeg processing, background pipeline execution, and filesystem access for generated artifacts.

A static-only deployment of `dist/` will not provide those backend capabilities. Deploy the Node.js server on a host that supports long-running processes and FFmpeg, and configure persistent storage for `data/`. If the frontend and API are hosted separately, configure API routing/base URLs and CORS appropriately before deployment.

Before production use, verify:
- FFmpeg availability and permissions on the host.
- Persistent storage and backup/retention for `data/`.
- API key and OAuth secret handling.
- Real media upload behavior, OAuth callbacks, and platform-specific permissions.
- Job recovery, logging, and failure handling under long-running workloads.

## Repository layout

```text
.
├── src/
│   ├── components/       # UI views and shared components
│   ├── types/            # Pipeline and application types
│   └── utils/            # Pipeline stages, subtitle timing, validation, platform helpers
├── server/
│   ├── routes.ts         # Express API routes
│   ├── db.ts             # JSON persistence and artifact paths
│   ├── gemini.ts         # Gemini-backed generation and speech
│   ├── pipelineRunner.ts # Asynchronous pipeline orchestration
│   ├── videoRenderer.ts  # Scene rendering and MP4 encoding
│   └── publisher.ts      # Publishing integration logic
├── data/                 # Local runtime state and artifacts (created at runtime)
├── server.ts             # Express + Vite server entry point
├── vite.config.ts
├── package.json
└── .env.example
```

## Contributing

1. Create a focused branch for your change.
2. Keep changes scoped and preserve existing pipeline behavior.
3. Run `pnpm lint` and `pnpm build`.
4. Describe what was changed and which checks were actually executed in your pull request.

## License

No license file was found when this README was prepared. Unless a license is added to the repository, do not assume the code is available for unrestricted reuse.
