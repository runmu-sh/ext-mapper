/**
 * The map of one world: rooms, areas, indexes, pathfinding, undo/redo, import/export and debounced persistence.
 * `createStore(worldId, persist)` takes any `Persist` (the SDK-backed one from `persist.ts`, or `memoryPersist`
 * in tests). Every write goes through `mutate`, which records one undo step and one watcher event per call, or
 * one per `batch`.
 */
import { parseDir } from './dirs';
import { idNumber, readMapFile } from './import';
import { alongFree, componentOf, dijkstra, spiralFree } from './path';
import type { AreaLink, Dir, FindQuery, MapArea, MapData, MapExit, MapRoom, MapStore, PathResult, StoreEvent } from './types';
import type { Dispose } from '@muclient/sdk';

/** Where the store keeps its data. `save` is called debounced with the whole map; errors go to `onError`. */
export interface Persist {
  load(): Promise<MapData | null>;
  save(data: MapData): Promise<void>;
  /** Called with any error `load`/`save` raised (a `QuotaExceeded`, say) instead of it being thrown. */
  onError?: (e: unknown) => void;
}

/** The store with the test hooks the contract does not need. */
export interface MapStoreImpl extends MapStore {
  /** How many watchers are registered (zero after `dispose`). */
  watcherCount(): number;
}

const UNDO_CAP = 100;
const SAVE_DELAY_MS = 250;

const cellKey = (area: string, x: number, y: number, z: number): string => `${area}\u0000${x}\u0000${y}\u0000${z}`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** An id from a name: lower-case words joined by `-`. */
export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

interface Snapshot { rooms: Record<string, MapRoom>; areas: Record<string, MapArea>; nextId: number }

export function createStore(worldId: string, persist: Persist): MapStoreImpl {
  /* ── state ── */
  let rooms = new Map<string, MapRoom>();
  let areas = new Map<string, MapArea>();
  let nextId = 1;
  const cells = new Map<string, string>();
  const vnums = new Map<string, string>();
  const handles = new Map<string, string>();
  const sigs = new Map<string, Set<string>>();

  /* ── indexes ── */
  function index(r: MapRoom): void {
    cells.set(cellKey(r.area, r.x, r.y, r.z), r.id);
    if (r.vnum) vnums.set(r.vnum, r.id);
    if (r.sig) { let s = sigs.get(r.sig); if (!s) sigs.set(r.sig, (s = new Set())); s.add(r.id); }
    for (const e of Object.values(r.exits)) if (e.handle) handles.set(e.handle, r.id);
  }
  function unindex(r: MapRoom): void {
    const ck = cellKey(r.area, r.x, r.y, r.z);
    if (cells.get(ck) === r.id) cells.delete(ck);
    if (r.vnum && vnums.get(r.vnum) === r.id) vnums.delete(r.vnum);
    if (r.sig) { const s = sigs.get(r.sig); if (s) { s.delete(r.id); if (!s.size) sigs.delete(r.sig); } }
    for (const e of Object.values(r.exits)) if (e.handle && handles.get(e.handle) === r.id) handles.delete(e.handle);
  }
  function reindexAll(): void {
    cells.clear(); vnums.clear(); handles.clear(); sigs.clear();
    for (const r of rooms.values()) index(r);
  }
  const taken = (area: string) => (x: number, y: number, z: number): boolean => cells.has(cellKey(area, x, y, z));

  /* ── snapshots, undo, redo ── */
  function snapshot(): string {
    const s: Snapshot = { rooms: Object.fromEntries(rooms), areas: Object.fromEntries(areas), nextId };
    return JSON.stringify(s);
  }
  function restore(json: string): void {
    const s = JSON.parse(json) as Snapshot;
    rooms = new Map(Object.entries(s.rooms));
    areas = new Map(Object.entries(s.areas));
    nextId = s.nextId;
    reindexAll();
  }
  const undoStack: Array<{ label: string; state: string }> = [];
  const redoStack: Array<{ label: string; state: string }> = [];

  /* ── watchers and the mutation wrapper ── */
  const watchers = new Set<(e: StoreEvent) => void>();
  let depth = 0;
  let pendingKinds = new Set<StoreEvent['kind']>();
  let pendingIds = new Set<string>();
  let disposed = false;

  function touch(kind: StoreEvent['kind'], ids: Iterable<string> = []): void {
    pendingKinds.add(kind);
    for (const id of ids) pendingIds.add(id);
  }
  function touchRoom(r: MapRoom): void {
    r.updated = Date.now();
    touch('rooms', [r.id]);
  }
  function emit(): void {
    if (!pendingKinds.size) return;
    let ev: StoreEvent;
    if (pendingKinds.has('reset') || (pendingKinds.has('rooms') && pendingKinds.has('areas'))) ev = { kind: 'reset' };
    else if (pendingKinds.has('rooms')) ev = { kind: 'rooms', ids: [...pendingIds] };
    else ev = { kind: 'areas' };
    pendingKinds = new Set();
    pendingIds = new Set();
    for (const fn of [...watchers]) fn(ev);
  }
  /** Run a write: one undo step, one save, one event, unless inside a batch (then the batch owns them). */
  function mutate<T>(label: string, fn: () => T): T {
    if (depth > 0) return fn();
    const before = snapshot();
    depth++;
    try {
      return fn();
    } finally {
      depth--;
      // Even when fn threw part-way, what it changed is recorded, saved and announced.
      if (pendingKinds.size) {
        undoStack.push({ label, state: before });
        if (undoStack.length > UNDO_CAP) undoStack.splice(0, undoStack.length - UNDO_CAP);
        redoStack.length = 0;
        scheduleSave();
        emit();
      }
    }
  }

  /* ── persistence ── */
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  const report = (e: unknown): void => { if (persist.onError) persist.onError(e); };
  function saveNow(): Promise<void> {
    const data = exportData();
    saving = saving.then(() => persist.save(data)).catch(report);
    return saving;
  }
  function scheduleSave(): void {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void saveNow(); }, SAVE_DELAY_MS);
  }
  async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; await saveNow(); }
    await saving;
  }
  function load(data: MapData): void {
    rooms = new Map(Object.entries(clone(data.rooms)));
    areas = new Map(Object.entries(clone(data.areas)));
    nextId = data.nextId;
    for (const id of rooms.keys()) { const n = idNumber(id); if (n !== null && n >= nextId) nextId = n + 1; }
    reindexAll();
  }
  const ready: Promise<void> = (async () => {
    try {
      const data = await persist.load();
      if (data && !disposed) { load(data); touch('reset'); emit(); }
    } catch (e) { report(e); }
  })();

  /* ── reads ── */
  function exportData(): MapData {
    return clone({ format: 'mu-map', v: 2, rooms: Object.fromEntries(rooms), areas: Object.fromEntries(areas), nextId });
  }
  function incoming(id: string): Array<{ room: MapRoom; exit: MapExit }> {
    const out: Array<{ room: MapRoom; exit: MapExit }> = [];
    for (const r of rooms.values()) for (const e of Object.values(r.exits)) if (e.to === id) out.push({ room: r, exit: e });
    return out;
  }
  function find(q: FindQuery): MapRoom[] {
    const out: MapRoom[] = [];
    const name = q.name?.toLowerCase();
    const near = q.near ? rooms.get(q.near.roomId) : undefined;
    if (q.near && !near) return out;
    for (const r of rooms.values()) {
      if (name !== undefined && !r.name.toLowerCase().includes(name)) continue;
      if (q.area !== undefined && r.area !== q.area) continue;
      if (q.vnum !== undefined && r.vnum !== q.vnum) continue;
      if (q.tag !== undefined && !(r.tags ?? []).includes(q.tag)) continue;
      if (near && q.near) {
        if (r.area !== near.area || r.z !== near.z) continue;
        if (Math.max(Math.abs(r.x - near.x), Math.abs(r.y - near.y)) > q.near.radius) continue;
      }
      out.push(r);
      if (q.limit !== undefined && out.length >= q.limit) break;
    }
    return out;
  }

  /* ── writes ── */
  function allocId(): string {
    let id = `r${nextId++}`;
    while (rooms.has(id)) id = `r${nextId++}`;
    return id;
  }
  function create(room: Omit<MapRoom, 'id'> & { id?: string }): MapRoom {
    return mutate('create room', () => {
      let id = room.id;
      if (id === undefined) id = allocId();
      else {
        if (rooms.has(id)) throw new Error(`room ${id} exists`);
        const n = idNumber(id);
        if (n !== null && n >= nextId) nextId = n + 1;
      }
      const r: MapRoom = { ...clone(room), id, exits: {} };
      for (const [k, e] of Object.entries(room.exits ?? {})) r.exits[k] = { ...clone(e), key: e.key ?? k };
      rooms.set(id, r);
      index(r);
      touchRoom(r);
      return r;
    });
  }
  function update(id: string, patch: Partial<Omit<MapRoom, 'id'>>): MapRoom | undefined {
    const r = rooms.get(id);
    if (!r) return undefined;
    return mutate('edit room', () => {
      unindex(r);
      const p = clone(patch) as Partial<MapRoom>;
      delete p.id;
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) delete (r as unknown as Record<string, unknown>)[k];
        else (r as unknown as Record<string, unknown>)[k] = v;
      }
      index(r);
      touchRoom(r);
      return r;
    });
  }
  function dropLinksTo(id: string, except?: string): void {
    for (const { room, exit } of incoming(id)) {
      if (room.id === except) continue;
      exit.to = null;
      touchRoom(room);
    }
  }
  function remove(id: string): void {
    const r = rooms.get(id);
    if (!r) return;
    mutate('delete room', () => {
      unindex(r);
      rooms.delete(id);
      touch('rooms', [id]);
      dropLinksTo(id);
    });
  }
  function merge(from: string, into: string): void {
    const a = rooms.get(from), b = rooms.get(into);
    if (!a || !b || from === into) return;
    mutate('merge rooms', () => {
      unindex(a); unindex(b);
      for (const [k, e] of Object.entries(a.exits)) if (!b.exits[k]) b.exits[k] = { ...e };
      for (const e of Object.values(b.exits)) if (e.to === from || e.to === into) e.to = null;
      for (const { room, exit } of incoming(from)) {
        if (room.id === from) continue;
        exit.to = room.id === into ? null : into;
        touchRoom(room);
      }
      if (a.note) b.note = b.note ? `${b.note}\n${a.note}` : a.note;
      if (a.tags?.length) b.tags = [...new Set([...(b.tags ?? []), ...a.tags])];
      if (!b.color && a.color) b.color = a.color;
      if (!b.symbol && a.symbol) b.symbol = a.symbol;
      if (!b.vnum && a.vnum) b.vnum = a.vnum;
      if (!b.sig && a.sig) b.sig = a.sig;
      rooms.delete(from);
      index(b);
      touch('rooms', [from]);
      touchRoom(b);
    });
  }
  function move(ids: string[], dx: number, dy: number, dz = 0, area?: string): boolean {
    const set = new Set(ids);
    const moving = ids.map((id) => rooms.get(id)).filter((r): r is MapRoom => !!r);
    if (!moving.length) return false;
    const targets = new Set<string>();
    for (const r of moving) {
      const ck = cellKey(area ?? r.area, r.x + dx, r.y + dy, r.z + dz);
      const occupant = cells.get(ck);
      if ((occupant !== undefined && !set.has(occupant)) || targets.has(ck)) return false;
      targets.add(ck);
    }
    if (dx === 0 && dy === 0 && dz === 0 && (area === undefined || moving.every((r) => r.area === area))) return true;
    mutate('move rooms', () => {
      for (const r of moving) unindex(r);
      for (const r of moving) {
        r.x += dx; r.y += dy; r.z += dz;
        if (area !== undefined) r.area = area;
        index(r);
        touchRoom(r);
      }
    });
    return true;
  }
  function setExit(roomId: string, exit: MapExit): void {
    const r = rooms.get(roomId);
    if (!r || !exit.key) return;
    mutate('edit exit', () => {
      unindex(r);
      r.exits[exit.key] = clone(exit);
      if (r.exits[exit.key].to === undefined) r.exits[exit.key].to = null;
      index(r);
      touchRoom(r);
    });
  }
  function removeExit(roomId: string, key: string): void {
    const r = rooms.get(roomId);
    if (!r || !r.exits[key]) return;
    mutate('delete exit', () => {
      unindex(r);
      delete r.exits[key];
      index(r);
      touchRoom(r);
    });
  }
  /** The exit of `room` facing back along `dir` (its key, or its drawn `dir`, is the opposite direction). */
  function facing(room: MapRoom, dir: Dir): MapExit | undefined {
    for (const e of Object.values(room.exits)) {
      const d = parseDir(e.key) ?? (e.dir ? parseDir(e.dir) : null);
      if (d && d.name === dir.opposite) return e;
    }
    return undefined;
  }
  function link(roomId: string, key: string, to: string, opts: { back?: boolean } = {}): void {
    const r = rooms.get(roomId), dest = rooms.get(to);
    if (!r || !dest) return;
    mutate('link exit', () => {
      const e = r.exits[key] ?? (r.exits[key] = { key, to: null });
      if (e.to !== to) { e.to = to; touchRoom(r); }
      if (opts.back && to !== roomId) {
        const d = parseDir(key) ?? (e.dir ? parseDir(e.dir) : null);
        const back = d ? facing(dest, d) : undefined;
        if (back && back.to === null) { back.to = roomId; touchRoom(dest); }
      }
    });
  }
  function unlink(roomId: string, key: string): void {
    const r = rooms.get(roomId);
    const e = r?.exits[key];
    if (!r || !e || e.to === null) return;
    mutate('unlink exit', () => { e.to = null; touchRoom(r); });
  }
  function autoConnect(area?: string): number {
    return mutate('connect exits', () => {
      let n = 0;
      for (const r of rooms.values()) {
        if (area !== undefined && r.area !== area) continue;
        for (const e of Object.values(r.exits)) {
          const d = parseDir(e.key);
          if (!d || (d.dx === 0 && d.dy === 0 && d.dz === 0)) continue;
          const nid = cells.get(cellKey(r.area, r.x + d.dx, r.y + d.dy, r.z + d.dz));
          if (!nid || nid === r.id) continue;
          const nb = rooms.get(nid)!;
          const back = facing(nb, d);
          if (!back) continue;
          if (e.to === null) {
            if (back.to === null) { e.to = nid; back.to = r.id; touchRoom(r); touchRoom(nb); n += 2; }
            else if (back.to === r.id) { e.to = nid; touchRoom(r); n++; }
          } else if (e.to === nid && back.to === null) { back.to = r.id; touchRoom(nb); n++; }
        }
      }
      return n;
    });
  }
  function setArea(area: Partial<MapArea> & { id: string }): MapArea {
    const cur = areas.get(area.id);
    if (!area.id) return cur ?? { id: '', name: '' };
    return mutate('edit area', () => {
      const next: MapArea = { id: area.id, name: area.name ?? cur?.name ?? area.id };
      const note = 'note' in area ? area.note : cur?.note;
      const color = 'color' in area ? area.color : cur?.color;
      if (note) next.note = note;
      if (color) next.color = color;
      if (cur && same(cur, next)) return cur;
      areas.set(area.id, next);
      touch('areas');
      return next;
    });
  }
  function createArea(name: string, fields: Omit<Partial<MapArea>, 'id' | 'name'> = {}): MapArea {
    const base = slug(name) || 'area';
    let id = base;
    for (let n = 2; areas.has(id) || find({ area: id, limit: 1 }).length; n++) id = `${base}-${n}`;
    return setArea({ id, name: name.trim() || id, ...fields });
  }
  function removeArea(id: string, opts: { rooms?: 'delete' | 'move'; to?: string } = {}): void {
    if (!areas.has(id) && !find({ area: id, limit: 1 }).length) return;
    const to = opts.to ?? '';
    if (opts.rooms === 'move' && to === id) return;
    mutate('delete area', () => {
      areas.delete(id);
      touch('areas');
      const mine = [...rooms.values()].filter((r) => r.area === id);
      if (opts.rooms === 'move') { relocate(mine, to); return; }
      for (const r of mine) {
        unindex(r);
        rooms.delete(r.id);
        touch('rooms', [r.id]);
        dropLinksTo(r.id);
      }
    });
  }
  /** Rooms into another area: the layout is kept where the cells are free, else the nearest free cell on the floor. */
  function relocate(list: MapRoom[], to: string): void {
    for (const r of list) unindex(r);
    for (const r of list) {
      const free = spiralFree(taken(to), r.x, r.y, r.z);
      r.area = to; r.x = free.x; r.y = free.y; r.z = free.z;
      index(r);
      touchRoom(r);
    }
  }
  function moveToArea(ids: string[], area: string): void {
    const list = ids.map((id) => rooms.get(id)).filter((r): r is MapRoom => !!r && r.area !== area);
    if (!list.length) return;
    mutate('move to area', () => relocate(list, area));
  }
  function areaLinks(id: string, opts: { both?: boolean } = {}): AreaLink[] {
    const out: AreaLink[] = [];
    for (const r of rooms.values()) {
      for (const e of Object.values(r.exits)) {
        if (!e.to) continue;
        const t = rooms.get(e.to);
        if (!t || t.area === r.area) continue;
        if (r.area === id || (opts.both && t.area === id)) out.push({ from: r, exit: e, to: t });
      }
    }
    return out;
  }
  function areaCounts(): Record<string, number> {
    const out: Record<string, number> = { '': 0 };
    for (const a of areas.keys()) out[a] = 0;
    for (const r of rooms.values()) out[r.area] = (out[r.area] ?? 0) + 1;
    return out;
  }

  /* ── history and io ── */
  function batch<T>(label: string, fn: () => T): T {
    return mutate(label, fn);
  }
  function undo(): string | null {
    const step = undoStack.pop();
    if (!step) return null;
    redoStack.push({ label: step.label, state: snapshot() });
    restore(step.state);
    touch('reset'); scheduleSave(); emit();
    return step.label;
  }
  function redo(): string | null {
    const step = redoStack.pop();
    if (!step) return null;
    undoStack.push({ label: step.label, state: snapshot() });
    restore(step.state);
    touch('reset'); scheduleSave(); emit();
    return step.label;
  }
  function importMap(data: unknown): { rooms: number } {
    const parsed = readMapFile(data);
    mutate('import map', () => { load(parsed); touch('reset'); });
    return { rooms: rooms.size };
  }
  function erase(): void {
    mutate('erase map', () => {
      rooms = new Map(); areas = new Map(); nextId = 1;
      reindexAll();
      touch('reset');
    });
  }

  const store: MapStoreImpl = {
    worldId,
    ready,
    room: (id) => rooms.get(id),
    rooms: () => [...rooms.values()],
    area: (id) => areas.get(id),
    areas: () => [...areas.values()],
    at: (area, x, y, z) => { const id = cells.get(cellKey(area, x, y, z)); return id ? rooms.get(id) : undefined; },
    byVnum: (vnum) => { const id = vnums.get(vnum); return id ? rooms.get(id) : undefined; },
    byHandle: (handle) => { const id = handles.get(handle); return id ? rooms.get(id) : undefined; },
    bySig: (sig) => [...(sigs.get(sig) ?? [])].map((id) => rooms.get(id)!).filter(Boolean),
    find,
    incoming,
    path: (from, to, opts): PathResult => dijkstra(rooms, from, to, opts),
    freeNear: (area, x, y, z) => spiralFree(taken(area), x, y, z),
    freeAlong: (room, dir) => alongFree(taken(room.area), room, dir),
    create, update, remove, merge, move, setExit, removeExit, link, unlink, autoConnect,
    component: (id) => componentOf(rooms, id),
    setArea, createArea, removeArea, moveToArea, areaLinks, areaCounts,
    batch, undo, redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    export: exportData,
    import: importMap,
    erase,
    watch: (fn): Dispose => { watchers.add(fn); return () => { watchers.delete(fn); }; },
    flush,
    dispose: () => { disposed = true; watchers.clear(); void flush(); },
    watcherCount: () => watchers.size,
  };
  return store;
}
