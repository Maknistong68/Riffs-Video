import { defineConfig } from 'vitest/config';
import base from './vite.config';

// Opt-in suites that call real, paid services (npm run ai:eval). Never part of `npm test`.
export default defineConfig({ ...base, test: { ...base.test, include: ['tests/live/**/*.test.ts'], testTimeout: 600_000, fileParallelism: false } });
