import { defineConfig, devices } from '@playwright/test';

const PORT = 3100; // 3000 is sometimes occupied by Docker on dev machines.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Build + start the production server so the e2e tests exercise the same
    // path users will hit. Build is fast (~1s); the running server is the
    // single source of truth for static asset serving in prod.
    command: `npm run build && PORT=${PORT} npm start`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
