import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', use: { baseURL: process.env.BYOA_MARGIN_URL || 'http://127.0.0.1:5183', channel: process.env.CHROME_FOR_TESTING_BIN ? undefined : 'chrome', launchOptions: { executablePath: process.env.CHROME_FOR_TESTING_BIN }, viewport: { width: 1440, height: 1100 } }, reporter: 'list', workers: 1 });
