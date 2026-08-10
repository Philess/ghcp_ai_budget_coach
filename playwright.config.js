import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ['line'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }]
    ],
    outputDir: 'test-results',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ],
    webServer: {
        command: 'node tests/e2e/server.mjs',
        url: 'http://127.0.0.1:4173/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
    }
});
