import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3049', viewport: { width: 1080, height: 1350 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node .output/server/index.mjs',
    url: 'http://127.0.0.1:3049',
    env: { NITRO_HOST: '127.0.0.1', NITRO_PORT: '3049' },
    reuseExistingServer: false,
  },
})
