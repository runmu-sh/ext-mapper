/**
 * Load a pure `src/*.ts` module for tests: bundle it with esbuild (no SDK runtime; `@muclient/sdk` stays
 * external and is only imported for types) and import the result from a data: URL.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(join(ROOT, 'package.json'));
const esbuild = await import(pathToFileURL(req.resolve('esbuild')).href);

const cache = new Map();

/** `await loadTs('src/store.ts')` → the module's exports. */
export async function loadTs(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const result = await esbuild.build({
    entryPoints: [join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['@muclient/sdk'],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  cache.set(rel, mod);
  return mod;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
