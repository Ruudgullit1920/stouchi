import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/* The test account and the public Supabase settings come from .env (never printed). */
if (existsSync('.env')) process.loadEnvFile('.env');

/* Spec §8.6: iPhone 13 and Pixel 7 viewports. iPhone runs WebKit, Pixel runs Chromium. */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  /* The preview build registers sw.js; with a service worker in the way,
     WebKit's requests skip page.route stubs. The push specs fake it instead. */
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry', serviceWorkers: 'block' },
  /* The production host, locally: Cloudflare Pages (wrangler) serves dist/ with
     src/public/_headers, its redirects (/index.html → /) and the /api/aam
     Function, which reads .env like the dev server. */
  webServer: {
    command: 'npm run build && npm run preview:pages -- --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  /* The core specs share one test account: run one test at a time so one
     test's writes never move another test's figures. */
  workers: 1,
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'iphone-13', use: { ...devices['iPhone 13'] }, dependencies: ['setup'] },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] }, dependencies: ['setup'] },
  ],
});
