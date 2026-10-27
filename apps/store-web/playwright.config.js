import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The shipped customer entry point is offline licensing. Older account/payment
  // specs target the retired backend application and are retained as historical tests.
  testMatch: 'offline-library.spec.js',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5178', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort',
    url: 'http://127.0.0.1:5178', reuseExistingServer: false, timeout: 30000 },
});
