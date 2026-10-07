import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '@runmu.sh/dev/test';
import { loadTs } from './lib/load.mjs';

const { gmcpSource } = await loadTs('src/sources/gmcp.ts');
const { sceneSource } = await loadTs('src/sources/scene.ts');
const { textSource } = await loadTs('src/sources/text.ts');
const { GENERIC, UNDERSPIRE, profileFor, matchHost } = await loadTs('src/profiles/index.ts');
const { underspireExitKeys } = await loadTs('src/profiles/underspire.ts');
const { splitExits } = await loadTs('src/profiles/generic.ts');

/** A recording tracker: `scenes`, `moves`, `fails`; `source`/`lastScene` per sid drive the text source. */
function fakeTracker(opts = {}) {
  const listeners = new Set();
  const t = {
    scenes: [], moves: [], fails: [],
    state: new Map(),
    track(sid) { return t.state.get(sid); },
    tracks() { return [...t.state.values()]; },
    scene(input) {
      t.scenes.push(input);
      const cur = t.state.get(sid0(input.sid));
      const track = { sid: input.sid, worldId: 'w1', position: { roomId: 'r1', by: 'vnum' }, pending: cur?.pending ?? [], lastScene: input, paused: false, source: cur?.source ?? input.source };
      t.state.set(input.sid, track);
      for (const fn of listeners) fn({ type: 'track', sid: input.sid, track });
    },
    moved(sid, key, o = {}) {
      t.moves.push({ sid, key, confirmed: !!o.confirmed });
      const track = t.state.get(sid) ?? { sid, worldId: 'w1', position: { roomId: null, by: 'none' }, pending: [], lastScene: null, paused: false, source: '' };
      if (!o.confirmed) track.pending.push(key);
      t.state.set(sid, track);
      for (const fn of listeners) fn({ type: 'moved', sid, key });
    },
    failed(sid, text, key) { t.fails.push({ sid, text, key: key ?? null }); for (const fn of listeners) fn({ type: 'failed', sid, key: key ?? null, text }); },
    anchor() {}, createHere() { return null; }, pause() {},
    isMove: opts.isMove ?? ((sid, key) => /^(n|s|e|w|north|south|east|west|up|down|u|d|market|m|enter .*|board.*)$/i.test(key)),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    drop() {},
    emit(e) { for (const fn of listeners) fn(e); },
  };
  const sid0 = (s) => s;
  return t;
}
const worldOf = () => 'w1';

/** The input stage the text source registered on the (unmodelled) `mu.input.stage`, as a runner. */
function inputRunner(host) {
  const call = host.calls.find((c) => c.path === 'input.stage');
  assert.ok(call, 'an input stage was registered');
  const spec = call.args[0];
  assert.equal(spec.phase, 'observe');
  return (text, sid = 's1', source = 'cmd') => spec.run({ text, source, meta: { replay: false } }, { sid, worldId: 'w1', phase: 'observe', meta: { replay: false } });
}

test('gmcp: Room.Info shapes — object, list, string exits, coords, zone/terrain', () => {
  const host = createHost();
  const tracker = fakeTracker();
  const off = gmcpSource(host.mu, tracker, worldOf);
  host.gmcp('Room.Info', { num: 12, name: 'Square', area: 'Town', environment: 'city', desc: 'Wide.', exits: { n: 13, south: 14 }, coords: { x: 1, y: 2, z: 0 } });
  let s = tracker.scenes.at(-1);
  assert.equal(s.source, 'gmcp');
  assert.deepEqual([s.vnum, s.name, s.area, s.env, s.desc, s.exitsComplete, s.replay], ['12', 'Square', 'Town', 'city', 'Wide.', true, false]);
  assert.deepEqual(s.exits, [{ key: 'n', to: '13' }, { key: 'south', to: '14' }]);
  assert.deepEqual(s.coords, { x: 1, y: 2, z: 0 });
  host.gmcp('Room.Info', { id: 'abc', name: 'Lane', zone: 'Wilds', terrain: 'forest', exits: ['n', { dir: 'e', name: 'the gate', id: 'g1' }], coords: [3, 4] });
  s = tracker.scenes.at(-1);
  assert.deepEqual([s.vnum, s.area, s.env], ['abc', 'Wilds', 'forest']);
  assert.deepEqual(s.exits, [{ key: 'n' }, { key: 'e', name: 'the gate', to: 'g1' }]);
  assert.deepEqual(s.coords, { x: 3, y: 4, z: 0 });
  host.gmcp('Room.Info', { vnum: 7, name: 'Path', exits: 'n s up' });
  s = tracker.scenes.at(-1);
  assert.deepEqual(s.exits.map((e) => e.key), ['n', 's', 'up']);
  assert.equal(s.coords, undefined);
  host.gmcp('Room.Info', { num: 8 });
  assert.equal(tracker.scenes.length, 3, 'no name → nothing');
  off();
  host.gmcp('Room.Info', { num: 9, name: 'After' });
  assert.equal(tracker.scenes.length, 3, 'disposed');
});

test('gmcp: Room.Name only while the session has seen no Room.Info', () => {
  const host = createHost();
  const tracker = fakeTracker();
  gmcpSource(host.mu, tracker, worldOf);
  host.gmcp('Room.Name', 'Shard intake');
  host.gmcp('Room.Name', { name: 'The well' });
  assert.deepEqual(tracker.scenes.map((s) => [s.name, s.exitsComplete, s.exits.length, s.source]), [['Shard intake', false, 0, 'gmcp'], ['The well', false, 0, 'gmcp']]);
  host.gmcp('Room.Info', { num: 1, name: 'Real' });
  host.gmcp('Room.Name', 'Ignored');
  assert.equal(tracker.scenes.length, 3);
  assert.equal(tracker.scenes.at(-1).name, 'Real');
});

test('msdp: variables assemble per session and report on ROOM_VNUM / ROOM_EXITS changes', () => {
  const host = createHost({ sessions: [{ id: 's1', worldId: 'w1' }, { id: 's2', worldId: 'w1' }] });
  const tracker = fakeTracker();
  gmcpSource(host.mu, tracker, worldOf);
  host.msdp('ROOM_NAME', 'Temple');
  host.msdp('AREA_NAME', 'Midgaard');
  host.msdp('ROOM_TERRAIN', 'inside');
  assert.equal(tracker.scenes.length, 0, 'nothing until the vnum or the exits');
  host.msdp('ROOM_VNUM', 3001);
  let s = tracker.scenes.at(-1);
  assert.deepEqual([s.source, s.vnum, s.name, s.area, s.env, s.exitsComplete], ['msdp', '3001', 'Temple', 'Midgaard', 'inside', false]);
  host.msdp('ROOM_EXITS', { n: 3054, s: 3005 });
  s = tracker.scenes.at(-1);
  assert.deepEqual(s.exits, [{ key: 'n', to: '3054' }, { key: 's', to: '3005' }]);
  assert.equal(s.exitsComplete, true);
  host.msdp('ROOM_EXITS', { n: 3054, s: 3005 });
  assert.equal(tracker.scenes.length, 2, 'the same exits again do not report');
  host.msdp('s2', 'ROOM', { VNUM: 10, NAME: 'Cell', EXITS: { e: 11 }, AREA: 'Jail' });
  s = tracker.scenes.at(-1);
  assert.deepEqual([s.sid, s.vnum, s.name, s.area, s.exits], ['s2', '10', 'Cell', 'Jail', [{ key: 'e', to: '11' }]]);
  assert.equal(tracker.scenes.length, 3);
});

test('scene fallback: reports the scene model when id/title/exits change', () => {
  const host = createHost();
  const tracker = fakeTracker();
  // The dev host's scene.watch only calls back once (with the scene now), so set the scene first.
  host.mu.scene.set({ title: 'Cellar', desc: 'Damp.', area: 'Keep', exits: ['n', 'up'], id: '' }, 's1');
  sceneSource(host.mu, tracker);
  assert.equal(tracker.scenes.length, 1);
  const s = tracker.scenes[0];
  assert.deepEqual([s.source, s.vnum, s.name, s.desc, s.area, s.exitsComplete], ['scene', undefined, 'Cellar', 'Damp.', 'Keep', true]);
  assert.deepEqual(s.exits, [{ key: 'n' }, { key: 'up' }]);
  const host2 = createHost();
  const t2 = fakeTracker();
  sceneSource(host2.mu, t2);
  assert.equal(t2.scenes.length, 0, 'an unknown scene reports nothing');
  assert.ok(host2.live().includes('sessions.each'));
});

test('text: input stage reports moves (go stripped, non-moves ignored), both phases observe', () => {
  const host = createHost();
  const tracker = fakeTracker();
  textSource(host.mu, tracker, () => GENERIC);
  const input = inputRunner(host);
  input('n'); input('go east'); input('say hello'); input('enter portal');
  assert.deepEqual(tracker.moves.map((m) => m.key), ['n', 'east', 'enter portal']);
  const stage = host.calls.find((c) => c.path === 'input.stage').args[0];
  assert.equal(stage.phase, 'observe');
});

test('text: confirmations, queued and failures through both profiles', () => {
  const host = createHost();
  const tracker = fakeTracker();
  textSource(host.mu, tracker, () => UNDERSPIRE);
  const input = inputRunner(host);
  input('n');
  host.line('You begin walking north.');
  assert.deepEqual(tracker.moves.at(-1), { sid: 's1', key: 'north', confirmed: true });
  host.line('You add east to your route.');
  assert.deepEqual(tracker.moves.at(-1), { sid: 's1', key: 'east', confirmed: false }, 'queued and not already pending → pushed');
  tracker.state.get('s1').pending.push('west');
  host.line('You add west to your route.');
  assert.equal(tracker.moves.at(-1).key, 'east', 'already pending → ignored');
  host.line("Command 'dance' is not available.");
  assert.equal(tracker.fails.length, 0, 'not a move');
  host.line("Command 'market' is not available.");
  assert.deepEqual(tracker.fails.at(-1), { sid: 's1', text: "Command 'market' is not available.", key: 'market' });
  host.line('There is no exit north.');
  assert.equal(tracker.fails.at(-1).text, 'There is no exit north.');
  host.line("You can't go that way.");
  assert.equal(tracker.fails.length, 3);
  // Generic profile: a Diku refusal; a Command line is nothing to it.
  const host2 = createHost();
  const t2 = fakeTracker();
  textSource(host2.mu, t2, () => GENERIC);
  host2.line('Alas, you cannot go that way...');
  host2.line('The door is closed.');
  host2.line("Command 'n' is not available.");
  host2.line('Huh?');
  assert.deepEqual(t2.fails.map((f) => f.text), ['Alas, you cannot go that way...', 'The door is closed.']);
  host2.line('You begin walking north.');
  assert.equal(t2.moves.length, 0, 'generic has no confirmation');
});

test('text: an exits line completes the Room.Name scene, in either order', () => {
  let now = 0;
  const host = createHost();
  const tracker = fakeTracker();
  textSource(host.mu, tracker, () => UNDERSPIRE, { now: () => now });
  // Order 1: Room.Name (incomplete scene) then the look with the exits line.
  tracker.scene({ sid: 's1', source: 'gmcp', name: 'Shard intake', exits: [], exitsComplete: false });
  now += 100;
  host.line('There are exits to the market (m), the well and Shard services (s).');
  let s = tracker.scenes.at(-1);
  assert.deepEqual([s.source, s.name, s.exitsComplete], ['text', 'Shard intake', true]);
  assert.deepEqual(s.exits, [{ key: 'm', name: 'market' }, { key: 'well' }, { key: 's', name: 'Shard services' }]);
  // Order 2: the look first (held), then Room.Name: the held exits attach.
  const input = inputRunner(host);
  input('m');
  now += 1000;
  host.line('The street continues north.');
  assert.equal(tracker.scenes.length, 2, 'held, not attached to the old scene after a move');
  now += 200;
  tracker.scene({ sid: 's1', source: 'gmcp', name: 'Market', exits: [], exitsComplete: false });
  s = tracker.scenes.at(-1);
  assert.deepEqual([s.source, s.name, s.exits], ['text', 'Market', [{ key: 'north' }]]);
  // Held exits that are too old are dropped.
  input('n');
  now += 1000;
  host.line('Exits: south.');
  now += 2000;
  tracker.scene({ sid: 's1', source: 'gmcp', name: 'North end', exits: [], exitsComplete: false });
  assert.equal(tracker.scenes.at(-1).source, 'gmcp', 'stale held exits were not attached');
  // A complete scene is never completed again.
  tracker.scene({ sid: 's1', source: 'gmcp', name: 'Full', exits: [{ key: 'n' }], exitsComplete: true });
  const n = tracker.scenes.length;
  host.line('Exits: north, south.');
  assert.equal(tracker.scenes.length, n);
});

test('text: the generic room-text reader builds a scene when there is no GMCP', () => {
  const host = createHost();
  const tracker = fakeTracker();
  textSource(host.mu, tracker, () => GENERIC);
  const input = inputRunner(host);
  input('look');
  host.line('The Temple Square');
  host.line('You are standing in a large square. The temple rises to the north.');
  host.line('A fountain bubbles here.');
  host.line('');
  host.line('A guard is standing here.');
  host.line('[Exits: north east south]');
  assert.equal(tracker.scenes.length, 1);
  const s = tracker.scenes[0];
  assert.deepEqual([s.source, s.name, s.exitsComplete], ['text', 'The Temple Square', true]);
  assert.equal(s.desc, 'You are standing in a large square. The temple rises to the north.\nA fountain bubbles here.');
  assert.deepEqual(s.exits.map((e) => e.key), ['north', 'east', 'south']);
  // With GMCP Room.Name seen, the reader stays off: the exits line only completes.
  const host2 = createHost();
  const t2 = fakeTracker();
  textSource(host2.mu, t2, () => GENERIC);
  host2.gmcp('Room.Name', 'Hall');
  host2.line('Hall');
  host2.line('Obvious exits: north and west.');
  assert.equal(t2.scenes.length, 0);
});

test('profiles: exit splitters, profileFor and matchHost', () => {
  assert.deepEqual(underspireExitKeys('the market (m), the well and Shard services (s)'), [{ key: 'm', name: 'market' }, { key: 'well' }, { key: 's', name: 'Shard services' }]);
  assert.deepEqual(underspireExitKeys('north (n)'), [{ key: 'n', name: 'north' }]);
  assert.deepEqual(splitExits('north, east and the market (m).'), [{ key: 'north' }, { key: 'east' }, { key: 'market' }]);
  assert.deepEqual(splitExits('north east south'), [{ key: 'north' }, { key: 'east' }, { key: 'south' }]);
  assert.deepEqual(splitExits('up north, down'), [{ key: 'up north' }, { key: 'down' }], 'a compound direction stays one');
  assert.deepEqual(splitExits('north: A street, east: The gate'), [{ key: 'north' }, { key: 'east' }]);
  assert.deepEqual(splitExits('none'), []);
  assert.deepEqual(splitExits('southeast aft ^ up'), [{ key: 'southeast' }, { key: 'aft' }, { key: 'up' }], 'a marker glyph is not an exit');
  assert.deepEqual(splitExits('v down'), [{ key: 'down' }]);
  assert.deepEqual(splitExits('fore, aft and starboard'), [{ key: 'fore' }, { key: 'aft' }, { key: 'starboard' }]);
  assert.equal(matchHost('underspire.net', 'underspire.net'), true);
  assert.equal(matchHost('*.underspire.net', 'play.underspire.net:4000'), true);
  assert.equal(matchHost('*.underspire.net', 'underspire.net'), false);
  assert.equal(matchHost('underspire.net', 'notunderspire.net'), false);
  assert.equal(profileFor('underspire.net').id, 'underspire');
  assert.equal(profileFor('mud.example.org').id, 'generic');
  assert.equal(profileFor(undefined).id, 'generic');
  const mine = { id: 'mine', hosts: ['*.example.org'], moveFailed: [] };
  assert.equal(profileFor('mud.example.org', [mine]).id, 'mine');
  const over = { id: 'over', hosts: ['underspire.net'], moveFailed: [] };
  assert.equal(profileFor('underspire.net', [over]).id, 'over', 'registered beats built-in');
});
