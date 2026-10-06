/** End to end: real tracker + store + the gmcp and text sources under the dev host, an Underspire-style session. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '@runmu.sh/dev/test';
import { loadTs } from './lib/load.mjs';

const { createStore } = await loadTs('src/store.ts');
const { memoryPersist } = await loadTs('src/persist.ts');
const { createTracker } = await loadTs('src/tracker.ts');
const { gmcpSource } = await loadTs('src/sources/gmcp.ts');
const { textSource } = await loadTs('src/sources/text.ts');
const { UNDERSPIRE, GENERIC } = await loadTs('src/profiles/index.ts');

async function setup(profile) {
  const host = createHost();
  const store = createStore('w1', memoryPersist());
  await store.ready;
  let now = 0;
  const tracker = createTracker({ storeFor: () => store, worldOf: () => 'w1', settings: { get: () => undefined }, now: () => now, moveVerbs: () => profile.moveVerbs });
  gmcpSource(host.mu, tracker, () => 'w1');
  textSource(host.mu, tracker, () => profile, { now: () => now });
  const spec = host.calls.find((c) => c.path === 'input.stage').args[0];
  const input = (text) => spec.run({ text, source: 'cmd', meta: { replay: false } }, { sid: 's1', worldId: 'w1', phase: 'observe', meta: { replay: false } });
  const here = () => store.room(tracker.track('s1').position.roomId);
  return { host, store, tracker, input, here, tick: (ms) => { now += ms; } };
}

test('Underspire: Room.Name + look text, both orders, walking by exit keys and refusals', async () => {
  const { host, store, tracker, input, here, tick } = await setup(UNDERSPIRE);
  // Login: the look prints first, then Room.Name.
  host.line('Shard intake');
  host.line('A vast data space, humming with virtual activity.');
  host.line('');
  host.line('There are exits to the market (m) and the well.');
  tick(50);
  host.gmcp('Room.Name', 'Shard intake');
  let r = here();
  assert.equal(r.name, 'Shard intake');
  assert.deepEqual(Object.keys(r.exits).sort(), ['m', 'well']);
  assert.equal(r.exits.m.name, 'market');
  assert.equal(store.rooms().length, 1);
  // Move by exit key: Room.Name first this time, then the look.
  input('m');
  host.line('You begin walking to the market.');
  tick(300);
  host.gmcp('Room.Name', 'The market');
  tick(100);
  host.line('The market');
  host.line('Stalls everywhere.');
  host.line('');
  host.line('There are exits to Shard intake (back) and the gate (g).');
  r = here();
  assert.equal(r.name, 'The market');
  assert.deepEqual(Object.keys(r.exits).sort(), ['back', 'g']);
  assert.equal(store.room('r1').exits.m.to, r.id, 'linked through m');
  assert.equal(r.warn, 'reached via "market"');
  assert.equal(store.rooms().length, 2);
  // A refusal clears the pending move; no room is created.
  input('g');
  host.line("Command 'g' is not available.");
  assert.deepEqual(tracker.track('s1').pending, []);
  // Back: the recorded destination is recognised by name.
  input('back');
  host.line('You begin walking back.');
  tick(100);
  host.gmcp('Room.Name', 'Shard intake');
  assert.equal(here().id, 'r1');
  assert.equal(store.rooms().length, 2);
  assert.equal(store.room('r2').exits.back.to, 'r1');
});

test('generic: a telnet-only Diku room look maps and links by direction', async () => {
  const { host, store, input, here } = await setup(GENERIC);
  input('look');
  host.line('The Temple Square');
  host.line('You are standing on the temple square.');
  host.line('');
  host.line('[Exits: north south]');
  assert.equal(here().name, 'The Temple Square');
  input('n');
  host.line('The Temple');
  host.line('A hush falls.');
  host.line('');
  host.line('[Exits: south]');
  const t = here();
  assert.deepEqual([t.name, t.x, t.y], ['The Temple', 0, -1]);
  assert.equal(store.room('r1').exits.north.to, t.id);
  assert.equal(t.exits.south.to, 'r1');
  input('n');
  host.line('Alas, you cannot go that way...');
  input('s');
  host.line('The Temple Square');
  host.line('You are standing on the temple square.');
  host.line('');
  host.line('[Exits: north south]');
  assert.equal(here().id, 'r1', 'signature identity back to the square');
  assert.equal(store.rooms().length, 2);
});

test('Diku over GMCP: the look text lands before the first Room.Info and does not make a second room', async () => {
  const { host, store, here, tick } = await setup(GENERIC);
  host.line('Temple Square');
  host.line('A wide square paved with worn flagstones.');
  host.line('[Exits: north east south west]');
  tick(20);
  host.gmcp('Room.Info', { num: 1, name: 'Temple Square', area: 'Midgaard', exits: { n: 2, e: 3, s: 5, w: 4 } });
  assert.equal(store.rooms().length, 1, 'one room, not one per source');
  const r = here();
  assert.equal(r.vnum, '1');
  assert.equal(r.area, 'midgaard');
  assert.deepEqual(Object.keys(r.exits).sort(), ['e', 'n', 's', 'w'], 'the GMCP exits replace the text ones');
  assert.equal(r.desc, 'A wide square paved with worn flagstones.', 'the description from the look is kept');
});

test('Diku: a room mapped from GMCP alone is recognised later from its text when the position is lost', async () => {
  const first = await setup(GENERIC);
  first.host.gmcp('Room.Info', { num: 3, name: 'Market Street', area: 'Midgaard', exits: { e: 4, w: 1 } });
  assert.equal(first.store.rooms().length, 1);
  // The client restarts with the same map: no GMCP state, the player types look and only the text arrives.
  const { host, store, here, tick } = await setup(GENERIC);
  for (const r of first.store.rooms()) store.create({ ...r });
  host.line('Market Street');
  host.line('Stalls line the street.');
  host.line('[Exits: west east]');
  tick(500);
  assert.equal(store.rooms().length, 1, 'no second Market Street');
  assert.equal(here().vnum, '3');
  assert.equal(here().desc, 'Stalls line the street.', 'the description is learned');
});
