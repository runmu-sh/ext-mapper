#!/usr/bin/env node
/**
 * `npm run dev`: start the μClient extension dev server (@runmu.sh/dev) on this folder. It rebuilds
 * src/ on every save and pushes a hot reload to μClient over SSE. In μClient: ☰ → Extensions → Advanced →
 * Developer → load from dev server (http://localhost:5199/), or open μClient with ?ext-dev=<url>.
 *
 * Found, in order: $MUCLIENT_DEV (a path to serve.mjs), the installed @runmu.sh/dev devDependency, and
 * the μClient checkout this project was created from, if any.
 * Extra arguments pass through: npm run dev -- --port 5200
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CREATED_FROM = "/tank/data/Dev/games/muClient/clients/extensions/dev/serve.mjs";

function find() {
  if (process.env.MUCLIENT_DEV) return process.env.MUCLIENT_DEV;
  try { return createRequire(join(ROOT, 'package.json')).resolve('@runmu.sh/dev'); } catch { /* next */ }
  if (CREATED_FROM && existsSync(CREATED_FROM)) return CREATED_FROM;
  return null;
}
const serve = find();
if (!serve) {
  console.error('The μClient dev server was not found. Run npm install (it is the @runmu.sh/dev devDependency).');
  process.exit(1);
}
const child = spawn(process.execPath, [serve, ROOT, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (code) => process.exit(code ?? 0));
