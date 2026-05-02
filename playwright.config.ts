import { defineConfig, devices } from '@playwright/test';

const PORT = 3100; // 3001 is the dev default; 3100 keeps e2e isolated from `npm run dev`.
const BASE_URL = `http://localhost:${PORT}`;
const PERSIST_DIR = './data/yjs-test'; // wiped on each test-suite start (V2 persistence isolation)

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
    command: `rm -rf ${PERSIST_DIR} && npm run build && PORT=${PORT} PERSIST_DIR=${PERSIST_DIR} npm start`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
