/* Turns src/public/sw.js into this build's worker (spec §8.3, §8.4): the build's
 * version, so a deploy installs a new worker that waits for "Recharger", and the
 * files to precache, so the app starts offline. Used by vite.config.mts. */

import { createHash } from 'node:crypto';

const VERSION_LINE = "const VERSION = 'dev'; // __VERSION__";
const PRECACHE_LINE = 'const PRECACHE = []; // __PRECACHE__';

/** Every built file the app may need offline, lazy chunks included (chat,
 * onboarding): the shell is small, and a chunk missing offline is a blank sheet.
 * The shell is listed as '/', which hosts serve without a redirect (Cloudflare
 * Pages answers /index.html with a redirect to /). */
export function precacheList(fileNames: string[]): string[] {
  const assets = fileNames
    .filter((f) => f.startsWith('assets/') && !f.endsWith('.map'))
    .sort()
    .map((f) => `/${f}`);
  return ['/', ...assets];
}

export function injectSw(source: string, version: string, files: string[]): string {
  if (!source.includes(VERSION_LINE) || !source.includes(PRECACHE_LINE))
    throw new Error('sw-inject: a marker line is missing in src/public/sw.js');
  return source
    .replace(VERSION_LINE, `const VERSION = ${JSON.stringify(version)};`)
    .replace(PRECACHE_LINE, `const PRECACHE = ${JSON.stringify(files)};`);
}

/** The worker's version: the built file names (content-hashed) and index.html,
 * which carries no hash of its own, so any change to either installs a new worker. */
export function buildVersion(fileNames: string[], indexHtml: string): string {
  return createHash('sha256')
    .update([...fileNames].sort().join('\n'))
    .update(indexHtml)
    .digest('hex')
    .slice(0, 12);
}
