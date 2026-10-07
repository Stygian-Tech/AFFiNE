import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  outputDir: join(tmpdir(), 'atelier-gate-test-results'),
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'yarn dev --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env.ATELIER_REUSE_SERVER === '1',
  },
});
