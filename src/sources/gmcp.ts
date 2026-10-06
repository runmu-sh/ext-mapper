/**
 * The GMCP and MSDP sources: `Room.Info` (exits as an object, a list or a string; coords; environment), `Room.Name`
 * for games that send only the name (Evennia / Underspire; only while the session has seen no `Room.Info`), and
 * MSDP `ROOM_*` (flat variables or a `ROOM` table), reported when the vnum or the exits change. Declares nothing:
 * the manifest declares `Room 1`.
 */
import type { Dispose, Mu } from '@muclient/sdk';
import type { SceneInput, Tracker } from '../types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() || undefined : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** `Room.Info.exits` in its three shapes: `{ n: 2 }`, `['n', 's']` / `[{ dir, name, id|to }]`, or `'n s e'`. */
export function exitsOf(raw: unknown): SceneInput['exits'] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const out: NonNullable<SceneInput['exits']> = [];
  if (typeof raw === 'string') {
    for (const k of raw.split(/[\s,;]+/)) if (k.trim()) out.push({ key: k.trim().toLowerCase() });
  } else if (Array.isArray(raw)) {
    for (const e of raw) {
      if (typeof e === 'string') { if (e.trim()) out.push({ key: e.trim().toLowerCase() }); continue; }
      if (!isObj(e)) continue;
      const key = str(e.dir) ?? str(e.direction) ?? str(e.key) ?? str(e.name);
      if (!key) continue;
      const x: NonNullable<SceneInput['exits']>[number] = { key: key.toLowerCase() };
      const name = str(e.name);
      if (name && name.toLowerCase() !== x.key) x.name = name;
      const to = str(e.id) ?? str(e.to) ?? str(e.num) ?? str(e.vnum);
      if (to) x.to = to;
      if (typeof e.door === 'string') x.door = e.door as NonNullable<SceneInput['exits']>[number]['door'];
      out.push(x);
    }
  } else if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!k.trim()) continue;
      const x: NonNullable<SceneInput['exits']>[number] = { key: k.trim().toLowerCase() };
      const to = isObj(v) ? str(v.id) ?? str(v.to) ?? str(v.num) : str(v);
      if (to) x.to = to;
      if (isObj(v)) { const name = str(v.name); if (name && name.toLowerCase() !== x.key) x.name = name; }
      out.push(x);
    }
  } else return undefined;
  return out;
}

/** `coords` as `{ x, y, z }`, `[x, y, z]` or `"x,y,z"`. */
export function coordsOf(raw: unknown): SceneInput['coords'] | undefined {
  let x: number | undefined, y: number | undefined, z: number | undefined;
  if (Array.isArray(raw)) [x, y, z] = [num(raw[0]), num(raw[1]), num(raw[2]) ?? 0];
  else if (isObj(raw)) [x, y, z] = [num(raw.x), num(raw.y), num(raw.z) ?? 0];
  else if (typeof raw === 'string') { const p = raw.split(/[,\s]+/); [x, y, z] = [num(p[0]), num(p[1]), num(p[2]) ?? 0]; }
  return x !== undefined && y !== undefined && z !== undefined ? { x, y, z } : undefined;
}

/** `Room.Info` → a scene, or null without a name. */
export function roomInfoScene(sid: string, d: unknown, replay: boolean): SceneInput | null {
  if (!isObj(d)) return null;
  const name = str(d.name) ?? str(d.title);
  if (!name) return null;
  const s: SceneInput = { sid, source: 'gmcp', name, exitsComplete: true, replay };
  const vnum = str(d.num) ?? str(d.id) ?? str(d.vnum);
  if (vnum) s.vnum = vnum;
  const desc = str(d.desc) ?? str(d.description);
  if (desc) s.desc = desc;
  const area = str(d.area) ?? str(d.zone);
  if (area) s.area = area;
  const env = str(d.environment) ?? str(d.terrain);
  if (env) s.env = env;
  s.exits = exitsOf(d.exits) ?? [];
  const coords = coordsOf(d.coords);
  if (coords) s.coords = coords;
  return s;
}

/** `Room.Name`: a bare string or `{ name }`. */
export function roomNameOf(d: unknown): string {
  return str(d) ?? (isObj(d) ? str(d.name) ?? '' : '');
}

interface MsdpRoom { vnum?: string; name?: string; area?: string; env?: string; exits?: SceneInput['exits']; exitsKey?: string }

export function gmcpSource(mu: Mu, tracker: Tracker, worldOf: (sid: string) => string | null): Dispose {
  const subs: Dispose[] = [];
  const inScope = (sid: string): boolean => worldOf(sid) !== null;

  subs.push(mu.gmcp.on('Room.Info', (data, m) => {
    if (!inScope(m.sid)) return;
    const s = roomInfoScene(m.sid, data, m.replay);
    if (s) tracker.scene(s);
  }));
  subs.push(mu.gmcp.on('Room.Name', (data, m) => {
    if (!inScope(m.sid)) return;
    if (mu.gmcp.state('Room.Info', m.sid) !== undefined) return;
    const name = roomNameOf(data);
    if (!name) return;
    tracker.scene({ sid: m.sid, source: 'gmcp', name, exits: [], exitsComplete: false, replay: m.replay });
  }));

  /* MSDP: assemble per session; report when the vnum or the exits change. */
  const msdp = new Map<string, MsdpRoom>();
  const roomOf = (sid: string): MsdpRoom => msdp.get(sid) ?? msdp.set(sid, {}).get(sid)!;
  const report = (sid: string, r: MsdpRoom, replay: boolean): void => {
    if (!r.name && !r.vnum) return;
    const s: SceneInput = { sid, source: 'msdp', name: r.name ?? r.vnum ?? '', exits: r.exits ?? [], exitsComplete: r.exits !== undefined, replay };
    if (r.vnum) s.vnum = r.vnum;
    if (r.area) s.area = r.area;
    if (r.env) s.env = r.env;
    tracker.scene(s);
  };
  const apply = (sid: string, variable: string, value: unknown, replay: boolean): void => {
    const r = roomOf(sid);
    let changed = false;
    const setExits = (raw: unknown): void => {
      const ex = exitsOf(raw) ?? [];
      const key = JSON.stringify(ex);
      if (key !== r.exitsKey) { r.exitsKey = key; r.exits = ex; changed = true; }
    };
    const setVnum = (raw: unknown): void => { const v = str(raw); if (v !== undefined && v !== r.vnum) { r.vnum = v; changed = true; } };
    switch (variable) {
      case 'ROOM_VNUM': setVnum(value); break;
      case 'ROOM_NAME': r.name = str(value) ?? r.name; break;
      case 'AREA_NAME': r.area = str(value) ?? r.area; break;
      case 'ROOM_TERRAIN': r.env = str(value) ?? r.env; break;
      case 'ROOM_EXITS': setExits(value); break;
      case 'ROOM': {
        if (!isObj(value)) return;
        const v = Object.fromEntries(Object.entries(value).map(([k, x]) => [k.toUpperCase(), x]));
        if ('NAME' in v) r.name = str(v.NAME) ?? r.name;
        if ('AREA' in v) r.area = str(v.AREA) ?? r.area;
        if ('TERRAIN' in v) r.env = str(v.TERRAIN) ?? r.env;
        if ('VNUM' in v) setVnum(v.VNUM);
        if ('EXITS' in v) setExits(v.EXITS);
        break;
      }
      default: return;
    }
    if (changed) report(sid, r, replay);
  };
  for (const v of ['ROOM_VNUM', 'ROOM_NAME', 'ROOM_EXITS', 'AREA_NAME', 'ROOM_TERRAIN', 'ROOM']) {
    subs.push(mu.msdp.on(v, (value, m) => { if (inScope(m.sid)) apply(m.sid, m.variable.toUpperCase(), value, m.replay); }));
  }
  subs.push(mu.sessions.on('close', (s) => { msdp.delete(s.id); }));

  return () => { for (const d of subs.splice(0)) d(); msdp.clear(); };
}
