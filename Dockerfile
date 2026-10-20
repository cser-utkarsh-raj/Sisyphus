# Production runtime for Sisyphus: Node + FFmpeg + FFprobe.
# Deploy this repository as a Docker container, not as a static Vite site.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV PORT=3000

WORKDIR /app

# FFmpeg and FFprobe are system binaries; npm packages alone do not provide them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && "${FFMPEG_PATH}" -version \
    && "${FFPROBE_PATH}" -version

COPY package.json ./
RUN npm install --include=dev

COPY . .
RUN npm run lint && npm run build && npm test

EXPOSE 3000
CMD ["npm", "run", "start"]
