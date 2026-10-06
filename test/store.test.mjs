import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './lib/load.mjs';

const { createStore } = await loadTs('src/store.ts');
const { memoryPersist } = await loadTs('src/persist.ts');
const { parseDir } = await loadTs('src/dirs.ts');

/** A store with an in-memory Persist, ready. */
async function fresh(initial = null) {
  const persist = memoryPersist(initial);
  const store = createStore('w1', persist);
  await store.ready;
  return { store, persist };
}
const room = (name, x, y, z = 0, extra = {}) => ({ name, area: '', x, y, z, exits: {}, ...extra });
const exit = (key, to = null, extra = {}) => ({ key, to, ...extra });

test('create, update, remove keep the indexes in sync', async () => {
  const { store } = await fresh();
  const a = store.create(room('Square', 0, 0, 0, { vnum: '100', sig: 'sigA', exits: { n: exit('n', null, { handle: 'h1' }) } }));
  assert.equal(a.id, 'r1');
  assert.ok(a.updated > 0, 'updated is set');
  assert.equal(store.at('', 0, 0, 0), a);
  assert.equal(store.byVnum('100'), a);
  assert.equal(store.byHandle('h1'), a);
  assert.deepEqual(store.bySig('sigA').map((r) => r.id), ['r1']);
  store.update('r1', { x: 2, vnum: '200', sig: 'sigB', exits: { e: exit('e', null, { handle: 'h2' }) } });
  assert.equal(store.at('', 0, 0, 0), undefined);
  assert.equal(store.at('', 2, 0, 0).id, 'r1');
  assert.equal(store.byVnum('100'), undefined);
  assert.equal(store.byVnum('200').id, 'r1');
  assert.equal(store.byHandle('h1'), undefined);
  assert.equal(store.byHandle('h2').id, 'r1');
  assert.deepEqual(store.bySig('sigA'), []);
  assert.equal(store.bySig('sigB').length, 1);
  const b = store.create(room('Lane', 3, 0));
  assert.equal(b.id, 'r2');
  store.link('r1', 'e', 'r2');
  store.remove('r2');
  assert.equal(store.room('r2'), undefined);
  assert.equal(store.room('r1').exits.e.to, null, 'links to the removed room are dropped');
  store.remove('r1');
  assert.equal(store.byVnum('200'), undefined);
  assert.equal(store.byHandle('h2'), undefined);
  assert.equal(store.at('', 2, 0, 0), undefined);
  assert.deepEqual(store.rooms(), []);
  assert.equal(store.create(room('Again', 0, 0)).id, 'r3', 'ids keep counting');
});

test('setExit, removeExit, link with back, unlink, incoming, find', async () => {
  const { store } = await fresh();
  store.create(room('A', 0, 0, 0, { tags: ['shop'] }));
  store.create(room('B', 0, -1));
  store.setExit('r1', exit('n'));
  store.setExit('r2', exit('s'));
  store.setExit('r2', exit('enter portal', null, { commands: ['say open', 'enter portal'], dir: 'up' }));
  store.link('r1', 'n', 'r2', { back: true });
  assert.equal(store.room('r1').exits.n.to, 'r2');
  assert.equal(store.room('r2').exits.s.to, 'r1', 'back link filled');
  assert.deepEqual(store.incoming('r1').map(({ room: r, exit: e }) => [r.id, e.key]), [['r2', 's']]);
  store.unlink('r2', 's');
  assert.equal(store.room('r2').exits.s.to, null);
  store.link('r2', 's', 'r2');
  store.link('r1', 'n', 'r1', { back: true });
  assert.equal(store.room('r2').exits.s.to, 'r2', 'back never overwrites a linked exit');
  store.removeExit('r2', 'enter portal');
  assert.deepEqual(Object.keys(store.room('r2').exits), ['s']);
  store.link('r1', 'climb', 'r2');
  assert.equal(store.room('r1').exits.climb.to, 'r2', 'link creates a missing exit');
  assert.deepEqual(store.find({ name: 'a' }).map((r) => r.id), ['r1']);
  assert.deepEqual(store.find({ tag: 'shop' }).map((r) => r.id), ['r1']);
  assert.deepEqual(store.find({ near: { roomId: 'r1', radius: 1 } }).map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(store.find({ near: { roomId: 'r1', radius: 0 } }).map((r) => r.id), ['r1']);
  assert.equal(store.find({ area: '', limit: 1 }).length, 1);
});

test('autoConnect: fresh pair, one-sided completion, refusal when the back exit points elsewhere', async () => {
  const { store } = await fresh();
  store.create(room('A', 0, 0, 0, { exits: { n: exit('n') } }));
  store.create(room('B', 0, -1, 0, { exits: { s: exit('s'), u: exit('u') } }));
  store.create(room('C', 0, -1, 1, { exits: { d: exit('d', 'r2') } })); // C above B, already linked down to B
  store.create(room('D', 5, 5, 0, { exits: { w: exit('w') } }));
  store.create(room('E', 4, 5, 0, { exits: { e: exit('e', 'r1') } })); // E's east points at A, not D
  store.create(room('F', 0, 1, 0, { exits: { n: exit('n', 'r1') } })); // F north → A, A has no south exit
  const n = store.autoConnect();
  assert.equal(store.room('r1').exits.n.to, 'r2');
  assert.equal(store.room('r2').exits.s.to, 'r1');
  assert.equal(store.room('r2').exits.u.to, 'r3', 'one-sided completion');
  assert.equal(store.room('r4').exits.w.to, null, 'refused: back exit points elsewhere');
  assert.equal(store.room('r5').exits.e.to, 'r1');
  assert.equal(n, 3);
  assert.equal(store.autoConnect(), 0, 'idempotent');
  store.create(room('G', 0, -2, 0, { exits: { s: exit('s') } }));
  store.create(room('H', 0, -3, 0, { exits: { s: exit('s') } }));
  store.setExit('r7', exit('n'));
  store.setExit('r2', exit('n'));
  assert.equal(store.autoConnect('elsewhere'), 0, 'area filter');
  assert.equal(store.autoConnect(''), 4);
  assert.equal(store.room('r7').exits.n.to, 'r8');
});

test('merge folds exits, incoming links, notes, tags, colour and symbol', async () => {
  const { store } = await fresh();
  store.create(room('Keep', 0, 0, 0, { note: 'keep', tags: ['a'], exits: { n: exit('n', null), e: exit('e') } }));
  store.create(room('Gone', 1, 0, 0, { note: 'gone', tags: ['a', 'b'], color: 'gold', symbol: '$', exits: { n: exit('n', 'r3'), w: exit('w', 'r1'), s: exit('s', 'r2') } }));
  store.create(room('Other', 1, -1, 0, { exits: { s: exit('s', 'r2'), w: exit('w', 'r1') } }));
  store.merge('r2', 'r1');
  const k = store.room('r1');
  assert.equal(store.room('r2'), undefined);
  assert.equal(k.exits.n.to, null, 'into keeps its own exits');
  assert.equal(k.exits.w.to, null, 'gained exit that pointed at into becomes a dropped self-link');
  assert.equal(k.exits.s.to, null, 'self-link of from dropped');
  assert.equal(store.room('r3').exits.s.to, 'r1', 'incoming retargeted');
  assert.equal(store.room('r3').exits.w.to, 'r1');
  assert.equal(k.note, 'keep\ngone');
  assert.deepEqual(k.tags, ['a', 'b']);
  assert.equal(k.color, 'gold');
  assert.equal(k.symbol, '$');
  assert.equal(store.at('', 1, 0, 0), undefined);
  store.update('r1', { color: 'sky' });
  store.create(room('X', 5, 5, 0, { color: 'rust' }));
  store.merge('r4', 'r1');
  assert.equal(store.room('r1').color, 'sky', 'into keeps its colour');
});

test('move refuses taken cells, moves groups and changes area', async () => {
  const { store } = await fresh();
  store.create(room('A', 0, 0));
  store.create(room('B', 1, 0));
  store.create(room('C', 3, 0));
  assert.equal(store.move(['r1'], 1, 0), false, 'cell taken by B');
  assert.equal(store.room('r1').x, 0, 'nothing moved');
  assert.equal(store.move(['r1', 'r2'], 1, 0), true, 'B shifts out of the way within the group');
  assert.equal(store.room('r1').x, 1);
  assert.equal(store.room('r2').x, 2);
  assert.equal(store.at('', 0, 0, 0), undefined);
  assert.equal(store.move(['r1', 'r2'], 1, 0), false, 'C blocks');
  assert.equal(store.move(['r2'], 0, 0, 1), true);
  assert.equal(store.room('r2').z, 1);
  assert.equal(store.move(['r3'], 0, 0, 0, 'cellar'), true);
  assert.equal(store.room('r3').area, 'cellar');
  assert.equal(store.at('cellar', 3, 0, 0).id, 'r3');
  assert.equal(store.at('', 3, 0, 0), undefined);
  assert.equal(store.move(['nope'], 1, 0), false);
});

test('path: costs, weights, locked, avoid, blocked, steps and commands', async () => {
  const { store } = await fresh();
  // A -n-> B -n-> D ; A -e-> C -n-> D (C heavy); A -portal-> D (locked door)
  store.create(room('A', 0, 0, 0, { exits: { n: exit('n', 'r2'), e: exit('e', 'r3'), portal: exit('portal', 'r4', { door: 'locked', commands: ['unlock portal', 'enter portal'] }) } }));
  store.create(room('B', 0, -1, 0, { exits: { n: exit('n', 'r4', { cost: 3 }) } }));
  store.create(room('C', 1, 0, 0, { weight: 5, exits: { n: exit('n', 'r4') } }));
  store.create(room('D', 0, -2));
  let p = store.path('r1', 'r4');
  assert.deepEqual(p, { ids: ['r2', 'r4'], steps: [['n'], ['n']], cost: 2 + 4 });
  p = store.path('r1', 'r4', { locked: true });
  assert.deepEqual(p, { ids: ['r4'], steps: [['unlock portal', 'enter portal']], cost: 2 });
  p = store.path('r1', 'r4', { avoid: ['r2'] });
  assert.deepEqual(p.ids, ['r3', 'r4']);
  assert.equal(p.cost, 6 + 2);
  store.setExit('r3', exit('n', 'r4', { blocked: true }));
  assert.equal(store.path('r1', 'r4', { avoid: ['r2'] }), null);
  assert.deepEqual(store.path('r1', 'r1'), { ids: [], steps: [], cost: 0 });
  assert.equal(store.path('r4', 'r1'), null, 'one-way');
  assert.equal(store.path('r1', 'nope'), null);
  assert.equal(store.path('r1', 'r4', { avoid: ['r4'] }), null);
});

test('freeNear spirals, freeAlong walks the direction then falls back', async () => {
  const { store } = await fresh();
  assert.deepEqual(store.freeNear('', 0, 0, 0), { x: 0, y: 0, z: 0 });
  store.create(room('A', 0, 0));
  const near = store.freeNear('', 0, 0, 0);
  assert.equal(Math.max(Math.abs(near.x), Math.abs(near.y)), 1, 'ring 1');
  assert.equal(near.z, 0);
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) if (x || y) store.create(room('R', x, y));
  const r2 = store.freeNear('', 0, 0, 0);
  assert.equal(Math.max(Math.abs(r2.x), Math.abs(r2.y)), 2, 'ring 2');
  assert.deepEqual(store.freeNear('', 0, 0, 1), { x: 0, y: 0, z: 1 }, 'other floor is free');
  assert.deepEqual(store.freeNear('elsewhere', 0, 0, 0), { x: 0, y: 0, z: 0 }, 'other area is free');
  const a = store.room('r1');
  assert.deepEqual(store.freeAlong(a, parseDir('e')), { x: 2, y: 0, z: 0 }, 'k = 2 since (1,0) is taken');
  for (let k = 2; k <= 12; k++) store.create(room('E', k, 0));
  const fb = store.freeAlong(a, parseDir('e'));
  assert.ok(Math.max(Math.abs(fb.x - 1), Math.abs(fb.y)) <= 2, `fallback near (1,0): ${JSON.stringify(fb)}`);
  assert.deepEqual(store.freeAlong(a, parseDir('u')), { x: 0, y: 0, z: 1 });
  assert.deepEqual(store.freeAlong(a, parseDir('dne')), { x: 1, y: -1, z: -1 });
});

test('component walks links both ways on one floor and area', async () => {
  const { store } = await fresh();
  store.create(room('A', 0, 0, 0, { exits: { n: exit('n', 'r2') } }));
  store.create(room('B', 0, -1, 0, { exits: { u: exit('u', 'r4') } }));
  store.create(room('C', 5, 5, 0, { exits: { w: exit('w', 'r1') } })); // incoming only
  store.create(room('D', 0, -1, -1, { exits: { d: exit('d', 'r2') } }));
  store.create(room('E', 9, 9, 0));
  store.create(room('F', 0, 0, 0, { area: 'x', exits: { e: exit('e', 'r1') } }));
  assert.deepEqual([...store.component('r1')].sort(), ['r1', 'r2', 'r3']);
  assert.deepEqual([...store.component('r4')], ['r4']);
  assert.deepEqual([...store.component('nope')], []);
});

test('undo/redo/batch: labels, events, cap', async () => {
  const { store } = await fresh();
  const events = [];
  store.watch((e) => events.push(e));
  store.create(room('A', 0, 0));
  assert.deepEqual(events, [{ kind: 'rooms', ids: ['r1'] }]);
  events.length = 0;
  store.batch('lay out', () => { store.create(room('B', 1, 0)); store.create(room('C', 2, 0)); store.link('r1', 'e', 'r2'); store.setArea({ id: 'z', name: 'Z' }); });
  assert.equal(events.length, 1, 'one event per batch');
  assert.equal(events[0].kind, 'reset', 'rooms + areas in one batch read as reset');
  events.length = 0;
  store.setArea({ id: 'y', name: 'Y' });
  assert.deepEqual(events, [{ kind: 'areas' }]);
  events.length = 0;
  assert.equal(store.canUndo(), true);
  assert.equal(store.canRedo(), false);
  assert.equal(store.undo(), 'edit area');
  assert.equal(store.area('y'), undefined);
  assert.equal(store.undo(), 'lay out');
  assert.deepEqual(store.rooms().map((r) => r.id), ['r1']);
  assert.equal(store.area('z'), undefined);
  assert.equal(store.at('', 1, 0, 0), undefined, 'indexes rebuilt on undo');
  assert.deepEqual(events, [{ kind: 'reset' }, { kind: 'reset' }]);
  assert.equal(store.redo(), 'lay out');
  assert.equal(store.rooms().length, 3);
  assert.equal(store.room('r1').exits.e.to, 'r2');
  assert.equal(store.at('', 2, 0, 0).id, 'r3');
  assert.equal(store.redo(), 'edit area');
  assert.equal(store.redo(), null);
  assert.equal(store.canRedo(), false);
  assert.equal(store.undo(), 'edit area');
  store.create(room('New', 7, 7));
  assert.equal(store.canRedo(), false, 'a new change clears redo');
  assert.equal(store.undo(), 'create room');
  assert.equal(store.undo(), 'lay out');
  assert.equal(store.undo(), 'create room');
  assert.equal(store.undo(), null);
  assert.equal(store.canUndo(), false);
  // cap
  for (let i = 0; i < 120; i++) store.create(room(`R${i}`, i, 50));
  let n = 0;
  while (store.undo()) n++;
  assert.equal(n, 100, 'capped at 100 steps');
  assert.equal(store.rooms().length, 20);
  // a read-only "mutation" records nothing
  const before = store.canRedo();
  store.unlink('r1', 'nothing');
  assert.equal(store.canRedo(), before);
});

test('erase and a no-op update', async () => {
  const { store } = await fresh();
  const events = [];
  store.watch((e) => events.push(e.kind));
  store.create(room('A', 0, 0, 0, { vnum: '7' }));
  store.erase();
  assert.deepEqual(store.rooms(), []);
  assert.equal(store.byVnum('7'), undefined);
  assert.deepEqual(events, ['rooms', 'reset']);
  assert.equal(store.undo(), 'erase map');
  assert.equal(store.byVnum('7').id, 'r1');
  assert.equal(store.update('nope', { name: 'x' }), undefined);
  assert.equal(store.create(room('B', 1, 1)).id, 'r2', 'nextId restored with the snapshot');
});

test('export round trip is a deep copy', async () => {
  const { store } = await fresh();
  store.create(room('A', 0, 0, 0, { exits: { n: exit('n') } }));
  store.setArea({ id: 'town', name: 'Town' });
  const data = store.export();
  assert.equal(data.format, 'mu-map');
  assert.equal(data.v, 2);
  assert.equal(data.nextId, 2);
  data.rooms.r1.name = 'changed';
  data.rooms.r1.exits.n.to = 'r9';
  assert.equal(store.room('r1').name, 'A', 'export does not alias the store');
  assert.equal(store.room('r1').exits.n.to, null);
  const other = (await fresh()).store;
  const res = other.import(store.export());
  assert.deepEqual(res, { rooms: 1 });
  assert.deepEqual(other.export(), store.export());
  assert.equal(other.area('town').name, 'Town');
  assert.equal(other.at('', 0, 0, 0).id, 'r1');
});

test('import: userscript 0.x shape', async () => {
  const { store } = await fresh();
  const events = [];
  store.watch((e) => events.push(e.kind));
  const n = store.import({
    v: 1, nextId: 3, cur: 'r1',
    rooms: {
      r1: { id: 'r1', name: 'Gate', x: 0, y: 0, z: 0, color: '#ff0000', sym: '!', note: 'guard', flag: 'displaced', exits: { h1: { key: 'n', name: 'north', to: 'r2' }, h2: { key: 'enter', name: 'the gatehouse', to: null } } },
      r2: { id: 'r2', name: 'Road', x: 0, y: -1, z: 0, color: '#4488ff', exits: { h3: { key: 's', to: 'r1' } }, dh: 'abc' },
      r5: { id: 'r5', name: 'Grey', x: 3, y: 3, z: 0, color: '#808080', exits: {} },
    },
  });
  assert.deepEqual(n, { rooms: 3 });
  assert.deepEqual(events, ['reset']);
  const g = store.room('r1');
  assert.equal(g.color, 'alert');
  assert.equal(g.symbol, '!');
  assert.equal(g.note, 'guard');
  assert.equal(g.warn, 'displaced');
  assert.equal(g.area, '');
  assert.equal(g.exits.n.to, 'r2');
  assert.equal(g.exits.n.handle, 'h1');
  assert.equal(g.exits.n.name, 'north');
  assert.equal(g.exits.enter.name, 'the gatehouse');
  assert.equal(store.byHandle('h2').id, 'r1');
  assert.equal(store.room('r2').color, 'sky');
  assert.equal(store.room('r5').color, 'dim');
  assert.deepEqual(store.bySig('abc').map((r) => r.id), ['r2']);
  assert.equal(store.create(room('Next', 9, 9)).id, 'r6', 'nextId past the highest id');
});

test('import: Mudlet JSON (areas and bare rooms), y negated, vnum = id', async () => {
  const { store } = await fresh();
  const n = store.import({
    areas: [
      { id: 1, name: 'Town', rooms: [
        { id: 100, name: 'Square', coordinates: [0, 0, 0], exits: { north: 101 }, specialExits: { 'enter well': 102 }, userData: { shop: 'yes' }, environment: 3 },
        { id: 101, name: 'North Road', coordinates: [0, 1, 0], exits: { south: 100, up: 999 } },
      ] },
      { id: 2, name: 'Well', rooms: [{ id: 102, name: 'Bottom', coordinates: [0, 0, -1], exits: {} }] },
    ],
  });
  assert.deepEqual(n, { rooms: 3 });
  const sq = store.byVnum('100');
  assert.equal(sq.name, 'Square');
  assert.equal(sq.area, '1');
  assert.equal(store.area('1').name, 'Town');
  assert.deepEqual([sq.x, sq.y, sq.z], [0, 0, 0]);
  const nr = store.byVnum('101');
  assert.deepEqual([nr.x, nr.y, nr.z], [0, -1, 0], 'Mudlet y grows upward');
  assert.equal(sq.exits.north.to, nr.id);
  assert.equal(nr.exits.south.to, sq.id);
  assert.equal(nr.exits.up.to, null, 'unknown destination dropped');
  assert.equal(sq.exits['enter well'].to, store.byVnum('102').id);
  assert.equal(sq.note, 'shop: yes');
  assert.equal(sq.env, '3');
  assert.equal(store.byVnum('102').z, -1);
  const bare = (await fresh()).store;
  assert.deepEqual(bare.import({ rooms: [{ id: 5, name: 'Lone', coordinates: [2, 3, 0], exits: {} }] }), { rooms: 1 });
  assert.deepEqual([bare.byVnum('5').x, bare.byVnum('5').y], [2, -3]);
});

test('import rejects anything else', async () => {
  const { store } = await fresh();
  store.create(room('Keep', 0, 0));
  for (const bad of [null, 42, 'x', [], {}, { rooms: [] }, { rooms: [{ name: 'no id' }] }, { format: 'other', rooms: {} }, { v: 2 }]) {
    assert.throws(() => store.import(bad), /not a map file/, JSON.stringify(bad));
  }
  assert.equal(store.rooms().length, 1, 'a rejected import changes nothing');
});

test('areas: setArea merges fields, createArea mints ids, removeArea deletes or moves rooms, counts and links, all undoable', async () => {
  const { store } = await fresh();
  const a = store.createArea('The Keep', { color: 'moss' });
  assert.deepEqual(a, { id: 'the-keep', name: 'The Keep', color: 'moss' });
  assert.equal(store.createArea('  The Keep ').id, 'the-keep-2');
  assert.equal(store.createArea('***').id, 'area', 'a name with no letters still gets an id');
  // Merge: an absent field is kept, undefined clears it, a no-op change records nothing.
  store.setArea({ id: 'the-keep', note: 'levels 5-10' });
  assert.deepEqual(store.area('the-keep'), { id: 'the-keep', name: 'The Keep', color: 'moss', note: 'levels 5-10' });
  const before = store.canUndo();
  store.setArea({ id: 'the-keep', name: 'The Keep' });
  assert.equal(store.canUndo(), before);
  store.setArea({ id: 'the-keep', color: undefined });
  assert.equal(store.area('the-keep').color, undefined);
  store.setArea({ id: 'town', name: 'Town' });
  // Rooms: two in town, one in the keep, one in the default area, one link across.
  store.create(room('Square', 0, 0, 0, { area: 'town' }));
  store.create(room('Lane', 1, 0, 0, { area: 'town', exits: { e: exit('e') } }));
  store.create(room('Gate', 0, 0, 0, { area: 'the-keep', exits: { w: exit('w') } }));
  store.create(room('Field', 0, 0, 0));
  store.link('r2', 'e', 'r3', { back: true });
  assert.deepEqual(store.areaCounts(), { '': 1, 'the-keep': 1, 'the-keep-2': 0, area: 0, town: 2 });
  assert.deepEqual(store.areaLinks('town').map((l) => [l.from.id, l.exit.key, l.to.id]), [['r2', 'e', 'r3']]);
  assert.deepEqual(store.areaLinks('town', { both: true }).map((l) => l.from.id).sort(), ['r2', 'r3']);
  assert.deepEqual(store.areaLinks(''), []);
  // Move the keep's rooms into town: the cell 0,0 is taken by Square, so Gate lands on the nearest free cell.
  store.removeArea('the-keep', { rooms: 'move', to: 'town' });
  assert.equal(store.area('the-keep'), undefined);
  const gate = store.room('r3');
  assert.equal(gate.area, 'town');
  assert.notDeepEqual([gate.x, gate.y], [0, 0]);
  assert.equal(store.at('town', gate.x, gate.y, 0).id, 'r3', 'the cell index follows');
  assert.equal(store.room('r2').exits.e.to, 'r3', 'links survive a move');
  assert.deepEqual(store.areaLinks('town'), []);
  // Delete town with its rooms: the exit from Field into it (none here) and r2/r3 are gone; undo brings all back.
  store.removeArea('town');
  assert.deepEqual(store.rooms().map((r) => r.id), ['r4']);
  assert.equal(store.area('town'), undefined);
  assert.equal(store.undo(), 'delete area');
  assert.equal(store.rooms().length, 4);
  assert.equal(store.area('town').name, 'Town');
  // Moving into itself is refused; the default area cannot be a MapArea but can hold rooms.
  store.removeArea('town', { rooms: 'move', to: 'town' });
  assert.equal(store.area('town').name, 'Town');
  store.removeArea('town', { rooms: 'move' });
  assert.equal(store.rooms().filter((r) => r.area === '').length, 4);
});
