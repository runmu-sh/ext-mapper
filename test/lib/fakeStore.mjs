/**
 * An in-memory `MapStore` with only what the panel calls. Not the real store: no persistence, undo is a snapshot
 * stack, `path` is a BFS over linked exits, `move` refuses a taken cell.
 */
const clone = (v) => JSON.parse(JSON.stringify(v));

export function fakeStore(worldId = 'w1', rooms = []) {
  const map = new Map();
  const areas = new Map();
  const watchers = new Set();
  const undoStack = [], redoStack = [];
  let nextId = 1, depth = 0, pendingNotify = null;
  const calls = [];

  const snapshot = () => clone([...map.values()]);
  const notify = (e) => { if (depth) { pendingNotify = e; return; } for (const f of [...watchers]) f(e); };
  const record = (label) => { if (depth) return; undoStack.push({ label, rooms: snapshot() }); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; };
  const load = (list) => { map.clear(); for (const r of list) map.set(r.id, r); };
  const log = (name, ...args) => calls.push({ name, args });

  const store = {
    worldId, ready: Promise.resolve(), calls,
    room: (id) => map.get(id),
    rooms: () => [...map.values()],
    area: (id) => areas.get(id),
    areas: () => [...areas.values()],
    at: (area, x, y, z) => [...map.values()].find((r) => r.area === area && r.x === x && r.y === y && r.z === z),
    byVnum: (v) => [...map.values()].find((r) => r.vnum === v),
    byHandle: () => undefined, bySig: () => [], find: () => [],
    incoming: (id) => { const out = []; for (const r of map.values()) for (const e of Object.values(r.exits)) if (e.to === id) out.push({ room: r, exit: e }); return out; },
    path(from, to) {
      log('path', from, to);
      if (from === to) return { ids: [from], steps: [], cost: 0 };
      const prev = new Map([[from, null]]);
      const q = [from];
      while (q.length) {
        const id = q.shift();
        const r = map.get(id);
        if (!r) continue;
        for (const e of Object.values(r.exits)) {
          if (!e.to || e.blocked || prev.has(e.to)) continue;
          prev.set(e.to, { id, key: e.key });
          if (e.to === to) {
            const ids = [], steps = [];
            let cur = to;
            while (cur !== from) { const p = prev.get(cur); ids.unshift(cur); steps.unshift(e.commands ?? [p.key]); cur = p.id; }
            ids.unshift(from);
            return { ids, steps, cost: steps.length };
          }
          q.push(e.to);
        }
      }
      return null;
    },
    freeNear: (area, x, y, z) => { let d = 0; for (;;) { for (let dx = -d; dx <= d; dx++) for (let dy = -d; dy <= d; dy++) if (!store.at(area, x + dx, y + dy, z)) return { x: x + dx, y: y + dy, z }; d++; } },
    freeAlong: (room, dir) => store.freeNear(room.area, room.x + dir.dx, room.y + dir.dy, room.z + dir.dz),
    create(room) { record('create'); const id = room.id ?? `r${nextId++}`; const r = { exits: {}, ...clone(room), id }; map.set(id, r); notify({ kind: 'rooms', ids: [id] }); return r; },
    update(id, patch) { log('update', id, patch); const r = map.get(id); if (!r) return undefined; record('update'); Object.assign(r, clone(patch)); for (const k of Object.keys(patch)) if (patch[k] === undefined) delete r[k]; notify({ kind: 'rooms', ids: [id] }); return r; },
    remove(id) { log('remove', id); record('remove'); map.delete(id); for (const r of map.values()) for (const e of Object.values(r.exits)) if (e.to === id) e.to = null; notify({ kind: 'rooms', ids: [id] }); },
    merge(from, into) { log('merge', from, into); record('merge'); const a = map.get(from), b = map.get(into); if (a && b) { for (const [k, e] of Object.entries(a.exits)) if (!b.exits[k]) b.exits[k] = e; for (const r of map.values()) for (const e of Object.values(r.exits)) if (e.to === from) e.to = into; map.delete(from); } notify({ kind: 'rooms', ids: [from, into] }); },
    move(ids, dx, dy, dz = 0, area) {
      log('move', ids, dx, dy, dz, area);
      const set = new Set(ids);
      for (const id of ids) { const r = map.get(id); if (!r) continue; const t = store.at(area ?? r.area, r.x + dx, r.y + dy, r.z + dz); if (t && !set.has(t.id)) return false; }
      record('move');
      for (const id of ids) { const r = map.get(id); if (!r) continue; r.x += dx; r.y += dy; r.z += dz; if (area !== undefined) r.area = area; }
      notify({ kind: 'rooms', ids });
      return true;
    },
    setExit(roomId, exit) { log('setExit', roomId, exit); const r = map.get(roomId); if (!r) return; record('exit'); r.exits[exit.key] = clone(exit); notify({ kind: 'rooms', ids: [roomId] }); },
    removeExit(roomId, key) { log('removeExit', roomId, key); const r = map.get(roomId); if (!r) return; record('exit'); delete r.exits[key]; notify({ kind: 'rooms', ids: [roomId] }); },
    link(roomId, key, to, opts) { log('link', roomId, key, to, opts); const r = map.get(roomId); if (!r) return; record('link'); (r.exits[key] ??= { key, to: null }).to = to; notify({ kind: 'rooms', ids: [roomId, to] }); },
    unlink(roomId, key) { log('unlink', roomId, key); const r = map.get(roomId); if (!r?.exits[key]) return; record('unlink'); r.exits[key].to = null; notify({ kind: 'rooms', ids: [roomId] }); },
    autoConnect(area) { log('autoConnect', area); return 0; },
    component(id) { const out = new Set([id]); const q = [id]; while (q.length) { const cur = map.get(q.shift()); if (!cur) continue; for (const e of Object.values(cur.exits)) { const t = e.to && map.get(e.to); if (t && t.z === cur.z && t.area === cur.area && !out.has(t.id)) { out.add(t.id); q.push(t.id); } } for (const r of map.values()) for (const e of Object.values(r.exits)) if (e.to === cur.id && r.z === cur.z && r.area === cur.area && !out.has(r.id)) { out.add(r.id); q.push(r.id); } } return out; },
    setArea(a) { log('setArea', a); record('area'); const cur = areas.get(a.id) ?? { id: a.id, name: a.id }; const next = { ...cur, ...a }; for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]; areas.set(a.id, next); notify({ kind: 'areas' }); return next; },
    createArea(name, fields = {}) { const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'area'; let id = base; for (let n = 2; areas.has(id); n++) id = `${base}-${n}`; return store.setArea({ id, name, ...fields }); },
    removeArea(id, opts = {}) { log('removeArea', id, opts); record('area'); areas.delete(id); const mine = [...map.values()].filter((r) => r.area === id); if (opts.rooms === 'move') { for (const r of mine) r.area = opts.to ?? ''; } else { for (const r of mine) map.delete(r.id); for (const r of map.values()) for (const e of Object.values(r.exits)) if (e.to && !map.has(e.to)) e.to = null; } notify({ kind: 'reset' }); },
    moveToArea(ids, area) { log('moveToArea', ids, area); record('area'); for (const id of ids) { const r = map.get(id); if (r) r.area = area; } notify({ kind: 'rooms', ids }); },
    areaLinks(id, opts = {}) { const out = []; for (const r of map.values()) for (const e of Object.values(r.exits)) { const t = e.to && map.get(e.to); if (!t || t.area === r.area) continue; if (r.area === id || (opts.both && t.area === id)) out.push({ from: r, exit: e, to: t }); } return out; },
    areaCounts() { const out = { '': 0 }; for (const a of areas.keys()) out[a] = 0; for (const r of map.values()) out[r.area] = (out[r.area] ?? 0) + 1; return out; },
    batch(label, fn) { if (!depth) record(label); depth++; try { return fn(); } finally { depth--; if (!depth && pendingNotify) { const e = pendingNotify; pendingNotify = null; notify(e); } } },
    undo() { log('undo'); const s = undoStack.pop(); if (!s) return null; redoStack.push({ label: s.label, rooms: snapshot() }); load(s.rooms); notify({ kind: 'reset' }); return s.label; },
    redo() { log('redo'); const s = redoStack.pop(); if (!s) return null; undoStack.push({ label: s.label, rooms: snapshot() }); load(s.rooms); notify({ kind: 'reset' }); return s.label; },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    export: () => ({ format: 'mu-map', v: 2, rooms: Object.fromEntries([...map.entries()].map(([k, v]) => [k, clone(v)])), areas: Object.fromEntries(areas), nextId }),
    import(data) { log('import', data); if (!data || data.format !== 'mu-map') throw new Error('unknown map format'); record('import'); load(Object.values(data.rooms)); notify({ kind: 'reset' }); return { rooms: map.size }; },
    erase() { log('erase'); record('erase'); map.clear(); notify({ kind: 'reset' }); },
    watch(fn) { watchers.add(fn); return () => watchers.delete(fn); },
    flush: async () => {}, dispose() { watchers.clear(); },
  };
  for (const r of rooms) map.set(r.id, { exits: {}, area: '', z: 0, ...clone(r) });
  nextId = rooms.length + 1;
  return store;
}

/** Three rooms in a row: r1 —east→ r2 ⇄ r3, r1 has an unexplored north and an up, r3 has a one-way south to r1 off-grid. */
export function threeRooms() {
  return [
    { id: 'r1', name: 'Gate', area: '', x: 0, y: 0, z: 0, exits: { east: { key: 'east', to: 'r2' }, north: { key: 'north', to: null }, up: { key: 'up', to: null } } },
    { id: 'r2', name: 'Street', area: '', x: 1, y: 0, z: 0, exits: { west: { key: 'west', to: 'r1' }, east: { key: 'east', to: 'r3' } }, color: 'gold', symbol: '$' },
    { id: 'r3', name: 'Square', area: '', x: 2, y: 0, z: 0, exits: { west: { key: 'west', to: 'r2' }, south: { key: 'south', to: 'r1' } }, warn: 'displaced', note: 'busy' },
  ];
}

export function fakeTracker(sid = 's1', roomId = 'r1') {
  const listeners = new Set();
  const tr = { sid, worldId: 'w1', position: { roomId, by: 'vnum' }, pending: [], lastScene: { sid, source: 'test', name: 'Here', exits: [] }, paused: false, source: 'test' };
  const calls = [];
  return {
    calls, tr,
    track: (s) => (s === sid ? tr : undefined), tracks: () => [tr],
    scene() {}, moved() {}, failed() {},
    anchor(s, id) { calls.push({ name: 'anchor', s, id }); tr.position = { roomId: id, by: 'anchor' }; },
    createHere(s, cell) { calls.push({ name: 'createHere', s, cell }); return null; },
    pause(s, p) { calls.push({ name: 'pause', s, p }); tr.paused = p; },
    isMove: () => false,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    drop() {},
    emit(e) { for (const f of [...listeners]) f(e); },
    setPosition(id) { tr.position = { roomId: id, by: 'vnum' }; },
  };
}

export function fakeWalker() {
  const calls = [];
  let st = { status: 'idle', target: null, route: [], at: 0 };
  return {
    calls,
    async goto(sid, roomId, opts) { calls.push({ name: 'goto', sid, roomId, opts }); return st; },
    async steps(sid, steps, opts) { calls.push({ name: 'steps', sid, steps, opts }); return st; },
    stop(sid) { calls.push({ name: 'stop', sid }); },
    pause() {}, resume() {},
    state: () => st,
    setState(s) { st = s; },
  };
}
