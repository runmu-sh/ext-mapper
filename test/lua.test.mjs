/**
 * The Lua bridge: every wire function (happy path and bad args), reply ids and fire-and-forget, event gating and
 * the 50/s drop, `goto` replying when the walk ends, `batch` as one undo step, the export size guard, `help()`
 * and the Lua library (compiled with fengari, a Lua 5.4 VM, and its speedwalk parser held to the JS twin).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './lib/load.mjs';
import { harness } from './lib/luaHarness.mjs';

const { LUA_API, LUA_FN_NAMES, luaHelp } = await loadTs('src/lua/api.ts');
const { MAPPER_LUA, parseSpeedwalk, luaMethodName } = await loadTs('src/lua/library.ts');
const { toLuaRoom, EVENTS_PER_S } = await loadTs('src/lua/bridge.ts');

const ok = (r) => { assert.equal(r?.ok, true, `expected ok, got ${JSON.stringify(r)}`); return r.result; };
const bad = (r, fn, part) => { assert.equal(r?.ok, false, `expected error, got ${JSON.stringify(r)}`); assert.match(r.error, new RegExp(`^mapper\\.${fn}: `)); if (part) assert.match(r.error, part); return r.error; };

/** Two linked rooms a—n→b, with b having an unexplored exit east. */
async function twoRooms(h) {
  const a = h.room('Square', 0, 0, { vnum: '100', tags: ['start'] });
  const b = h.room('Lane', 0, -1, { vnum: '101' });
  h.store.setExit(a.id, { key: 'n', to: b.id });
  h.store.setExit(b.id, { key: 's', to: a.id });
  h.store.setExit(b.id, { key: 'e', to: null });
  h.tracker.setHere('s1', a.id);
  return { a, b };
}

test('reads: version, here, room, rooms, byVnum, at, areas, path, incoming', async () => {
  const h = await harness();
  const { a, b } = await twoRooms(h);
  h.store.setArea({ id: 'town', name: 'Town' });
  assert.equal(ok(await h.call('version')), '0.1.0-test');
  assert.equal(ok(await h.call('here')).id, a.id);
  assert.equal(ok(await h.call('room', b.id)).name, 'Lane');
  assert.equal(ok(await h.call('room', 'r99')), null);
  bad(await h.call('room', 5), 'room', /id must be/);
  assert.deepEqual(ok(await h.call('rooms', { name: 'lan' })).map((r) => r.id), [b.id]);
  assert.deepEqual(ok(await h.call('rooms', { tag: 'start' })).map((r) => r.id), [a.id]);
  assert.deepEqual(ok(await h.call('rooms', { near: { id: a.id, radius: 1 }, limit: 5 })).map((r) => r.id).sort(), [a.id, b.id].sort());
  assert.equal(ok(await h.call('rooms', {})).length, 2);
  assert.equal(ok(await h.call('rooms')).length, 2);
  bad(await h.call('rooms', { near: { id: 'nope', radius: 1 } }), 'rooms', /no room nope/);
  bad(await h.call('rooms', 'x'), 'rooms', /must be a table/);
  assert.equal(ok(await h.call('byVnum', '101')).id, b.id);
  assert.equal(ok(await h.call('byVnum', 101)).id, b.id);
  bad(await h.call('byVnum'), 'byVnum');
  assert.equal(ok(await h.call('at', '', 0, -1, 0)).id, b.id);
  assert.equal(ok(await h.call('at', '', 7, 7, 0)), null);
  bad(await h.call('at', '', 'x', 0), 'at', /x must be a number/);
  assert.deepEqual(ok(await h.call('areas')), [{ id: '', name: '', note: '', color: '', rooms: 2 }, { id: 'town', name: 'Town', note: '', color: '', rooms: 0 }]);
  assert.deepEqual(ok(await h.call('area', 'town')), { id: 'town', name: 'Town', note: '', color: '', rooms: 0 });
  assert.equal(ok(await h.call('area', 'nope')), null);
  const p = ok(await h.call('path', b.id));
  assert.deepEqual(p, { ids: [b.id], steps: ['n'], cost: p.cost });
  assert.deepEqual(ok(await h.call('path', b.id, a.id)).steps, ['s']);
  assert.deepEqual(ok(await h.call('path', b.id, {})).steps, ['n']);
  assert.equal(ok(await h.call('path', a.id, b.id, { avoid: [b.id] })), null);
  bad(await h.call('path', a.id, b.id, { avoid: 'b' }), 'path', /avoid must be a list/);
  bad(await h.call('path', 'zz'), 'path', /no room zz/);
  const inc = ok(await h.call('incoming', b.id));
  assert.deepEqual(inc.map((x) => [x.room.id, x.key]), [[a.id, 'n']]);
  bad(await h.call('incoming', ''), 'incoming');
});

test('unexplored exits are false, never null; LuaRoom shape', async () => {
  const h = await harness();
  const { b } = await twoRooms(h);
  const r = ok(await h.call('room', b.id));
  assert.equal(r.exits.e, false);
  assert.ok('e' in r.exits && 's' in r.exits);
  assert.deepEqual(Object.keys(toLuaRoom(h.store.room(b.id))).sort(), ['area', 'color', 'env', 'exits', 'id', 'locked', 'name', 'note', 'symbol', 'tags', 'vnum', 'x', 'y', 'z']);
  assert.ok(!JSON.stringify(r).includes('null'));
});

test('areas: addArea, setArea, areaLinks, removeArea (delete and move)', async () => {
  const h = await harness();
  const { a, b } = await twoRooms(h);
  const keep = ok(await h.call('addArea', 'The Keep', { note: 'levels 5-10', color: 'moss' }));
  assert.deepEqual(keep, { id: 'the-keep', name: 'The Keep', note: 'levels 5-10', color: 'moss', rooms: 0 });
  assert.equal(ok(await h.call('addArea', 'The Keep')).id, 'the-keep-2', 'a second area of the same name gets a numbered id');
  bad(await h.call('addArea', ''), 'addArea', /name must be/);
  bad(await h.call('addArea', 'X', { bogus: 1 }), 'addArea', /unknown area field/);
  bad(await h.call('setArea', '', { name: 'x' }), 'setArea', /default area cannot/);
  const ren = ok(await h.call('setArea', 'the-keep', { name: 'Keep', note: null }));
  assert.deepEqual(ren, { id: 'the-keep', name: 'Keep', note: '', color: 'moss', rooms: 0 });
  // Rooms into the area, one link across.
  const gate = ok(await h.call('add', { name: 'Gate', area: 'the-keep', x: 0, y: 0, z: 0, exits: { w: true } }));
  ok(await h.call('link', a.id, 'e', gate.id));
  assert.equal(ok(await h.call('area', 'the-keep')).rooms, 1);
  assert.deepEqual(ok(await h.call('areaLinks', '')), [{ from: a.id, key: 'e', to: gate.id, fromArea: '', toArea: 'the-keep' }]);
  assert.deepEqual(ok(await h.call('areaLinks', 'the-keep')), [{ from: gate.id, key: 'w', to: a.id, fromArea: 'the-keep', toArea: '' }]);
  assert.equal(ok(await h.call('areaLinks', 'the-keep', { both: true })).length, 2);
  bad(await h.call('areaLinks', 'nope'), 'areaLinks', /no area nope/);
  // Move the rooms out, then delete.
  ok(await h.call('removeArea', 'the-keep', { rooms: 'move', to: '' }));
  const moved = ok(await h.call('room', gate.id));
  assert.equal(moved.area, '');
  assert.ok(!(moved.x === 0 && moved.y === 0 && moved.z === 0), 'its cell was taken by a: moved to a free one');
  assert.equal(ok(await h.call('room', a.id)).exits.e, gate.id, 'the link survives');
  assert.equal(ok(await h.call('area', 'the-keep')), null);
  bad(await h.call('removeArea', ''), 'removeArea', /default area cannot/);
  bad(await h.call('removeArea', 'the-keep-2', { rooms: 'zap' }), 'removeArea', /rooms must be/);
  ok(await h.call('set', b.id, { area: 'the-keep-2' }));
  ok(await h.call('removeArea', 'the-keep-2'));
  assert.equal(ok(await h.call('room', b.id)).area, '', 'by default the rooms move to the default area');
  ok(await h.call('set', b.id, { area: 'the-keep-3' }));
  ok(await h.call('removeArea', 'the-keep-3', { rooms: 'delete' }));
  assert.equal(ok(await h.call('room', b.id)), null, 'rooms = "delete" deletes its rooms');
  assert.equal(ok(await h.call('room', a.id)).exits.n, false, 'the exit into it is unexplored again');
});

test('writes: add, set, remove, merge, move', async () => {
  const h = await harness();
  const { a, b } = await twoRooms(h);
  const c = ok(await h.call('add', { name: 'Shop', tags: ['shop'], color: 'gold', symbol: '$', exits: { w: a.id, e: true } }));
  assert.equal(c.name, 'Shop'); assert.equal(c.exits.w, a.id); assert.equal(c.exits.e, false); assert.equal(c.color, 'gold');
  assert.ok(!h.store.at('', 0, 0, 0) || h.store.at('', 0, 0, 0).id === a.id, 'free cell near here');
  assert.notEqual(`${c.x},${c.y}`, '0,0');
  const d = ok(await h.call('add', { name: 'Far', area: 'town', x: 5, y: 5, z: 1 }));
  assert.deepEqual([d.area, d.x, d.y, d.z], ['town', 5, 5, 1]);
  bad(await h.call('add', {}), 'add', /name is required/);
  bad(await h.call('add', { name: 'X', color: 'pink' }), 'add', /color must be/);
  bad(await h.call('add', { name: 'X', exits: { n: 'r99' } }), 'add', /no room r99/);
  bad(await h.call('add', { name: 'X', area: 'town', x: 5, y: 5, z: 1 }), 'add', /taken/);
  bad(await h.call('add', { name: 'X', vnum: '100' }), 'add', /already room/);
  const s = ok(await h.call('set', b.id, { note: 'hi', symbol: 'AB', tags: ['x'], weight: 3, locked: true }));
  assert.deepEqual([s.note, s.symbol, s.tags, s.locked], ['hi', 'AB', ['x'], true]);
  assert.equal(h.store.room(b.id).weight, 3);
  bad(await h.call('set', b.id, { symbol: 'ABC' }), 'set', /2 characters/);
  bad(await h.call('set', b.id, { tags: 'x' }), 'set', /list of strings/);
  bad(await h.call('set', b.id, { exits: {} , bogus: 1 }), 'set', /unknown field "bogus"/);
  bad(await h.call('set', b.id, { id: 'r9' }), 'set');
  bad(await h.call('set', b.id, { x: 0, y: 0 }), 'set', /taken by/);
  bad(await h.call('set', 'r99', { note: 'x' }), 'set', /no room/);
  assert.equal(ok(await h.call('move', b.id, 0, -1)), true);
  assert.equal(h.store.room(b.id).y, -2);
  assert.equal(ok(await h.call('move', [a.id, b.id], 1, 0, 0)), true);
  assert.equal(h.store.room(a.id).x, 1);
  bad(await h.call('move', b.id, 'x', 0), 'move', /dx/);
  assert.equal(ok(await h.call('merge', c.id, b.id)), true);
  assert.equal(h.store.room(c.id), undefined);
  bad(await h.call('merge', a.id, a.id), 'merge', /same room/);
  assert.equal(ok(await h.call('remove', d.id)), true);
  assert.equal(h.store.room(d.id), undefined);
  bad(await h.call('remove', d.id), 'remove', /no room/);
});

test('exits: exit, removeExit, link, unlink, autoConnect', async () => {
  const h = await harness();
  const { a, b } = await twoRooms(h);
  const r = ok(await h.call('exit', a.id, 'enter portal', { to: b.id, commands: ['say xyzzy', 'enter portal'], cost: 3, door: 'closed', dir: 'up', oneway: true }));
  assert.equal(r.exits['enter portal'], b.id);
  const e = h.store.room(a.id).exits['enter portal'];
  assert.deepEqual([e.commands, e.cost, e.door, e.dir, e.oneway], [['say xyzzy', 'enter portal'], 3, 'closed', 'up', true]);
  assert.equal(ok(await h.call('exit', a.id, 'enter portal', { to: false })).exits['enter portal'], false);
  bad(await h.call('exit', a.id, 'x', { door: 'ajar' }), 'exit', /door must be/);
  bad(await h.call('exit', a.id, 'x', { dir: 'sideways' }), 'exit', /dir must be/);
  bad(await h.call('exit', a.id, 'x', { nope: 1 }), 'exit', /unknown exit field/);
  bad(await h.call('exit', a.id, '', {}), 'exit', /key/);
  assert.equal(ok(await h.call('removeExit', a.id, 'enter portal')), true);
  bad(await h.call('removeExit', a.id, 'enter portal'), 'removeExit', /no exit/);
  assert.equal(ok(await h.call('unlink', b.id, 's')).exits ? true : true, true);
  assert.equal(h.store.room(b.id).exits.s.to, null);
  bad(await h.call('unlink', b.id, 'zz'), 'unlink', /no exit/);
  const l = ok(await h.call('link', a.id, 'n', b.id));
  assert.equal(l.exits.n, b.id);
  assert.equal(h.store.room(b.id).exits.s.to, a.id, 'back link by default');
  h.store.unlink(b.id, 's');
  ok(await h.call('link', a.id, 'n', b.id, { back: false }));
  assert.equal(h.store.room(b.id).exits.s.to, null);
  bad(await h.call('link', a.id, 'n', 'r99'), 'link', /no room r99/);
  bad(await h.call('link', a.id, 'n', b.id, { back: 'yes' }), 'link', /back must be/);
  assert.equal(typeof ok(await h.call('autoConnect')), 'number');
  bad(await h.call('autoConnect', 3), 'autoConnect', /area must be a string/);
});

test('tag, untag, note, lock', async () => {
  const h = await harness();
  const { a } = await twoRooms(h);
  assert.deepEqual(ok(await h.call('tag', a.id, 'shop')).tags, ['start', 'shop']);
  assert.deepEqual(ok(await h.call('tag', a.id, 'shop')).tags, ['start', 'shop'], 'no duplicate');
  assert.deepEqual(ok(await h.call('untag', a.id, 'start')).tags, ['shop']);
  bad(await h.call('tag', a.id, ''), 'tag');
  bad(await h.call('untag', a.id, 7), 'untag');
  assert.equal(ok(await h.call('note', a.id, 'buy here')).note, 'buy here');
  assert.equal(ok(await h.call('note', a.id, '')).note, '');
  bad(await h.call('note', a.id, 3), 'note', /text must be a string/);
  assert.equal(ok(await h.call('lock', a.id, true)).locked, true);
  assert.equal(ok(await h.call('lock', a.id, false)).locked, false);
  bad(await h.call('lock', a.id, 'yes'), 'lock', /true or false/);
});

test('tracking: scene, moved, failed, anchor, pause, track', async () => {
  const h = await harness();
  const { a } = await twoRooms(h);
  const t = ok(await h.call('scene', { name: 'Gate', vnum: 7, desc: 'A gate.', exits: { n: true, s: '100' }, exitsComplete: true }));
  assert.equal(t.roomId, a.id);
  const input = h.tracker.calls[0].args[0];
  assert.deepEqual(input, { sid: 's1', source: 'lua', name: 'Gate', vnum: '7', desc: 'A gate.', exits: [{ key: 'n' }, { key: 's', to: '100' }], exitsComplete: true });
  ok(await h.call('scene', { name: 'Gate', exits: ['n', 'e'] }));
  assert.deepEqual(h.tracker.calls[1].args[0].exits, [{ key: 'n' }, { key: 'e' }]);
  bad(await h.call('scene', { exits: ['n'] }), 'scene', /name/);
  bad(await h.call('scene', { name: 'G', exits: { n: {} } }), 'scene', /vnum or true/);
  assert.equal(ok(await h.call('moved', 'n')), true);
  assert.deepEqual(h.tracker.calls.at(-1).args, ['s1', 'n', { confirmed: undefined }]);
  bad(await h.call('moved'), 'moved', /key/);
  assert.equal(ok(await h.call('failed', 'The door is locked.', 'n')), true);
  assert.deepEqual(h.tracker.calls.at(-1).args, ['s1', 'The door is locked.', 'n']);
  ok(await h.call('failed', 'Huh?'));
  assert.deepEqual(h.tracker.calls.at(-1).args, ['s1', 'Huh?', null]);
  bad(await h.call('failed', 'x', 3), 'failed');
  const an = ok(await h.call('anchor', a.id));
  assert.deepEqual([an.roomId, an.by], [a.id, 'anchor']);
  bad(await h.call('anchor', 'r99'), 'anchor', /no room/);
  assert.equal(ok(await h.call('pause', true)).paused, true);
  bad(await h.call('pause', 1), 'pause', /true or false/);
  const tr = ok(await h.call('track'));
  assert.deepEqual(Object.keys(tr).sort(), ['by', 'dropped', 'paused', 'pending', 'roomId', 'source']);
  assert.deepEqual(tr.pending, ['n']);
});

test('goto replies when the walk ends; walk, stop, walkPause, walking', async () => {
  const h = await harness();
  const { a, b } = await twoRooms(h);
  const id = h.callNoWait('goto', b.id, { mode: 'burst', delayMs: 100 });
  await h.settle();
  assert.equal(h.replyFor(id), undefined, 'no reply while walking');
  assert.deepEqual(h.walker.calls[0], { fn: 'goto', args: ['s1', b.id, { mode: 'burst', delayMs: 100 }] });
  assert.equal(ok(await h.call('walking')).status, 'walking');
  h.walker.finish({ status: 'arrived', target: b.id, route: [b.id], at: 1 });
  await h.settle();
  assert.deepEqual(h.replyFor(id), { id, ok: true, result: { status: 'arrived', target: b.id, route: [b.id], at: 1 } });
  bad(await h.call('goto', a.id, { mode: 'fly' }), 'goto', /mode must be/);
  bad(await h.call('goto', 'r99'), 'goto', /no room/);
  const wid = h.callNoWait('walk', ['n', 'open door', 'e']);
  await h.settle();
  assert.deepEqual(h.walker.calls.at(-1).args, ['s1', ['n', 'open door', 'e'], {}]);
  h.walker.finish({ status: 'failed', target: null, route: [], at: 1, reason: 'no exit' });
  await h.settle();
  assert.equal(h.replyFor(wid).result.reason, 'no exit');
  bad(await h.call('walk', []), 'walk', /not be empty/);
  bad(await h.call('walk', 'n'), 'walk', /list of strings/);
  assert.equal(ok(await h.call('walkPause', true)).status, 'paused');
  assert.equal(ok(await h.call('walkPause', false)).status, 'walking');
  bad(await h.call('walkPause', 'x'), 'walkPause');
  assert.equal(ok(await h.call('stop')).status, 'stopped');
  assert.equal(h.walker.calls.at(-1).fn, 'stop');
});

test('a pending goto settles as stopped when the bridge is disposed', async () => {
  const h = await harness();
  const { b } = await twoRooms(h);
  const id = h.callNoWait('goto', b.id);
  await h.settle();
  h.dispose();
  await h.settle();
  assert.equal(h.replyFor(id), undefined, 'nothing is emitted after dispose');
  assert.equal(h.tracker.listenerCount(), 0);
  assert.ok(h.walker.hasPending(), 'the walker promise itself is left to the walker');
});

test('batch is one undo step and returns per-call results; undo/redo', async () => {
  const h = await harness();
  const { a } = await twoRooms(h);
  const before = h.store.rooms().length;
  const res = ok(await h.call('batch', 'build street', [
    { fn: 'add', args: [{ name: 'A', x: 3, y: 3, exits: { e: true } }] },
    { fn: 'add', args: [{ name: 'B', x: 4, y: 3, exits: { w: true } }] },
    { fn: 'tag', args: ['r99', 'x'] },
    { fn: 'autoConnect' },
  ]));
  assert.equal(res.length, 4);
  assert.equal(res[0].ok, true); assert.equal(res[0].result.name, 'A');
  assert.equal(res[2].ok, false); assert.match(res[2].error, /^mapper\.tag: no room r99/);
  assert.equal(res[3].result, 2, 'A—e—B linked both ways by autoConnect');
  assert.equal(h.store.rooms().length, before + 2);
  assert.equal(ok(await h.call('undo')), 'build street');
  assert.equal(h.store.rooms().length, before);
  assert.equal(ok(await h.call('redo')), 'build street');
  assert.equal(h.store.rooms().length, before + 2);
  assert.equal(ok(await h.call('undo')), 'build street');
  h.store.undo(); h.store.undo(); h.store.undo(); h.store.undo();
  while (h.store.canUndo()) h.store.undo();
  assert.equal(ok(await h.call('undo')), null);
  bad(await h.call('batch', '', []), 'batch');
  bad(await h.call('batch', 'x', [{ fn: 'goto', args: [a.id] }]), 'batch', /cannot run in a batch/);
  bad(await h.call('batch', 'x', [{ fn: 'nope' }]), 'batch', /unknown function/);
  bad(await h.call('batch', 'x', [{ fn: 'batch', args: ['y', []] }]), 'batch');
});

test('export size guard, import, erase', async () => {
  const h = await harness();
  await twoRooms(h);
  const data = ok(await h.call('export'));
  assert.equal(data.format, 'mu-map'); assert.equal(Object.keys(data.rooms).length, 2);
  for (let i = 0; i < 400; i++) h.store.create({ name: `Room ${i} ${'x'.repeat(150)}`, area: 'big', x: i, y: 0, z: 0, exits: {} });
  bad(await h.call('export'), 'export', /map too large for Lua \(\d+ KB\); use the panel/);
  bad(await h.call('erase'), 'erase', /pass "yes"/);
  assert.equal(ok(await h.call('erase', 'yes')), true);
  assert.equal(h.store.rooms().length, 0);
  assert.deepEqual(ok(await h.call('import', data)), { rooms: 2 });
  assert.equal(h.store.rooms().length, 2);
  bad(await h.call('import', { format: 'wat' }), 'import');
  bad(await h.call('import', 'x'), 'import', /map table/);
});

test('reply ids, fire-and-forget, unknown function, malformed call, no map, args as an object with holes', async () => {
  const h = await harness();
  const r = await h.call('version');
  assert.equal(typeof r.id, 'number');
  const n = h.replies().length;
  h.fire('version'); h.fire('tag', 'r99', 'x');
  await h.settle();
  assert.equal(h.replies().length, n, 'no id, no reply');
  bad(await h.call('centerview'), 'centerview', /unknown function/);
  h.deliver('s1', { id: 999, fn: 7 }); await h.settle();
  assert.match(h.replyFor(999).error, /^mapper\.call: expected/);
  h.deliver('s1', { id: 998, fn: 'room', args: { 1: 'r1', 3: 1 } }); await h.settle();
  assert.equal(h.replyFor(998).ok, true, 'Lua table with a nil hole reads as a list');
  h.deliver('s1', { id: 997, fn: 'room', args: { a: 1 } }); await h.settle();
  bad(h.replyFor(997), 'room', /args must be a list/);
  h.host.sessions.push({ id: 's3', worldId: 'nomap' });
  bad(await h.callOn('s3', 'here'), 'here', /no map for this session/);
  assert.equal(typeof ok(await h.callOn('s3', 'version')), 'string');
  assert.equal(h.emits.filter((e) => e.sid !== 's1' && e.sid !== 's3').length, 0);
});

test('events are gated per session, track/moved are not forwarded, and more than 50/s are dropped', async () => {
  const h = await harness();
  const { a, b } = await twoRooms(h);
  const enter = { type: 'enter', sid: 's1', room: b, prev: a, via: 'n', by: 'vnum' };
  h.tracker.fire(enter);
  await h.settle();
  assert.equal(h.events().length, 0, 'nothing before events(true)');
  assert.equal(ok(await h.call('events', true)), true);
  bad(await h.call('events', 'on'), 'events');
  h.tracker.fire(enter);
  h.tracker.fire({ type: 'track', sid: 's1', track: h.tracker.track('s1') });
  h.tracker.fire({ type: 'moved', sid: 's1', key: 'n' });
  h.tracker.fire({ type: 'created', sid: 's1', room: b, via: null });
  h.tracker.fire({ type: 'lost', sid: 's1', scene: { sid: 's1', source: 'lua', name: 'Void' } });
  h.tracker.fire({ type: 'failed', sid: 's1', key: null, text: 'Ouch' });
  h.tracker.fire({ type: 'walk', sid: 's1', state: { status: 'arrived', target: b.id, route: [b.id], at: 1 } });
  h.tracker.fire({ ...enter, sid: 's2' });
  await h.settle();
  const ev = h.events();
  assert.deepEqual(ev.map((e) => e.type), ['enter', 'created', 'lost', 'failed', 'walk']);
  assert.equal(ev[0].room.id, b.id); assert.equal(ev[0].prev.id, a.id); assert.equal(ev[0].via, 'n'); assert.equal(ev[0].room.exits.e, false);
  assert.equal(ev[1].via, null);
  assert.equal(ev[2].name, 'Void');
  assert.deepEqual(ev[3], { type: 'failed', key: null, text: 'Ouch' });
  assert.deepEqual(ev[4], { type: 'walk', status: 'arrived', target: b.id, at: 1, total: 1, reason: null });
  assert.equal(h.events('s2').length, 0, 's2 never subscribed');
  for (let i = 0; i < 70; i++) h.tracker.fire(enter);
  await h.settle();
  assert.equal(h.events().length, EVENTS_PER_S);
  assert.equal(ok(await h.call('track')).dropped, 70 + 5 - EVENTS_PER_S);
  assert.equal(ok(await h.call('events', false)), false);
  h.tracker.fire(enter); await h.settle();
  assert.equal(h.events().length, EVENTS_PER_S);
});

test('help() lists every dispatch name with a signature; the API table is the single source', async () => {
  const h = await harness();
  const lines = ok(await h.call('help'));
  assert.equal(lines.length, LUA_API.length);
  for (const f of LUA_API) assert.ok(lines.some((l) => l.startsWith(f.fn + '(')), `help has ${f.fn}`);
  assert.deepEqual(lines, luaHelp());
  assert.equal(new Set(LUA_FN_NAMES).size, LUA_FN_NAMES.length, 'no duplicate names');
  for (const fn of LUA_FN_NAMES) ok(await h.call('help')) && assert.notEqual((await h.call(fn, ...(fn === 'erase' ? ['no'] : []))).error?.includes('unknown function'), true, `${fn} dispatches`);
});

test('MAPPER_LUA compiles (Lua 5.4 via fengari), defines every function, and its speedwalk parser matches the JS twin', async () => {
  const defined = new Set([...MAPPER_LUA.matchAll(/function mapper\.(\w+)/g)].map((m) => m[1]));
  for (const fn of LUA_FN_NAMES) assert.ok(defined.has(luaMethodName(fn)), `mapper.${luaMethodName(fn)} defined`);
  for (const extra of ['on', 'off', 'opposite', 'speedwalk', 'parseSpeedwalk']) assert.ok(defined.has(extra));
  assert.ok(MAPPER_LUA.split('\n').length <= 170, `lua is ${MAPPER_LUA.split('\n').length} lines`);
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = await import('fengari');
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  const pre = 'emitted = {}\next = { emit = function(n, d) emitted[#emitted + 1] = { n, d } return true end, on = function(n, f) _G[n:gsub("%.", "_")] = f end }\n';
  assert.equal(lauxlib.luaL_loadstring(L, to_luastring(pre + MAPPER_LUA)), 0, 'compiles: ' + (lua.lua_tostring(L, -1) ? to_jsstring(lua.lua_tostring(L, -1)) : ''));
  assert.equal(lua.lua_pcall(L, 0, 0, 0), 0, 'runs');
  const run = (src) => { assert.equal(lauxlib.luaL_dostring(L, to_luastring(src)), 0, src + ': ' + (lua.lua_tostring(L, -1) ? to_jsstring(lua.lua_tostring(L, -1)) : '')); const v = lua.lua_tostring(L, -1); lua.lua_pop(L, 1); return v ? to_jsstring(v) : null; };
  for (const s of ['3n 2e u', '3n2eu', 'n n e', '2enter portal', 'open door north; 2n', 'north 2south', 'NE 2sw', 'in out', '3in', '', 'nn', 'ses', '10n', 'say hi;2u', 'n;;e']) {
    assert.equal(run(`return table.concat(mapper.parseSpeedwalk(${JSON.stringify(s)}), "|")`), parseSpeedwalk(s).join('|'), `speedwalk ${JSON.stringify(s)}`);
  }
  assert.deepEqual(parseSpeedwalk('3n 2e u'), ['n', 'n', 'n', 'e', 'e', 'u']);
  assert.deepEqual(parseSpeedwalk('2enter portal'), ['2enter portal']);
  assert.deepEqual(parseSpeedwalk('n;open door;2e'), ['n', 'open door', 'e', 'e']);
  for (const [d, o] of [['n', 's'], ['north', 'south'], ['SW', 'ne'], ['up', 'down'], ['in', 'out'], ['x', 'nil']]) assert.equal(run(`return tostring(mapper.opposite(${JSON.stringify(d)}))`), o);
  // The wire: a call with a callback gets an id and answers from mapper.reply; without one it does not.
  assert.equal(run(`mapper.room("r1", function(ok, r) got = { ok, r } end) local e = emitted[#emitted][2] return e.fn .. "/" .. tostring(e.id) .. "/" .. e.args[1]`), 'room/1/r1');
  assert.equal(run(`mapper_reply({ id = 1, ok = true, result = { name = "Square" } }) return got[2].name`), 'Square');
  assert.equal(run(`mapper.note("r1", "x") local e = emitted[#emitted][2] return e.fn .. "/" .. tostring(e.id)`), 'note/nil');
  assert.equal(run(`mapper.go("r1", function() end) return emitted[#emitted][2].fn`), 'goto');
  assert.equal(run(`mapper.speedwalk("2n e") local e = emitted[#emitted][2] return e.fn .. "/" .. table.concat(e.args[1], ",")`), 'walk/n,n,e');
  assert.equal(run(`mapper.speedwalk("", function(ok, err) sw = err end) return sw`), 'mapper.speedwalk: nothing to walk');
  // mapper.on subscribes once and dispatches by type and "*".
  assert.equal(run(`n = 0 local before = #emitted mapper.on("enter", function(e) n = n + 1 end) mapper.on("*", function(e) n = n + 10 end) local e = emitted[#emitted][2] return e.fn .. "/" .. tostring(e.args[1]) .. "/" .. (#emitted - before)`), 'events/true/1');
  assert.equal(run(`mapper_event({ type = "enter", room = { id = "r2" } }) mapper_event({ type = "walk" }) return tostring(n)`), '21');
});
