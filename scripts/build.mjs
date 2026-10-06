#!/usr/bin/env node
/**
 * Build src/index.ts into dist/index.js the way μClient bundles extensions (clients/web/build/muExtensions.ts
 * and the dev server): ESM, es2022, `vue`, `@muclient/sdk` and `@muclient/ui` external (the host's import
 * map supplies them), everything else bundled. Then check the `muclient` manifest with the host's rules.
 *
 * Lazy modules (SDK 1.13, `muclient.modules`, loaded with `mu.modules.load`): each listed `dist/<name>.js` is built
 * the same way from `src/<name>.ts` (or `.js`), as its own file. Put a heavy dependency there so the entry stays
 * small. With the object form (path → sha256) the build writes the new hashes into package.json.
 *
 *   node scripts/build.mjs            build + check
 *   node scripts/build.mjs --check    check the manifest only
 *   node scripts/build.mjs --sourcemap
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EXTERNAL = ['vue', '@muclient/sdk', '@muclient/ui'];
const args = new Set(process.argv.slice(2));

/** The source of a lazy module: `dist/a/b.js` → `src/a/b.ts` (or .js, .mts). Null when there is none. */
export function moduleSource(path) {
  const stem = path.replace(/^dist\//, 'src/').replace(/\.m?js$/, '');
  for (const ext of ['.ts', '.mts', '.js', '.mjs']) if (existsSync(join(ROOT, stem + ext))) return stem + ext;
  return null;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let m;
try { m = validateManifest(pkg); } catch (e) { console.error(`package.json: ${e.message}`); process.exit(1); }

if (!args.has('--check')) {
  const { build } = await import('esbuild');
  const one = async (src, outRel) => {
    const t0 = Date.now();
    const r = await build({
      entryPoints: [join(ROOT, src)], bundle: true, format: 'esm', target: 'es2022', write: false,
      external: EXTERNAL, legalComments: 'none', sourcemap: args.has('--sourcemap') ? 'inline' : false,
      logLevel: 'warning', absWorkingDir: ROOT,
    });
    const out = join(ROOT, outRel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, r.outputFiles[0].contents);
    console.log(`built ${outRel} (${r.outputFiles[0].contents.length} bytes, ${Date.now() - t0} ms)`);
    return r.outputFiles[0].contents;
  };
  await one(m.source, m.entry);
  const pins = {};
  for (const p of Object.keys(m.modules ?? {})) {
    const src = moduleSource(p);
    if (!src) { console.error(`${p} is listed in muclient.modules, but there is no source for it (${p.replace(/^dist\//, 'src/').replace(/\.m?js$/, '.ts')}).`); process.exit(1); }
    pins[p] = createHash('sha256').update(await one(src, p)).digest('hex');
  }
  // The object form carries hashes: keep them in step with what was just built.
  const raw = pkg.muclient.modules;
  if (raw && !Array.isArray(raw) && typeof raw === 'object' && Object.keys(pins).some((p) => raw[p] !== pins[p])) {
    pkg.muclient.modules = { ...raw, ...pins };
    writeFileSync(join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    console.log('pinned muclient.modules in package.json');
  }
}
for (const [p, h] of Object.entries(m.wasm ?? {})) {
  if (!existsSync(join(ROOT, p))) console.warn(`note: ${p} is listed in muclient.wasm but not built yet (npm run build:wasm)`);
  else if (!h) console.warn(`note: ${p} has no sha256 in muclient.wasm; npm run build:wasm pins it`);
}
console.log(`manifest ok: ${m.id} ${m.version} (api ${m.api})`);
