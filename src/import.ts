/**
 * Map file readers: our own `MapData`, the 0.x userscript map and Mudlet JSON exports, each turned into a
 * `MapData`. Pure; the store calls `readMapFile` from `import()`.
 */
import { dirByName } from './dirs';
import { ROOM_COLORS, type MapArea, type MapData, type MapExit, type MapRoom, type RoomColor } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);

/** The numeric part of an `r<n>` id, or null. */
export function idNumber(id: string): number | null {
  const m = /^r(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

function nextIdFor(rooms: Record<string, MapRoom>, hint: unknown): number {
  let n = Math.max(1, Math.floor(num(hint, 1)));
  for (const id of Object.keys(rooms)) {
    const k = idNumber(id);
    if (k !== null && k >= n) n = k + 1;
  }
  return n;
}

/** Drop links to rooms that do not exist. */
function pruneLinks(rooms: Record<string, MapRoom>): void {
  for (const r of Object.values(rooms)) for (const e of Object.values(r.exits)) if (e.to !== null && !rooms[e.to]) e.to = null;
}

/** Turn any recognised map file into `MapData`; throws `Error('not a map file')` otherwise. */
export function readMapFile(data: unknown): MapData {
  if (!isObj(data)) throw new Error('not a map file');
  if (data.format === 'mu-map' && isObj(data.rooms)) return readMuMap(data);
  if (data.v === 1 && isObj(data.rooms)) return readUserscript(data);
  if (isMudlet(data)) return readMudlet(data);
  throw new Error('not a map file');
}

/* ────────────────────────────── mu-map ────────────────────────────── */

function readMuMap(data: Obj): MapData {
  const rooms: Record<string, MapRoom> = {};
  for (const [id, raw] of Object.entries(data.rooms as Obj)) {
    if (!isObj(raw)) continue;
    const exits: Record<string, MapExit> = {};
    if (isObj(raw.exits)) {
      for (const [key, e] of Object.entries(raw.exits)) {
        if (!isObj(e)) continue;
        exits[key] = { ...(e as unknown as MapExit), key: str(e.key, key), to: typeof e.to === 'string' ? e.to : null };
      }
    }
    rooms[id] = { ...(raw as unknown as MapRoom), id, name: str(raw.name), area: str(raw.area), x: num(raw.x), y: num(raw.y), z: num(raw.z), exits };
  }
  const areas: Record<string, MapArea> = {};
  if (isObj(data.areas)) {
    for (const [id, a] of Object.entries(data.areas)) if (isObj(a)) areas[id] = { id, name: str(a.name, id) };
  }
  pruneLinks(rooms);
  return { format: 'mu-map', v: 2, rooms, areas, nextId: nextIdFor(rooms, data.nextId) };
}

/* ────────────────────────────── 0.x userscript ────────────────────────────── */

/** Representative hues of the named colours; `accent` is theme-defined so it is never picked from a hex. */
const HUES: ReadonlyArray<{ color: RoomColor; hue: number }> = [
  { color: 'alert', hue: 0 }, { color: 'rust', hue: 22 }, { color: 'gold', hue: 48 }, { color: 'moss', hue: 95 },
  { color: 'ok', hue: 140 }, { color: 'sky', hue: 205 }, { color: 'plum', hue: 290 }, { color: 'alert', hue: 360 },
];

/** Nearest named colour to a CSS hex by hue; greys become `dim`; anything unparseable is `''`. */
export function colorFromHex(hex: unknown): RoomColor {
  if (typeof hex !== 'string') return '';
  const s = hex.trim();
  if (ROOM_COLORS.includes(s as RoomColor)) return s as RoomColor;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.2 || l < 0.08) return 'dim';
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  let best: RoomColor = '';
  let bestDist = Infinity;
  for (const c of HUES) {
    const dist = Math.abs(c.hue - hue);
    if (dist < bestDist) { bestDist = dist; best = c.color; }
  }
  return best;
}

function readUserscript(data: Obj): MapData {
  const rooms: Record<string, MapRoom> = {};
  for (const [rawId, raw] of Object.entries(data.rooms as Obj)) {
    if (!isObj(raw)) continue;
    const id = str(raw.id, rawId);
    const exits: Record<string, MapExit> = {};
    if (isObj(raw.exits)) {
      for (const [handle, e] of Object.entries(raw.exits)) {
        if (!isObj(e)) continue;
        const key = str(e.key, handle);
        if (!key || exits[key]) continue;
        const exit: MapExit = { key, to: e.to === null || e.to === undefined ? null : str(e.to), handle };
        const name = str(e.name);
        if (name && name !== key) exit.name = name;
        exits[key] = exit;
      }
    }
    const room: MapRoom = { id, name: str(raw.name), area: '', x: num(raw.x), y: num(raw.y), z: num(raw.z), exits };
    const color = colorFromHex(raw.color);
    if (color) room.color = color;
    const sym = str(raw.sym);
    if (sym) room.symbol = sym;
    const note = str(raw.note);
    if (note) room.note = note;
    const flag = str(raw.flag);
    if (flag) room.warn = flag;
    const dh = raw.dh;
    if (typeof dh === 'string' || typeof dh === 'number') room.sig = String(dh);
    rooms[id] = room;
  }
  pruneLinks(rooms);
  return { format: 'mu-map', v: 2, rooms, areas: {}, nextId: nextIdFor(rooms, data.nextId) };
}

/* ────────────────────────────── Mudlet ────────────────────────────── */

function looksLikeMudletRoom(r: unknown): boolean {
  return isObj(r) && (Array.isArray(r.coordinates) || isObj(r.exits) || isObj(r.specialExits)) && r.id !== undefined;
}

function isMudlet(data: Obj): boolean {
  if (Array.isArray(data.areas)) {
    return data.areas.some((a) => isObj(a) && Array.isArray(a.rooms) && (a.rooms.length === 0 || a.rooms.some(looksLikeMudletRoom)));
  }
  return Array.isArray(data.rooms) && data.rooms.length > 0 && data.rooms.every(looksLikeMudletRoom);
}

const MUDLET_DIRS = ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest', 'up', 'down', 'in', 'out'] as const;

function readMudlet(data: Obj): MapData {
  const areas: Record<string, MapArea> = {};
  const raws: Array<{ room: Obj; area: string }> = [];
  if (Array.isArray(data.areas)) {
    for (const a of data.areas) {
      if (!isObj(a) || !Array.isArray(a.rooms)) continue;
      const areaId = a.id === undefined ? '' : str(a.id);
      if (areaId) areas[areaId] = { id: areaId, name: str(a.name, areaId) };
      for (const r of a.rooms) if (isObj(r)) raws.push({ room: r, area: areaId });
    }
  } else if (Array.isArray(data.rooms)) {
    for (const r of data.rooms) {
      if (!isObj(r)) continue;
      const areaId = r.area === undefined ? '' : str(r.area);
      if (areaId && !areas[areaId]) areas[areaId] = { id: areaId, name: areaId };
      raws.push({ room: r, area: areaId });
    }
  }
  // Mudlet ids → our ids, in file order.
  const ids = new Map<string, string>();
  let nextId = 1;
  for (const { room } of raws) {
    const vnum = str(room.id);
    if (!ids.has(vnum)) ids.set(vnum, `r${nextId++}`);
  }
  const rooms: Record<string, MapRoom> = {};
  for (const { room: raw, area } of raws) {
    const vnum = str(raw.id);
    const id = ids.get(vnum)!;
    const coords = Array.isArray(raw.coordinates) ? raw.coordinates : [];
    const exits: Record<string, MapExit> = {};
    if (isObj(raw.exits)) {
      for (const [k, v] of Object.entries(raw.exits)) {
        const dir = dirByName(k.toLowerCase());
        const key = dir?.name ?? k;
        const to = v === null || v === undefined ? null : ids.get(str(v)) ?? null;
        exits[key] = { key, to };
      }
    }
    if (isObj(raw.specialExits)) {
      for (const [cmd, v] of Object.entries(raw.specialExits)) {
        if (!cmd || exits[cmd]) continue;
        exits[cmd] = { key: cmd, to: v === null || v === undefined ? null : ids.get(str(v)) ?? null };
      }
    }
    const locks = Array.isArray(raw.locks) ? raw.locks : [];
    for (const l of locks) { const d = (MUDLET_DIRS as readonly string[]).includes(str(l)) ? exits[str(l)] : undefined; if (d) d.blocked = true; }
    const room: MapRoom = {
      id, vnum, name: str(raw.name), area,
      x: num(coords[0]), y: -num(coords[1]), z: num(coords[2]),
      exits,
    };
    const env = raw.environment;
    if (typeof env === 'string' && env) room.env = env;
    else if (typeof env === 'number') room.env = String(env);
    if (typeof raw.symbol === 'string' && raw.symbol) room.symbol = raw.symbol.slice(0, 2);
    if (typeof raw.weight === 'number' && raw.weight > 0 && raw.weight !== 1) room.weight = raw.weight;
    if (isObj(raw.userData)) {
      const lines = Object.entries(raw.userData).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => `${k}: ${v as string}`);
      if (lines.length) room.note = lines.join('\n');
    }
    rooms[id] = room;
  }
  return { format: 'mu-map', v: 2, rooms, areas, nextId };
}
