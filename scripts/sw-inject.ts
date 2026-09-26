/* Turns src/public/sw.js into this build's worker (spec §8.3, §8.4): the build's
 * version, so a deploy installs a new worker that waits for "Recharger", and the
 * files to precache, so the app starts offline. Used by vite.config.mts. */

const VERSION_LINE = "const VERSION = 'dev'; // __VERSION__";
const PRECACHE_LINE = 'const PRECACHE = []; // __PRECACHE__';

/** Every built file the app may need offline, lazy chunks included (chat,
 * onboarding): the shell is small, and a chunk missing offline is a blank sheet. */
export function precacheList(fileNames: string[]): string[] {
  const assets = fileNames
    .filter((f) => f.startsWith('assets/') && !f.endsWith('.map'))
    .sort()
    .map((f) => `/${f}`);
  return ['/index.html', ...assets];
}

export function injectSw(source: string, version: string, files: string[]): string {
  if (!source.includes(VERSION_LINE) || !source.includes(PRECACHE_LINE))
    throw new Error('sw-inject: a marker line is missing in src/public/sw.js');
  return source
    .replace(VERSION_LINE, `const VERSION = ${JSON.stringify(version)};`)
    .replace(PRECACHE_LINE, `const PRECACHE = ${JSON.stringify(files)};`);
}
