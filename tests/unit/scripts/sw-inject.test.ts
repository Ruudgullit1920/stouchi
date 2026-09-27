/* The build step that turns src/public/sw.js into this build's worker (Phase 7
 * Task 3): a version and the files to precache. */
import { describe, expect, it } from 'vitest';
import { buildVersion, injectSw, precacheList } from '../../../scripts/sw-inject';

const TEMPLATE = [
  "const VERSION = 'dev'; // __VERSION__",
  'const PRECACHE = []; // __PRECACHE__',
  'self.x = [VERSION, PRECACHE];',
].join('\n');

describe('precacheList', () => {
  it('keeps the app shell (as /, what hosts serve without a redirect) and every built asset, never maps, the manifest or the worker', () => {
    expect(
      precacheList([
        'index.html',
        'assets/index-a.js',
        'assets/index-a.js.map',
        'assets/chat-b.js',
        'assets/index-c.css',
        'assets/jakarta-d.woff2',
        '.vite/manifest.json',
        'sw.js',
      ]),
    ).toEqual([
      '/',
      '/assets/chat-b.js',
      '/assets/index-a.js',
      '/assets/index-c.css',
      '/assets/jakarta-d.woff2',
    ]);
  });
});

describe('injectSw', () => {
  it('writes the version and the list into the two marked lines', () => {
    const out = injectSw(TEMPLATE, 'v42', ['/index.html', '/assets/a.js']);
    expect(out).toContain('const VERSION = "v42";');
    expect(out).toContain('const PRECACHE = ["/index.html","/assets/a.js"];');
    expect(out).not.toContain('__VERSION__');
    expect(out).toContain('self.x = [VERSION, PRECACHE];');
  });

  it('fails the build when a marker is missing', () => {
    expect(() => injectSw('const VERSION = 1;', 'v1', [])).toThrow(/marker/);
  });
});

describe('buildVersion', () => {
  it('changes with the file names and with index.html alone (review m6)', () => {
    const a = buildVersion(['assets/a.js', 'index.html'], '<html>1');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(buildVersion(['index.html', 'assets/a.js'], '<html>1')).toBe(a);
    expect(buildVersion(['assets/b.js', 'index.html'], '<html>1')).not.toBe(a);
    expect(buildVersion(['assets/a.js', 'index.html'], '<html>2')).not.toBe(a);
  });
});
