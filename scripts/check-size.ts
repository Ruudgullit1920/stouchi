/* First-load JS budget (spec §8.4): the JS index.html loads before anything is
 * clicked — the entry and its static imports — gzipped, at most 150 kB (Vite's
 * kB: 1 000 bytes). Lazy chunks (chat, onboarding, …) don't count.
 *   npm run build && npx tsx scripts/check-size.ts
 * Reads dist/.vite/manifest.json (build.manifest in vite.config.mts). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const MAX_BYTES = 150_000;

interface Chunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
}
export type Manifest = Record<string, Chunk>;

export function firstLoadFiles(manifest: Manifest): string[] {
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry);
  if (!entry) throw new Error('check-size: no entry in the Vite manifest');
  const seen = new Set<string>();
  const walk = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const next of manifest[key].imports ?? []) walk(next);
  };
  walk(entry);
  return [...seen].map((k) => manifest[k].file);
}

export const overBudget = (bytes: number): boolean => bytes > MAX_BYTES;

function main(dist = 'dist'): void {
  const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8')) as Manifest;
  const files = firstLoadFiles(manifest).filter((f) => f.endsWith('.js'));
  const sizes = files.map((f) => ({ f, bytes: gzipSync(readFileSync(join(dist, f))).length }));
  const total = sizes.reduce((s, x) => s + x.bytes, 0);
  for (const { f, bytes } of sizes) console.log(`  ${(bytes / 1000).toFixed(1).padStart(6)} kB  ${f}`);
  const line = `check-size: first-load JS ${(total / 1000).toFixed(1)} kB gzipped (budget ${MAX_BYTES / 1000} kB)`;
  if (overBudget(total)) {
    console.error(`${line} — over budget`);
    process.exit(1);
  }
  console.log(line);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
