import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Serves/emits Basic Pitch's model files at /models/basic-pitch/ (model.json references its shard by relative name). */
function basicPitchModel(): Plugin {
  const dir = join(__dirname, 'node_modules/@spotify/basic-pitch/model');
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

export default defineConfig({
  plugins: [react(), basicPitchModel()],
  resolve: {
    alias: [
      // alphaTab's package entry auto-starts alphaTab's own worker protocol when loaded inside a
      // Web Worker (it hijacks onmessage). We use it as a plain library everywhere, so import the
      // side-effect-free core build. Same API and types.
      { find: /^@coderline\/alphatab$/, replacement: join(__dirname, 'node_modules/@coderline/alphatab/dist/alphaTab.core.mjs') },
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
