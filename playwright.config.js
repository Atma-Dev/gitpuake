import { defineConfig, devices } from '@playwright/test'

// WebKit, because the app runs in WebKitGTK on Linux.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:1430', ...devices['Desktop Safari'], viewport: { width: 1400, height: 860 } },
  webServer: { command: 'npx vite --port 1430 --strictPort', url: 'http://127.0.0.1:1430', reuseExistingServer: !process.env.CI },
})
