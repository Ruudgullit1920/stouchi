import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { injectSw, precacheList } from './scripts/sw-inject';

const envDir = fileURLToPath(new URL('.', import.meta.url));

/* In dev, POST /api/aam runs the same handler as the Vercel function
   (api/aam.ts). The pipeline is CommonJS, so it is required natively here
   and handed to the handler, which Vite loads from source. */
function aamApi(): Plugin {
  return {
    name: 'aam-api',
    configureServer(server) {
      const pipeline = createRequire(import.meta.url)(
        './lib/aam-salah',
      ) as typeof import('./lib/aam-salah/index.js');
      server.middlewares.use('/api/aam', (req, res) => {
        void (async () => {
          let raw = '';
          for await (const chunk of req) {
            raw += String(chunk);
            if (raw.length > 64 * 1024) break; // aamHttp answers 413 above 32 kB
          }
          const { serveAam, devEnv } = (await server.ssrLoadModule(
            '/server/aam/http.ts',
          )) as typeof import('./src/server/aam/http');
          /* dev reads stouchi-test (VITE_*), never a production SUPABASE_URL */
          const env = devEnv({ ...process.env, ...loadEnv(server.config.mode, envDir, '') });
          const out = await serveAam(
            { method: req.method, authorization: req.headers.authorization, body: raw },
            env,
            { handleAam: pipeline.handleAam, safe: pipeline.SAFE },
          );
          res.statusCode = out.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(out.body));
        })();
      });
    },
  };
}

/* public/sw.js is copied as is; once the build is written, fill in its version
   and precache list (scripts/sw-inject). The version hashes the content-hashed
   file names, so any change to the app installs a new worker. */
function serviceWorker(): Plugin {
  let outDir = '';
  let files: string[] = [];
  return {
    name: 'stouchi-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      files = Object.keys(bundle);
    },
    closeBundle() {
      const path = join(outDir, 'sw.js');
      const version = createHash('sha256').update(files.sort().join('\n')).digest('hex').slice(0, 12);
      writeFileSync(path, injectSw(readFileSync(path, 'utf8'), version, precacheList(files)));
    },
  };
}

/* The rebuild has its own index.html in src/, so the live app's root
   index.html is never picked up by Vite. */
export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  /* .env stays at the repo root, next to the legacy app's */
  envDir,
  plugins: [preact(), aamApi(), serviceWorker()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    /* dist/.vite/manifest.json: scripts/check-size.ts walks it (spec §8.4) */
    manifest: true,
    /* Never inline fonts as data: URIs: the CSP is font-src 'self', so an
       inlined font would be blocked and log a console CSP error. */
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
  },
  preview: { port: 4173 },
});
