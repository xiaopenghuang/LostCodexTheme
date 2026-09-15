import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testMatch: ['**/editor/*.spec.ts', '**/editor/*.spec.mjs'],
  outputDir: 'artifacts/production/results',
  webServer: {
    ...base.webServer,
    command: 'npm run preview -- --port 1421 --strictPort',
  },
  reporter: [['list'], ['json', { outputFile: 'artifacts/production/report.json' }]],
});
