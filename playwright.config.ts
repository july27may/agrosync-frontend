import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:5173', launchOptions: { executablePath: process.env.CHROME_PATH } },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
})
