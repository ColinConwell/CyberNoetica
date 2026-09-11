FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/renderer/package.json packages/renderer/
COPY packages/audio/package.json packages/audio/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json settings.json ./
COPY apps/web/ apps/web/
COPY packages/ packages/
# The complete shared DSP is bundled into the AudioWorklet and compatibility
# path. No generated audio WASM or throwing production stub is required.
RUN pnpm build

FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
WORKDIR /app
COPY --from=builder /app/apps/web/dist ./dist
COPY --from=builder /app/apps/web/server.cjs ./server.cjs
COPY --from=builder /app/apps/web/auth-page.html ./auth-page.html
# Server dependencies are bundled from the frozen pnpm lockfile; no runtime install.
ENV NODE_ENV=production
ENV AUDIO_DIR=/data/audio
ENV TRUST_PROXY_HOPS=1
EXPOSE 3000
CMD ["node", "server.cjs"]
