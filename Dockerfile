# Production runtime for Sisyphus: Node + FFmpeg + FFprobe.
# Deploy this repository as a Docker service, not as a static Vite site.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# FFmpeg and FFprobe are system binaries; npm packages alone do not provide them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version \
    && ffprobe -version

COPY package.json ./
RUN npm install

COPY . .
RUN npm run lint && npm run build && npm test

EXPOSE 3000
CMD ["npm", "run", "start"]
