import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './lib/load.mjs';

const { createStore } = await loadTs('src/store.ts');
const { memoryPersist } = await loadTs('src/persist.ts');
const { createTracker } = await loadTs('src/tracker.ts');
const { sigOf } = await loadTs('src/hash.ts');

/** A tracker over one real store for world w1, session s1; `settings` overrides setting values. */
async function fresh(settings = {}, extra = {}) {
  const store = createStore('w1', memoryPersist());
  await store.ready;
  let t = 1000;
  const events = [];
  const tracker = createTracker({
    storeFor: (w) => (w === 'w1' ? store : null),
    worldOf: (sid) => (sid.startsWith('s') ? 'w1' : null),
    settings: { get: (k) => settings[k] },
    now: () => t,
    ...extra,
  });
  tracker.on((e) => events.push(e));
  return { store, tracker, events, tick: (ms) => { t += ms; }, types: () => events.map((e) => e.type) };
}
const scene = (name, exits = [], extra = {}) => ({ sid: 's1', source: 'gmcp', name, exits: exits.map((k) => (typeof k === 'string' ? { key: k } : k)), exitsComplete: true, ...extra });
const here = (tracker, store, sid = 's1') => store.room(tracker.track(sid).position.roomId);

test('first room lands at the origin; the same scene twice creates nothing', async () => {
  const { store, tracker, events } = await fresh();
  tracker.scene(scene('Square', ['n', 'e']));
  const r = here(tracker, store);
  assert.deepEqual([r.x, r.y, r.z, r.area, r.name], [0, 0, 0, '', 'Square']);
  assert.deepEqual(Object.keys(r.exits).sort(), ['e', 'n']);
  assert.equal(r.sig, sigOf('Square', undefined));
  assert.equal(tracker.track('s1').position.by, 'created');
  assert.deepEqual(events.map((e) => e.type), ['created', 'enter', 'track']);
  tracker.scene(scene('Square', ['n', 'e', 'w']));
  assert.equal(store.rooms().length, 1);
  assert.deepEqual(Object.keys(store.room(r.id).exits).sort(), ['e', 'n', 'w'], 'new exits adopted');
  assert.equal(tracker.track('s1').source, 'gmcp');
});

test('moved then a new scene creates at prev + dir and links both ways', async () => {
  const { store, tracker, events } = await fresh();
  tracker.scene(scene('Square', ['n']));
  tracker.moved('s1', 'n');
  assert.deepEqual(tracker.track('s1').pending, ['n']);
  assert.ok(events.some((e) => e.type === 'moved' && e.key === 'n'));
  tracker.scene(scene('Lane', ['s', 'n']));
  const lane = here(tracker, store);
  assert.deepEqual([lane.x, lane.y], [0, -1]);
  assert.equal(store.room('r1').exits.n.to, lane.id);
  assert.equal(lane.exits.s.to, 'r1', 'back-linked');
  assert.deepEqual(tracker.track('s1').pending, []);
  const enter = events.filter((e) => e.type === 'enter').pop();
  assert.equal(enter.via, 'n');
  assert.equal(enter.prev.id, 'r1');
});

test('vnum identity: a teleport to a known room, and warn teleport? only for an unknown one', async () => {
  const { store, tracker } = await fresh();
  tracker.scene(scene('A', ['n'], { vnum: '1' }));
  tracker.moved('s1', 'n');
  tracker.scene(scene('B', ['s'], { vnum: '2' }));
  // Back to A with no move: known by vnum, no new room, no warning.
  tracker.scene(scene('A renamed', ['n'], { vnum: '1' }));
  assert.equal(store.rooms().length, 2);
  assert.equal(here(tracker, store).vnum, '1');
  assert.equal(here(tracker, store).name, 'A renamed', 'name adopted');
  assert.equal(tracker.track('s1').position.by, 'vnum');
  assert.equal(here(tracker, store).warn, undefined);
  // An unknown vnum with no move: created nearby with teleport?.
  tracker.scene(scene('C', [], { vnum: '3' }));
  const c = here(tracker, store);
  assert.equal(c.warn, 'teleport?');
  assert.equal(store.rooms().length, 3);
  assert.equal(store.room('r1').exits.n.to, 'r2', 'no link was made for a teleport');
});

test('fingerprint identity: majority vote of handle owners', async () => {
  const { store, tracker } = await fresh();
  tracker.scene(scene('Hall', [{ key: 'n', handle: 'h1' }, { key: 'e', handle: 'h2' }, { key: 'w', handle: 'h3' }]));
  tracker.moved('s1', 'n');
  tracker.scene(scene('Other', [{ key: 's', handle: 'h9' }]));
  assert.equal(store.rooms().length, 2);
  // Back, with one handle differing (h3 → h4) and one borrowed from Other: Hall still wins 2 to 1.
  tracker.moved('s1', 's');
  tracker.scene(scene('Hall', [{ key: 'n', handle: 'h1' }, { key: 'e', handle: 'h2' }, { key: 'w', handle: 'h4' }]));
  assert.equal(here(tracker, store).id, 'r1');
  assert.equal(tracker.track('s1').position.by, 'fingerprint');
  assert.equal(store.rooms().length, 2);
  assert.equal(store.room('r1').exits.w.handle, 'h4', 'handle refreshed');
});

test('signature identity picks the dead-reckoned cell among duplicates', async () => {
  const { store, tracker } = await fresh();
  const sig = sigOf('Forest', 'Trees everywhere.');
  store.create({ name: 'Forest', area: '', x: 1, y: 0, z: 0, exits: { w: { key: 'w', to: null } }, sig, desc: 'Trees everywhere.' });
  store.create({ name: 'Forest', area: '', x: -1, y: 0, z: 0, exits: { e: { key: 'e', to: null } }, sig, desc: 'Trees everywhere.' });
  const start = store.create({ name: 'Clearing', area: '', x: 0, y: 0, z: 0, exits: { e: { key: 'e', to: null }, w: { key: 'w', to: null } } });
  tracker.anchor('s1', start.id);
  tracker.moved('s1', 'e');
  tracker.scene({ ...scene('Forest', ['w']), desc: 'Trees everywhere.' });
  assert.equal(here(tracker, store).id, 'r1', 'the one to the east');
  assert.equal(tracker.track('s1').position.by, 'signature');
  assert.equal(store.room(start.id).exits.e.to, 'r1');
  assert.equal(store.rooms().length, 3);
});

test('displaced placement when the dead-reckoned cell is taken', async () => {
  const { store, tracker } = await fresh();
  store.create({ name: 'Blocker', area: '', x: 0, y: -1, z: 0, exits: {} });
  tracker.scene(scene('Start', ['n']));
  tracker.moved('s1', 'n');
  tracker.scene(scene('Beyond', ['s']));
  const b = here(tracker, store);
  assert.equal(b.warn, 'displaced (cell was taken)');
  assert.deepEqual([b.x, b.y], [0, -2], 'further along the direction');
  assert.equal(store.room('r2').exits.n.to, b.id);
});

test('failed clears pending; the matching key is reported', async () => {
  const { tracker, events } = await fresh();
  tracker.scene(scene('A', ['n', 'e']));
  tracker.moved('s1', 'n');
  tracker.moved('s1', 'e');
  tracker.failed('s1', "You can't go that way.", 'e');
  assert.deepEqual(tracker.track('s1').pending, []);
  const f = events.filter((e) => e.type === 'failed').pop();
  assert.deepEqual([f.key, f.text], ['e', "You can't go that way."]);
});

test('paused locates known rooms but never creates or links', async () => {
  const { store, tracker, events } = await fresh();
  tracker.scene(scene('A', ['n'], { vnum: '1' }));
  tracker.moved('s1', 'n');
  tracker.scene(scene('B', ['s'], { vnum: '2' }));
  tracker.pause('s1', true);
  tracker.moved('s1', 'n');
  tracker.scene(scene('C', ['s'], { vnum: '3' }));
  assert.equal(store.rooms().length, 2);
  assert.equal(tracker.track('s1').position.roomId, null);
  assert.equal(events.filter((e) => e.type === 'lost').length, 1);
  assert.equal(store.room('r2').exits.n, undefined, 'no exit added');
  tracker.scene(scene('A', ['n'], { vnum: '1' }));
  assert.equal(tracker.track('s1').position.roomId, 'r1', 'still recognised');
  assert.equal(tracker.track('s1').paused, true);
});

test('replay never creates', async () => {
  const { store, tracker, events } = await fresh();
  tracker.scene(scene('A', ['n'], { vnum: '1', replay: true }));
  assert.equal(store.rooms().length, 0);
  assert.equal(events.filter((e) => e.type === 'lost').length, 1);
  tracker.scene(scene('A', ['n'], { vnum: '1' }));
  assert.equal(store.rooms().length, 1);
  tracker.scene(scene('A', ['n', 'w'], { vnum: '1', replay: true }));
  assert.equal(tracker.track('s1').position.roomId, 'r1');
  assert.deepEqual(Object.keys(store.room('r1').exits), ['n'], 'a replay does not edit');
});

test('anchor replaces exits and clears pending and warn', async () => {
  const { store, tracker } = await fresh();
  const r = store.create({ name: 'Old', area: '', x: 3, y: 3, z: 0, exits: { n: { key: 'n', to: null }, w: { key: 'w', to: null } }, warn: 'unanchored' });
  tracker.scene(scene('Start', ['n']));
  tracker.moved('s1', 'n');
  tracker.scene(scene('Here', ['e', 's']));
  tracker.moved('s1', 'e');
  tracker.anchor('s1', r.id);
  const now = store.room(r.id);
  assert.deepEqual(Object.keys(now.exits).sort(), ['e', 's']);
  assert.ok(!now.warn, 'warn cleared');
  assert.equal(now.name, 'Old', 'anchor does not rename');
  assert.equal(tracker.track('s1').position.roomId, r.id);
  assert.equal(tracker.track('s1').position.by, 'anchor');
  assert.deepEqual(tracker.track('s1').pending, []);
});

test('createHere makes a room for the last scene at a cell', async () => {
  const { store, tracker } = await fresh();
  tracker.scene(scene('A', ['n'], { vnum: '1' }));
  tracker.scene(scene('Far', ['e'], { vnum: '9', replay: true }));
  const r = tracker.createHere('s1', { area: '', x: 5, y: 5, z: 1 });
  assert.deepEqual([r.name, r.vnum, r.x, r.y, r.z], ['Far', '9', 5, 5, 1]);
  assert.deepEqual(Object.keys(r.exits), ['e']);
  assert.equal(tracker.track('s1').position.roomId, r.id);
  assert.equal(tracker.createHere('s2', { area: '', x: 0, y: 0, z: 0 }), null, 'no scene yet');
});

test('source priority: a scene input after gmcp is ignored; text may complete exits', async () => {
  const { store, tracker } = await fresh();
  tracker.scene({ sid: 's1', source: 'scene', name: 'A', exits: [{ key: 'n' }], exitsComplete: true });
  assert.equal(tracker.track('s1').source, 'scene');
  tracker.scene(scene('A', ['n'], { vnum: '1' }));
  assert.equal(tracker.track('s1').source, 'gmcp');
  tracker.scene({ sid: 's1', source: 'scene', name: 'Elsewhere', exits: [{ key: 's' }], exitsComplete: true });
  assert.equal(store.rooms().length, 1, 'ignored');
  assert.equal(tracker.track('s1').lastScene.name, 'A');
  // A text completion of an incomplete gmcp scene (Room.Name only) is taken.
  tracker.moved('s1', 'n');
  tracker.scene({ sid: 's1', source: 'gmcp', name: 'B', exits: [], exitsComplete: false });
  assert.equal(here(tracker, store).name, 'B');
  tracker.scene({ sid: 's1', source: 'text', name: 'B', exits: [{ key: 's' }, { key: 'e' }], exitsComplete: true });
  assert.deepEqual(Object.keys(here(tracker, store).exits).sort(), ['e', 's']);
  assert.equal(store.rooms().length, 2);
  assert.equal(tracker.track('s1').source, 'gmcp');
});

test('areas: created from the game, slugged; areasFromGame false puts everything in ""', async () => {
  const a = await fresh();
  a.tracker.scene(scene('Gate', ['n'], { area: 'Old Town' }));
  assert.deepEqual(a.store.areas(), [{ id: 'old-town', name: 'Old Town' }]);
  assert.equal(here(a.tracker, a.store).area, 'old-town');
  a.tracker.moved('s1', 'n');
  a.tracker.scene(scene('Road', ['s'], { area: 'Wilds' }));
  const road = here(a.tracker, a.store);
  assert.deepEqual([road.area, road.x, road.y], ['wilds', 0, 0], 'a new area starts at its origin');
  assert.equal(a.store.room('r1').exits.n.to, road.id, 'still linked across areas');
  const b = await fresh({ areasFromGame: false });
  b.tracker.scene(scene('Gate', ['n'], { area: 'Old Town' }));
  assert.deepEqual(b.store.areas(), []);
  assert.equal(here(b.tracker, b.store).area, '');
});

test('exitsComplete drops stale exits except special ones; a locked room keeps all and its name', async () => {
  const { store, tracker } = await fresh();
  tracker.scene(scene('A', ['n', 'e', 'w'], { vnum: '1' }));
  store.setExit('r1', { key: 'enter portal', to: null, commands: ['say open', 'enter portal'] });
  tracker.scene(scene('A', ['n'], { vnum: '1' }));
  assert.deepEqual(Object.keys(store.room('r1').exits).sort(), ['enter portal', 'n']);
  store.update('r1', { locked: true, name: 'My A' });
  tracker.scene(scene('A again', [], { vnum: '1' }));
  assert.deepEqual(Object.keys(store.room('r1').exits).sort(), ['enter portal', 'n']);
  assert.equal(store.room('r1').name, 'My A');
  // An incomplete list never drops.
  store.update('r1', { locked: false });
  tracker.scene({ ...scene('A', ['e'], { vnum: '1' }), exitsComplete: false });
  assert.deepEqual(Object.keys(store.room('r1').exits).sort(), ['e', 'enter portal', 'n']);
});

test('isMove: directions, exit keys and names, move verbs, go prefix', async () => {
  const { tracker } = await fresh({}, { moveVerbs: () => ['enter', 'board'] });
  tracker.scene(scene('Dock', [{ key: 'm', name: 'market' }, 'n']));
  assert.equal(tracker.isMove('s1', 'north'), true);
  assert.equal(tracker.isMove('s1', 'dne'), true);
  assert.equal(tracker.isMove('s1', 'go east'), true);
  assert.equal(tracker.isMove('s1', 'm'), true);
  assert.equal(tracker.isMove('s1', 'Market'), true);
  assert.equal(tracker.isMove('s1', 'enter boat'), true);
  assert.equal(tracker.isMove('s1', 'board'), true);
  assert.equal(tracker.isMove('s1', 'climb rope'), false, 'not in this profile');
  assert.equal(tracker.isMove('s1', 'say hello'), false);
  assert.equal(tracker.isMove('s1', 'look'), false);
  assert.equal(tracker.isMove('s9', 'n'), true, 'a direction without a track');
});

test('pending entries older than 30 s are dropped; the cap is 20', async () => {
  const { store, tracker, tick } = await fresh();
  tracker.scene(scene('A', ['n']));
  tracker.moved('s1', 'e');
  tick(31_000);
  tracker.moved('s1', 'n');
  tracker.scene(scene('B', ['s']));
  assert.deepEqual([here(tracker, store).x, here(tracker, store).y], [0, -1], 'the stale e was dropped, n used');
  for (let i = 0; i < 25; i++) tracker.moved('s1', `k${i}`);
  assert.equal(tracker.track('s1').pending.length, 20);
});

test('a confirmed move wins over pending and is consumed', async () => {
  const { store, tracker } = await fresh();
  tracker.scene(scene('A', ['n', 'e']));
  tracker.moved('s1', 'e');
  tracker.moved('s1', 'n', { confirmed: true });
  assert.deepEqual(tracker.track('s1').pending, ['e'], 'confirmed is not pending');
  tracker.scene(scene('B', ['s']));
  assert.deepEqual([here(tracker, store).x, here(tracker, store).y], [0, -1]);
  assert.deepEqual(tracker.track('s1').pending, ['e'], 'the unconfirmed e is still queued');
});

test('a move without a direction places nearby with reached via when areaOnEnter is off; drop forgets the track', async () => {
  const { store, tracker } = await fresh({ areaOnEnter: false });
  tracker.scene(scene('Dock', ['board']));
  tracker.moved('s1', 'board');
  tracker.scene(scene('Deck', ['leave']));
  const d = here(tracker, store);
  assert.equal(d.warn, 'reached via "board"');
  assert.equal(d.area, '', 'same area');
  assert.equal(store.room('r1').exits.board.to, d.id);
  tracker.drop('s1');
  assert.equal(tracker.track('s1'), undefined);
  assert.deepEqual(tracker.tracks(), []);
});

test('in, out, enter and board open a new area for a new room; the exit links the areas (default on)', async () => {
  const { store, tracker } = await fresh();
  tracker.scene(scene('Dock', ['north', 'in']));
  tracker.moved('s1', 'in');
  tracker.scene(scene('Cargo Hold', ['out', 'aft']));
  const hold = here(tracker, store);
  assert.equal(hold.area, 'cargo-hold', 'its own area, named after the room');
  assert.equal(store.area('cargo-hold').name, 'Cargo Hold');
  assert.deepEqual([hold.x, hold.y, hold.z], [0, 0, 0], 'anchored at the origin of the new area');
  assert.equal(hold.warn, undefined);
  assert.equal(store.room('r1').exits.in.to, hold.id, 'linked through in');
  assert.equal(hold.exits.out.to, 'r1', 'the facing exit links back');
  // Going out again finds the known room; nothing new is created.
  tracker.moved('s1', 'out');
  tracker.scene(scene('Dock', ['north', 'in']));
  assert.equal(here(tracker, store).id, 'r1');
  assert.equal(store.rooms().length, 2);
  // `enter hatch` likewise; `aft` from the hold is ordinary movement inside the hold's area.
  tracker.moved('s1', 'in');
  tracker.scene(scene('Cargo Hold', ['out', 'aft']));
  tracker.moved('s1', 'aft');
  tracker.scene(scene('Aft Hold', ['fore']));
  const aftHold = here(tracker, store);
  assert.equal(aftHold.area, 'cargo-hold');
  assert.deepEqual([aftHold.x, aftHold.y], [0, 1], 'aft is south');
  assert.equal(aftHold.exits.fore.to, hold.id, 'fore faces aft');
  tracker.moved('s1', 'enter hatch');
  tracker.scene(scene('Airlock', ['exit']));
  assert.equal(here(tracker, store).area, 'airlock');
  // A named area from the game wins over the room-named one.
  tracker.moved('s1', 'exit');
  tracker.scene(scene('Aft Hold', ['fore']));
  tracker.moved('s1', 'in');
  tracker.scene(scene('Locker', ['out'], { area: 'Ship Interior' }));
  assert.equal(here(tracker, store).area, 'ship-interior');
});
