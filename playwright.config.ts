import { defineConfig, devices } from '@playwright/test';

// Emulation runs Chromium only (see CLAUDE.md §7): real iPhone/Android checks are done by hand.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
  projects: [
    { name: 'iPhone 15', use: { ...devices['iPhone 15'], browserName: 'chromium' } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
  ],
});
