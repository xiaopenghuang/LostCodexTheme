import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 15000,
  use: { browserName: 'chromium', channel: 'chrome', headless: true },
  webServer: {
    command: 'npm run dev -- --port 1421',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: 'list',
});
