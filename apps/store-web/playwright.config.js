import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // P7: spec offline-library da go cung OfflineLibrary. admin.spec.js va catalog.spec.js la spec cu cua ung dung truoc v3,
  // CHUA tung duoc chay lai -> khong bat cho den khi duoc kiem va viet lai.
  testMatch: [],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5178', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort',
    url: 'http://127.0.0.1:5178', reuseExistingServer: false, timeout: 30000 },
});
