import { defineConfig } from 'vitest/config';
import base from './vite.config';

// Same config as unit tests, but only the (slow) accuracy suite.
export default defineConfig({ ...base, test: { ...base.test, include: ['tests/accuracy/**/*.test.ts'], testTimeout: 300_000, fileParallelism: false } });
