import { defineConfig } from 'vite';
import { createAudioRouter } from './server/audio-files.js';
import express from 'express';
import { createValidationReportRouter } from './server/validation-report.js';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { existsSync, createReadStream, readFileSync } from 'fs';

export default defineConfig({
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions:
      process.env.CYBER_QA === '1'
        ? {
            input: {
              main: resolve(__dirname, 'index.html'),
              validation: resolve(__dirname, 'validation.html'),
            },
          }
        : undefined,
  },
  optimizeDeps: {
    exclude: ['@cybernoetica/audio'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [
          /^\/sample-music(?:\/|$)/,
          /^\/(?:api|auth|assets)(?:\/|$)/,
        ],
        // Audio is intentionally network-only: automatic multi-megabyte downloads
        // cannot be bounded by entry count and may cache authenticated responses.
        runtimeCaching: [],
      },
      manifest: {
        name: 'Cybernoetica',
        short_name: 'Cybernoetica',
        description: 'GPU-accelerated audio-reactive visualizer',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
    {
      name: 'dev-settings',
      configureServer(server) {
        const settingsPath = resolve(__dirname, '../../settings.json');
        server.middlewares.use('/settings.json', (_req, res, next) => {
          if (!existsSync(settingsPath)) {
            res.setHeader('Content-Type', 'application/json');
            res.end('{}');
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          createReadStream(settingsPath).pipe(res);
        });
      },
      generateBundle() {
        const settingsPath = resolve(__dirname, '../../settings.json');
        if (existsSync(settingsPath)) {
          this.emitFile({
            type: 'asset',
            fileName: 'settings.json',
            source: readFileSync(settingsPath, 'utf-8'),
          });
        }
      },
    },
    {
      name: 'sample-music',
      configureServer(server) {
        server.middlewares.use(
          '/sample-music',
          express().use(
            createAudioRouter(resolve(__dirname, '../../data/sample-music')),
          ),
        );
      },
      configurePreviewServer(server) {
        server.middlewares.use(
          '/sample-music',
          express().use(
            createAudioRouter(resolve(__dirname, '../../data/sample-music')),
          ),
        );
        if (process.env.CYBER_QA === '1')
          server.middlewares.use(
            '/__validation',
            express().use(createValidationReportRouter()),
          );
      },
    },
  ],
});
