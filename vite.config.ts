import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Pre-bundle worker deps so the dev server never reloads the page mid-export.
  optimizeDeps: { include: ['mediabunny', '@mediabunny/aac-encoder'] },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
