/**
 * `npm test`: the whole extension in a headless μClient host (@runmu.sh/dev/test): activate, feed GMCP and output,
 * assert on what it did (the store, the panel, the commands, the API). The parts have their own tests beside this.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CREATED_FROM = '/tank/data/Dev/games/muClient/clients/extensions/dev/test.mjs';
function find() {
  if (process.env.MUCLIENT_DEV_TEST) return process.env.MUCLIENT_DEV_TEST;
  try { return createRequire(join(ROOT, 'package.json')).resolve('@runmu.sh/dev/test'); } catch { /* next */ }
  if (CREATED_FROM && existsSync(CREATED_FROM)) return CREATED_FROM;
  throw new Error('@runmu.sh/dev/test was not found. Run npm install (it is in the @runmu.sh/dev devDependency).');
}
const { createHost } = await import(pathToFileURL(find()).href);

const until = async (fn, what, tries = 50) => { for (let i = 0; i < tries; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); } assert.fail(`timed out: ${what}`); };

test('activates: panel, commands, settings, API', async () => {
  const host = createHost({ root: ROOT });
  const ext = await host.load('src/index.ts');
  assert.ok(host.panels.has('mapper'), 'registers its panel');
  assert.equal(host.panels.get('mapper').show, 'always');
  for (const id of ['mapper.open', 'focus.mapper', 'mapper.copyLua', 'mapper.pause', 'mapper.stop']) assert.ok(host.commands.has(id), `command ${id}`);
  assert.deepEqual(host.commands.get('focus.mapper').keys, ['Alt+M']);
  const keys = host.settingsSchema.items.map((i) => i.key);
  assert.deepEqual(keys, ['autoConnect', 'areasFromGame', 'keepDesc', 'fromText', 'walk.mode', 'walk.delayMs', 'walk.timeoutS', 'keys.focus']);
  assert.equal(typeof ext.api.luaLibrary(), 'string');
  assert.equal(ext.api.here('s1'), null);
  assert.equal(host.errors.length, 0, 'no handler threw');
  await host.unload();
  assert.deepEqual(host.live(), [], 'everything registered through mu is disposed');
});

test('maps rooms from GMCP Room.Info and links the move', async () => {
  const host = createHost({ root: ROOT });
  const ext = await host.load('src/index.ts');
  host.gmcp('Room.Info', { num: 1, name: 'A narrow cellar', area: 'Undercroft', exits: { n: 2 } });
  const a = ext.api.here('s1');
  assert.ok(a, 'a room after the first Room.Info');
  assert.equal(a.name, 'A narrow cellar');
  assert.equal(a.vnum, '1');
  assert.deepEqual(host.calls.filter((c) => c.path === 'panels.touch').map((c) => c.args), [['mapper', 's1']], 'the panel is offered once a room is known');

  // The player types north; the game answers with the next room.
  const stage = host.calls.find((c) => c.path === 'input.stage')?.args[0];
  assert.ok(stage, 'an observe input stage watches for moves');
  stage.run({ text: 'n', source: 'player', meta: {} }, { sid: 's1' });
  host.gmcp('Room.Info', { num: 2, name: 'The well room', area: 'Undercroft', exits: { s: 1 } });
  const b = ext.api.here('s1');
  assert.equal(b.name, 'The well room');
  assert.deepEqual([b.x, b.y, b.z], [a.x, a.y - 1, a.z], 'placed north of the first room');
  const store = ext.api.store('w1');
  assert.equal(store.room(a.id).exits.n.to, b.id);
  assert.equal(store.room(b.id).exits.s.to, a.id);
  assert.equal(store.rooms().length, 2);
  assert.deepEqual(host.sends('command'), [], 'mapping sends nothing to the game');
  assert.equal(host.errors.length, 0);
  await host.unload();
});

test('follows a recorded session (test/fixtures/session.murec)', async () => {
  const host = createHost({ root: ROOT });
  const ext = await host.load('src/index.ts');
  const played = await host.play('test/fixtures/session.murec');
  assert.equal(played, 4);
  assert.equal(ext.api.here('s1').name, 'The well room');
  assert.equal(ext.api.store('w1').rooms().length, 2);
  await host.unload();
});

test('goto walks through the walker and the API reports the walk', async () => {
  const host = createHost({ root: ROOT });
  const ext = await host.load('src/index.ts');
  host.gmcp('Room.Info', { num: 1, name: 'A', exits: { n: 2 } });
  const stage = host.calls.find((c) => c.path === 'input.stage').args[0];
  stage.run({ text: 'n', source: 'player', meta: {} }, { sid: 's1' });
  host.gmcp('Room.Info', { num: 2, name: 'B', exits: { s: 1 } });
  const store = ext.api.store('w1');
  const a = store.byVnum('1');
  const walk = ext.api.goto(a.id, 's1');
  await until(() => host.sends('command').length === 1, 'the first hop is sent');
  assert.deepEqual(host.sends('command').map((s) => s.text), ['s']);
  stage.run({ text: 's', source: 'ext', meta: {} }, { sid: 's1' });
  host.gmcp('Room.Info', { num: 1, name: 'A', exits: { n: 2 } });
  const end = await walk;
  assert.equal(end.status, 'arrived');
  assert.equal(ext.api.here('s1').id, a.id);
  assert.equal(host.errors.length, 0);
  await host.unload();
});

test('the Lua bridge is live and disposed with the extension', async () => {
  const host = createHost({ root: ROOT });
  await host.load('src/index.ts');
  const lua = host.live().filter((l) => String(l).includes('lua.on'));
  assert.ok(lua.length >= 1, `lua.on registered: ${JSON.stringify(host.live())}`);
  await host.unload();
  assert.deepEqual(host.live(), []);
});
