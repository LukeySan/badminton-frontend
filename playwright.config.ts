import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* The tests make their own users and videos, so they can run in parallel on CI too */
  workers: process.env.CI ? 2 : undefined,
  /* CI: failures as annotations on the PR, plus an HTML report kept as an artifact */
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: 'playwright/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    // Safari's engine: iPhones (and the Capacitor iOS app) run WebKit. On in CI.
    // Locally only with PW_WEBKIT=1: Playwright's WebKit hangs opening a page on
    // macOS 26.0 (Nov 2026), so on a Mac use `bun run test:webkit` (Linux WebKit
    // in Docker, like CI).
    ...(process.env.CI || process.env.PW_WEBKIT
      ? [
          {
            name: 'webkit',
            use: {
              ...devices['Desktop Safari'],
              storageState: 'playwright/.auth/user.json',
            },
            dependencies: ['setup'],
          },
          // iPhone: WebKit, touch, phone screen. Only the video screen specs: the rest of
          // the suite drives the desktop layout. These specs remove the element
          // Fullscreen API here, like iPhone Safari, so the fallback is what's tested.
          {
            name: 'iphone',
            use: {
              ...devices['iPhone 15'],
              storageState: 'playwright/.auth/user.json',
            },
            testMatch: /video-screen.*\.spec\.ts/,
            dependencies: ['setup'],
          },
        ]
      : []),

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'bun run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
});
