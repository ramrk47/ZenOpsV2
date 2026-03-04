import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'
const apiURL = process.env.E2E_API_URL || 'http://localhost:8000'
const includeRunnerHeader = String(process.env.E2E_INCLUDE_RUNNER_HEADER || '0') === '1'

export default defineConfig({
  testDir: './playwright/tests',
  timeout: 60_000,
  retries: 1,
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright/test-results/html-report', open: 'never' }],
  ],
  outputDir: 'playwright/test-results/artifacts',
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    extraHTTPHeaders: includeRunnerHeader ? { 'X-E2E-Runner': 'phase8.5' } : undefined,
  },
  expect: {
    timeout: 10_000,
  },
  metadata: {
    baseURL,
    apiURL,
  },
})
