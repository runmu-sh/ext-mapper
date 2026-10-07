/**
 * The tracker: turns scenes (from the sources) and sent commands into positions and map edits, one track per
 * session. Identity runs vnum → exit fingerprint → text signature with dead reckoning → the exit's recorded
 * destination → the room at the dead-reckoned cell; an unknown room is created next to the previous one and
 * linked through the exit taken. The tracker knows nothing about the game's text: sources call `scene`, `moved`
 * and `failed`; the walker listens to its events and emits its own through `emit`.
 */
import type { Dispose } from '@muclient/sdk';
import { slug } from './store';
import { parseDir, sameDir } from './dirs';
import { sigOf } from './hash';
import type { Dir, MapExit, MapRoom, MapStore, MapperEvent, Position, SceneInput, SessionTrack, Tracker } from './types';

export interface TrackerOpts {
  storeFor(worldId: string): MapStore | null;
  worldOf(sid: string): string | null;
  /** The extension's settings, read per world: `autoConnect`, `areasFromGame`, `areaOnEnter`, `keepDesc` (all default true). */
  settings: { get<T>(key: string, worldId: string | null): T };
  now?(): number;
  /** The active profile's move verbs for a world; default {@link DEFAULT_MOVE_VERBS}. */
  moveVerbs?(worldId: string | null): string[] | undefined;
}

/** The tracker with the emitter the walker needs (the contract's `Tracker` has no `emit`). */
export type TrackerImpl = Tracker & { emit(e: MapperEvent): void };

export const DEFAULT_MOVE_VERBS: readonly string[] = ['enter', 'climb', 'board', 'leave', 'exit', 'go'];

const PENDING_TTL_MS = 30_000;
const PENDING_CAP = 20;
/** Source priority: higher wins a session; anything unknown (`lua`, another extension) sits between msdp and text. */
const RANK: Record<string, number> = { gmcp: 5, msdp: 4, text: 2, scene: 1 };
const rank = (s: string): number => RANK[s] ?? 3;

interface Cell { area: string; x: number; y: number; z: number }

interface Track extends SessionTrack {
  /** When each pending entry was pushed, parallel to `pending`. */
  pendingAt: number[];
  /** A move the game confirmed, waiting for its scene. */
  step: { key: string; at: number } | null;
}

interface Found { room: MapRoom; by: Position['by'] }

const lc = (s: string | undefined): string => (s ?? '').trim().toLowerCase();
const sameName = (a: string, b: string): boolean => lc(a) === lc(b);
const atCell = (r: MapRoom, c: Cell): boolean => r.area === c.area && r.x === c.x && r.y === c.y && r.z === c.z;
const zero = (d: Dir): boolean => d.dx === 0 && d.dy === 0 && d.dz === 0;
/** Move commands that go into or out of something rather than along the grid. */
const ENTER_VERB = /^(?:go\s+)?(?:enter|board|embark|disembark|leave|exit)(?:\s|$)/i;

/** The exit of a room a key names: by key, by display name, or the same direction in another form. */
export function exitFor(room: MapRoom, key: string): MapExit | undefined {
  const k = lc(key);
  if (!k) return undefined;
  const list = Object.values(room.exits);
  return list.find((e) => lc(e.key) === k) ?? list.find((e) => lc(e.name) === k) ?? list.find((e) => sameDir(e.key, k));
}

export function createTracker(opts: TrackerOpts): TrackerImpl {
  const now = opts.now ?? (() => Date.now());
  const tracks = new Map<string, Track>();
  const listeners = new Set<(e: MapperEvent) => void>();

  const setting = (key: string, worldId: string | null, fallback: boolean): boolean => {
    const v = opts.settings.get<boolean | undefined>(key, worldId);
    return typeof v === 'boolean' ? v : fallback;
  };

  function emit(e: MapperEvent): void {
    for (const fn of [...listeners]) fn(e);
  }
  function plain(t: Track): SessionTrack {
    return { sid: t.sid, worldId: t.worldId, position: { ...t.position }, pending: [...t.pending], lastScene: t.lastScene, paused: t.paused, source: t.source };
  }
  function emitTrack(t: Track): void {
    emit({ type: 'track', sid: t.sid, track: plain(t) });
  }
  function ensure(sid: string, worldId?: string | null): Track | null {
    let t = tracks.get(sid);
    if (t) return t;
    const w = worldId ?? opts.worldOf(sid);
    if (!w) return null;
    t = { sid, worldId: w, position: { roomId: null, by: 'none' }, pending: [], pendingAt: [], lastScene: null, paused: false, source: '', step: null };
    tracks.set(sid, t);
    return t;
  }
  function storeOf(t: Track): MapStore | null {
    return opts.storeFor(t.worldId);
  }
  function expire(t: Track): void {
    const cut = now() - PENDING_TTL_MS;
    while (t.pendingAt.length && t.pendingAt[0] < cut) { t.pending.shift(); t.pendingAt.shift(); }
    if (t.step && t.step.at < cut) t.step = null;
  }
  function current(t: Track, store: MapStore): MapRoom | null {
    const r = t.position.roomId ? store.room(t.position.roomId) : undefined;
    if (!r) t.position = { roomId: null, by: 'none' };
    return r ?? null;
  }

  /* ── exits ── */

  function newExit(store: MapStore, ie: NonNullable<SceneInput['exits']>[number]): MapExit {
    const e: MapExit = { key: ie.key, to: null };
    if (ie.name && lc(ie.name) !== lc(ie.key)) e.name = ie.name;
    if (ie.handle) e.handle = ie.handle;
    if (ie.door) e.door = ie.door;
    if (ie.to) { const r = store.byVnum(ie.to); if (r) e.to = r.id; }
    return e;
  }
  /** The room's exits with the scene's folded in; null when nothing changes. `replace` drops every unlisted exit. */
  function mergedExits(store: MapStore, room: MapRoom, input: SceneInput, replace = false): Record<string, MapExit> | null {
    if (!input.exits) return null;
    const out: Record<string, MapExit> = {};
    for (const [k, e] of Object.entries(room.exits)) out[k] = { ...e };
    const kept = new Set<string>();
    for (const ie of input.exits) {
      if (!ie.key) continue;
      const have = exitFor({ ...room, exits: out }, ie.key) ?? (ie.name ? exitFor({ ...room, exits: out }, ie.name) : undefined);
      if (have) {
        let e = out[have.key];
        // The same direction under another spelling (`north` from the text, `n` from GMCP): the game's newest key wins.
        if (have.key !== ie.key && lc(have.key) !== lc(ie.name ?? '') && parseDir(ie.key)) { delete out[have.key]; e = { ...e, key: ie.key }; out[ie.key] = e; }
        kept.add(e.key);
        if (ie.name && lc(ie.name) !== lc(e.key)) e.name = ie.name;
        if (ie.handle) e.handle = ie.handle;
        if (ie.door !== undefined) e.door = ie.door;
        if (e.to === null && ie.to) { const r = store.byVnum(ie.to); if (r) e.to = r.id; }
      } else {
        out[ie.key] = newExit(store, ie);
        kept.add(ie.key);
      }
    }
    // A complete list drops what the game no longer names, except special exits (`commands`) and a locked room's.
    const drop = replace || (input.exitsComplete === true && !room.locked);
    if (drop) for (const k of Object.keys(out)) if (!kept.has(k) && !out[k].commands?.length) delete out[k];
    return JSON.stringify(out) === JSON.stringify(room.exits) ? null : out;
  }

  /** Fold a scene into a known room: name (not when locked), desc, sig, env, area (when the cell is free there), exits. */
  function adopt(store: MapStore, t: Track, room: MapRoom, input: SceneInput, areaId: string): void {
    const patch: Partial<Omit<MapRoom, 'id'>> = {};
    const name = !room.locked && input.name && input.name !== room.name ? input.name : room.name;
    if (name !== room.name) patch.name = name;
    if (input.vnum && room.vnum !== input.vnum) patch.vnum = input.vnum;
    const keepDesc = setting('keepDesc', t.worldId, true);
    if (input.desc !== undefined && keepDesc && input.desc !== room.desc) patch.desc = input.desc;
    const sig = input.desc !== undefined ? sigOf(name, input.desc) : !room.sig || name !== room.name ? sigOf(name, room.desc) : room.sig;
    if (sig !== room.sig) patch.sig = sig;
    if (input.env && input.env !== room.env) patch.env = input.env;
    if (areaId !== room.area && !room.locked && !store.at(areaId, room.x, room.y, room.z)) patch.area = areaId;
    const exits = mergedExits(store, room, input);
    if (exits) patch.exits = exits;
    if (Object.keys(patch).length) store.update(room.id, patch);
  }

  function createFor(store: MapStore, t: Track, input: SceneInput, cell: Cell, warn?: string): MapRoom {
    const exits: Record<string, MapExit> = {};
    for (const ie of input.exits ?? []) if (ie.key) exits[ie.key] = newExit(store, ie);
    const room: Omit<MapRoom, 'id'> = { name: input.name, area: cell.area, x: cell.x, y: cell.y, z: cell.z, exits, sig: sigOf(input.name, input.desc) };
    if (input.vnum) room.vnum = input.vnum;
    if (input.desc !== undefined && setting('keepDesc', t.worldId, true)) room.desc = input.desc;
    if (input.env) room.env = input.env;
    if (warn) room.warn = warn;
    return store.create(room);
  }

  /* ── the scene ── */

  function identify(store: MapStore, input: SceneInput, sig: string, expected: Cell | null, used: MapExit | undefined, prev: MapRoom | null, stationary: boolean): Found | null {
    // (1) the game's own id: known → that room. Unknown → the other strategies, but never a room with another vnum.
    if (input.vnum) {
      const r = store.byVnum(input.vnum);
      if (r) return { room: r, by: 'vnum' };
    }
    const ok = (r: MapRoom | undefined): r is MapRoom => !!r && (!input.vnum || !r.vnum || r.vnum === input.vnum);
    // (1b) nothing was sent and the name is the current room's: a look, or a better source describing the same room
    // (the room text often lands before the first GMCP Room.Info).
    if (stationary && prev && ok(prev) && sameName(prev.name, input.name)) return { room: prev, by: 'signature' };
    // (2) exit handles: majority vote of their owners.
    const votes = new Map<string, number>();
    for (const e of input.exits ?? []) {
      if (!e.handle) continue;
      const r = store.byHandle(e.handle);
      if (ok(r)) votes.set(r.id, (votes.get(r.id) ?? 0) + 1);
    }
    if (votes.size) {
      let best: string[] = [], max = 0;
      for (const [id, n] of votes) { if (n > max) { max = n; best = [id]; } else if (n === max) best.push(id); }
      let pick = best[0];
      if (best.length > 1 && expected) { const at = store.at(expected.area, expected.x, expected.y, expected.z); if (at && best.includes(at.id)) pick = at.id; }
      return { room: store.room(pick)!, by: 'fingerprint' };
    }
    // (3) the signature, preferring the dead-reckoned cell, then the exit's destination, then the nearest. Without a
    // description the signature is the name alone, which is weak: the candidate must then be at the dead-reckoned
    // cell, the exit's recorded destination, or a room linked with the previous one.
    // A described scene also matches a room of that name that has no description yet (mapped from GMCP alone).
    const byName = (): MapRoom[] => store.rooms().filter((r) => sameName(r.name, input.name));
    let cands = (input.desc ? store.bySig(sig) : byName()).filter(ok);
    if (!cands.length && input.desc) cands = byName().filter((r) => !r.desc).filter(ok);
    if (cands.length) {
      const at = expected ? cands.find((c) => atCell(c, expected)) : undefined;
      if (at) return { room: at, by: 'signature' };
      const via = used?.to ? cands.find((c) => c.id === used.to) : undefined;
      if (via) return { room: via, by: 'signature' };
      if (input.desc) {
        const origin = prev ?? (expected ? { area: expected.area, x: expected.x, y: expected.y, z: expected.z } : null);
        const floor = origin ? cands.filter((c) => c.area === origin.area && c.z === origin.z) : cands;
        if (!origin) return { room: cands[0], by: 'signature' };
        let nearest: MapRoom | undefined, best = Infinity;
        for (const c of floor) { const d = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y); if (d < best) { best = d; nearest = c; } }
        if (nearest) return { room: nearest, by: 'signature' };
      } else if (prev) {
        const linked = cands.find((c) => Object.values(c.exits).some((e) => e.to === prev.id) || Object.values(prev.exits).some((e) => e.to === c.id));
        if (linked) return { room: linked, by: 'signature' };
      }
    }
    // (4) where the exit taken led last time, when the name agrees.
    if (used?.to) { const r = store.room(used.to); if (ok(r) && sameName(r.name, input.name)) return { room: r, by: 'signature' }; }
    // (5) whatever sits at the dead-reckoned cell, when the name agrees.
    if (expected) { const r = store.at(expected.area, expected.x, expected.y, expected.z); if (ok(r) && sameName(r.name, input.name)) return { room: r, by: 'signature' }; }
    return null;
  }

  function placeNew(store: MapStore, input: SceneInput, areaId: string, prev: MapRoom | null, dir: Dir | null, key: string | null): { cell: Cell; warn?: string } {
    if (input.coords) {
      const c = { area: areaId, x: input.coords.x, y: input.coords.y, z: input.coords.z };
      if (!store.at(c.area, c.x, c.y, c.z)) return { cell: c };
      return { cell: { area: areaId, ...store.freeNear(areaId, c.x, c.y, c.z) }, warn: 'displaced (cell was taken)' };
    }
    if (prev && prev.area === areaId) {
      if (dir && !zero(dir)) {
        const c = { area: areaId, x: prev.x + dir.dx, y: prev.y + dir.dy, z: prev.z + dir.dz };
        if (!store.at(c.area, c.x, c.y, c.z)) return { cell: c };
        return { cell: { area: areaId, ...store.freeAlong(prev, dir) }, warn: 'displaced (cell was taken)' };
      }
      return { cell: { area: areaId, ...store.freeNear(areaId, prev.x + 1, prev.y + 1, prev.z) }, warn: key ? `reached via "${key}"` : 'teleport?' };
    }
    if (!store.find({ area: areaId, limit: 1 }).length) return { cell: { area: areaId, x: 0, y: 0, z: 0 } };
    return { cell: { area: areaId, ...store.freeNear(areaId, 0, 0, 0) }, warn: 'unanchored' };
  }

  function scene(input: SceneInput): void {
    const t = ensure(input.sid);
    if (!t) return;
    const store = storeOf(t);
    if (!store) return;
    // Source priority: a lower source may only complete the exits of the incomplete scene the better one reported.
    if (t.source && rank(input.source) < rank(t.source)) {
      const completing = !!t.lastScene && t.lastScene.exitsComplete !== true && input.exitsComplete === true && sameName(input.name, t.lastScene.name);
      if (!completing) return;
      const here = current(t, store);
      if (here) {
        t.lastScene = input;
        if (!t.paused && input.replay !== true) store.batch('move', () => adopt(store, t, here, input, here.area));
        emitTrack(t);
        return;
      }
    } else t.source = input.source;
    expire(t);
    const prev = current(t, store);
    const prevScene = t.lastScene;
    const locateOnly = input.replay === true || t.paused;
    // The move key: a confirmed step wins, else the oldest pending command. A replay has no move.
    let key: string | null = null, confirmed = false;
    if (input.replay !== true) {
      if (t.step) { key = t.step.key; confirmed = true; } else if (t.pending.length) key = t.pending[0];
    }
    const used = prev && key !== null ? exitFor(prev, key) : undefined;
    const dir = (key !== null ? parseDir(key) : null) ?? (used?.dir ? parseDir(used.dir) : null);
    const areasFromGame = setting('areasFromGame', t.worldId, true);
    let areaId = areasFromGame && input.area ? slug(input.area) : '';
    // `in` / `out`, `enter <x>`, `board`, `leave`: a move into or out of something, with no place on the grid. When
    // the game names no area and the room is new, it opens its own area (named after the room) rather than being
    // dropped diagonally beside the previous one; the exit taken links the two areas. A named exit such as
    // Underspire's `market (m)` is ordinary movement and stays in the area.
    const enters = prev !== null && key !== null && !input.coords && !(areasFromGame && input.area) && (dir ? zero(dir) : ENTER_VERB.test(key));
    const newArea = enters && setting('areaOnEnter', t.worldId, true) ? input.name : null;
    // Without a game-named area, an ordinary move stays in the previous room's area (a room-named one included).
    if (!areaId && prev && !enters) areaId = prev.area;
    const sig = sigOf(input.name, input.desc);
    let expected: Cell | null = null;
    if (input.coords) expected = { area: areaId, ...input.coords };
    else if (prev && prev.area === areaId) {
      if (key === null) expected = { area: areaId, x: prev.x, y: prev.y, z: prev.z };
      else if (dir) expected = { area: areaId, x: prev.x + dir.dx, y: prev.y + dir.dy, z: prev.z + dir.dz };
    }
    const found = identify(store, input, sig, expected, used, prev, key === null);
    t.lastScene = input;

    // Same room: refresh what the game lists, consume nothing.
    if (found && prev && found.room.id === prev.id) {
      if (!locateOnly) store.batch('move', () => adopt(store, t, found.room, input, areaId || found.room.area));
      emitTrack(t);
      return;
    }
    // A move: consume the key.
    if (key !== null) {
      if (confirmed) t.step = null;
      else { t.pending.shift(); t.pendingAt.shift(); }
    }
    if (locateOnly) {
      if (found) {
        t.position = { roomId: found.room.id, by: found.by };
        emit({ type: 'enter', sid: t.sid, room: found.room, prev, via: key, by: found.by });
      } else {
        t.position = { roomId: null, by: 'none' };
        emit({ type: 'lost', sid: t.sid, scene: input });
      }
      emitTrack(t);
      return;
    }
    let dest!: MapRoom;
    let created = false;
    store.batch('move', () => {
      if (areaId && areasFromGame && input.area && !store.area(areaId)) store.setArea({ id: areaId, name: input.area });
      // A known room changes area only on the game's word, never by inheriting the previous room's.
      if (found) { adopt(store, t, found.room, input, areasFromGame && input.area ? areaId : found.room.area); dest = store.room(found.room.id)!; }
      else {
        if (newArea !== null) areaId = store.createArea(newArea).id;
        const { cell, warn } = placeNew(store, input, areaId, prev, dir, key);
        dest = createFor(store, t, input, cell, warn);
        created = true;
      }
      if (prev && key !== null && prev.id !== dest.id) {
        const prevIncomplete = !prevScene || prevScene.exitsComplete !== true;
        const ex = used ?? ((key !== null && parseDir(key)) || prevIncomplete ? { key, to: null } : undefined);
        if (ex) store.link(prev.id, ex.key, dest.id, { back: true });
      }
      if (setting('autoConnect', t.worldId, true)) store.autoConnect(dest.area);
    });
    dest = store.room(dest.id) ?? dest;
    const by: Position['by'] = created ? 'created' : found!.by;
    t.position = { roomId: dest.id, by };
    if (created) emit({ type: 'created', sid: t.sid, room: dest, via: key });
    emit({ type: 'enter', sid: t.sid, room: dest, prev, via: key, by });
    emitTrack(t);
  }

  /* ── commands ── */

  function moved(sid: string, key: string, o: { confirmed?: boolean } = {}): void {
    const t = ensure(sid);
    if (!t) return;
    const k = key.trim();
    if (!k) return;
    expire(t);
    if (o.confirmed) {
      const i = t.pending.findIndex((p) => lc(p) === lc(k) || sameDir(p, k));
      if (i >= 0) { t.pending.splice(i, 1); t.pendingAt.splice(i, 1); }
      t.step = { key: k, at: now() };
    } else {
      t.pending.push(k);
      t.pendingAt.push(now());
      while (t.pending.length > PENDING_CAP) { t.pending.shift(); t.pendingAt.shift(); }
    }
    emit({ type: 'moved', sid, key: k });
    emitTrack(t);
  }

  function failed(sid: string, text: string, key?: string | null): void {
    const t = ensure(sid);
    if (!t) return;
    let k: string | null = key ?? null;
    if (k !== null) {
      const i = t.pending.findIndex((p) => lc(p) === lc(k!) || sameDir(p, k!));
      if (i < 0 && t.pending.length && !(t.step && (lc(t.step.key) === lc(k) || sameDir(t.step.key, k)))) k = t.pending[0];
    } else k = t.step?.key ?? t.pending[0] ?? null;
    t.pending = [];
    t.pendingAt = [];
    t.step = null;
    emit({ type: 'failed', sid, key: k, text });
    emitTrack(t);
  }

  function anchor(sid: string, roomId: string): void {
    const t = ensure(sid);
    if (!t) return;
    const store = storeOf(t);
    const room = store?.room(roomId);
    if (!store || !room) return;
    const scene = t.lastScene;
    store.batch('anchor', () => {
      // `update` clones its patch through JSON, which drops `undefined`: clear the warning with ''.
      const patch: Partial<Omit<MapRoom, 'id'>> = { warn: '' };
      if (scene) {
        const exits = mergedExits(store, room, scene, true);
        if (exits) patch.exits = exits;
        if (scene.vnum) patch.vnum = scene.vnum;
        patch.sig = sigOf(room.locked ? room.name : scene.name, scene.desc ?? room.desc);
        if (scene.desc !== undefined && setting('keepDesc', t.worldId, true)) patch.desc = scene.desc;
      }
      store.update(roomId, patch);
    });
    const prev = current(t, store);
    t.pending = []; t.pendingAt = []; t.step = null;
    t.position = { roomId, by: 'anchor' };
    emit({ type: 'enter', sid, room: store.room(roomId)!, prev, via: null, by: 'anchor' });
    emitTrack(t);
  }

  function createHere(sid: string, cell: { area: string; x: number; y: number; z: number }): MapRoom | null {
    const t = ensure(sid);
    if (!t) return null;
    const store = storeOf(t);
    if (!store || !t.lastScene) return null;
    const scene = t.lastScene;
    const prev = current(t, store);
    const room = store.batch('new room', () => {
      if (cell.area && !store.area(cell.area)) store.setArea({ id: cell.area, name: scene.area ?? cell.area });
      const free = store.at(cell.area, cell.x, cell.y, cell.z) ? { area: cell.area, ...store.freeNear(cell.area, cell.x, cell.y, cell.z) } : cell;
      return createFor(store, t, scene, free);
    });
    t.pending = []; t.pendingAt = []; t.step = null;
    t.position = { roomId: room.id, by: 'created' };
    emit({ type: 'created', sid, room, via: null });
    emit({ type: 'enter', sid, room, prev, via: null, by: 'created' });
    emitTrack(t);
    return room;
  }

  function pause(sid: string, paused: boolean): void {
    const t = ensure(sid);
    if (!t || t.paused === paused) return;
    t.paused = paused;
    emitTrack(t);
  }

  function isMove(sid: string, key: string): boolean {
    let k = lc(key);
    if (k.startsWith('go ')) k = k.slice(3).trim();
    if (!k) return false;
    if (parseDir(k)) return true;
    const t = tracks.get(sid);
    const worldId = t?.worldId ?? opts.worldOf(sid);
    const store = t ? storeOf(t) : null;
    const room = t && store ? current(t, store) : null;
    if (room) for (const e of Object.values(room.exits)) if (lc(e.key) === k || lc(e.name) === k) return true;
    for (const v of opts.moveVerbs?.(worldId) ?? DEFAULT_MOVE_VERBS) {
      const vl = lc(v);
      if (vl && (k === vl || k.startsWith(`${vl} `))) return true;
    }
    return false;
  }

  return {
    track: (sid) => { const t = tracks.get(sid); return t ? plain(t) : undefined; },
    tracks: () => [...tracks.values()].map(plain),
    scene, moved, failed, anchor, createHere, pause, isMove,
    on: (fn): Dispose => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    drop: (sid) => { tracks.delete(sid); },
    emit,
  };
}
