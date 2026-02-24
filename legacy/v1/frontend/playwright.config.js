const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: 'tests',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    headless: true,
  },
  timeout: 60_000,
})
