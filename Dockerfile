FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/renderer/package.json packages/renderer/
COPY packages/audio/package.json packages/audio/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY settings.json ./
COPY apps/web/ apps/web/
COPY packages/ packages/

RUN mkdir -p packages/audio/wasm && \
    printf 'export default async function init() {}\nexport class AudioAnalyzer { constructor() { throw new Error("WASM not built"); } }\n' \
    > packages/audio/wasm/audio_analysis.js

RUN pnpm build
RUN pnpm --filter @cybernoetica/web build:server

# ── Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/apps/web/dist ./dist
COPY --from=builder /app/apps/web/server.mjs ./server.mjs
COPY --from=builder /app/apps/web/auth-page.html ./auth-page.html

RUN npm install --no-save express compression cookie-session multer

ENV NODE_ENV=production
ENV AUDIO_DIR=/data/audio
EXPOSE 3000
CMD ["node", "server.mjs"]
