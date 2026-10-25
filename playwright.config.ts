import { defineConfig, devices } from '@playwright/test';

// Emulation runs Chromium only (CLAUDE.md §7): real iPhone/Android checks are done by hand.
const mobile = (name: string, device: (typeof devices)[string]) => ({
  name,
  testDir: 'tests/e2e',
  use: { ...device, browserName: 'chromium' as const },
});

export default defineConfig({
  timeout: 240_000,
  workers: 2,
  use: { baseURL: 'http://localhost:5173' },
  // The AI-import endpoint is mocked in tests/e2e/ai.spec.ts; these only make the app think it is configured.
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    env: { VITE_SUPABASE_URL: 'https://riffreel-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
  },
  projects: [
    { name: 'golden', testDir: 'tests/golden', use: { browserName: 'chromium', viewport: { width: 800, height: 600 } } },
    mobile('iPhone 15', devices['iPhone 15']),
    mobile('Pixel 7', devices['Pixel 7']),
  ],
});
