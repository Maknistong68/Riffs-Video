import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/** Serves/emits Basic Pitch's model files at /models/basic-pitch/ (model.json references its shard by relative name). */
function basicPitchModel(): Plugin {
  const dir = join(import.meta.dirname, 'node_modules/@spotify/basic-pitch/model');
  const files = ['model.json', 'group1-shard1of1.bin'];
  return {
    name: 'basic-pitch-model',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/models\/basic-pitch\/([^?]+)/);
        if (!m || !files.includes(m[1]!)) return next();
        res.setHeader('Content-Type', m[1]!.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.end(readFileSync(join(dir, m[1]!)));
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: `models/basic-pitch/${f}`, source: readFileSync(join(dir, f)) });
    },
  };
}

/** Shown in Settings so the user can tell which version the phone is running. */
function appVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? (() => {
    try {
      return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return 'dev';
    }
  })();
  return `${sha.slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    basicPitchModel(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/app/pwa.ts
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'RiffReel — Guitar Riff Video Maker',
        short_name: 'RiffReel',
        description: 'Turn guitar riffs into vertical videos with an animated neck and tab, made on your phone.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d0f14',
        theme_color: '#0d0f14',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Offline after first load: app shell, workers, SoundFont, font, Basic Pitch model, AAC fallback.
        globPatterns: ['**/*.{js,css,html,woff2,sf2,sf3,json,bin,png,svg}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: [
      // alphaTab's package entry auto-starts alphaTab's own worker protocol when loaded inside a
      // Web Worker (it hijacks onmessage). We use it as a plain library everywhere, so import the
      // side-effect-free core build. Same API and types.
      { find: /^@coderline\/alphatab$/, replacement: join(import.meta.dirname, 'node_modules/@coderline/alphatab/dist/alphaTab.core.mjs') },
    ],
  },
  worker: { format: 'es' },
  // Pre-bundle worker deps so the dev server never reloads the page mid-export.
  optimizeDeps: {
    include: ['mediabunny', '@mediabunny/aac-encoder', '@spotify/basic-pitch', '@tensorflow/tfjs'],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
