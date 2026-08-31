# Dayline render worker — portable container image.
# Base: Debian-slim Node 22 + apt-installed ffmpeg (matches the version
# family this worker was developed and tested against: ffmpeg 6.1,
# Ubuntu/Debian packaging). Any Docker-capable host works — see
# docs/DEPLOYMENT.md for current hosting-cost notes.

FROM node:22-bookworm-slim AS base

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM base AS build
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV WORKER_TMP_DIR=/tmp/dayline-worker
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN useradd --create-home --shell /usr/sbin/nologin worker && \
    mkdir -p /tmp/dayline-worker && chown -R worker:worker /tmp/dayline-worker /app
USER worker

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
