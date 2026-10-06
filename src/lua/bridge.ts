/**
 * The Lua bridge: `ext.emit("mapper.call", { id, fn, args })` from a session's Lua is dispatched to the store,
 * tracker or walker of that session's world and answered with `mapper.reply { id, ok, result | error }`.
 * Sessions that asked (`events(true)`) also get `mapper.event { type, ... }` for every tracker event, at most
 * `EVENTS_PER_S` per second (the rest are dropped and counted; `track()` reports the count).
 *
 * Validation lives here in one place: every argument a script can get wrong answers `{ ok: false, error:
 * 'mapper.<fn>: <what>' }` and never throws into the host. The function table is `api.ts`.
 */
import type { Dispose, Mu } from '@muclient/sdk';
import { dirByName } from '../dirs';
import { LUA_API, luaHelp } from './api';
import { ROOM_COLORS, type DirName, type FindQuery, type LuaCall, type LuaReply, type LuaRoom, type MapArea, type MapData, type MapExit, type MapRoom, type MapStore, type MapperEvent, type PathResult, type RoomColor, type SceneInput, type SessionTrack, type Tracker, type WalkOptions, type WalkState, type Walker } from '../types';

export interface BridgeDeps {
  mu: Mu;
  storeFor(worldId: string): MapStore | null;
  worldOf(sid: string): string | null;
  tracker: Tracker;
  walker: Walker;
  version: string;
}

export const EVENTS_PER_S = 50;
export const EXPORT_LIMIT_BYTES = 60 * 1024;

/* ────────────────────────────── conversions ────────────────────────────── */

/** A room for Lua: flat fields, exits as `{ key = to or false }` (never null: a JSON null drops the key in Lua). */
export function toLuaRoom(r: MapRoom): LuaRoom {
  const exits: Record<string, string | false> = {};
  for (const [k, e] of Object.entries(r.exits)) exits[k] = e.to ?? false;
  const out: LuaRoom = {
    id: r.id, name: r.name, area: r.area, x: r.x, y: r.y, z: r.z, exits,
    tags: [...(r.tags ?? [])], note: r.note ?? '', symbol: r.symbol ?? '', color: r.color ?? '', env: r.env ?? '', locked: !!r.locked,
  };
  if (r.vnum !== undefined) out.vnum = r.vnum;
  if (r.desc !== undefined) out.desc = r.desc;
  return out;
}

/** An area for Lua: every field present (empty strings, never nil), with its room count. */
export function toLuaArea(a: MapArea, rooms: number): LuaArea {
  return { id: a.id, name: a.id ? a.name : '', note: a.note ?? '', color: a.color ?? '', rooms };
}
export interface LuaArea { id: string; name: string; note: string; color: string; rooms: number }

/** An area by id (`''` is the default area, which exists while rooms use it). */
function areaOf(store: MapStore, id: unknown): MapArea | undefined {
  const aid = str(id, 'id');
  const a = store.area(aid);
  if (a) return a;
  return store.find({ area: aid, limit: 1 }).length ? { id: aid, name: aid } : undefined;
}
function areaFields(t: Obj): Omit<Partial<MapArea>, 'id' | 'name'> {
  const out: Omit<Partial<MapArea>, 'id' | 'name'> = {};
  if ('note' in t) out.note = t.note === null ? undefined : str(t.note, 'note') || undefined;
  if ('color' in t) out.color = t.color === null ? undefined : (color(t.color) || undefined);
  for (const k of Object.keys(t)) if (!['name', 'note', 'color'].includes(k)) bad(`unknown area field "${k}"`);
  return out;
}

function toLuaPath(p: PathResult): { ids: string[]; steps: string[]; cost: number } | null {
  return p ? { ids: p.ids, steps: p.steps.flat(), cost: p.cost } : null;
}

function toLuaWalk(w: WalkState): WalkState { return { status: w.status, target: w.target, route: [...w.route], at: w.at, ...(w.reason !== undefined ? { reason: w.reason } : {}) }; }

/* ────────────────────────────── validation ────────────────────────────── */

class ArgError extends Error {}
const bad = (what: string): never => { throw new ArgError(what); };
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Lua's `{}` arrives as `{}` or `[]`: both read as an empty table. */
const table = (v: unknown, what: string): Obj => (v === undefined || v === null ? {} : Array.isArray(v) && v.length === 0 ? {} : isObj(v) ? v : bad(`${what} must be a table`));
const str = (v: unknown, what: string): string => (typeof v === 'string' ? v : bad(`${what} must be a string`));
const nonEmpty = (v: unknown, what: string): string => (typeof v === 'string' && v.trim() ? v : bad(`${what} must be a non-empty string`));
const optStr = (v: unknown, what: string): string | undefined => (v === undefined || v === null ? undefined : str(v, what));
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : bad(`${what} must be a number`));
const int = (v: unknown, what: string): number => Math.trunc(num(v, what));
const optInt = (v: unknown, what: string): number | undefined => (v === undefined || v === null ? undefined : int(v, what));
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : bad(`${what} must be true or false`));
const optBool = (v: unknown, what: string): boolean | undefined => (v === undefined || v === null ? undefined : bool(v, what));
const strList = (v: unknown, what: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) bad(`${what} must be a list of strings`);
  return v as string[];
};
const color = (v: unknown): RoomColor => ((ROOM_COLORS as readonly string[]).includes(str(v, 'color')) ? (v as RoomColor) : bad(`color must be one of ${ROOM_COLORS.filter(Boolean).join(', ')} or ""`));
const symbol = (v: unknown): string => ([...str(v, 'symbol')].length <= 2 ? (v as string) : bad('symbol must be at most 2 characters'));
const dirName = (v: unknown): DirName => (dirByName(str(v, 'dir')) ? (v as DirName) : bad(`dir must be a direction name such as "north"`));
const DOORS = ['', 'open', 'closed', 'locked'];
const door = (v: unknown): MapExit['door'] => (DOORS.includes(str(v, 'door')) ? (v as MapExit['door']) : bad('door must be "", "open", "closed" or "locked"'));

/** Fields of `set`/`add` a script may write, with their checks. */
const ROOM_FIELDS: Record<string, (v: unknown) => unknown> = {
  name: (v) => nonEmpty(v, 'name'), vnum: (v) => str(v, 'vnum'), area: (v) => str(v, 'area'),
  x: (v) => int(v, 'x'), y: (v) => int(v, 'y'), z: (v) => int(v, 'z'),
  desc: (v) => str(v, 'desc'), env: (v) => str(v, 'env'), note: (v) => str(v, 'note'), warn: (v) => str(v, 'warn'),
  tags: (v) => strList(v, 'tags'), symbol, color, weight: (v) => num(v, 'weight'), locked: (v) => bool(v, 'locked'),
};
const CLEARED: Record<string, unknown> = { vnum: '', desc: '', env: '', note: '', warn: '', symbol: '', color: '', tags: [], locked: false };
function roomPatch(raw: unknown, what: string): Partial<Omit<MapRoom, 'id' | 'exits'>> {
  const t = table(raw, what);
  const out: Obj = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === 'exits') continue;
    const check = ROOM_FIELDS[k];
    if (!check) bad(`unknown field "${k}"`);
    if (k === 'id') bad('id cannot be changed');
    // Lua cannot send nil in a table (the key vanishes), so "" clears a text field and {} clears the tags.
    out[k] = v === null ? CLEARED[k] ?? bad(`${k} cannot be null`) : check(v);
  }
  return out as Partial<Omit<MapRoom, 'id' | 'exits'>>;
}

const walkOpts = (raw: unknown): WalkOptions => {
  const t = table(raw, 'options');
  const o: WalkOptions = {};
  if (t.mode !== undefined && t.mode !== null) { if (t.mode !== 'step' && t.mode !== 'burst') bad('mode must be "step" or "burst"'); o.mode = t.mode as WalkOptions['mode']; }
  const delayMs = optInt(t.delayMs, 'delayMs'); if (delayMs !== undefined) o.delayMs = delayMs;
  const timeoutS = optInt(t.timeoutS, 'timeoutS'); if (timeoutS !== undefined) o.timeoutS = timeoutS;
  const locked = optBool(t.locked, 'locked'); if (locked !== undefined) o.locked = locked;
  return o;
};

/** The args list; a Lua table with a nil hole (`{ "a", nil, 3 }`) arrives as `{ "1": "a", "3": 3 }` and is put back. */
function argList(raw: unknown): unknown[] | null {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  if (!isObj(raw)) return null;
  const keys = Object.keys(raw);
  if (!keys.every((k) => /^[1-9]\d*$/.test(k))) return keys.length ? null : [];
  const out: unknown[] = [];
  for (const k of keys) out[Number(k) - 1] = raw[k];
  return out;
}

/* ────────────────────────────── the bridge ────────────────────────────── */

interface Session { sid: string; events: boolean; dropped: number; window: number; sent: number }

export function luaBridge(deps: BridgeDeps): Dispose {
  const { mu, tracker, walker } = deps;
  const sessions = new Map<string, Session>();
  const pendingWalks = new Set<{ settle(): void }>();
  let disposed = false;

  const session = (sid: string): Session => {
    let s = sessions.get(sid);
    if (!s) sessions.set(sid, (s = { sid, events: false, dropped: 0, window: 0, sent: 0 }));
    return s;
  };
  const emit = (sid: string, name: string, data: unknown): void => {
    if (disposed) return;
    void Promise.resolve(mu.lua.emit(name, data, { sid })).catch((e: unknown) => mu.log.warn('Mapper', 'lua emit failed', e));
  };

  /* ── context of one call ── */
  interface Ctx { sid: string; store: MapStore; inBatch: boolean }
  const storeOf = (sid: string): MapStore => {
    const worldId = deps.worldOf(sid);
    const store = worldId ? deps.storeFor(worldId) : null;
    return store ?? bad('no map for this session');
  };
  const roomOf = (store: MapStore, id: unknown, what = 'id'): MapRoom => store.room(nonEmpty(id, what)) ?? bad(`no room ${String(id)}`);
  const hereOf = (c: Ctx): MapRoom | null => { const id = tracker.track(c.sid)?.position.roomId; return id ? c.store.room(id) ?? null : null; };
  const luaTrack = (c: Ctx): Obj => {
    const t: SessionTrack | undefined = tracker.track(c.sid);
    return { roomId: t?.position.roomId ?? null, by: t?.position.by ?? 'none', pending: [...(t?.pending ?? [])], paused: !!t?.paused, source: t?.source ?? '', dropped: session(c.sid).dropped };
  };

  function exitsOfAdd(raw: unknown, store: MapStore): Record<string, MapExit> {
    const out: Record<string, MapExit> = {};
    for (const [key, to] of Object.entries(table(raw, 'exits'))) {
      if (!key.trim()) bad('exit key must be a non-empty string');
      if (to === true) out[key] = { key, to: null };
      else if (typeof to === 'string') { if (!store.room(to)) bad(`exit ${key}: no room ${to}`); out[key] = { key, to }; }
      else bad(`exit ${key} must be a room id or true`);
    }
    return out;
  }
  function sceneExits(raw: unknown): SceneInput['exits'] {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw)) return raw.map((k) => ({ key: nonEmpty(k, 'exit key') }));
    const out: NonNullable<SceneInput['exits']> = [];
    for (const [key, to] of Object.entries(table(raw, 'exits'))) {
      if (!key.trim()) bad('exit key must be a non-empty string');
      if (to === true) out.push({ key });
      else if (typeof to === 'string' || typeof to === 'number') out.push({ key, to: String(to) });
      else bad(`exit ${key} must be a vnum or true`);
    }
    return out;
  }

  /* ── the functions; each returns a value or a promise of one ── */
  type Fn = (c: Ctx, a: unknown[]) => unknown;
  const fns: Record<string, Fn> = {
    version: () => deps.version,
    here: (c) => { const r = hereOf(c); return r ? toLuaRoom(r) : null; },
    room: (c, [id]) => { const r = c.store.room(nonEmpty(id, 'id')); return r ? toLuaRoom(r) : null; },
    rooms: (c, [q]) => {
      const t = table(q, 'query');
      const fq: FindQuery = {};
      const name = optStr(t.name, 'name'); if (name !== undefined) fq.name = name;
      const area = optStr(t.area, 'area'); if (area !== undefined) fq.area = area;
      const tag = optStr(t.tag, 'tag'); if (tag !== undefined) fq.tag = tag;
      if (t.vnum !== undefined && t.vnum !== null) fq.vnum = typeof t.vnum === 'number' ? String(t.vnum) : str(t.vnum, 'vnum');
      const limit = optInt(t.limit, 'limit'); if (limit !== undefined) fq.limit = limit;
      if (t.near !== undefined && t.near !== null) { const n = table(t.near, 'near'); fq.near = { roomId: roomOf(c.store, n.id, 'near.id').id, radius: int(n.radius, 'near.radius') }; }
      return c.store.find(fq).map(toLuaRoom);
    },
    byVnum: (c, [v]) => { const r = c.store.byVnum(typeof v === 'number' ? String(v) : nonEmpty(v, 'vnum')); return r ? toLuaRoom(r) : null; },
    at: (c, [area, x, y, z]) => { const r = c.store.at(str(area, 'area'), int(x, 'x'), int(y, 'y'), int(z ?? 0, 'z')); return r ? toLuaRoom(r) : null; },
    areas: (c) => {
      const counts = c.store.areaCounts();
      const out = c.store.areas().map((a) => toLuaArea(a, counts[a.id] ?? 0));
      if (counts[''] && !c.store.area('')) out.unshift(toLuaArea({ id: '', name: '' }, counts['']));
      for (const id of Object.keys(counts)) if (id && !c.store.area(id)) out.push(toLuaArea({ id, name: id }, counts[id]));
      return out;
    },
    area: (c, [id]) => { const a = areaOf(c.store, id); return a ? toLuaArea(a, c.store.areaCounts()[a.id] ?? 0) : null; },
    areaLinks: (c, [id, opts]) => {
      const a = areaOf(c.store, id) ?? bad(`no area ${String(id)}`);
      const both = optBool(table(opts, 'options').both, 'both');
      return c.store.areaLinks(a.id, { both: both ?? false }).map((l) => ({ from: l.from.id, key: l.exit.key, to: l.to.id, fromArea: l.from.area, toArea: l.to.area }));
    },
    path: (c, a) => {
      // path(to) | path(to, opts) | path(from, to) | path(from, to, opts)
      let [from, to, opts] = a;
      if (a.length === 1 || (a.length === 2 && typeof to !== 'string')) { opts = to; to = from; from = undefined; }
      if (from === undefined || from === null) from = hereOf(c)?.id ?? bad('position unknown and no from given');
      const o = table(opts, 'options');
      return toLuaPath(c.store.path(roomOf(c.store, from, 'from').id, roomOf(c.store, to, 'to').id, { ...(o.locked !== undefined ? { locked: bool(o.locked, 'locked') } : {}), avoid: strList(o.avoid, 'avoid') }));
    },
    incoming: (c, [id]) => c.store.incoming(roomOf(c.store, id).id).map(({ room, exit }) => ({ room: toLuaRoom(room), key: exit.key })),

    add: (c, [spec]) => {
      const t = table(spec, 'room');
      const patch = roomPatch(t, 'room');
      const name = patch.name ?? bad('name is required');
      const exits = exitsOfAdd(t.exits, c.store);
      const here = hereOf(c);
      const area = patch.area ?? here?.area ?? '';
      let cell: { x: number; y: number; z: number };
      if (patch.x !== undefined && patch.y !== undefined) cell = { x: patch.x, y: patch.y, z: patch.z ?? here?.z ?? 0 };
      else cell = c.store.freeNear(area, here?.x ?? 0, here?.y ?? 0, patch.z ?? here?.z ?? 0);
      if (c.store.at(area, cell.x, cell.y, cell.z)) bad(`cell ${cell.x},${cell.y},${cell.z} in area "${area}" is taken`);
      if (patch.vnum !== undefined && c.store.byVnum(patch.vnum)) bad(`vnum ${patch.vnum} is already room ${c.store.byVnum(patch.vnum)!.id}`);
      const { x: _x, y: _y, z: _z, ...rest } = patch;
      return toLuaRoom(c.store.create({ ...rest, name, area, ...cell, exits }));
    },
    set: (c, [id, patch]) => {
      const r = roomOf(c.store, id);
      const p = roomPatch(patch, 'patch');
      if (p.vnum !== undefined) { const o = c.store.byVnum(p.vnum); if (o && o.id !== r.id) bad(`vnum ${p.vnum} is already room ${o.id}`); }
      const nx = p.x ?? r.x, ny = p.y ?? r.y, nz = p.z ?? r.z, na = p.area ?? r.area;
      const occupant = c.store.at(na, nx, ny, nz);
      if (occupant && occupant.id !== r.id) bad(`cell ${nx},${ny},${nz} in area "${na}" is taken by ${occupant.id}`);
      return toLuaRoom(c.store.update(r.id, p)!);
    },
    remove: (c, [id]) => { c.store.remove(roomOf(c.store, id).id); return true; },
    merge: (c, [from, into]) => {
      const a = roomOf(c.store, from, 'from'), b = roomOf(c.store, into, 'into');
      if (a.id === b.id) bad('from and into are the same room');
      c.store.merge(a.id, b.id); return true;
    },
    move: (c, [ids, dx, dy, dz]) => {
      const list = (Array.isArray(ids) ? ids : [ids]).map((id) => roomOf(c.store, id).id);
      return c.store.move(list, int(dx, 'dx'), int(dy, 'dy'), dz === undefined || dz === null ? 0 : int(dz, 'dz'));
    },
    exit: (c, [id, key, spec]) => {
      const r = roomOf(c.store, id);
      const k = nonEmpty(key, 'key');
      const t = table(spec, 'exit');
      const e: MapExit = { ...(r.exits[k] ?? { key: k, to: null }) };
      for (const [f, v] of Object.entries(t)) {
        switch (f) {
          case 'to': e.to = v === false || v === null ? null : roomOf(c.store, v, 'to').id; break;
          case 'name': e.name = str(v, 'name'); break;
          case 'commands': e.commands = strList(v, 'commands'); break;
          case 'cost': e.cost = num(v, 'cost'); break;
          case 'door': e.door = door(v); break;
          case 'oneway': e.oneway = bool(v, 'oneway'); break;
          case 'dir': e.dir = dirName(v); break;
          case 'blocked': e.blocked = bool(v, 'blocked'); break;
          case 'handle': e.handle = str(v, 'handle'); break;
          default: bad(`unknown exit field "${f}"`);
        }
      }
      c.store.setExit(r.id, e);
      return toLuaRoom(c.store.room(r.id)!);
    },
    removeExit: (c, [id, key]) => { const r = roomOf(c.store, id); const k = nonEmpty(key, 'key'); if (!r.exits[k]) bad(`no exit ${k} in ${r.id}`); c.store.removeExit(r.id, k); return true; },
    link: (c, [id, key, to, opts]) => {
      const r = roomOf(c.store, id), dest = roomOf(c.store, to, 'to');
      const back = table(opts, 'options').back;
      c.store.link(r.id, nonEmpty(key, 'key'), dest.id, { back: back === undefined || back === null ? true : bool(back, 'back') });
      return toLuaRoom(c.store.room(r.id)!);
    },
    unlink: (c, [id, key]) => { const r = roomOf(c.store, id); const k = nonEmpty(key, 'key'); if (!r.exits[k]) bad(`no exit ${k} in ${r.id}`); c.store.unlink(r.id, k); return true; },
    addArea: (c, [name, fields]) => { const t = table(fields, 'fields'); return toLuaArea(c.store.createArea(nonEmpty(name, 'name'), areaFields(t)), 0); },
    setArea: (c, [id, fields]) => {
      const aid = str(id, 'id');
      if (!aid) bad('the default area cannot be edited');
      const t = table(fields, 'fields');
      const name = optStr(t.name, 'name');
      const a = c.store.setArea({ id: aid, ...(name !== undefined ? { name: nonEmpty(name, 'name') } : {}), ...areaFields(t) });
      return toLuaArea(a, c.store.areaCounts()[a.id] ?? 0);
    },
    removeArea: (c, [id, opts]) => {
      const a = areaOf(c.store, id) ?? bad(`no area ${String(id)}`);
      if (!a.id) bad('the default area cannot be deleted');
      const o = table(opts, 'options');
      const mode = optStr(o.rooms, 'rooms');
      if (mode !== undefined && mode !== 'delete' && mode !== 'move') bad('rooms must be "delete" or "move"');
      const rooms = mode as 'delete' | 'move' | undefined;
      const to = optStr(o.to, 'to');
      if (to !== undefined && to !== '' && !areaOf(c.store, to)) bad(`no area ${to}`);
      c.store.removeArea(a.id, { rooms: rooms ?? 'move', to });
      return true;
    },
    autoConnect: (c, [area]) => c.store.autoConnect(optStr(area, 'area')),
    tag: (c, [id, tag]) => { const r = roomOf(c.store, id); const t = nonEmpty(tag, 'tag'); const tags = r.tags ?? []; if (!tags.includes(t)) c.store.update(r.id, { tags: [...tags, t] }); return toLuaRoom(c.store.room(r.id)!); },
    untag: (c, [id, tag]) => { const r = roomOf(c.store, id); const t = nonEmpty(tag, 'tag'); if (r.tags?.includes(t)) c.store.update(r.id, { tags: r.tags.filter((x) => x !== t) }); return toLuaRoom(c.store.room(r.id)!); },
    note: (c, [id, text]) => { const r = roomOf(c.store, id); c.store.update(r.id, { note: str(text ?? '', 'text') }); return toLuaRoom(c.store.room(r.id)!); },
    lock: (c, [id, on]) => { const r = roomOf(c.store, id); c.store.update(r.id, { locked: bool(on, 'bool') }); return toLuaRoom(c.store.room(r.id)!); },

    scene: (c, [spec]) => {
      const t = table(spec, 'scene');
      const input: SceneInput = { sid: c.sid, source: 'lua', name: nonEmpty(t.name, 'name') };
      if (t.vnum !== undefined && t.vnum !== null) input.vnum = typeof t.vnum === 'number' ? String(t.vnum) : str(t.vnum, 'vnum');
      const desc = optStr(t.desc, 'desc'); if (desc !== undefined) input.desc = desc;
      const area = optStr(t.area, 'area'); if (area !== undefined) input.area = area;
      const env = optStr(t.env, 'env'); if (env !== undefined) input.env = env;
      const exits = sceneExits(t.exits); if (exits) input.exits = exits;
      const complete = optBool(t.exitsComplete, 'exitsComplete'); if (complete !== undefined) input.exitsComplete = complete;
      if (t.coords !== undefined && t.coords !== null) { const k = table(t.coords, 'coords'); input.coords = { x: int(k.x, 'coords.x'), y: int(k.y, 'coords.y'), z: int(k.z ?? 0, 'coords.z') }; }
      tracker.scene(input);
      return luaTrack(c);
    },
    moved: (c, [key, opts]) => { const o = table(opts, 'options'); tracker.moved(c.sid, nonEmpty(key, 'key'), { confirmed: optBool(o.confirmed, 'confirmed') }); return true; },
    failed: (c, [text, key]) => { tracker.failed(c.sid, str(text ?? '', 'text'), key === undefined || key === null ? null : nonEmpty(key, 'key')); return true; },
    anchor: (c, [id]) => { tracker.anchor(c.sid, roomOf(c.store, id).id); return luaTrack(c); },
    pause: (c, [on]) => { tracker.pause(c.sid, bool(on, 'bool')); return luaTrack(c); },
    track: (c) => luaTrack(c),

    goto: (c, [id, opts]) => guardWalk(walker.goto(c.sid, roomOf(c.store, id).id, walkOpts(opts))),
    walk: (c, [steps, opts]) => { const list = strList(steps, 'steps'); if (!list.length) bad('steps must not be empty'); return guardWalk(walker.steps(c.sid, list, walkOpts(opts))); },
    stop: (c) => { walker.stop(c.sid); return toLuaWalk(walker.state(c.sid)); },
    walkPause: (c, [on]) => { if (bool(on, 'bool')) walker.pause(c.sid); else walker.resume(c.sid); return toLuaWalk(walker.state(c.sid)); },
    walking: (c) => toLuaWalk(walker.state(c.sid)),

    batch: (c, [label, calls]) => {
      const l = nonEmpty(label, 'label');
      if (!Array.isArray(calls) || !calls.length) bad('calls must be a non-empty list of { fn, args }');
      if (c.inBatch) bad('batch cannot nest');
      const specs = (calls as unknown[]).map((x, i): { fn: string; args: unknown[] } => {
        const t = table(x, `call ${i + 1}`);
        const fn = nonEmpty(t.fn, `call ${i + 1}: fn`);
        const def = LUA_API.find((d) => d.fn === fn) ?? bad(`call ${i + 1}: unknown function "${fn}"`);
        if (def.batchable === false) bad(`call ${i + 1}: ${fn} cannot run in a batch`);
        const args = t.args === undefined || t.args === null ? [] : Array.isArray(t.args) ? (t.args as unknown[]) : bad(`call ${i + 1}: args must be a list`);
        return { fn, args };
      });
      return c.store.batch(l, () => specs.map((s) => run({ ...c, inBatch: true }, s.fn, s.args)));
    },
    undo: (c) => c.store.undo(),
    redo: (c) => c.store.redo(),
    export: (c) => {
      const data = c.store.export();
      const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
      if (bytes > EXPORT_LIMIT_BYTES) bad(`map too large for Lua (${Math.ceil(bytes / 1024)} KB); use the panel`);
      return data;
    },
    import: (c, [data]) => { if (!isObj(data)) bad('data must be a map table'); try { return c.store.import(data as MapData); } catch (e) { return bad(e instanceof Error ? e.message : String(e)); } },
    erase: (c, [confirm]) => { if (confirm !== 'yes') bad('pass "yes" to erase the whole map'); c.store.erase(); return true; },

    events: (c, [on]) => { session(c.sid).events = bool(on, 'bool'); return session(c.sid).events; },
    help: () => luaHelp(),
  };
  for (const d of LUA_API) if (!fns[d.fn]) throw new Error(`lua bridge: ${d.fn} is in the API table but not implemented`);

  /** A walk promise that still settles (as `stopped`) when the bridge is disposed first. */
  function guardWalk(p: Promise<WalkState>): Promise<WalkState> {
    return new Promise<WalkState>((resolve) => {
      let done = false;
      const settle = (): void => { if (!done) { done = true; pendingWalks.delete(h); resolve({ status: 'stopped', target: null, route: [], at: 0, reason: 'mapper unloaded' }); } };
      const h = { settle };
      pendingWalks.add(h);
      p.then((s) => { if (!done) { done = true; pendingWalks.delete(h); resolve(toLuaWalk(s)); } }, (e: unknown) => { if (!done) { done = true; pendingWalks.delete(h); resolve({ status: 'failed', target: null, route: [], at: 0, reason: e instanceof Error ? e.message : String(e) }); } });
    });
  }

  /** Run one function synchronously; returns `{ ok, result | error }`. A promise result is passed through as `result`. */
  function run(c: Ctx, fn: string, args: unknown[]): { ok: boolean; result?: unknown; error?: string } {
    const f = fns[fn];
    if (!f) return { ok: false, error: `mapper.${fn}: unknown function (see mapper.help())` };
    try { return { ok: true, result: f(c, args) }; } catch (e) {
      if (e instanceof ArgError) return { ok: false, error: `mapper.${fn}: ${e.message}` };
      mu.log.error('Mapper', `lua ${fn}`, e);
      return { ok: false, error: `mapper.${fn}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /* ── wire ── */
  const offCall = mu.lua.on('mapper.call', (data, meta) => {
    if (disposed) return;
    const sid = meta.sid;
    const call = isObj(data) ? (data as unknown as LuaCall) : null;
    const id = call && typeof call.id === 'number' ? call.id : undefined;
    const reply = (r: Omit<LuaReply, 'id'>): void => { if (id !== undefined) emit(sid, 'mapper.reply', { id, ...r }); };
    if (!call || typeof call.fn !== 'string') { reply({ ok: false, error: 'mapper.call: expected { id?, fn, args? }' }); return; }
    const args = argList(call.args);
    if (!args) { reply({ ok: false, error: `mapper.${call.fn}: args must be a list` }); return; }
    let store: MapStore;
    try { store = storeOf(sid); } catch (e) {
      if (call.fn === 'version' || call.fn === 'help') { reply(run({ sid, store: null as unknown as MapStore, inBatch: false }, call.fn, args)); return; }
      reply({ ok: false, error: `mapper.${call.fn}: ${(e as Error).message}` }); return;
    }
    const r = run({ sid, store, inBatch: false }, call.fn, args);
    if (r.ok && r.result instanceof Promise) {
      void r.result.then((result) => reply({ ok: true, result }), (e: unknown) => reply({ ok: false, error: `mapper.${call.fn}: ${e instanceof Error ? e.message : String(e)}` }));
      return;
    }
    reply(r);
  });

  /* ── events to Lua, rate-limited per session ── */
  const offEvents = tracker.on((e: MapperEvent) => {
    if (e.type === 'track' || e.type === 'moved') return;
    const s = sessions.get(e.sid);
    if (!s?.events) return;
    const now = Date.now();
    if (now - s.window >= 1000) { s.window = now; s.sent = 0; }
    if (s.sent >= EVENTS_PER_S) { s.dropped++; return; }
    s.sent++;
    emit(e.sid, 'mapper.event', toLuaEvent(e));
  });

  const offClose = mu.sessions.on('close', (ref) => { sessions.delete(ref.id); });

  return () => {
    if (disposed) return;
    disposed = true;
    for (const w of [...pendingWalks]) w.settle();
    pendingWalks.clear();
    sessions.clear();
    offCall(); offEvents(); offClose();
  };
}

/**
 * A tracker event as `mapper.event` carries it: rooms as LuaRoom; absent values (`prev` on the first room, `via`
 * after a teleport) as JSON null, which a Lua handler reads as `nil`.
 */
export function toLuaEvent(e: MapperEvent): Record<string, unknown> | null {
  switch (e.type) {
    case 'enter': return { type: 'enter', room: toLuaRoom(e.room), prev: e.prev ? toLuaRoom(e.prev) : null, via: e.via, by: e.by };
    case 'created': return { type: 'created', room: toLuaRoom(e.room), via: e.via };
    case 'lost': return { type: 'lost', name: e.scene.name, vnum: e.scene.vnum ?? null };
    case 'failed': return { type: 'failed', key: e.key, text: e.text };
    case 'walk': return { type: 'walk', status: e.state.status, target: e.state.target, at: e.state.at, total: e.state.route.length, reason: e.state.reason ?? null };
    default: return null;
  }
}
