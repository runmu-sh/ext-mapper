// src/index.ts
import { defineExtension } from "@muclient/sdk";

// src/dirs.ts
var COMPASS = [
  { name: "north", short: "n", dx: 0, dy: -1, opposite: "south" },
  { name: "south", short: "s", dx: 0, dy: 1, opposite: "north" },
  { name: "east", short: "e", dx: 1, dy: 0, opposite: "west" },
  { name: "west", short: "w", dx: -1, dy: 0, opposite: "east" },
  { name: "northeast", short: "ne", dx: 1, dy: -1, opposite: "southwest" },
  { name: "northwest", short: "nw", dx: -1, dy: -1, opposite: "southeast" },
  { name: "southeast", short: "se", dx: 1, dy: 1, opposite: "northwest" },
  { name: "southwest", short: "sw", dx: -1, dy: 1, opposite: "northeast" }
];
function build() {
  const out = [];
  for (const c of COMPASS) out.push({ name: c.name, short: c.short, dx: c.dx, dy: c.dy, dz: 0, opposite: c.opposite });
  out.push({ name: "up", short: "u", dx: 0, dy: 0, dz: 1, opposite: "down" });
  out.push({ name: "down", short: "d", dx: 0, dy: 0, dz: -1, opposite: "up" });
  out.push({ name: "in", short: "in", dx: 0, dy: 0, dz: 0, opposite: "out" });
  out.push({ name: "out", short: "out", dx: 0, dy: 0, dz: 0, opposite: "in" });
  for (const vert of ["up", "down"]) {
    const dz = vert === "up" ? 1 : -1;
    const other = vert === "up" ? "down" : "up";
    for (const c of COMPASS) {
      out.push({
        name: `${vert} ${c.name}`,
        short: `${vert[0]}${c.short}`,
        dx: c.dx,
        dy: c.dy,
        dz,
        opposite: `${other} ${c.opposite}`
      });
    }
  }
  return out;
}
var DIRS = Object.freeze(build());
var BY_NAME = /* @__PURE__ */ new Map();
var BY_SHORT = /* @__PURE__ */ new Map();
for (const d of DIRS) {
  BY_NAME.set(d.name, d);
  BY_SHORT.set(d.short, d);
}
function norm(raw) {
  return raw.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
var VERT_WORDS = { up: "up", u: "up", down: "down", d: "down" };
var NAUTICAL = Object.freeze({
  fore: "north",
  forward: "north",
  fwd: "north",
  bow: "north",
  aft: "south",
  astern: "south",
  abaft: "south",
  stern: "south",
  starboard: "east",
  stbd: "east",
  port: "west",
  portside: "west",
  larboard: "west"
});
function compass(word) {
  const d = BY_NAME.get(NAUTICAL[word] ?? word) ?? BY_SHORT.get(word);
  return d && d.dz === 0 && (d.dx !== 0 || d.dy !== 0) ? d : void 0;
}
function parseDir(raw) {
  if (typeof raw !== "string") return null;
  const s = norm(raw);
  if (!s) return null;
  const whole = BY_NAME.get(s) ?? BY_SHORT.get(s) ?? compass(s);
  if (whole) return whole;
  const words = s.split(" ");
  if (words.length === 3) {
    const v = VERT_WORDS[words[0]];
    const c = compass(words[1] + words[2]) ?? compass((NAUTICAL[words[1]] ?? words[1]) + (NAUTICAL[words[2]] ?? words[2]));
    return v && c ? BY_NAME.get(`${v} ${c.name}`) ?? null : null;
  }
  if (words.length === 2) {
    const fused = compass(words[0] + words[1]) ?? compass((NAUTICAL[words[0]] ?? words[0]) + (NAUTICAL[words[1]] ?? words[1]));
    if (fused) return fused;
    const v = VERT_WORDS[words[0]];
    const c = compass(words[1]);
    if (v && c) return BY_NAME.get(`${v} ${c.name}`) ?? null;
    return null;
  }
  if (words.length === 1) {
    for (const [vw, v] of Object.entries(VERT_WORDS)) {
      if (s.length > vw.length && s.startsWith(vw)) {
        const c = compass(s.slice(vw.length));
        if (c) return BY_NAME.get(`${v} ${c.name}`) ?? null;
      }
    }
  }
  return null;
}
function sameDir(a, b) {
  const da = parseDir(a);
  const db = parseDir(b);
  return !!da && !!db && da.name === db.name;
}
function dirByName(name) {
  return BY_NAME.get(name);
}

// src/types.ts
var ROOM_COLORS = ["", "accent", "gold", "ok", "alert", "dim", "sky", "moss", "plum", "rust"];

// src/import.ts
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var num = (v, d = 0) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d;
var str = (v, d = "") => typeof v === "string" ? v : typeof v === "number" ? String(v) : d;
function idNumber(id) {
  const m = /^r(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}
function nextIdFor(rooms, hint) {
  let n = Math.max(1, Math.floor(num(hint, 1)));
  for (const id of Object.keys(rooms)) {
    const k = idNumber(id);
    if (k !== null && k >= n) n = k + 1;
  }
  return n;
}
function pruneLinks(rooms) {
  for (const r of Object.values(rooms)) for (const e of Object.values(r.exits)) if (e.to !== null && !rooms[e.to]) e.to = null;
}
function readMapFile(data) {
  if (!isObj(data)) throw new Error("not a map file");
  if (data.format === "mu-map" && isObj(data.rooms)) return readMuMap(data);
  if (data.v === 1 && isObj(data.rooms)) return readUserscript(data);
  if (isMudlet(data)) return readMudlet(data);
  throw new Error("not a map file");
}
function readMuMap(data) {
  const rooms = {};
  for (const [id, raw] of Object.entries(data.rooms)) {
    if (!isObj(raw)) continue;
    const exits = {};
    if (isObj(raw.exits)) {
      for (const [key, e] of Object.entries(raw.exits)) {
        if (!isObj(e)) continue;
        exits[key] = { ...e, key: str(e.key, key), to: typeof e.to === "string" ? e.to : null };
      }
    }
    rooms[id] = { ...raw, id, name: str(raw.name), area: str(raw.area), x: num(raw.x), y: num(raw.y), z: num(raw.z), exits };
  }
  const areas = {};
  if (isObj(data.areas)) {
    for (const [id, a] of Object.entries(data.areas)) if (isObj(a)) areas[id] = { id, name: str(a.name, id) };
  }
  pruneLinks(rooms);
  return { format: "mu-map", v: 2, rooms, areas, nextId: nextIdFor(rooms, data.nextId) };
}
var HUES = [
  { color: "alert", hue: 0 },
  { color: "rust", hue: 22 },
  { color: "gold", hue: 48 },
  { color: "moss", hue: 95 },
  { color: "ok", hue: 140 },
  { color: "sky", hue: 205 },
  { color: "plum", hue: 290 },
  { color: "alert", hue: 360 }
];
function colorFromHex(hex) {
  if (typeof hex !== "string") return "";
  const s = hex.trim();
  if (ROOM_COLORS.includes(s)) return s;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return "";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.2 || l < 0.08) return "dim";
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = (g - b) / d % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  let best = "";
  let bestDist = Infinity;
  for (const c of HUES) {
    const dist = Math.abs(c.hue - hue);
    if (dist < bestDist) {
      bestDist = dist;
      best = c.color;
    }
  }
  return best;
}
function readUserscript(data) {
  const rooms = {};
  for (const [rawId, raw] of Object.entries(data.rooms)) {
    if (!isObj(raw)) continue;
    const id = str(raw.id, rawId);
    const exits = {};
    if (isObj(raw.exits)) {
      for (const [handle, e] of Object.entries(raw.exits)) {
        if (!isObj(e)) continue;
        const key = str(e.key, handle);
        if (!key || exits[key]) continue;
        const exit = { key, to: e.to === null || e.to === void 0 ? null : str(e.to), handle };
        const name = str(e.name);
        if (name && name !== key) exit.name = name;
        exits[key] = exit;
      }
    }
    const room = { id, name: str(raw.name), area: "", x: num(raw.x), y: num(raw.y), z: num(raw.z), exits };
    const color2 = colorFromHex(raw.color);
    if (color2) room.color = color2;
    const sym = str(raw.sym);
    if (sym) room.symbol = sym;
    const note = str(raw.note);
    if (note) room.note = note;
    const flag = str(raw.flag);
    if (flag) room.warn = flag;
    const dh = raw.dh;
    if (typeof dh === "string" || typeof dh === "number") room.sig = String(dh);
    rooms[id] = room;
  }
  pruneLinks(rooms);
  return { format: "mu-map", v: 2, rooms, areas: {}, nextId: nextIdFor(rooms, data.nextId) };
}
function looksLikeMudletRoom(r) {
  return isObj(r) && (Array.isArray(r.coordinates) || isObj(r.exits) || isObj(r.specialExits)) && r.id !== void 0;
}
function isMudlet(data) {
  if (Array.isArray(data.areas)) {
    return data.areas.some((a) => isObj(a) && Array.isArray(a.rooms) && (a.rooms.length === 0 || a.rooms.some(looksLikeMudletRoom)));
  }
  return Array.isArray(data.rooms) && data.rooms.length > 0 && data.rooms.every(looksLikeMudletRoom);
}
var MUDLET_DIRS = ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "up", "down", "in", "out"];
function readMudlet(data) {
  const areas = {};
  const raws = [];
  if (Array.isArray(data.areas)) {
    for (const a of data.areas) {
      if (!isObj(a) || !Array.isArray(a.rooms)) continue;
      const areaId = a.id === void 0 ? "" : str(a.id);
      if (areaId) areas[areaId] = { id: areaId, name: str(a.name, areaId) };
      for (const r of a.rooms) if (isObj(r)) raws.push({ room: r, area: areaId });
    }
  } else if (Array.isArray(data.rooms)) {
    for (const r of data.rooms) {
      if (!isObj(r)) continue;
      const areaId = r.area === void 0 ? "" : str(r.area);
      if (areaId && !areas[areaId]) areas[areaId] = { id: areaId, name: areaId };
      raws.push({ room: r, area: areaId });
    }
  }
  const ids = /* @__PURE__ */ new Map();
  let nextId = 1;
  for (const { room } of raws) {
    const vnum = str(room.id);
    if (!ids.has(vnum)) ids.set(vnum, `r${nextId++}`);
  }
  const rooms = {};
  for (const { room: raw, area } of raws) {
    const vnum = str(raw.id);
    const id = ids.get(vnum);
    const coords = Array.isArray(raw.coordinates) ? raw.coordinates : [];
    const exits = {};
    if (isObj(raw.exits)) {
      for (const [k, v] of Object.entries(raw.exits)) {
        const dir = dirByName(k.toLowerCase());
        const key = dir?.name ?? k;
        const to = v === null || v === void 0 ? null : ids.get(str(v)) ?? null;
        exits[key] = { key, to };
      }
    }
    if (isObj(raw.specialExits)) {
      for (const [cmd, v] of Object.entries(raw.specialExits)) {
        if (!cmd || exits[cmd]) continue;
        exits[cmd] = { key: cmd, to: v === null || v === void 0 ? null : ids.get(str(v)) ?? null };
      }
    }
    const locks = Array.isArray(raw.locks) ? raw.locks : [];
    for (const l of locks) {
      const d = MUDLET_DIRS.includes(str(l)) ? exits[str(l)] : void 0;
      if (d) d.blocked = true;
    }
    const room = {
      id,
      vnum,
      name: str(raw.name),
      area,
      x: num(coords[0]),
      y: -num(coords[1]),
      z: num(coords[2]),
      exits
    };
    const env = raw.environment;
    if (typeof env === "string" && env) room.env = env;
    else if (typeof env === "number") room.env = String(env);
    if (typeof raw.symbol === "string" && raw.symbol) room.symbol = raw.symbol.slice(0, 2);
    if (typeof raw.weight === "number" && raw.weight > 0 && raw.weight !== 1) room.weight = raw.weight;
    if (isObj(raw.userData)) {
      const lines = Object.entries(raw.userData).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => `${k}: ${v}`);
      if (lines.length) room.note = lines.join("\n");
    }
    rooms[id] = room;
  }
  return { format: "mu-map", v: 2, rooms, areas, nextId };
}

// src/path.ts
var Heap = class {
  a = [];
  seq = 0;
  get size() {
    return this.a.length;
  }
  push(c, id) {
    const a = this.a;
    a.push({ c, n: this.seq++, id });
    let i = a.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (this.less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return void 0;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return { c: top.c, id: top.id };
  }
  less(x, y) {
    return x.c < y.c || x.c === y.c && x.n < y.n;
  }
};
function dijkstra(rooms, from, to, opts = {}) {
  if (!rooms.has(from) || !rooms.has(to)) return null;
  if (from === to) return { ids: [], steps: [], cost: 0 };
  const avoid = new Set(opts.avoid ?? []);
  avoid.delete(from);
  if (avoid.has(to)) return null;
  const dist = /* @__PURE__ */ new Map([[from, 0]]);
  const prev = /* @__PURE__ */ new Map();
  const done = /* @__PURE__ */ new Set();
  const heap = new Heap();
  heap.push(0, from);
  while (heap.size) {
    const cur = heap.pop();
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    if (cur.id === to) break;
    const room = rooms.get(cur.id);
    for (const e of Object.values(room.exits)) {
      if (!e.to || e.blocked) continue;
      if (e.door === "locked" && !opts.locked) continue;
      if (avoid.has(e.to) || done.has(e.to)) continue;
      const dest = rooms.get(e.to);
      if (!dest) continue;
      const c = cur.c + (e.cost ?? 1) + (dest.weight ?? 1);
      const old = dist.get(e.to);
      if (old === void 0 || c < old) {
        dist.set(e.to, c);
        prev.set(e.to, { id: cur.id, steps: e.commands ?? [e.key] });
        heap.push(c, e.to);
      }
    }
  }
  if (!done.has(to)) return null;
  const ids = [];
  const steps = [];
  for (let at2 = to; at2 !== from; ) {
    const p = prev.get(at2);
    ids.unshift(at2);
    steps.unshift([...p.steps]);
    at2 = p.id;
  }
  return { ids, steps, cost: dist.get(to) };
}
function spiralFree(taken, x, y, z, maxRadius = 60) {
  if (!taken(x, y, z)) return { x, y, z };
  for (let r = 1; r <= maxRadius; r++) {
    for (let i = -r; i <= r; i++) if (!taken(x + i, y - r, z)) return { x: x + i, y: y - r, z };
    for (let j = -r + 1; j <= r; j++) if (!taken(x + r, y + j, z)) return { x: x + r, y: y + j, z };
    for (let i = r - 1; i >= -r; i--) if (!taken(x + i, y + r, z)) return { x: x + i, y: y + r, z };
    for (let j = r - 1; j >= -r + 1; j--) if (!taken(x - r, y + j, z)) return { x: x - r, y: y + j, z };
  }
  return { x, y, z };
}
function alongFree(taken, room, dir) {
  for (let k = 1; k <= 12; k++) {
    const x = room.x + dir.dx * k, y = room.y + dir.dy * k, z = room.z + dir.dz * k;
    if (!taken(x, y, z)) return { x, y, z };
  }
  return spiralFree(taken, room.x + dir.dx, room.y + dir.dy, room.z + dir.dz);
}
function componentOf(rooms, start) {
  const out = /* @__PURE__ */ new Set();
  const root = rooms.get(start);
  if (!root) return out;
  const same3 = (r) => !!r && r.area === root.area && r.z === root.z;
  const back = /* @__PURE__ */ new Map();
  for (const r of rooms.values()) {
    if (!same3(r)) continue;
    for (const e of Object.values(r.exits)) {
      if (!e.to) continue;
      let list = back.get(e.to);
      if (!list) back.set(e.to, list = []);
      list.push(r.id);
    }
  }
  const queue = [start];
  out.add(start);
  while (queue.length) {
    const id = queue.shift();
    const r = rooms.get(id);
    const next = [];
    for (const e of Object.values(r.exits)) if (e.to) next.push(e.to);
    for (const b of back.get(id) ?? []) next.push(b);
    for (const n of next) {
      if (out.has(n)) continue;
      if (!same3(rooms.get(n))) continue;
      out.add(n);
      queue.push(n);
    }
  }
  return out;
}

// src/store.ts
var UNDO_CAP = 100;
var SAVE_DELAY_MS = 250;
var cellKey = (area, x, y, z) => `${area}\0${x}\0${y}\0${z}`;
var clone = (v) => JSON.parse(JSON.stringify(v));
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function createStore(worldId, persist) {
  let rooms = /* @__PURE__ */ new Map();
  let areas = /* @__PURE__ */ new Map();
  let nextId = 1;
  const cells = /* @__PURE__ */ new Map();
  const vnums = /* @__PURE__ */ new Map();
  const handles = /* @__PURE__ */ new Map();
  const sigs = /* @__PURE__ */ new Map();
  function index(r) {
    cells.set(cellKey(r.area, r.x, r.y, r.z), r.id);
    if (r.vnum) vnums.set(r.vnum, r.id);
    if (r.sig) {
      let s = sigs.get(r.sig);
      if (!s) sigs.set(r.sig, s = /* @__PURE__ */ new Set());
      s.add(r.id);
    }
    for (const e of Object.values(r.exits)) if (e.handle) handles.set(e.handle, r.id);
  }
  function unindex(r) {
    const ck = cellKey(r.area, r.x, r.y, r.z);
    if (cells.get(ck) === r.id) cells.delete(ck);
    if (r.vnum && vnums.get(r.vnum) === r.id) vnums.delete(r.vnum);
    if (r.sig) {
      const s = sigs.get(r.sig);
      if (s) {
        s.delete(r.id);
        if (!s.size) sigs.delete(r.sig);
      }
    }
    for (const e of Object.values(r.exits)) if (e.handle && handles.get(e.handle) === r.id) handles.delete(e.handle);
  }
  function reindexAll() {
    cells.clear();
    vnums.clear();
    handles.clear();
    sigs.clear();
    for (const r of rooms.values()) index(r);
  }
  const taken = (area) => (x, y, z) => cells.has(cellKey(area, x, y, z));
  function snapshot() {
    const s = { rooms: Object.fromEntries(rooms), areas: Object.fromEntries(areas), nextId };
    return JSON.stringify(s);
  }
  function restore(json) {
    const s = JSON.parse(json);
    rooms = new Map(Object.entries(s.rooms));
    areas = new Map(Object.entries(s.areas));
    nextId = s.nextId;
    reindexAll();
  }
  const undoStack = [];
  const redoStack = [];
  const watchers = /* @__PURE__ */ new Set();
  let depth = 0;
  let pendingKinds = /* @__PURE__ */ new Set();
  let pendingIds = /* @__PURE__ */ new Set();
  let disposed = false;
  function touch(kind, ids = []) {
    pendingKinds.add(kind);
    for (const id of ids) pendingIds.add(id);
  }
  function touchRoom(r) {
    r.updated = Date.now();
    touch("rooms", [r.id]);
  }
  function emit() {
    if (!pendingKinds.size) return;
    let ev;
    if (pendingKinds.has("reset") || pendingKinds.has("rooms") && pendingKinds.has("areas")) ev = { kind: "reset" };
    else if (pendingKinds.has("rooms")) ev = { kind: "rooms", ids: [...pendingIds] };
    else ev = { kind: "areas" };
    pendingKinds = /* @__PURE__ */ new Set();
    pendingIds = /* @__PURE__ */ new Set();
    for (const fn of [...watchers]) fn(ev);
  }
  function mutate(label, fn) {
    if (depth > 0) return fn();
    const before = snapshot();
    depth++;
    try {
      return fn();
    } finally {
      depth--;
      if (pendingKinds.size) {
        undoStack.push({ label, state: before });
        if (undoStack.length > UNDO_CAP) undoStack.splice(0, undoStack.length - UNDO_CAP);
        redoStack.length = 0;
        scheduleSave();
        emit();
      }
    }
  }
  let timer = null;
  let saving = Promise.resolve();
  const report = (e) => {
    if (persist.onError) persist.onError(e);
  };
  function saveNow() {
    const data = exportData();
    saving = saving.then(() => persist.save(data)).catch(report);
    return saving;
  }
  function scheduleSave() {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveNow();
    }, SAVE_DELAY_MS);
  }
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      await saveNow();
    }
    await saving;
  }
  function load(data) {
    rooms = new Map(Object.entries(clone(data.rooms)));
    areas = new Map(Object.entries(clone(data.areas)));
    nextId = data.nextId;
    for (const id of rooms.keys()) {
      const n = idNumber(id);
      if (n !== null && n >= nextId) nextId = n + 1;
    }
    reindexAll();
  }
  const ready = (async () => {
    try {
      const data = await persist.load();
      if (data && !disposed) {
        load(data);
        touch("reset");
        emit();
      }
    } catch (e) {
      report(e);
    }
  })();
  function exportData() {
    return clone({ format: "mu-map", v: 2, rooms: Object.fromEntries(rooms), areas: Object.fromEntries(areas), nextId });
  }
  function incoming(id) {
    const out = [];
    for (const r of rooms.values()) for (const e of Object.values(r.exits)) if (e.to === id) out.push({ room: r, exit: e });
    return out;
  }
  function find(q) {
    const out = [];
    const name = q.name?.toLowerCase();
    const near = q.near ? rooms.get(q.near.roomId) : void 0;
    if (q.near && !near) return out;
    for (const r of rooms.values()) {
      if (name !== void 0 && !r.name.toLowerCase().includes(name)) continue;
      if (q.area !== void 0 && r.area !== q.area) continue;
      if (q.vnum !== void 0 && r.vnum !== q.vnum) continue;
      if (q.tag !== void 0 && !(r.tags ?? []).includes(q.tag)) continue;
      if (near && q.near) {
        if (r.area !== near.area || r.z !== near.z) continue;
        if (Math.max(Math.abs(r.x - near.x), Math.abs(r.y - near.y)) > q.near.radius) continue;
      }
      out.push(r);
      if (q.limit !== void 0 && out.length >= q.limit) break;
    }
    return out;
  }
  function allocId() {
    let id = `r${nextId++}`;
    while (rooms.has(id)) id = `r${nextId++}`;
    return id;
  }
  function create(room) {
    return mutate("create room", () => {
      let id = room.id;
      if (id === void 0) id = allocId();
      else {
        if (rooms.has(id)) throw new Error(`room ${id} exists`);
        const n = idNumber(id);
        if (n !== null && n >= nextId) nextId = n + 1;
      }
      const r = { ...clone(room), id, exits: {} };
      for (const [k, e] of Object.entries(room.exits ?? {})) r.exits[k] = { ...clone(e), key: e.key ?? k };
      rooms.set(id, r);
      index(r);
      touchRoom(r);
      return r;
    });
  }
  function update(id, patch) {
    const r = rooms.get(id);
    if (!r) return void 0;
    return mutate("edit room", () => {
      unindex(r);
      const p = clone(patch);
      delete p.id;
      for (const [k, v] of Object.entries(p)) {
        if (v === void 0) delete r[k];
        else r[k] = v;
      }
      index(r);
      touchRoom(r);
      return r;
    });
  }
  function dropLinksTo(id, except) {
    for (const { room, exit } of incoming(id)) {
      if (room.id === except) continue;
      exit.to = null;
      touchRoom(room);
    }
  }
  function remove2(id) {
    const r = rooms.get(id);
    if (!r) return;
    mutate("delete room", () => {
      unindex(r);
      rooms.delete(id);
      touch("rooms", [id]);
      dropLinksTo(id);
    });
  }
  function merge(from, into) {
    const a = rooms.get(from), b = rooms.get(into);
    if (!a || !b || from === into) return;
    mutate("merge rooms", () => {
      unindex(a);
      unindex(b);
      for (const [k, e] of Object.entries(a.exits)) if (!b.exits[k]) b.exits[k] = { ...e };
      for (const e of Object.values(b.exits)) if (e.to === from || e.to === into) e.to = null;
      for (const { room, exit } of incoming(from)) {
        if (room.id === from) continue;
        exit.to = room.id === into ? null : into;
        touchRoom(room);
      }
      if (a.note) b.note = b.note ? `${b.note}
${a.note}` : a.note;
      if (a.tags?.length) b.tags = [.../* @__PURE__ */ new Set([...b.tags ?? [], ...a.tags])];
      if (!b.color && a.color) b.color = a.color;
      if (!b.symbol && a.symbol) b.symbol = a.symbol;
      if (!b.vnum && a.vnum) b.vnum = a.vnum;
      if (!b.sig && a.sig) b.sig = a.sig;
      rooms.delete(from);
      index(b);
      touch("rooms", [from]);
      touchRoom(b);
    });
  }
  function move(ids, dx, dy, dz = 0, area) {
    const set = new Set(ids);
    const moving = ids.map((id) => rooms.get(id)).filter((r) => !!r);
    if (!moving.length) return false;
    const targets = /* @__PURE__ */ new Set();
    for (const r of moving) {
      const ck = cellKey(area ?? r.area, r.x + dx, r.y + dy, r.z + dz);
      const occupant = cells.get(ck);
      if (occupant !== void 0 && !set.has(occupant) || targets.has(ck)) return false;
      targets.add(ck);
    }
    if (dx === 0 && dy === 0 && dz === 0 && (area === void 0 || moving.every((r) => r.area === area))) return true;
    mutate("move rooms", () => {
      for (const r of moving) unindex(r);
      for (const r of moving) {
        r.x += dx;
        r.y += dy;
        r.z += dz;
        if (area !== void 0) r.area = area;
        index(r);
        touchRoom(r);
      }
    });
    return true;
  }
  function setExit(roomId, exit) {
    const r = rooms.get(roomId);
    if (!r || !exit.key) return;
    mutate("edit exit", () => {
      unindex(r);
      r.exits[exit.key] = clone(exit);
      if (r.exits[exit.key].to === void 0) r.exits[exit.key].to = null;
      index(r);
      touchRoom(r);
    });
  }
  function removeExit(roomId, key) {
    const r = rooms.get(roomId);
    if (!r || !r.exits[key]) return;
    mutate("delete exit", () => {
      unindex(r);
      delete r.exits[key];
      index(r);
      touchRoom(r);
    });
  }
  function facing(room, dir) {
    for (const e of Object.values(room.exits)) {
      const d = parseDir(e.key) ?? (e.dir ? parseDir(e.dir) : null);
      if (d && d.name === dir.opposite) return e;
    }
    return void 0;
  }
  function link(roomId, key, to, opts = {}) {
    const r = rooms.get(roomId), dest = rooms.get(to);
    if (!r || !dest) return;
    mutate("link exit", () => {
      const e = r.exits[key] ?? (r.exits[key] = { key, to: null });
      if (e.to !== to) {
        e.to = to;
        touchRoom(r);
      }
      if (opts.back && to !== roomId) {
        const d = parseDir(key) ?? (e.dir ? parseDir(e.dir) : null);
        const back = d ? facing(dest, d) : void 0;
        if (back && back.to === null) {
          back.to = roomId;
          touchRoom(dest);
        }
      }
    });
  }
  function unlink(roomId, key) {
    const r = rooms.get(roomId);
    const e = r?.exits[key];
    if (!r || !e || e.to === null) return;
    mutate("unlink exit", () => {
      e.to = null;
      touchRoom(r);
    });
  }
  function autoConnect(area) {
    return mutate("connect exits", () => {
      let n = 0;
      for (const r of rooms.values()) {
        if (area !== void 0 && r.area !== area) continue;
        for (const e of Object.values(r.exits)) {
          const d = parseDir(e.key);
          if (!d || d.dx === 0 && d.dy === 0 && d.dz === 0) continue;
          const nid = cells.get(cellKey(r.area, r.x + d.dx, r.y + d.dy, r.z + d.dz));
          if (!nid || nid === r.id) continue;
          const nb = rooms.get(nid);
          const back = facing(nb, d);
          if (!back) continue;
          if (e.to === null) {
            if (back.to === null) {
              e.to = nid;
              back.to = r.id;
              touchRoom(r);
              touchRoom(nb);
              n += 2;
            } else if (back.to === r.id) {
              e.to = nid;
              touchRoom(r);
              n++;
            }
          } else if (e.to === nid && back.to === null) {
            back.to = r.id;
            touchRoom(nb);
            n++;
          }
        }
      }
      return n;
    });
  }
  function setArea(area) {
    const cur = areas.get(area.id);
    if (!area.id) return cur ?? { id: "", name: "" };
    return mutate("edit area", () => {
      const next = { id: area.id, name: area.name ?? cur?.name ?? area.id };
      const note = "note" in area ? area.note : cur?.note;
      const color2 = "color" in area ? area.color : cur?.color;
      if (note) next.note = note;
      if (color2) next.color = color2;
      if (cur && same(cur, next)) return cur;
      areas.set(area.id, next);
      touch("areas");
      return next;
    });
  }
  function createArea(name, fields = {}) {
    const base = slug(name) || "area";
    let id = base;
    for (let n = 2; areas.has(id) || find({ area: id, limit: 1 }).length; n++) id = `${base}-${n}`;
    return setArea({ id, name: name.trim() || id, ...fields });
  }
  function removeArea(id, opts = {}) {
    if (!areas.has(id) && !find({ area: id, limit: 1 }).length) return;
    const to = opts.to ?? "";
    if (opts.rooms === "move" && to === id) return;
    mutate("delete area", () => {
      areas.delete(id);
      touch("areas");
      const mine = [...rooms.values()].filter((r) => r.area === id);
      if (opts.rooms === "move") {
        relocate(mine, to);
        return;
      }
      for (const r of mine) {
        unindex(r);
        rooms.delete(r.id);
        touch("rooms", [r.id]);
        dropLinksTo(r.id);
      }
    });
  }
  function relocate(list, to) {
    for (const r of list) unindex(r);
    for (const r of list) {
      const free = spiralFree(taken(to), r.x, r.y, r.z);
      r.area = to;
      r.x = free.x;
      r.y = free.y;
      r.z = free.z;
      index(r);
      touchRoom(r);
    }
  }
  function moveToArea2(ids, area) {
    const list = ids.map((id) => rooms.get(id)).filter((r) => !!r && r.area !== area);
    if (!list.length) return;
    mutate("move to area", () => relocate(list, area));
  }
  function areaLinks(id, opts = {}) {
    const out = [];
    for (const r of rooms.values()) {
      for (const e of Object.values(r.exits)) {
        if (!e.to) continue;
        const t = rooms.get(e.to);
        if (!t || t.area === r.area) continue;
        if (r.area === id || opts.both && t.area === id) out.push({ from: r, exit: e, to: t });
      }
    }
    return out;
  }
  function areaCounts() {
    const out = { "": 0 };
    for (const a of areas.keys()) out[a] = 0;
    for (const r of rooms.values()) out[r.area] = (out[r.area] ?? 0) + 1;
    return out;
  }
  function batch(label, fn) {
    return mutate(label, fn);
  }
  function undo() {
    const step = undoStack.pop();
    if (!step) return null;
    redoStack.push({ label: step.label, state: snapshot() });
    restore(step.state);
    touch("reset");
    scheduleSave();
    emit();
    return step.label;
  }
  function redo() {
    const step = redoStack.pop();
    if (!step) return null;
    undoStack.push({ label: step.label, state: snapshot() });
    restore(step.state);
    touch("reset");
    scheduleSave();
    emit();
    return step.label;
  }
  function importMap2(data) {
    const parsed = readMapFile(data);
    mutate("import map", () => {
      load(parsed);
      touch("reset");
    });
    return { rooms: rooms.size };
  }
  function erase() {
    mutate("erase map", () => {
      rooms = /* @__PURE__ */ new Map();
      areas = /* @__PURE__ */ new Map();
      nextId = 1;
      reindexAll();
      touch("reset");
    });
  }
  const store = {
    worldId,
    ready,
    room: (id) => rooms.get(id),
    rooms: () => [...rooms.values()],
    area: (id) => areas.get(id),
    areas: () => [...areas.values()],
    at: (area, x, y, z) => {
      const id = cells.get(cellKey(area, x, y, z));
      return id ? rooms.get(id) : void 0;
    },
    byVnum: (vnum) => {
      const id = vnums.get(vnum);
      return id ? rooms.get(id) : void 0;
    },
    byHandle: (handle) => {
      const id = handles.get(handle);
      return id ? rooms.get(id) : void 0;
    },
    bySig: (sig) => [...sigs.get(sig) ?? []].map((id) => rooms.get(id)).filter(Boolean),
    find,
    incoming,
    path: (from, to, opts) => dijkstra(rooms, from, to, opts),
    freeNear: (area, x, y, z) => spiralFree(taken(area), x, y, z),
    freeAlong: (room, dir) => alongFree(taken(room.area), room, dir),
    create,
    update,
    remove: remove2,
    merge,
    move,
    setExit,
    removeExit,
    link,
    unlink,
    autoConnect,
    component: (id) => componentOf(rooms, id),
    setArea,
    createArea,
    removeArea,
    moveToArea: moveToArea2,
    areaLinks,
    areaCounts,
    batch,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    export: exportData,
    import: importMap2,
    erase,
    watch: (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    flush,
    dispose: () => {
      disposed = true;
      watchers.clear();
      void flush();
    },
    watcherCount: () => watchers.size
  };
  return store;
}

// src/persist.ts
var KEY_AREAS = "areas";
var KEY_META = "meta";
var COLLECTION = "rooms";
var same2 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function storePersist(store) {
  const col = store.collection(COLLECTION);
  let lastRooms = /* @__PURE__ */ new Map();
  let lastAreas = null;
  let lastMeta = null;
  const persist = {
    async load() {
      if (store.ready) await store.ready;
      const items = col.list();
      const meta = store.get(KEY_META, void 0);
      const areasRaw = store.get(KEY_AREAS, void 0);
      if (!items.length && !meta && !areasRaw) return null;
      const rooms = {};
      lastRooms = /* @__PURE__ */ new Map();
      for (const { id, value } of items) {
        if (!value || typeof value !== "object") continue;
        const room = { ...value, id: value.id ?? id, exits: value.exits ?? {} };
        rooms[room.id] = room;
        lastRooms.set(room.id, JSON.stringify(room));
      }
      const areas = areasRaw && typeof areasRaw === "object" ? areasRaw : {};
      lastAreas = JSON.stringify(areas);
      let nextId = typeof meta?.nextId === "number" ? meta.nextId : 1;
      for (const id of Object.keys(rooms)) {
        const m = /^r(\d+)$/.exec(id);
        if (m && Number(m[1]) >= nextId) nextId = Number(m[1]) + 1;
      }
      lastMeta = JSON.stringify({ nextId, v: 2 });
      return { format: "mu-map", v: 2, rooms, areas, nextId };
    },
    async save(data) {
      try {
        const seen = /* @__PURE__ */ new Set();
        for (const [id, room] of Object.entries(data.rooms)) {
          seen.add(id);
          const json = JSON.stringify(room);
          if (lastRooms.get(id) === json) continue;
          col.put(id, room);
          lastRooms.set(id, json);
        }
        for (const id of [...lastRooms.keys()]) {
          if (seen.has(id)) continue;
          col.remove(id);
          lastRooms.delete(id);
        }
        const areasJson = JSON.stringify(data.areas);
        if (areasJson !== lastAreas) {
          store.set(KEY_AREAS, data.areas);
          lastAreas = areasJson;
        }
        const meta = { nextId: data.nextId, v: 2 };
        if (!same2(meta, lastMeta === null ? null : JSON.parse(lastMeta))) {
          store.set(KEY_META, meta);
          lastMeta = JSON.stringify(meta);
        }
      } catch (e) {
        if (persist.onError) persist.onError(e);
      }
    }
  };
  return persist;
}

// src/hash.ts
function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function sigOf(name, desc) {
  return fnv1a(`${name.trim()}
${(desc ?? "").trim()}`);
}

// src/tracker.ts
var DEFAULT_MOVE_VERBS = ["enter", "climb", "board", "leave", "exit", "go"];
var PENDING_TTL_MS = 3e4;
var PENDING_CAP = 20;
var RANK = { gmcp: 5, msdp: 4, text: 2, scene: 1 };
var rank = (s) => RANK[s] ?? 3;
var lc = (s) => (s ?? "").trim().toLowerCase();
var sameName = (a, b) => lc(a) === lc(b);
var atCell = (r, c) => r.area === c.area && r.x === c.x && r.y === c.y && r.z === c.z;
var zero = (d) => d.dx === 0 && d.dy === 0 && d.dz === 0;
var ENTER_VERB = /^(?:go\s+)?(?:enter|board|embark|disembark|leave|exit)(?:\s|$)/i;
function exitFor(room, key) {
  const k = lc(key);
  if (!k) return void 0;
  const list = Object.values(room.exits);
  return list.find((e) => lc(e.key) === k) ?? list.find((e) => lc(e.name) === k) ?? list.find((e) => sameDir(e.key, k));
}
function createTracker(opts) {
  const now = opts.now ?? (() => Date.now());
  const tracks = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const setting = (key, worldId, fallback) => {
    const v = opts.settings.get(key, worldId);
    return typeof v === "boolean" ? v : fallback;
  };
  function emit(e) {
    for (const fn of [...listeners]) fn(e);
  }
  function plain(t) {
    return { sid: t.sid, worldId: t.worldId, position: { ...t.position }, pending: [...t.pending], lastScene: t.lastScene, paused: t.paused, source: t.source };
  }
  function emitTrack(t) {
    emit({ type: "track", sid: t.sid, track: plain(t) });
  }
  function ensure(sid, worldId) {
    let t = tracks.get(sid);
    if (t) return t;
    const w = worldId ?? opts.worldOf(sid);
    if (!w) return null;
    t = { sid, worldId: w, position: { roomId: null, by: "none" }, pending: [], pendingAt: [], lastScene: null, paused: false, source: "", step: null };
    tracks.set(sid, t);
    return t;
  }
  function storeOf(t) {
    return opts.storeFor(t.worldId);
  }
  function expire(t) {
    const cut = now() - PENDING_TTL_MS;
    while (t.pendingAt.length && t.pendingAt[0] < cut) {
      t.pending.shift();
      t.pendingAt.shift();
    }
    if (t.step && t.step.at < cut) t.step = null;
  }
  function current(t, store) {
    const r = t.position.roomId ? store.room(t.position.roomId) : void 0;
    if (!r) t.position = { roomId: null, by: "none" };
    return r ?? null;
  }
  function newExit(store, ie) {
    const e = { key: ie.key, to: null };
    if (ie.name && lc(ie.name) !== lc(ie.key)) e.name = ie.name;
    if (ie.handle) e.handle = ie.handle;
    if (ie.door) e.door = ie.door;
    if (ie.to) {
      const r = store.byVnum(ie.to);
      if (r) e.to = r.id;
    }
    return e;
  }
  function mergedExits(store, room, input, replace = false) {
    if (!input.exits) return null;
    const out = {};
    for (const [k, e] of Object.entries(room.exits)) out[k] = { ...e };
    const kept = /* @__PURE__ */ new Set();
    for (const ie of input.exits) {
      if (!ie.key) continue;
      const have = exitFor({ ...room, exits: out }, ie.key) ?? (ie.name ? exitFor({ ...room, exits: out }, ie.name) : void 0);
      if (have) {
        let e = out[have.key];
        if (have.key !== ie.key && lc(have.key) !== lc(ie.name ?? "") && parseDir(ie.key)) {
          delete out[have.key];
          e = { ...e, key: ie.key };
          out[ie.key] = e;
        }
        kept.add(e.key);
        if (ie.name && lc(ie.name) !== lc(e.key)) e.name = ie.name;
        if (ie.handle) e.handle = ie.handle;
        if (ie.door !== void 0) e.door = ie.door;
        if (e.to === null && ie.to) {
          const r = store.byVnum(ie.to);
          if (r) e.to = r.id;
        }
      } else {
        out[ie.key] = newExit(store, ie);
        kept.add(ie.key);
      }
    }
    const drop = replace || input.exitsComplete === true && !room.locked;
    if (drop) {
      for (const k of Object.keys(out)) if (!kept.has(k) && !out[k].commands?.length) delete out[k];
    }
    return JSON.stringify(out) === JSON.stringify(room.exits) ? null : out;
  }
  function adopt(store, t, room, input, areaId) {
    const patch = {};
    const name = !room.locked && input.name && input.name !== room.name ? input.name : room.name;
    if (name !== room.name) patch.name = name;
    if (input.vnum && room.vnum !== input.vnum) patch.vnum = input.vnum;
    const keepDesc = setting("keepDesc", t.worldId, true);
    if (input.desc !== void 0 && keepDesc && input.desc !== room.desc) patch.desc = input.desc;
    const sig = input.desc !== void 0 ? sigOf(name, input.desc) : !room.sig || name !== room.name ? sigOf(name, room.desc) : room.sig;
    if (sig !== room.sig) patch.sig = sig;
    if (input.env && input.env !== room.env) patch.env = input.env;
    if (areaId !== room.area && !room.locked && !store.at(areaId, room.x, room.y, room.z)) patch.area = areaId;
    const exits = mergedExits(store, room, input);
    if (exits) patch.exits = exits;
    if (Object.keys(patch).length) store.update(room.id, patch);
  }
  function createFor(store, t, input, cell, warn) {
    const exits = {};
    for (const ie of input.exits ?? []) if (ie.key) exits[ie.key] = newExit(store, ie);
    const room = { name: input.name, area: cell.area, x: cell.x, y: cell.y, z: cell.z, exits, sig: sigOf(input.name, input.desc) };
    if (input.vnum) room.vnum = input.vnum;
    if (input.desc !== void 0 && setting("keepDesc", t.worldId, true)) room.desc = input.desc;
    if (input.env) room.env = input.env;
    if (warn) room.warn = warn;
    return store.create(room);
  }
  function identify(store, input, sig, expected, used, prev, stationary) {
    if (input.vnum) {
      const r = store.byVnum(input.vnum);
      if (r) return { room: r, by: "vnum" };
    }
    const ok = (r) => !!r && (!input.vnum || !r.vnum || r.vnum === input.vnum);
    if (stationary && prev && ok(prev) && sameName(prev.name, input.name)) return { room: prev, by: "signature" };
    const votes = /* @__PURE__ */ new Map();
    for (const e of input.exits ?? []) {
      if (!e.handle) continue;
      const r = store.byHandle(e.handle);
      if (ok(r)) votes.set(r.id, (votes.get(r.id) ?? 0) + 1);
    }
    if (votes.size) {
      let best = [], max = 0;
      for (const [id, n] of votes) {
        if (n > max) {
          max = n;
          best = [id];
        } else if (n === max) best.push(id);
      }
      let pick = best[0];
      if (best.length > 1 && expected) {
        const at2 = store.at(expected.area, expected.x, expected.y, expected.z);
        if (at2 && best.includes(at2.id)) pick = at2.id;
      }
      return { room: store.room(pick), by: "fingerprint" };
    }
    const byName = () => store.rooms().filter((r) => sameName(r.name, input.name));
    let cands = (input.desc ? store.bySig(sig) : byName()).filter(ok);
    if (!cands.length && input.desc) cands = byName().filter((r) => !r.desc).filter(ok);
    if (cands.length) {
      const at2 = expected ? cands.find((c) => atCell(c, expected)) : void 0;
      if (at2) return { room: at2, by: "signature" };
      const via = used?.to ? cands.find((c) => c.id === used.to) : void 0;
      if (via) return { room: via, by: "signature" };
      if (input.desc) {
        const origin = prev ?? (expected ? { area: expected.area, x: expected.x, y: expected.y, z: expected.z } : null);
        const floor = origin ? cands.filter((c) => c.area === origin.area && c.z === origin.z) : cands;
        if (!origin) return { room: cands[0], by: "signature" };
        let nearest, best = Infinity;
        for (const c of floor) {
          const d = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y);
          if (d < best) {
            best = d;
            nearest = c;
          }
        }
        if (nearest) return { room: nearest, by: "signature" };
      } else if (prev) {
        const linked = cands.find((c) => Object.values(c.exits).some((e) => e.to === prev.id) || Object.values(prev.exits).some((e) => e.to === c.id));
        if (linked) return { room: linked, by: "signature" };
      }
    }
    if (used?.to) {
      const r = store.room(used.to);
      if (ok(r) && sameName(r.name, input.name)) return { room: r, by: "signature" };
    }
    if (expected) {
      const r = store.at(expected.area, expected.x, expected.y, expected.z);
      if (ok(r) && sameName(r.name, input.name)) return { room: r, by: "signature" };
    }
    return null;
  }
  function placeNew(store, input, areaId, prev, dir, key) {
    if (input.coords) {
      const c = { area: areaId, x: input.coords.x, y: input.coords.y, z: input.coords.z };
      if (!store.at(c.area, c.x, c.y, c.z)) return { cell: c };
      return { cell: { area: areaId, ...store.freeNear(areaId, c.x, c.y, c.z) }, warn: "displaced (cell was taken)" };
    }
    if (prev && prev.area === areaId) {
      if (dir && !zero(dir)) {
        const c = { area: areaId, x: prev.x + dir.dx, y: prev.y + dir.dy, z: prev.z + dir.dz };
        if (!store.at(c.area, c.x, c.y, c.z)) return { cell: c };
        return { cell: { area: areaId, ...store.freeAlong(prev, dir) }, warn: "displaced (cell was taken)" };
      }
      return { cell: { area: areaId, ...store.freeNear(areaId, prev.x + 1, prev.y + 1, prev.z) }, warn: key ? `reached via "${key}"` : "teleport?" };
    }
    if (!store.find({ area: areaId, limit: 1 }).length) return { cell: { area: areaId, x: 0, y: 0, z: 0 } };
    return { cell: { area: areaId, ...store.freeNear(areaId, 0, 0, 0) }, warn: "unanchored" };
  }
  function scene(input) {
    const t = ensure(input.sid);
    if (!t) return;
    const store = storeOf(t);
    if (!store) return;
    if (t.source && rank(input.source) < rank(t.source)) {
      const completing = !!t.lastScene && t.lastScene.exitsComplete !== true && input.exitsComplete === true && sameName(input.name, t.lastScene.name);
      if (!completing) return;
      const here = current(t, store);
      if (here) {
        t.lastScene = input;
        if (!t.paused && input.replay !== true) store.batch("move", () => adopt(store, t, here, input, here.area));
        emitTrack(t);
        return;
      }
    } else t.source = input.source;
    expire(t);
    const prev = current(t, store);
    const prevScene = t.lastScene;
    const locateOnly = input.replay === true || t.paused;
    let key = null, confirmed = false;
    if (input.replay !== true) {
      if (t.step) {
        key = t.step.key;
        confirmed = true;
      } else if (t.pending.length) key = t.pending[0];
    }
    const used = prev && key !== null ? exitFor(prev, key) : void 0;
    const dir = (key !== null ? parseDir(key) : null) ?? (used?.dir ? parseDir(used.dir) : null);
    const areasFromGame = setting("areasFromGame", t.worldId, true);
    let areaId = areasFromGame && input.area ? slug(input.area) : "";
    const enters = prev !== null && key !== null && !input.coords && !(areasFromGame && input.area) && (dir ? zero(dir) : ENTER_VERB.test(key));
    const newArea2 = enters && setting("areaOnEnter", t.worldId, true) ? input.name : null;
    if (!areaId && prev && !enters) areaId = prev.area;
    const sig = sigOf(input.name, input.desc);
    let expected = null;
    if (input.coords) expected = { area: areaId, ...input.coords };
    else if (prev && prev.area === areaId) {
      if (key === null) expected = { area: areaId, x: prev.x, y: prev.y, z: prev.z };
      else if (dir) expected = { area: areaId, x: prev.x + dir.dx, y: prev.y + dir.dy, z: prev.z + dir.dz };
    }
    const found = identify(store, input, sig, expected, used, prev, key === null);
    t.lastScene = input;
    if (found && prev && found.room.id === prev.id) {
      if (!locateOnly) store.batch("move", () => adopt(store, t, found.room, input, areaId || found.room.area));
      emitTrack(t);
      return;
    }
    if (key !== null) {
      if (confirmed) t.step = null;
      else {
        t.pending.shift();
        t.pendingAt.shift();
      }
    }
    if (locateOnly) {
      if (found) {
        t.position = { roomId: found.room.id, by: found.by };
        emit({ type: "enter", sid: t.sid, room: found.room, prev, via: key, by: found.by });
      } else {
        t.position = { roomId: null, by: "none" };
        emit({ type: "lost", sid: t.sid, scene: input });
      }
      emitTrack(t);
      return;
    }
    let dest;
    let created = false;
    store.batch("move", () => {
      if (areaId && areasFromGame && input.area && !store.area(areaId)) store.setArea({ id: areaId, name: input.area });
      if (found) {
        adopt(store, t, found.room, input, areasFromGame && input.area ? areaId : found.room.area);
        dest = store.room(found.room.id);
      } else {
        if (newArea2 !== null) areaId = store.createArea(newArea2).id;
        const { cell, warn } = placeNew(store, input, areaId, prev, dir, key);
        dest = createFor(store, t, input, cell, warn);
        created = true;
      }
      if (prev && key !== null && prev.id !== dest.id) {
        const prevIncomplete = !prevScene || prevScene.exitsComplete !== true;
        const ex = used ?? (key !== null && parseDir(key) || prevIncomplete ? { key, to: null } : void 0);
        if (ex) store.link(prev.id, ex.key, dest.id, { back: true });
      }
      if (setting("autoConnect", t.worldId, true)) store.autoConnect(dest.area);
    });
    dest = store.room(dest.id) ?? dest;
    const by = created ? "created" : found.by;
    t.position = { roomId: dest.id, by };
    if (created) emit({ type: "created", sid: t.sid, room: dest, via: key });
    emit({ type: "enter", sid: t.sid, room: dest, prev, via: key, by });
    emitTrack(t);
  }
  function moved(sid, key, o = {}) {
    const t = ensure(sid);
    if (!t) return;
    const k = key.trim();
    if (!k) return;
    expire(t);
    if (o.confirmed) {
      const i = t.pending.findIndex((p) => lc(p) === lc(k) || sameDir(p, k));
      if (i >= 0) {
        t.pending.splice(i, 1);
        t.pendingAt.splice(i, 1);
      }
      t.step = { key: k, at: now() };
    } else {
      t.pending.push(k);
      t.pendingAt.push(now());
      while (t.pending.length > PENDING_CAP) {
        t.pending.shift();
        t.pendingAt.shift();
      }
    }
    emit({ type: "moved", sid, key: k });
    emitTrack(t);
  }
  function failed(sid, text, key) {
    const t = ensure(sid);
    if (!t) return;
    let k = key ?? null;
    if (k !== null) {
      const i = t.pending.findIndex((p) => lc(p) === lc(k) || sameDir(p, k));
      if (i < 0 && t.pending.length && !(t.step && (lc(t.step.key) === lc(k) || sameDir(t.step.key, k)))) k = t.pending[0];
    } else k = t.step?.key ?? t.pending[0] ?? null;
    t.pending = [];
    t.pendingAt = [];
    t.step = null;
    emit({ type: "failed", sid, key: k, text });
    emitTrack(t);
  }
  function anchor(sid, roomId) {
    const t = ensure(sid);
    if (!t) return;
    const store = storeOf(t);
    const room = store?.room(roomId);
    if (!store || !room) return;
    const scene2 = t.lastScene;
    store.batch("anchor", () => {
      const patch = { warn: "" };
      if (scene2) {
        const exits = mergedExits(store, room, scene2, true);
        if (exits) patch.exits = exits;
        if (scene2.vnum) patch.vnum = scene2.vnum;
        patch.sig = sigOf(room.locked ? room.name : scene2.name, scene2.desc ?? room.desc);
        if (scene2.desc !== void 0 && setting("keepDesc", t.worldId, true)) patch.desc = scene2.desc;
      }
      store.update(roomId, patch);
    });
    const prev = current(t, store);
    t.pending = [];
    t.pendingAt = [];
    t.step = null;
    t.position = { roomId, by: "anchor" };
    emit({ type: "enter", sid, room: store.room(roomId), prev, via: null, by: "anchor" });
    emitTrack(t);
  }
  function createHere(sid, cell) {
    const t = ensure(sid);
    if (!t) return null;
    const store = storeOf(t);
    if (!store || !t.lastScene) return null;
    const scene2 = t.lastScene;
    const prev = current(t, store);
    const room = store.batch("new room", () => {
      if (cell.area && !store.area(cell.area)) store.setArea({ id: cell.area, name: scene2.area ?? cell.area });
      const free = store.at(cell.area, cell.x, cell.y, cell.z) ? { area: cell.area, ...store.freeNear(cell.area, cell.x, cell.y, cell.z) } : cell;
      return createFor(store, t, scene2, free);
    });
    t.pending = [];
    t.pendingAt = [];
    t.step = null;
    t.position = { roomId: room.id, by: "created" };
    emit({ type: "created", sid, room, via: null });
    emit({ type: "enter", sid, room, prev, via: null, by: "created" });
    emitTrack(t);
    return room;
  }
  function pause(sid, paused) {
    const t = ensure(sid);
    if (!t || t.paused === paused) return;
    t.paused = paused;
    emitTrack(t);
  }
  function isMove(sid, key) {
    let k = lc(key);
    if (k.startsWith("go ")) k = k.slice(3).trim();
    if (!k) return false;
    if (parseDir(k)) return true;
    const t = tracks.get(sid);
    const worldId = t?.worldId ?? opts.worldOf(sid);
    const store = t ? storeOf(t) : null;
    const room = t && store ? current(t, store) : null;
    if (room) {
      for (const e of Object.values(room.exits)) if (lc(e.key) === k || lc(e.name) === k) return true;
    }
    for (const v of opts.moveVerbs?.(worldId) ?? DEFAULT_MOVE_VERBS) {
      const vl = lc(v);
      if (vl && (k === vl || k.startsWith(`${vl} `))) return true;
    }
    return false;
  }
  return {
    track: (sid) => {
      const t = tracks.get(sid);
      return t ? plain(t) : void 0;
    },
    tracks: () => [...tracks.values()].map(plain),
    scene,
    moved,
    failed,
    anchor,
    createHere,
    pause,
    isMove,
    on: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    drop: (sid) => {
      tracks.delete(sid);
    },
    emit
  };
}

// src/walker.ts
var HOP_GAP_MS = 50;
var DEFAULT_DELAY_MS = 150;
var DEFAULT_TIMEOUT_S = 10;
var idle = () => ({ status: "idle", target: null, route: [], at: 0 });
var copy = (s) => ({ ...s, route: [...s.route] });
function createWalker(opts) {
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => clearTimeout(h));
  const walks = /* @__PURE__ */ new Map();
  function announce(sid, w) {
    opts.tracker.emit({ type: "walk", sid, state: copy(w.state) });
  }
  function clearTimer(w) {
    if (w.timer !== null && w.timer !== void 0) {
      clearT(w.timer);
      w.timer = null;
    }
  }
  function finish(sid, w, status, reason) {
    clearTimer(w);
    w.state = { ...w.state, status };
    if (reason !== void 0) w.state.reason = reason;
    else delete w.state.reason;
    walks.delete(sid);
    announce(sid, w);
    w.done(copy(w.state));
  }
  function sendHop(sid, w) {
    const hop = w.hops[w.state.at];
    if (!hop) {
      finish(sid, w, "arrived");
      return;
    }
    let i = 0;
    const next = () => {
      if (w.state.status !== "walking") return;
      if (i < hop.length) {
        void opts.send(sid, hop[i++]);
        if (i < hop.length) {
          w.timer = setT(next, HOP_GAP_MS);
          return;
        }
      }
      w.timer = setT(() => {
        w.timer = null;
        if (w.state.status === "walking") finish(sid, w, "failed", "no room change");
      }, w.timeoutMs);
    };
    next();
  }
  function onEnter(sid, w, roomId) {
    if (w.state.status !== "walking" || w.mode !== "step") return;
    clearTimer(w);
    const expected = w.state.route[w.state.at];
    if (roomId === expected) {
      w.state = { ...w.state, at: w.state.at + 1 };
      if (w.state.at >= w.hops.length) {
        finish(sid, w, "arrived");
        return;
      }
      announce(sid, w);
      sendHop(sid, w);
      return;
    }
    if (roomId === w.state.target) {
      w.state = { ...w.state, at: w.state.route.length };
      finish(sid, w, "arrived");
      return;
    }
    if (!w.replanned && w.state.target) {
      const store = storeFor(sid);
      const path = store?.path(roomId, w.state.target, { locked: w.locked });
      if (path && path.ids.length) {
        w.replanned = true;
        w.state = { ...w.state, route: path.ids, at: 0 };
        w.hops = path.steps;
        announce(sid, w);
        sendHop(sid, w);
        return;
      }
    }
    finish(sid, w, "failed", "off route");
  }
  function sendBurst(sid, w) {
    const tick = () => {
      w.timer = null;
      if (w.state.status !== "walking") return;
      if (w.flatAt >= w.flat.length) {
        w.state = { ...w.state, at: w.hops.length };
        finish(sid, w, "arrived");
        return;
      }
      void opts.send(sid, w.flat[w.flatAt++]);
      let n = 0, at2 = 0;
      while (at2 < w.hops.length && n + w.hops[at2].length <= w.flatAt) {
        n += w.hops[at2].length;
        at2++;
      }
      if (at2 !== w.state.at) {
        w.state = { ...w.state, at: at2 };
        announce(sid, w);
      }
      if (w.flatAt >= w.flat.length) {
        finish(sid, w, "arrived");
        return;
      }
      w.timer = setT(tick, w.delayMs);
    };
    tick();
  }
  function storeFor(sid) {
    const w = opts.worldOf(sid);
    return w ? opts.storeFor(w) : null;
  }
  function begin(sid, target, route, hops, o) {
    const old = walks.get(sid);
    if (old) finish(sid, old, "stopped");
    return new Promise((done) => {
      const w = {
        state: { status: "walking", target, route, at: 0 },
        hops,
        mode: o.mode ?? "step",
        delayMs: o.delayMs ?? DEFAULT_DELAY_MS,
        timeoutMs: (o.timeoutS ?? DEFAULT_TIMEOUT_S) * 1e3,
        locked: !!o.locked,
        replanned: false,
        timer: null,
        flat: hops.flat(),
        flatAt: 0,
        done
      };
      walks.set(sid, w);
      announce(sid, w);
      if (!hops.length) {
        finish(sid, w, "arrived");
        return;
      }
      if (w.mode === "burst") sendBurst(sid, w);
      else sendHop(sid, w);
    });
  }
  opts.tracker.on((e) => {
    const w = walks.get(e.sid);
    if (!w) return;
    if (e.type === "enter") onEnter(e.sid, w, e.room.id);
    else if (e.type === "failed" && w.state.status === "walking") finish(e.sid, w, "failed", e.text);
  });
  const walker = {
    async goto(sid, roomId, o = {}) {
      const store = storeFor(sid);
      const here = opts.tracker.track(sid)?.position.roomId ?? null;
      if (!store || !here) return { ...idle(), status: "failed", target: roomId, reason: "position unknown" };
      const path = store.path(here, roomId, { locked: o.locked });
      if (!path) return { ...idle(), status: "failed", target: roomId, reason: "no route" };
      return begin(sid, roomId, path.ids, path.steps, o);
    },
    async steps(sid, steps, o = {}) {
      const hops = steps.filter((s) => s.trim()).map((s) => [s]);
      return begin(sid, null, [], hops, { ...o, mode: "burst" });
    },
    stop(sid) {
      const w = walks.get(sid);
      if (w) finish(sid, w, "stopped");
    },
    pause(sid) {
      const w = walks.get(sid);
      if (!w || w.state.status !== "walking") return;
      clearTimer(w);
      w.state = { ...w.state, status: "paused" };
      announce(sid, w);
    },
    resume(sid) {
      const w = walks.get(sid);
      if (!w || w.state.status !== "paused") return;
      w.state = { ...w.state, status: "walking" };
      announce(sid, w);
      if (w.mode === "burst") sendBurst(sid, w);
      else sendHop(sid, w);
    },
    state(sid) {
      const w = walks.get(sid);
      return w ? copy(w.state) : idle();
    }
  };
  return walker;
}

// src/sources/gmcp.ts
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var str2 = (v) => typeof v === "string" ? v.trim() || void 0 : typeof v === "number" ? String(v) : void 0;
var num2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : void 0;
function exitsOf(raw) {
  if (raw === void 0 || raw === null) return void 0;
  const out = [];
  if (typeof raw === "string") {
    for (const k of raw.split(/[\s,;]+/)) if (k.trim()) out.push({ key: k.trim().toLowerCase() });
  } else if (Array.isArray(raw)) {
    for (const e of raw) {
      if (typeof e === "string") {
        if (e.trim()) out.push({ key: e.trim().toLowerCase() });
        continue;
      }
      if (!isObj2(e)) continue;
      const key = str2(e.dir) ?? str2(e.direction) ?? str2(e.key) ?? str2(e.name);
      if (!key) continue;
      const x = { key: key.toLowerCase() };
      const name = str2(e.name);
      if (name && name.toLowerCase() !== x.key) x.name = name;
      const to = str2(e.id) ?? str2(e.to) ?? str2(e.num) ?? str2(e.vnum);
      if (to) x.to = to;
      if (typeof e.door === "string") x.door = e.door;
      out.push(x);
    }
  } else if (isObj2(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!k.trim()) continue;
      const x = { key: k.trim().toLowerCase() };
      const to = isObj2(v) ? str2(v.id) ?? str2(v.to) ?? str2(v.num) : str2(v);
      if (to) x.to = to;
      if (isObj2(v)) {
        const name = str2(v.name);
        if (name && name.toLowerCase() !== x.key) x.name = name;
      }
      out.push(x);
    }
  } else return void 0;
  return out;
}
function coordsOf(raw) {
  let x, y, z;
  if (Array.isArray(raw)) [x, y, z] = [num2(raw[0]), num2(raw[1]), num2(raw[2]) ?? 0];
  else if (isObj2(raw)) [x, y, z] = [num2(raw.x), num2(raw.y), num2(raw.z) ?? 0];
  else if (typeof raw === "string") {
    const p = raw.split(/[,\s]+/);
    [x, y, z] = [num2(p[0]), num2(p[1]), num2(p[2]) ?? 0];
  }
  return x !== void 0 && y !== void 0 && z !== void 0 ? { x, y, z } : void 0;
}
function roomInfoScene(sid, d, replay) {
  if (!isObj2(d)) return null;
  const name = str2(d.name) ?? str2(d.title);
  if (!name) return null;
  const s = { sid, source: "gmcp", name, exitsComplete: true, replay };
  const vnum = str2(d.num) ?? str2(d.id) ?? str2(d.vnum);
  if (vnum) s.vnum = vnum;
  const desc = str2(d.desc) ?? str2(d.description);
  if (desc) s.desc = desc;
  const area = str2(d.area) ?? str2(d.zone);
  if (area) s.area = area;
  const env = str2(d.environment) ?? str2(d.terrain);
  if (env) s.env = env;
  s.exits = exitsOf(d.exits) ?? [];
  const coords = coordsOf(d.coords);
  if (coords) s.coords = coords;
  return s;
}
function roomNameOf(d) {
  return str2(d) ?? (isObj2(d) ? str2(d.name) ?? "" : "");
}
function gmcpSource(mu, tracker, worldOf) {
  const subs = [];
  const inScope = (sid) => worldOf(sid) !== null;
  subs.push(mu.gmcp.on("Room.Info", (data, m) => {
    if (!inScope(m.sid)) return;
    const s = roomInfoScene(m.sid, data, m.replay);
    if (s) tracker.scene(s);
  }));
  subs.push(mu.gmcp.on("Room.Name", (data, m) => {
    if (!inScope(m.sid)) return;
    if (mu.gmcp.state("Room.Info", m.sid) !== void 0) return;
    const name = roomNameOf(data);
    if (!name) return;
    tracker.scene({ sid: m.sid, source: "gmcp", name, exits: [], exitsComplete: false, replay: m.replay });
  }));
  const msdp = /* @__PURE__ */ new Map();
  const roomOf = (sid) => msdp.get(sid) ?? msdp.set(sid, {}).get(sid);
  const report = (sid, r, replay) => {
    if (!r.name && !r.vnum) return;
    const s = { sid, source: "msdp", name: r.name ?? r.vnum ?? "", exits: r.exits ?? [], exitsComplete: r.exits !== void 0, replay };
    if (r.vnum) s.vnum = r.vnum;
    if (r.area) s.area = r.area;
    if (r.env) s.env = r.env;
    tracker.scene(s);
  };
  const apply = (sid, variable, value, replay) => {
    const r = roomOf(sid);
    let changed = false;
    const setExits = (raw) => {
      const ex = exitsOf(raw) ?? [];
      const key = JSON.stringify(ex);
      if (key !== r.exitsKey) {
        r.exitsKey = key;
        r.exits = ex;
        changed = true;
      }
    };
    const setVnum = (raw) => {
      const v = str2(raw);
      if (v !== void 0 && v !== r.vnum) {
        r.vnum = v;
        changed = true;
      }
    };
    switch (variable) {
      case "ROOM_VNUM":
        setVnum(value);
        break;
      case "ROOM_NAME":
        r.name = str2(value) ?? r.name;
        break;
      case "AREA_NAME":
        r.area = str2(value) ?? r.area;
        break;
      case "ROOM_TERRAIN":
        r.env = str2(value) ?? r.env;
        break;
      case "ROOM_EXITS":
        setExits(value);
        break;
      case "ROOM": {
        if (!isObj2(value)) return;
        const v = Object.fromEntries(Object.entries(value).map(([k, x]) => [k.toUpperCase(), x]));
        if ("NAME" in v) r.name = str2(v.NAME) ?? r.name;
        if ("AREA" in v) r.area = str2(v.AREA) ?? r.area;
        if ("TERRAIN" in v) r.env = str2(v.TERRAIN) ?? r.env;
        if ("VNUM" in v) setVnum(v.VNUM);
        if ("EXITS" in v) setExits(v.EXITS);
        break;
      }
      default:
        return;
    }
    if (changed) report(sid, r, replay);
  };
  for (const v of ["ROOM_VNUM", "ROOM_NAME", "ROOM_EXITS", "AREA_NAME", "ROOM_TERRAIN", "ROOM"]) {
    subs.push(mu.msdp.on(v, (value, m) => {
      if (inScope(m.sid)) apply(m.sid, m.variable.toUpperCase(), value, m.replay);
    }));
  }
  subs.push(mu.sessions.on("close", (s) => {
    msdp.delete(s.id);
  }));
  return () => {
    for (const d of subs.splice(0)) d();
    msdp.clear();
  };
}

// src/sources/scene.ts
function sceneInputOf(sid, v) {
  if (!v.known || !v.title) return null;
  const exits = (v.exits ?? []).filter((k) => typeof k === "string" && k.trim()).map((k) => ({ key: k.trim() }));
  const s = { sid, source: "scene", name: v.title, exits, exitsComplete: exits.length > 0 };
  if (v.id) s.vnum = v.id;
  if (v.desc) s.desc = v.desc;
  if (v.area) s.area = v.area;
  return s;
}
function sceneSource(mu, tracker) {
  return mu.sessions.each((s) => {
    let last = "";
    return mu.scene.watch((v) => {
      const input = sceneInputOf(s.id, v);
      if (!input) return;
      const key = JSON.stringify([input.vnum ?? "", input.name, input.exits?.map((e) => e.key) ?? []]);
      if (key === last) return;
      last = key;
      tracker.scene(input);
    }, s.id);
  });
}

// src/profiles/generic.ts
var GENERIC_MOVE_FAILED = [
  /^Alas, you cannot go that way/i,
  /^You can(?:'|’)?t go (?:that way|in that direction|there)/i,
  /^You cannot go (?:that way|in that direction|there)/i,
  /^There(?:'s| is) no (?:exit|way|door|passage)\b/i,
  /^There is no exit\b/i,
  /^You don(?:'|’)?t see (?:any|an|that) (?:exit|way|door)\b/i,
  /^That way is blocked/i,
  /^There is nothing in that direction/i,
  /^The (?:door|gate|hatch|portal|way) (?:is|seems to be) (?:closed|locked|shut|barred)/i,
  /\b(?:is|are) (?:closed|locked|shut|barred)\.?$/i,
  /\bblocks? (?:your|the) (?:way|path|passage)\b/i,
  /^You bump into\b/i,
  /^You (?:cannot|can(?:'|’)?t) (?:fit|pass|squeeze) through\b/i,
  /^You stop walking/i
];
var GENERIC_EXITS_LINE = [
  /^\[?\s*(?:obvious |visible )?exits?\s*(?:are)?\s*:\s*(.+?)\s*\]?\.?$/i,
  /^exits? (?:are|is)\s+(.+?)\.?$/i,
  /^there (?:are|is) (?:an? )?(?:exits?|ways?(?: out)?|doors?) (?:to(?: the)?|leading(?: to)?|lead(?:ing)? to)\s+(.+?)\.?$/i,
  /^you (?:can|may) (?:go|travel|head|walk)\s+(.+?)\.?$/i,
  /^(?:the )?(?:obvious |visible )?exits? (?:here )?(?:lead|leads|go|goes|are|is)\s+(.+?)\.?$/i
];
var DEFAULT_MOVE_VERBS2 = ["enter", "climb", "board", "leave", "exit", "go"];
function splitExits(list) {
  const out = [];
  const push = (key) => {
    if (key && !out.some((e) => e.key === key)) out.push({ key });
  };
  const parts = list.replace(/[\[\]]/g, "").replace(/\.\s*$/, "").split(/\s*[,;|]\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i);
  for (let part of parts) {
    part = part.replace(/\s*\([^)]*\)\s*/g, " ").replace(/^(?:the|a|an)\s+/i, "").replace(/^-\s*/, "").trim();
    part = part.replace(/^(.+?):\s*.+$/, "$1");
    if (!part || /^(?:none|nothing|no exits?|nowhere)$/i.test(part)) continue;
    const words = part.toLowerCase().split(/\s+/).filter((w) => /[a-z0-9]/.test(w) && (w.length > 1 || parseDir(w)));
    if (!words.length) continue;
    part = words.join(" ");
    if (words.length > 1 && words.every((w) => parseDir(w)) && !parseDir(part)) {
      for (const w of words) push(w);
      continue;
    }
    push(part.toLowerCase());
  }
  return out;
}
var GENERIC = {
  id: "generic",
  moveFailed: GENERIC_MOVE_FAILED,
  exitsLine: GENERIC_EXITS_LINE,
  exitKeys: splitExits,
  moveVerbs: DEFAULT_MOVE_VERBS2,
  lookWaitMs: 400
};

// src/sources/text.ts
var DEFAULT_LOOK_WAIT_MS = 400;
var BUFFER_MAX = 60;
var MAX_TITLE = 80;
function firstMatch(res, text) {
  for (const re of res ?? []) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
}
function moveKeyOf(raw) {
  return raw.trim().replace(/^(?:to(?:wards?)? )?(?:the )?/i, "").replace(/[.!]+$/, "").trim();
}
function exitsFromLine(profile, text) {
  const m = firstMatch(profile.exitsLine, text.trim());
  if (!m) return null;
  const list = m[1] ?? "";
  return (profile.exitKeys ?? splitExits)(list).filter((e) => e.key);
}
var looksTitle = (t) => t.length > 0 && t.length <= MAX_TITLE && !/[.!?:;,"')>\]]$/.test(t) && !/^(?:you|there|it) /i.test(t);
var HERE_RE = /^(.+?) (?:is|are) (?:[a-z]+ )?here\.?$/i;
function roomFromLines(lines, maxSections = 4) {
  const sections = [[]];
  for (const raw of lines) {
    const l = raw.trim();
    if (l) sections[sections.length - 1].push(l);
    else if (sections[sections.length - 1].length) sections.push([]);
  }
  if (!sections[sections.length - 1].length) sections.pop();
  if (!sections.length) return null;
  const tail = sections[sections.length - 1];
  const people = tail.some((l) => HERE_RE.test(l) || /^you (?:are|is) [a-z ]*here\.?$/i.test(l));
  for (let i = sections.length - 1; i >= Math.max(0, sections.length - maxSections); i--) {
    if (i === sections.length - 1 && people) continue;
    const sec = sections[i];
    let t = -1;
    for (let j = sec.length - 1; j >= 0; j--) if (looksTitle(sec[j]) && !HERE_RE.test(sec[j])) {
      t = j;
      break;
    }
    if (t < 0) continue;
    return { name: sec[t], desc: sec.slice(t + 1).join("\n") };
  }
  return null;
}
function textSource(mu, tracker, profileOf, opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const per = /* @__PURE__ */ new Map();
  const of = (sid) => per.get(sid) ?? per.set(sid, { held: null, sceneAt: 0, lastScene: null, inFlight: false, buffer: [] }).get(sid);
  const waitOf = (sid) => profileOf(sid).lookWaitMs ?? DEFAULT_LOOK_WAIT_MS;
  const noGmcp = (sid) => mu.gmcp.state("Room.Info", sid) === void 0 && mu.gmcp.state("Room.Name", sid) === void 0;
  function complete(scene, exits, look) {
    const s = { ...scene, source: "text", exits, exitsComplete: true, replay: false };
    if (look && look.desc && scene.desc === void 0 && look.name.toLowerCase() === scene.name.toLowerCase()) s.desc = look.desc;
    tracker.scene(s);
  }
  function onTrack(track) {
    const p = of(track.sid);
    if (track.lastScene === p.lastScene) return;
    p.lastScene = track.lastScene;
    p.sceneAt = now();
    p.inFlight = false;
    const scene = track.lastScene;
    if (!scene || scene.exitsComplete === true || !p.held) return;
    const held = p.held;
    p.held = null;
    if (now() - held.at > waitOf(track.sid)) return;
    complete(scene, held.exits, held.name !== void 0 ? { name: held.name, desc: held.desc ?? "" } : null);
  }
  function onExitsLine(sid, exits, look) {
    const p = of(sid);
    const track = tracker.track(sid);
    const scene = track?.lastScene ?? null;
    const wait = waitOf(sid);
    if (scene && scene.exitsComplete !== true && (now() - p.sceneAt <= wait || !p.inFlight)) {
      complete(scene, exits, look);
      return;
    }
    p.held = { exits, at: now(), ...look ? { name: look.name, desc: look.desc } : {} };
  }
  function onLine(line, ctx) {
    if (line.kind !== "output" && line.kind !== "prompt") return;
    if (line.replay === true || line.backlog === true) return;
    const sid = ctx.sid;
    const text = line.text.trim();
    const profile = profileOf(sid);
    const p = of(sid);
    if (!text) {
      if (line.kind === "output") p.buffer.push("");
      return;
    }
    let m = firstMatch(profile.moveConfirmed, text);
    if (m) {
      tracker.moved(sid, moveKeyOf(m[1] ?? ""), { confirmed: true });
      p.inFlight = true;
      return;
    }
    m = firstMatch(profile.moveQueued, text);
    if (m) {
      const key = moveKeyOf(m[1] ?? "");
      const pending = tracker.track(sid)?.pending ?? [];
      if (key && !pending.some((k) => k.toLowerCase() === key.toLowerCase())) tracker.moved(sid, key);
      return;
    }
    m = firstMatch(profile.moveFailed, text);
    if (m) {
      const key = m[1] !== void 0 ? moveKeyOf(m[1]) : null;
      if (key !== null && /^command\b/i.test(text) && !tracker.isMove(sid, key)) return;
      tracker.failed(sid, text, key);
      return;
    }
    const exits = exitsFromLine(profile, text);
    if (exits) {
      const look = line.kind === "output" ? roomFromLines(p.buffer) : null;
      p.buffer = [];
      if (look && noGmcp(sid)) {
        const src = tracker.track(sid)?.source ?? "";
        if (src !== "gmcp" && src !== "msdp") {
          const s = { sid, source: "text", name: look.name, exits, exitsComplete: true };
          if (look.desc) s.desc = look.desc;
          tracker.scene(s);
          return;
        }
      }
      onExitsLine(sid, exits, look);
      return;
    }
    if (line.kind === "output") {
      p.buffer.push(text);
      if (p.buffer.length > BUFFER_MAX) p.buffer.splice(0, p.buffer.length - BUFFER_MAX);
    }
  }
  function onInput(cmd, ctx) {
    const sid = ctx.sid;
    const p = of(sid);
    p.buffer = [];
    let text = cmd.text.trim();
    if (!text) return;
    if (/^go\s+/i.test(text)) text = text.replace(/^go\s+/i, "").trim();
    if (tracker.isMove(sid, text)) {
      tracker.moved(sid, text);
      p.inFlight = true;
    }
  }
  const subs = [
    mu.input.stage({ id: "mapper-moves", phase: "observe", run: onInput }),
    mu.lines.stage({ id: "mapper-text", phase: "observe", run: onLine }),
    tracker.on((e) => {
      if (e.type === "track") onTrack(e.track);
      else if (e.type === "moved") of(e.sid).inFlight = true;
      else if (e.type === "failed") of(e.sid).inFlight = false;
    }),
    mu.sessions.on("close", (s) => {
      per.delete(s.id);
    })
  ];
  return () => {
    for (const d of subs.splice(0)) d();
    per.clear();
  };
}

// src/profiles/underspire.ts
var UNDERSPIRE_EXITS_LINE = [
  /^(?:there (?:are|is) (?:an? )?(?:exits?|ways?(?: out)?) (?:to|leading to) |(?:obvious )?exits?: )(.+?)\.?$/i,
  /^(?:the |a )?[\w' -]+? (?:continues|leads|runs|goes on|heads) ((?:north|south|east|west|up|down|in|out)(?:east|west)?(?:,? (?:and |or )?(?:north|south|east|west|up|down|in|out)(?:east|west)?)*)\.?$/i
];
function underspireExitKeys(list) {
  const out = [];
  for (const raw of list.replace(/\.\s*$/, "").split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i)) {
    let part = raw.trim();
    if (!part) continue;
    let key;
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(part);
    if (m) {
      part = m[1].trim();
      key = m[2].trim();
    }
    const name = part.replace(/^the\s+/i, "").trim();
    if (!name && !key) continue;
    const entry = { key: (key ?? name).toLowerCase() };
    if (key && name && name.toLowerCase() !== entry.key) entry.name = name;
    if (!out.some((e) => e.key === entry.key)) out.push(entry);
  }
  return out;
}
var UNDERSPIRE = {
  id: "underspire",
  hosts: ["underspire.net", "*.underspire.net"],
  moveConfirmed: [/^You begin walking (.+?)\.?$/i],
  moveQueued: [/^You add (.+?) to your route/i],
  moveFailed: [...GENERIC_MOVE_FAILED, /^Command '(.+?)' is not available/i],
  exitsLine: UNDERSPIRE_EXITS_LINE,
  exitKeys: underspireExitKeys,
  moveVerbs: ["enter", "climb", "board", "leave", "exit", "go", "take"],
  lookWaitMs: 350
};

// src/profiles/index.ts
var BUILTIN_PROFILES = [UNDERSPIRE, GENERIC];
function matchHost(pattern, host) {
  const h = host.trim().toLowerCase().replace(/:\d+$/, "");
  const p = pattern.trim().toLowerCase();
  if (!h || !p) return false;
  if (p === "*") return true;
  if (!p.includes("*")) return h === p;
  const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^.]+")}$`);
  return re.test(h);
}
function profileFor(host, registered = []) {
  const h = host ?? "";
  for (const list of [registered, BUILTIN_PROFILES]) {
    for (const p of list) if (h && p.hosts?.some((pat) => matchHost(pat, h))) return p;
  }
  return GENERIC;
}

// src/panel/css.ts
var P = '.ext-panel[data-ext="mapper"] .mu-map';
var PANEL_CSS = `
${P} { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-elev); color: var(--fg); font-family: var(--font-mono); font-size: var(--shell-font-size, 15px); }
${P} * { box-sizing: border-box; }
/* No \`font: inherit\` on controls here: this sheet is in the \`ext\` layer and would beat the host's \`.sh-cmd\` /
   \`.sh-toggle\` sizes (.68rem). The host's base.css already resets control fonts in the \`mu\` layer. */

/* The toolbar matches the Terminal's "Output filters and tools" bar (TerminalPanel.vue .logbar): 6px gap, 3px 8px padding. */
${P} .mu-map-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 3px 8px; background: var(--bg-elev); border-bottom: 1px solid var(--border); }
${P} .mu-map-bar .mu-map-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; }
${P} .mu-map-bar .mu-map-gap { flex: 1; }
/* The area select is an underline field (.sh-field, as the host's Hotbar edit cells draw a select) at the bar's type size. */
${P} .mu-map-bar select { min-height: 24px; max-width: 10em; padding: 0 .5ch; background: var(--bg-elev); font-size: .68rem; letter-spacing: .14em; text-transform: uppercase; color: var(--fg-dim); cursor: pointer; }
${P} .mu-map-bar select:hover { color: var(--accent-bright); }
${P} .mu-map-bar .mu-map-z { display: inline-block; min-width: 3ch; text-align: center; color: var(--gold); font-size: .68rem; letter-spacing: .14em; }

${P} .mu-map-body { display: flex; flex: 1; min-height: 0; flex-direction: column; }
${P} .mu-map-stage { position: relative; flex: 1; min-height: 60px; background: var(--bg); overflow: hidden; }
${P} .mu-map-stage canvas { display: block; width: 100%; height: 100%; outline: none; cursor: default; touch-action: none; }
${P} .mu-map-stage canvas:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: -2px; }
${P} .mu-map-stage canvas[data-cursor="grab"] { cursor: grab; }
${P} .mu-map-stage canvas[data-cursor="grabbing"] { cursor: grabbing; }
${P} .mu-map-stage canvas[data-cursor="pointer"] { cursor: pointer; }
${P} .mu-map-stage canvas[data-cursor="crosshair"] { cursor: crosshair; }
${P} .mu-map-stage canvas[data-cursor="move"] { cursor: move; }

${P} .mu-map-banner { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--bg-elev); border-bottom: 1px solid var(--gold); color: var(--gold); font-size: .66rem; letter-spacing: .14em; text-transform: uppercase; z-index: 3; }
${P} .mu-map-banner .mu-map-gap { flex: 1; }

${P} .mu-map-tip { position: absolute; z-index: 4; pointer-events: none; max-width: 16rem; padding: 4px 8px; background: var(--bg-deep); border: 1px solid var(--border-bright); color: var(--fg); font-size: .72rem; line-height: 1.4; white-space: pre-line; }
${P} .mu-map-tip .mu-map-tip-name { color: var(--accent-bright); letter-spacing: .06em; }
${P} .mu-map-tip .mu-map-tip-dim { color: var(--fg-dim); }
${P} .mu-map-tip .mu-map-tip-warn { color: var(--alert); }
${P} .mu-map-tip .mu-map-tip-walk { color: var(--gold); font-size: .62rem; letter-spacing: .14em; text-transform: uppercase; }

/* Popovers are the host's dropdown (.drop in controls.css: --bg-elev, a 1px --accent edge, --menu-shadow); menu rows
   are the host's .mi with its .k key hint (ContextMenu.vue), dialogs (Legend, Controls, Areas) hold a title and body. */
${P} .mu-map-pop { position: absolute; z-index: 20; min-width: 12rem; max-width: 18rem; max-height: 70%; overflow: auto; display: flex; flex-direction: column; align-items: stretch; padding: 0; background: var(--bg-elev); border: 1px solid var(--accent); box-shadow: var(--menu-shadow); }
${P} .mu-map-pop .mi { justify-content: space-between; gap: 1.2rem; min-height: 24px; width: 100%; }
${P} .mu-map-pop .mi .mu-map-mi-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${P} .mu-map-pop .mi:disabled { color: var(--fg-faint); background: none; pointer-events: none; }
${P} .mu-map-pop .cmd, ${P} .mu-map-pop .sh-cmd, ${P} .mu-map-pop .tool { justify-content: flex-start; width: 100%; padding: 0 1.2ch 0 .8ch; }
${P} .mu-map-pop .mu-map-pop-hint { margin-left: auto; padding-left: 1.5ch; color: var(--fg-faint); font-size: .6rem; letter-spacing: .08em; }
${P} .mu-map-pop .mu-map-pop-sep { height: 1px; margin: 2px 0; background: var(--border); }
${P} .mu-map-pop .mu-map-pop-title { padding: 6px 10px 2px; color: var(--fg-faint); font-size: .6rem; letter-spacing: .2em; text-transform: uppercase; }
${P} .mu-map-pop .mu-map-pop-body { padding: 4px 1ch 6px; font-size: .74rem; line-height: 1.5; color: var(--fg-dim); }
${P} .mu-map-pop .mu-map-pop-body dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 1.2ch; margin: 0; }
${P} .mu-map-pop .mu-map-pop-body dt { color: var(--fg); white-space: nowrap; display: flex; align-items: center; gap: .6ch; }
${P} .mu-map-pop .mu-map-pop-body dd { margin: 0; }
${P} .mu-map-pop .mu-map-pop-body kbd { color: var(--gold); font-family: inherit; font-size: .66rem; letter-spacing: .08em; }
${P} .mu-map-pop svg { width: 14px; height: 14px; display: inline-block; vertical-align: middle; }

/* The inspector is content under the stage: a --border rule (--border-bright outlines controls), the host's .82rem body size.
   Its title is the Scene panel's (t-title: .85rem .16em UPPER --accent-bright, a --border-bright bottom rule). */
${P} .mu-map-insp { flex: 0 0 auto; max-height: 40%; min-height: 0; overflow: auto; background: var(--bg-elev); border-top: 1px solid var(--border); padding: 4px 10px 8px; font-size: .82rem; }
${P} .mu-map-insp[hidden], ${P} .mu-map-banner[hidden], ${P} .mu-map [hidden] { display: none; }
${P} .mu-map-insp .mu-map-sec, ${P} .mu-map-area-detail .mu-map-sec { margin: .6rem 0 .3rem; }
${P} .mu-map-insp .mu-map-title, ${P} .mu-map-area-detail .mu-map-title { display: flex; align-items: baseline; gap: 1ch; color: var(--accent-bright); font-size: .85rem; letter-spacing: .16em; text-transform: uppercase; padding: 4px 0 3px; border-bottom: 1px solid var(--border-bright); }
html[data-glow] ${P} .mu-map-title { text-shadow: 0 0 6px var(--glow); }
${P} .mu-map-insp .mu-map-title .mu-map-id, ${P} .mu-map-area-detail .mu-map-title .mu-map-id { color: var(--fg-faint); font-size: .62rem; letter-spacing: .08em; text-transform: none; text-shadow: none; }
${P} .mu-map-title .sh-plate { text-shadow: none; }
${P} .mu-map-insp .mu-map-meta, ${P} .mu-map-area-detail .mu-map-meta { color: var(--fg-dim); font-size: .7rem; letter-spacing: .04em; }
${P} .mu-map-insp .mu-map-hint, ${P} .mu-map-area-detail .mu-map-hint { color: var(--fg-faint); font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; padding: 8px 0; }
${P} .mu-map-insp .mu-map-warn, ${P} .mu-map-area-detail .mu-map-warn { display: flex; align-items: center; gap: 1ch; color: var(--alert); font-size: .7rem; padding: 2px 0; }
${P} .mu-map-insp .mu-map-actions, ${P} .mu-map-area-detail .mu-map-actions { display: flex; flex-wrap: wrap; gap: 2px 4px; margin: 2px 0 2px -.5ch; }
${P} .mu-map-insp .mu-map-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 2px 0; }
${P} .mu-map-insp .mu-map-row .mu-map-gap { flex: 1; }

${P} .mu-map-pad { display: inline-grid; grid-template-columns: repeat(3, 24px); grid-auto-rows: 24px; gap: 1px; }
${P} .mu-map-pad button { min-width: 24px; min-height: 24px; padding: 0; }
${P} .mu-map-pad .mu-map-pad-mid { display: flex; align-items: center; justify-content: center; color: var(--fg-faint); font-size: .6rem; }
${P} .mu-map-padcol { display: inline-flex; flex-direction: column; gap: 1px; margin-left: 6px; }

${P} .mu-map-swatches { display: flex; flex-wrap: wrap; gap: 3px; }
${P} .mu-map-swatch { width: 24px; height: 24px; min-width: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: var(--bg); border: 1px solid var(--border-bright); color: var(--fg-faint); cursor: pointer; }
${P} .mu-map-swatch i { display: block; width: 14px; height: 14px; background: var(--sw, var(--border)); }
${P} .mu-map-swatch:hover { border-color: var(--accent); }
${P} .mu-map-swatch.on { border-color: var(--accent-bright); box-shadow: inset 0 0 0 1px var(--accent-bright); }
${P} .mu-map-swatch:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: -2px; }
${P} .mu-map-swatch[data-sw="accent"] i { background: var(--accent); }
${P} .mu-map-swatch[data-sw="gold"] i { background: var(--gold); }
${P} .mu-map-swatch[data-sw="ok"] i { background: var(--ok); }
${P} .mu-map-swatch[data-sw="alert"] i { background: var(--alert); }
${P} .mu-map-swatch[data-sw="dim"] i { background: var(--fg-dim); }
${P} .mu-map-swatch[data-sw="sky"] i { background: color-mix(in srgb, var(--accent) 62%, var(--bg)); }
${P} .mu-map-swatch[data-sw="moss"] i { background: color-mix(in srgb, var(--ok) 62%, var(--bg)); }
${P} .mu-map-swatch[data-sw="plum"] i { background: color-mix(in srgb, color-mix(in srgb, var(--accent) 50%, var(--gold)) 50%, var(--bg)); }
${P} .mu-map-swatch[data-sw="rust"] i { background: color-mix(in srgb, var(--gold) 55%, var(--bg)); }

${P} .mu-map-glyphs { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
${P} .mu-map-glyphs .mu-map-sym { width: 2.6ch; max-width: 3.5em; text-align: center; }

${P} .mu-map-chips { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
/* A tag is a dim plate (.sh-plate.dim: a --border-bright hairline, t-micro) with its \xD7 inside. */
${P} .mu-map-chip { display: inline-flex; align-items: center; gap: 0; min-height: 24px; padding: 0 0 0 .8ch; box-shadow: inset 0 0 0 1px var(--border-bright); color: var(--fg-dim); font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; }
${P} .mu-map-chip button { min-width: 24px; min-height: 24px; }
${P} .mu-map-chips input { width: 8em; }

${P} .mu-map-insp textarea { width: 100%; min-height: 3.2em; resize: vertical; }
${P} .mu-map-insp input[type="number"] { width: 4em; }

${P} .mu-map-exits { display: flex; flex-direction: column; gap: 1px; }
${P} .mu-map-exit { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; min-height: 24px; padding: 1px 0; border-bottom: 1px solid var(--border); font-size: .74rem; }
${P} .mu-map-exit .mu-map-key { color: var(--gold); letter-spacing: .06em; min-width: 3ch; }
${P} .mu-map-exit .mu-map-arrow { color: var(--fg-faint); }
${P} .mu-map-exit .mu-map-dest { color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14em; }
${P} .mu-map-exit .mu-map-dest.mu-map-none { color: var(--fg-faint); }
${P} .mu-map-exit .mu-map-door { color: var(--fg-dim); font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; }
${P} .mu-map-exit .mu-map-cost { width: 3.5em; min-height: 22px; }
${P} .mu-map-exit .mu-map-exit-tools { display: inline-flex; flex-wrap: wrap; gap: 0 2px; margin-left: auto; }

/* The status line: a bar (3px 8px) of readouts in the host's readout style (.64rem .14em UPPER --fg-dim). */
${P} .mu-map-status { display: flex; align-items: center; gap: 1.2ch; padding: 3px 8px; min-height: 24px; border-top: 1px solid var(--border); background: var(--bg-elev); color: var(--fg-dim); font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; overflow: hidden; }
${P} .mu-map-status .mu-map-gap { flex: 1; }
${P} .mu-map-status .mu-map-status-msg { color: var(--gold); overflow: hidden; text-overflow: ellipsis; }
${P} .mu-map-status .mu-map-status-warn { color: var(--alert); }

${P} .mu-map-areas { min-width: 16rem; max-width: 22rem; }
${P} .mu-map-areas > * { flex: none; }
${P} .mu-map-area-list { display: flex; flex-direction: column; max-height: 9rem; overflow: auto; border-bottom: 1px solid var(--border); }
${P} .mu-map-area-row { display: flex; align-items: center; gap: .8ch; }
${P} .mu-map-area-row .mu-map-area-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${P} .mu-map-area-sw { display: inline-block; width: 10px; height: 10px; flex: none; background: var(--border); }
${P} .mu-map-area-sw-none { background: transparent; border: 1px solid var(--border); }
${P} .mu-map-area-sw[data-sw="accent"] { background: var(--accent); }
${P} .mu-map-area-sw[data-sw="gold"] { background: var(--gold); }
${P} .mu-map-area-sw[data-sw="ok"] { background: var(--ok); }
${P} .mu-map-area-sw[data-sw="alert"] { background: var(--alert); }
${P} .mu-map-area-sw[data-sw="dim"] { background: var(--fg-dim); }
${P} .mu-map-area-sw[data-sw="sky"] { background: color-mix(in srgb, var(--accent) 62%, var(--bg)); }
${P} .mu-map-area-sw[data-sw="moss"] { background: color-mix(in srgb, var(--ok) 62%, var(--bg)); }
${P} .mu-map-area-sw[data-sw="plum"] { background: color-mix(in srgb, color-mix(in srgb, var(--accent) 50%, var(--gold)) 50%, var(--bg)); }
${P} .mu-map-area-sw[data-sw="rust"] { background: color-mix(in srgb, var(--gold) 55%, var(--bg)); }
${P} .mu-map-area-tools { display: flex; gap: 4px; padding: 2px .4ch; border-bottom: 1px solid var(--border); }
${P} .mu-map-area-detail { padding: 2px 1ch 6px; font-size: .78rem; }
${P} .mu-map-area-detail textarea { width: 100%; min-height: 3em; resize: vertical; }
${P} .mu-map-area-links { display: flex; flex-direction: column; gap: 1px; }
${P} .mu-map-area-link { font-size: .7rem; letter-spacing: .02em; text-transform: none; white-space: normal; text-align: left; line-height: 1.3; min-height: 24px; }
${P} .mu-map-insp .mu-map-area-btn { display: inline-flex; min-height: 20px; padding: 0 .4ch; font-size: inherit; letter-spacing: inherit; text-transform: inherit; color: var(--fg-dim); }
${P} .mu-map-insp .mu-map-area-btn:hover { color: var(--accent-bright); }

${P} .mu-map-legend { display: grid; grid-template-columns: auto 1fr; gap: 3px 1.2ch; align-items: center; }
${P} .mu-map-legend svg { color: var(--fg-dim); }

${P} .cmd, ${P} .sh-cmd, ${P} .tool, ${P} .mu-map-swatch, ${P} .mu-map-chip button { transition: color .12s ease, background-color .12s ease, border-color .12s ease; }
html[data-calm] ${P} *, ${P} .mu-map-calm * { transition: none !important; }
@media (prefers-reduced-motion: reduce) { ${P} * { transition: none !important; } }
`;

// src/panel/render.ts
var ROOM_HALF = 0.36;
var STUB_LEN = 0.11;
var GRID_MIN_SCALE = 22;
var NAMES_MIN_SCALE = 44;
var CHIP_MIN_SCALE = 44;
function parseHex(c) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
var toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
function mix(a, b, share) {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return a;
  const t = Math.max(0, Math.min(1, share));
  return `#${toHex(pa[0] * t + pb[0] * (1 - t))}${toHex(pa[1] * t + pb[1] * (1 - t))}${toHex(pa[2] * t + pb[2] * (1 - t))}`;
}
function withAlpha(c, alpha) {
  const p = parseHex(c);
  if (!p) return c;
  return `#${toHex(p[0])}${toHex(p[1])}${toHex(p[2])}${toHex(alpha * 255)}`;
}
function roomColorHex(color2, t) {
  switch (color2) {
    case "accent":
      return t.accent;
    case "gold":
      return t.gold;
    case "ok":
      return t.ok;
    case "alert":
      return t.alert;
    case "dim":
      return t.fgDim;
    case "sky":
      return mix(t.accent, t.bg, 0.62);
    case "moss":
      return mix(t.ok, t.bg, 0.62);
    case "plum":
      return mix(mix(t.accent, t.gold, 0.5), t.bg, 0.5);
    case "rust":
      return mix(t.gold, t.bg, 0.55);
    default:
      return t.border;
  }
}
function edgePoint(cx, cy, dx, dy, half) {
  return { x: cx + Math.sign(dx) * half, y: cy + Math.sign(dy) * half };
}
function exitVector(exit) {
  const d = parseDir(exit.key) ?? (exit.dir ? dirByName(exit.dir) : void 0);
  return d ? { dx: d.dx, dy: d.dy, dz: d.dz } : null;
}
function sameFloor(a, b) {
  return a.z === b.z && a.area === b.area;
}
function hasBackLink(target, roomId) {
  for (const e of Object.values(target.exits)) if (e.to === roomId) return true;
  return false;
}
function ellipsise(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}\u2026`).width > maxW) s = s.slice(0, -1);
  return `${s}\u2026`;
}
function draw(ctx, w, h, dpr, scene) {
  const { view, tokens: t } = scene;
  const s = view.scale;
  const half = ROOM_HALF * s;
  const px = (x) => w / 2 + (x - view.cx) * s;
  const py = (y) => h / 2 + (y - view.cy) * s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  if (s >= GRID_MIN_SCALE) drawGrid(ctx, w, h, scene);
  drawRoute(ctx, scene, px, py);
  const onFloor = /* @__PURE__ */ new Map();
  for (const r of scene.rooms) onFloor.set(r.id, r);
  const drawnPairs = /* @__PURE__ */ new Set();
  for (const r of scene.rooms) drawLinks(ctx, r, scene, drawnPairs, px, py, half);
  for (const r of scene.rooms) drawDecor(ctx, r, scene, px, py, half);
  for (const r of scene.rooms) drawRoom(ctx, r, scene, px, py, half);
  for (const r of scene.rooms) drawName(ctx, r, scene, px, py, half);
  if (scene.drag) drawDrag(ctx, scene.drag, t, px, py, half);
  if (scene.box) drawBox(ctx, scene.box, t);
  if (!scene.rooms.length && scene.emptyMessage) drawEmpty(ctx, w, h, scene);
}
function drawGrid(ctx, w, h, scene) {
  const { view, tokens: t } = scene;
  const s = view.scale;
  const x0 = Math.floor(view.cx - w / 2 / s) - 1, x1 = Math.ceil(view.cx + w / 2 / s) + 1;
  const y0 = Math.floor(view.cy - h / 2 / s) - 1, y1 = Math.ceil(view.cy + h / 2 / s) + 1;
  ctx.fillStyle = t.border;
  const r = s >= 60 ? 1.5 : 1;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      ctx.fillRect(w / 2 + (x - view.cx) * s - r / 2, h / 2 + (y - view.cy) * s - r / 2, r, r);
    }
  }
}
function drawRoute(ctx, scene, px, py) {
  if (scene.route.length < 2) return;
  const s = scene.view.scale;
  ctx.strokeStyle = withAlpha(scene.tokens.gold, 0.35);
  ctx.lineWidth = Math.max(4, s * 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  let pen = false;
  for (const id of scene.route) {
    const r = scene.byId(id);
    if (!r || r.z !== scene.view.z || r.area !== scene.view.area) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(px(r.x), py(r.y));
    else ctx.moveTo(px(r.x), py(r.y));
    pen = true;
  }
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}
function arrowHead(ctx, x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}
function drawLinks(ctx, room, scene, drawn, px, py, half) {
  const { tokens: t, view } = scene;
  const s = view.scale;
  const cx = px(room.x), cy = py(room.y);
  for (const exit of Object.values(room.exits)) {
    if (!exit.to) continue;
    const target = scene.byId(exit.to);
    if (!target || !sameFloor(target, room)) continue;
    const pairKey = room.id < target.id ? `${room.id}|${target.id}` : `${target.id}|${room.id}`;
    if (drawn.has(pairKey)) continue;
    drawn.add(pairKey);
    const oneway = !!exit.oneway || !hasBackLink(target, room.id);
    const v = exitVector(exit);
    const tx = px(target.x), ty = py(target.y);
    const straight = v && v.dz === 0 && (v.dx || v.dy) && target.x === room.x + v.dx && target.y === room.y + v.dy;
    if (straight && v) {
      const a = edgePoint(cx, cy, v.dx, v.dy, half);
      const b = edgePoint(tx, ty, -v.dx, -v.dy, half);
      ctx.strokeStyle = t.fgDim;
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (oneway) {
        ctx.fillStyle = t.fgDim;
        arrowHead(ctx, b.x, b.y, Math.atan2(b.y - a.y, b.x - a.x), Math.max(4, s * 0.14));
      }
      continue;
    }
    const ddx = tx - cx, ddy = ty - cy;
    const len = Math.hypot(ddx, ddy) || 1;
    const nx = -ddy / len, ny = ddx / len;
    const bend = Math.min(len * 0.25, s * 0.9);
    const mx = (cx + tx) / 2 + nx * bend, my = (cy + ty) / 2 + ny * bend;
    ctx.strokeStyle = t.gold;
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.setLineDash([Math.max(3, s * 0.12), Math.max(3, s * 0.1)]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    if (oneway) {
      ctx.fillStyle = t.gold;
      const end = edgePoint(tx, ty, Math.sign(tx - mx), Math.sign(ty - my), half);
      arrowHead(ctx, end.x, end.y, Math.atan2(ty - my, tx - mx), Math.max(4, s * 0.14));
    }
    if (s >= CHIP_MIN_SCALE) {
      const label = exit.key;
      ctx.font = `${Math.max(9, Math.round(s * 0.22))}px ${scene.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width + 8;
      const th = Math.max(12, s * 0.28);
      const bx = (cx + 2 * mx + tx) / 4, by = (cy + 2 * my + ty) / 4;
      ctx.fillStyle = t.bgDeep;
      ctx.fillRect(bx - tw / 2, by - th / 2, tw, th);
      ctx.strokeStyle = t.gold;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - tw / 2, by - th / 2, tw, th);
      ctx.fillStyle = t.gold;
      ctx.fillText(label, bx, by);
    }
  }
}
function drawDecor(ctx, room, scene, px, py, half) {
  const { tokens: t, view } = scene;
  const s = view.scale;
  const cx = px(room.x), cy = py(room.y);
  let tags = 0;
  for (const exit of Object.values(room.exits)) {
    const target = exit.to ? scene.byId(exit.to) : void 0;
    if (target && sameFloor(target, room)) continue;
    const crossArea = !!target && target.area !== room.area;
    const v = exitVector(exit);
    if (crossArea && v && (v.dx || v.dy)) {
      drawStub(ctx, cx, cy, v.dx, v.dy, half, s, { ...t, fgDim: t.gold }, true, v.dz !== 0);
      continue;
    }
    if (crossArea && v && !v.dx && !v.dy && v.dz !== 0) {
      drawCornerTriangle(ctx, cx, cy, v.dz > 0, half, s, { ...t, fgDim: t.gold }, true);
      continue;
    }
    if (crossArea) {
      drawStub(ctx, cx, cy, 1, 1, half, s, { ...t, fgDim: t.gold }, true, false);
      continue;
    }
    if (!v) {
      if (!target) tags++;
      else drawStub(ctx, cx, cy, 1, 1, half, s, t, true, false);
      continue;
    }
    const otherFloor = !!target || v.dz !== 0;
    if (v.dz !== 0 && !v.dx && !v.dy) {
      drawCornerTriangle(ctx, cx, cy, v.dz > 0, half, s, t, !!target);
      continue;
    }
    if (!v.dx && !v.dy) {
      if (!target) tags++;
      continue;
    }
    drawStub(ctx, cx, cy, v.dx, v.dy, half, s, t, otherFloor, v.dz !== 0);
  }
  if (tags) {
    const size = Math.max(5, s * 0.16);
    ctx.fillStyle = t.gold;
    ctx.fillRect(cx - half - size * 0.4, cy + half - size * 0.6, size, size);
  }
  if (room.warn) {
    ctx.fillStyle = t.alert;
    ctx.beginPath();
    ctx.arc(cx - half, cy - half, Math.max(2, s * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawStub(ctx, cx, cy, dx, dy, half, s, t, filled, diagonalFloor) {
  const a = edgePoint(cx, cy, dx, dy, half);
  const len = Math.max(3, s * STUB_LEN);
  const n = Math.hypot(dx, dy) || 1;
  const ex = a.x + dx / n * len, ey = a.y + dy / n * len;
  ctx.strokeStyle = t.fgDim;
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const r = Math.max(2, s * 0.06);
  ctx.beginPath();
  ctx.arc(ex + dx / n * r, ey + dy / n * r, r, 0, Math.PI * 2);
  if (filled) {
    ctx.fillStyle = t.fgDim;
    ctx.fill();
  } else {
    ctx.stroke();
  }
  if (diagonalFloor) {
    const tr = r;
    const tx = ex + dx / n * r * 2.4, ty = ey + dy / n * r * 2.4;
    ctx.fillStyle = t.fgDim;
    ctx.beginPath();
    ctx.moveTo(tx, ty - tr);
    ctx.lineTo(tx + tr, ty + tr);
    ctx.lineTo(tx - tr, ty + tr);
    ctx.closePath();
    ctx.fill();
  }
}
function drawCornerTriangle(ctx, cx, cy, up, half, s, t, filled) {
  const size = Math.max(4, s * 0.16);
  const x = cx + half + 1, y = up ? cy - half - 1 : cy + half + 1;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x + size / 2, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y);
  } else {
    ctx.moveTo(x + size / 2, y + size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineWidth = 1;
  if (filled) {
    ctx.fillStyle = t.fgDim;
    ctx.fill();
  } else {
    ctx.strokeStyle = t.fgDim;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}
function drawRoom(ctx, room, scene, px, py, half) {
  const { tokens: t, view } = scene;
  const s = view.scale;
  const cx = px(room.x), cy = py(room.y);
  const current = room.id === scene.currentId;
  const selected = scene.selection.has(room.id);
  const hovered = room.id === scene.hover;
  if (current && !scene.calm) {
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = Math.max(6, s * 0.45);
  }
  ctx.fillStyle = room.color ? roomColorHex(room.color, t) : scene.areaColor ? mix(roomColorHex(scene.areaColor, t), t.bg, 0.45) : t.border;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.setLineDash([]);
  ctx.lineWidth = current ? 2 : 1;
  ctx.strokeStyle = current ? t.accentBright : hovered ? t.fg : t.borderBright;
  ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
  if (selected) {
    ctx.strokeStyle = t.gold;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const pad = half + 3;
    ctx.strokeRect(cx - pad, cy - pad, pad * 2, pad * 2);
    ctx.setLineDash([]);
  }
  if (room.symbol && s >= 14) {
    ctx.fillStyle = room.color && room.color !== "dim" ? t.bgDeep : t.fg;
    ctx.font = `500 ${Math.max(8, Math.round(half * 1.2))}px ${scene.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(room.symbol.slice(0, 2), cx, cy + 0.5);
  }
}
function drawName(ctx, room, scene, px, py, half) {
  const { tokens: t, view } = scene;
  const s = view.scale;
  const single = scene.selection.size === 1 && scene.selection.has(room.id);
  const show = room.id === scene.hover || single || view.names && s >= NAMES_MIN_SCALE;
  if (!show || !room.name) return;
  const cx = px(room.x), cy = py(room.y);
  const size = Math.max(9, Math.min(12, Math.round(s * 0.22)));
  ctx.font = `${size}px ${scene.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const left = at(scene, room.x - 1, room.y), right = at(scene, room.x + 1, room.y);
  const row = left !== null || right !== null;
  const above = labelsAbove(scene, room) && !single && room.id !== scene.hover;
  const crowded = left !== null && labelsAbove(scene, left) === above || right !== null && labelsAbove(scene, right) === above;
  const maxW = Math.max(crowded ? 36 : 60, Math.min(180, crowded ? s - 6 : row ? s * 2 - 10 : s * 3.4));
  const label = ellipsise(ctx, room.name, maxW);
  const tw = ctx.measureText(label).width + 6;
  const th = size + 2;
  const y = above ? cy - half - 1 - th : cy + half + 1;
  ctx.fillStyle = withAlpha(t.bgDeep, 0.9);
  ctx.fillRect(cx - tw / 2, y, tw, th);
  ctx.fillStyle = room.id === scene.currentId ? t.accentBright : t.fg;
  ctx.fillText(label, cx, y + 1);
}
function occupied(scene, room, dx, dy) {
  return at(scene, room.x + dx, room.y + dy, room) !== null;
}
function at(scene, x, y, not) {
  for (const r of scene.rooms) if (r.x === x && r.y === y && r !== not) return r;
  return null;
}
function labelsAbove(scene, room) {
  if (occupied(scene, room, 0, -1)) return false;
  if (occupied(scene, room, 0, 1)) return true;
  const left = at(scene, room.x - 1, room.y), right = at(scene, room.x + 1, room.y);
  if (left === null && right === null) return false;
  const blocked = (r) => r !== null && at(scene, r.x, r.y - 1) !== null;
  if (blocked(left) || blocked(right)) return true;
  return Math.abs(room.x + room.y) % 2 === 1;
}
function drawDrag(ctx, drag, t, px, py, half) {
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  for (const c of drag.cells) ctx.strokeRect(px(c.x) - half, py(c.y) - half, half * 2, half * 2);
  ctx.setLineDash([]);
}
function drawBox(ctx, box, t) {
  const x = Math.min(box.x0, box.x1), y = Math.min(box.y0, box.y1);
  const w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0);
  ctx.fillStyle = withAlpha(t.accent, 0.12);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
}
function drawEmpty(ctx, w, h, scene) {
  ctx.fillStyle = scene.tokens.fgFaint;
  ctx.font = `10px ${scene.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((scene.emptyMessage ?? "").toUpperCase().split("").join(" "), w / 2, h / 2);
}

// src/panel/view.ts
var MIN_SCALE = 8;
var MAX_SCALE = 120;
var DEFAULT_SCALE = 40;
var STORAGE_KEY = "view";
var SAVE_DELAY_MS2 = 400;
function clean(v) {
  const o = v && typeof v === "object" ? v : {};
  const num4 = (k, fb) => typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] : fb;
  const bool2 = (k, fb) => typeof o[k] === "boolean" ? o[k] : fb;
  return {
    cx: num4("cx", 0),
    cy: num4("cy", 0),
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, num4("scale", DEFAULT_SCALE))),
    z: Math.round(num4("z", 0)),
    area: typeof o.area === "string" ? o.area : "",
    follow: bool2("follow", true),
    mode: o.mode === "edit" ? "edit" : "walk",
    names: bool2("names", false),
    details: bool2("details", true)
  };
}
var View = class {
  constructor(store) {
    this.store = store;
    this.state = clean(store?.get(STORAGE_KEY));
  }
  store;
  state;
  /** Selected room ids (edit mode). Not persisted. */
  selection = /* @__PURE__ */ new Set();
  pick = null;
  /** The canvas size in CSS px, set by the panel on resize. */
  width = 300;
  height = 200;
  saveTimer = null;
  listeners = /* @__PURE__ */ new Set();
  /** Change the view; persists (debounced) and notifies. */
  set(patch) {
    let changed = false;
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v !== void 0 && this.state[k] !== v) {
        this.state[k] = v;
        changed = true;
      }
    }
    if (!changed) return;
    this.state.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.state.scale));
    this.scheduleSave();
    this.emit();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit() {
    for (const f of [...this.listeners]) f();
  }
  scheduleSave() {
    if (!this.store) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DELAY_MS2);
  }
  /** Write the view state now (on unmount). */
  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      this.store?.set(STORAGE_KEY, { ...this.state });
    } catch {
    }
  }
  /* ── coordinates ── */
  /** The CSS px of the centre of cell (x, y). */
  pointOf(x, y) {
    const s = this.state.scale;
    return { px: this.width / 2 + (x - this.state.cx) * s, py: this.height / 2 + (y - this.state.cy) * s };
  }
  /** The cell under CSS px (px, py) (the nearest cell centre). */
  cellAt(px, py) {
    const s = this.state.scale;
    return { x: Math.round(this.state.cx + (px - this.width / 2) / s), y: Math.round(this.state.cy + (py - this.height / 2) / s) };
  }
  /** The cell under CSS px without rounding (for hit tests against a room square). */
  cellAtExact(px, py) {
    const s = this.state.scale;
    return { x: this.state.cx + (px - this.width / 2) / s, y: this.state.cy + (py - this.height / 2) / s };
  }
  /** Whether (px, py) falls within the square of the room at cell (x, y), half-size `half` cells (the drawn square by default). */
  hitsRoom(px, py, x, y, half = ROOM_HALF) {
    const c = this.cellAtExact(px, py);
    return Math.abs(c.x - x) <= half && Math.abs(c.y - y) <= half;
  }
  /** Zoom by `factor` keeping the map point under (px, py) still. */
  zoomAt(factor, px, py) {
    const before = this.cellAtExact(px, py);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.state.scale * factor));
    if (scale === this.state.scale) return;
    const cx = before.x - (px - this.width / 2) / scale;
    const cy = before.y - (py - this.height / 2) / scale;
    this.set({ scale, cx, cy });
  }
  /** Pan by CSS px. */
  panBy(dxPx, dyPx) {
    const s = this.state.scale;
    this.set({ cx: this.state.cx - dxPx / s, cy: this.state.cy - dyPx / s });
  }
  /** Centre on a cell, optionally switching floor and area. */
  centreOn(x, y, z, area) {
    const patch = { cx: x, cy: y };
    if (z !== void 0) patch.z = z;
    if (area !== void 0) patch.area = area;
    this.set(patch);
  }
  /** Scale and centre so every given cell is visible with a margin. */
  fitTo(cells, maxScale = 60) {
    if (!cells.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) {
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
    const w = x1 - x0 + 2, hgt = y1 - y0 + 2;
    const scale = Math.min(maxScale, Math.max(MIN_SCALE, Math.floor(Math.min(this.width / w, this.height / hgt))));
    this.set({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale });
  }
  /** Whether a cell is on screen (with a margin of `pad` cells inside the edge). */
  isVisible(x, y, pad = 0.5) {
    const p = this.pointOf(x, y);
    const m = pad * this.state.scale;
    return p.px >= m && p.py >= m && p.px <= this.width - m && p.py <= this.height - m;
  }
  /* ── selection ── */
  select(ids, add = false) {
    if (!add) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.emit();
  }
  toggleSelect(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.emit();
  }
  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.emit();
  }
  /** The single selected room id, or null. */
  single() {
    return this.selection.size === 1 ? [...this.selection][0] : null;
  }
  setPick(p) {
    this.pick = p;
    this.emit();
  }
  /** The hot-reload snapshot. */
  snapshot() {
    return { view: { ...this.state }, selection: [...this.selection] };
  }
  restore(s) {
    if (!s || typeof s !== "object") return;
    const o = s;
    if (o.view) this.state = clean({ ...this.state, ...o.view });
    if (Array.isArray(o.selection)) {
      this.selection.clear();
      for (const id of o.selection) if (typeof id === "string") this.selection.add(id);
    }
    this.emit();
  }
  dispose() {
    this.saveNow();
    this.listeners.clear();
  }
};

// src/panel/areas.ts
var T = {
  title: "Areas",
  defaultName: "default",
  rooms: (n) => `${n} room${n === 1 ? "" : "s"}`,
  show: "Show",
  newArea: "New area\u2026",
  rename: "Rename\u2026",
  note: "note",
  colour: "colour",
  del: "Delete\u2026",
  moveSel: (n) => `Move ${n} selected here`,
  links: "links to other areas",
  noLinks: "no exits lead out of this area",
  linkRow: (l, name) => `${l.from.name || l.from.id} \u2014${l.exit.key}\u2192 ${l.to.name || l.to.id} [${name(l.to.area)}]`,
  newTitle: "New area",
  newLabel: "name",
  newPh: "The Keep",
  renameTitle: "Rename area",
  nameNeeded: "a name is needed",
  delTitle: (n) => `Delete area \u201C${n}\u201D?`,
  delBody: (n) => n ? `It has ${n} rooms. Delete them too, or move them to the default area?` : "It has no rooms.",
  delRooms: "Delete rooms",
  delMove: "Move rooms out",
  delOk: "Delete",
  pickColour: "Area colour",
  notePh: "a note about this area",
  defaultTip: "the default area has no name, note or colour and cannot be deleted",
  close: "Close",
  created: (n) => `Area \u201C${n}\u201D created`,
  deleted: (n) => `Area \u201C${n}\u201D deleted`,
  moved: (n, a) => `${n} room${n === 1 ? "" : "s"} moved to ${a}`
};
function areaIds(ctx) {
  const counts = ctx.store.areaCounts();
  const ids = new Set(Object.keys(counts));
  for (const a of ctx.store.areas()) ids.add(a.id);
  const out = [...ids].filter((id) => id !== "" && (counts[id] || ctx.store.area(id)));
  out.sort((a, b) => areaName(ctx, a).localeCompare(areaName(ctx, b)));
  if (counts[""] || ctx.view.state.area === "") out.unshift("");
  return out;
}
function areaName(ctx, id) {
  if (id === "") return T.defaultName;
  return ctx.store.area(id)?.name || id;
}
function openAreas(ctx, anchor, chosen = ctx.view.state.area) {
  const { h, css } = ctx.mu.ui;
  const r = anchor.getBoundingClientRect(), p = ctx.root.getBoundingClientRect();
  const x = r.left - p.left, y = r.bottom - p.top + 2;
  let current = chosen;
  let unwatch = null;
  const pop = popover(ctx, x, y, (el, close) => {
    el.classList.add("mu-map-areas");
    const render = () => {
      const ids = areaIds(ctx);
      if (!ids.includes(current)) current = ids[0] ?? "";
      const counts = ctx.store.areaCounts();
      const list = h("div", { class: "mu-map-area-list", role: "listbox", "aria-label": T.title });
      for (const id of ids) {
        const on = id === current;
        const a = ctx.store.area(id);
        list.append(h(
          "button",
          {
            class: `${css.cmd} mu-map-area-row${on ? ` ${css.on}` : ""}`,
            type: "button",
            role: "option",
            "aria-selected": on ? "true" : "false",
            "data-area": id,
            onclick: () => {
              current = id;
              render();
            }
          },
          a?.color ? h("i", { class: "mu-map-area-sw", "data-sw": a.color, "aria-hidden": "true" }) : h("i", { class: "mu-map-area-sw mu-map-area-sw-none", "aria-hidden": "true" }),
          h("span", { class: "mu-map-area-name" }, areaName(ctx, id)),
          h("span", { class: "mu-map-pop-hint" }, T.rooms(counts[id] ?? 0))
        ));
      }
      el.replaceChildren(
        h("div", { class: "mu-map-pop-title" }, T.title),
        list,
        h(
          "div",
          { class: "mu-map-area-tools" },
          btn(T.newArea, () => void newArea(ctx, (id) => {
            current = id;
            render();
          }), { title: "create an empty area" }),
          btn(T.close, close)
        ),
        detail(current)
      );
    };
    const btn = (label, run, extra = {}) => h("button", { class: css.cmd, type: "button", ...extra, onclick: run }, label);
    const detail = (id) => {
      const a = ctx.store.area(id);
      const isDefault = id === "";
      const count = ctx.store.areaCounts()[id] ?? 0;
      const sel = [...ctx.view.selection].map((rid) => ctx.store.room(rid)).filter((rm) => !!rm && rm.area !== id);
      const links = ctx.store.areaLinks(id);
      const body = h("div", { class: "mu-map-area-detail", "data-area": id });
      body.append(h("div", { class: "mu-map-title" }, areaName(ctx, id), h("span", { class: "mu-map-id" }, isDefault ? "" : id)));
      if (isDefault) body.append(h("div", { class: "mu-map-meta" }, T.defaultTip));
      body.append(h(
        "div",
        { class: "mu-map-actions" },
        btn(T.show, () => {
          ctx.view.set({ area: id });
          ctx.actions.fit();
        }, { disabled: ctx.view.state.area === id ? true : void 0, title: "show this area on the map" }),
        isDefault ? null : btn(T.rename, () => void rename(ctx, id, a?.name ?? id, render)),
        isDefault ? null : btn(T.del, () => void remove(ctx, id, count, (gone) => {
          if (gone) {
            current = "";
          }
          render();
        }), { class: `${css.cmd} ${css.warn}` }),
        sel.length ? btn(T.moveSel(sel.length), () => {
          ctx.store.moveToArea(sel.map((rm) => rm.id), id);
          ctx.toast(T.moved(sel.length, areaName(ctx, id)));
          render();
        }, { title: "move the selected rooms into this area" }) : null
      ));
      if (!isDefault) {
        const note = h("textarea", { class: css.field, placeholder: T.notePh, "aria-label": T.note, rows: "2" });
        note.value = a?.note ?? "";
        note.addEventListener("change", () => ctx.store.setArea({ id, note: note.value.trim() || void 0 }));
        body.append(h("div", { class: `${css.secHead} mu-map-sec` }, T.note), note);
        const sw = h("div", { class: "mu-map-swatches", role: "radiogroup", "aria-label": T.colour });
        for (const c of ROOM_COLORS) {
          const on = (a?.color ?? "") === c;
          sw.append(h("button", {
            class: `mu-map-swatch${on ? " on" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": on ? "true" : "false",
            "data-sw": c,
            title: colorLabel(c),
            "aria-label": colorLabel(c),
            onclick: () => {
              ctx.store.setArea({ id, color: c || void 0 });
              render();
            }
          }, c ? h("i") : "\xD7"));
        }
        body.append(h("div", { class: `${css.secHead} mu-map-sec` }, T.colour), sw);
      }
      body.append(h("div", { class: `${css.secHead} mu-map-sec` }, `${T.links} (${links.length})`));
      if (!links.length) body.append(h("div", { class: "mu-map-hint" }, T.noLinks));
      else {
        const ul = h("div", { class: "mu-map-area-links" });
        for (const l of links.slice(0, 40)) {
          ul.append(h("button", {
            class: `${css.cmd} mu-map-area-link`,
            type: "button",
            title: "show this exit on the map",
            onclick: () => {
              ctx.view.set({ area: l.from.area, z: l.from.z });
              ctx.view.centreOn(l.from.x, l.from.y);
              if (ctx.view.state.mode === "edit") ctx.view.select([l.from.id]);
              close();
            }
          }, T.linkRow(l, (aid) => areaName(ctx, aid))));
        }
        if (links.length > 40) ul.append(h("div", { class: "mu-map-hint" }, `\u2026 and ${links.length - 40} more`));
        body.append(ul);
      }
      return body;
    };
    render();
    unwatch = ctx.store.watch(() => {
      if (el.isConnected) render();
    });
  }, { role: "dialog", label: T.title });
  anchor.setAttribute("aria-expanded", "true");
  const obs = new MutationObserver(() => {
    if (!pop.el.isConnected) {
      anchor.removeAttribute("aria-expanded");
      unwatch?.();
      obs.disconnect();
    }
  });
  obs.observe(ctx.root, { childList: true });
}
async function newArea(ctx, done) {
  const name = await ctx.mu.ui.prompt({ title: T.newTitle, label: T.newLabel, placeholder: T.newPh, validate: (v) => v.trim() ? null : T.nameNeeded });
  if (name === null || !name.trim()) return;
  const a = ctx.store.createArea(name.trim());
  ctx.toast(T.created(a.name));
  done(a.id);
}
async function rename(ctx, id, current, done) {
  const name = await ctx.mu.ui.prompt({ title: T.renameTitle, label: T.newLabel, value: current, validate: (v) => v.trim() ? null : T.nameNeeded });
  if (name === null || !name.trim() || name.trim() === current) return;
  ctx.store.setArea({ id, name: name.trim() });
  done();
}
async function remove(ctx, id, count, done) {
  const name = areaName(ctx, id);
  if (!count) {
    if (!await ctx.mu.ui.confirm({ title: T.delTitle(name), body: T.delBody(0), confirm: T.delOk, danger: true })) return done(false);
    ctx.store.removeArea(id);
  } else {
    const how = await ctx.mu.ui.pick({ title: T.delTitle(name), items: [
      { label: T.delMove, hint: `${count} \u2192 ${T.defaultName}`, value: "move" },
      { label: T.delRooms, hint: String(count), value: "delete" }
    ] });
    if (how === null) return done(false);
    if (how === "delete" && !await ctx.mu.ui.confirm({ title: T.delTitle(name), body: `${count} rooms will be deleted.`, confirm: T.delOk, danger: true })) return done(false);
    ctx.store.removeArea(id, { rooms: how, to: "" });
  }
  if (ctx.view.state.area === id) ctx.view.set({ area: "" });
  ctx.view.clearSelection();
  ctx.toast(T.deleted(name));
  done(true);
}
async function pickArea(ctx, title, exclude) {
  const counts = ctx.store.areaCounts();
  const items = areaIds(ctx).filter((id) => id !== exclude).map((id) => ({ label: areaName(ctx, id), hint: T.rooms(counts[id] ?? 0), value: id }));
  items.push({ label: T.newArea, hint: "", value: "\0new" });
  const picked = await ctx.mu.ui.pick({ title, items, filter: items.length > 8 });
  if (picked === null) return null;
  if (picked !== "\0new") return picked;
  const name = await ctx.mu.ui.prompt({ title: T.newTitle, label: T.newLabel, placeholder: T.newPh, validate: (v) => v.trim() ? null : T.nameNeeded });
  if (name === null || !name.trim()) return null;
  return ctx.store.createArea(name.trim()).id;
}

// src/panel/inspector.ts
var SYMBOLS = [
  { glyph: "\u2605", name: "star" },
  { glyph: "\u25C6", name: "diamond" },
  { glyph: "\u25CF", name: "dot" },
  { glyph: "\u25B2", name: "triangle" },
  { glyph: "\u2302", name: "home" },
  { glyph: "\u2691", name: "flag" },
  { glyph: "\u26A0", name: "warning" },
  { glyph: "\u2713", name: "check" },
  { glyph: "\xD7", name: "cross" },
  { glyph: "\u266A", name: "music" },
  { glyph: "$", name: "shop" },
  { glyph: "!", name: "quest" },
  { glyph: "?", name: "unknown" },
  { glyph: "\u21C4", name: "portal" },
  { glyph: "\u2191", name: "up" },
  { glyph: "\u2193", name: "down" }
];
function colorLabel(c) {
  return c === "" ? "none" : c;
}
var T2 = {
  hintWalk: "Click a room to walk there \xB7 right-click for more \xB7 E to edit",
  hintEdit: "Click a room to select \xB7 drag to move \xB7 shift for more \xB7 right-click an empty cell to add",
  hintUnknown: `Position unknown: right-click an empty cell \u2192 New room here, or select a room and press "I'm here"`,
  hintEmpty: "No rooms yet: move around with mapping on, or import a map from the \u2630 menu",
  selected: (n) => `${n} rooms selected`,
  deleteN: (n) => `Delete ${n}`,
  colourAll: "colour all",
  move: "move",
  connected: "Connected",
  clear: "Clear",
  moveToArea: "Move to area\u2026",
  areaTip: "areas: show, rename, colour, delete (A)",
  floorUp: "floor up",
  floorDown: "floor down",
  looksRight: "Looks right",
  walkHere: "Walk here",
  imHere: "I'm here",
  mergeInto: "Merge into\u2026",
  lock: "Lock",
  unlock: "Unlock",
  del: "Delete",
  colour: "colour",
  symbol: "symbol",
  tags: "tags",
  note: "note",
  exits: "exits",
  addTag: "add tag",
  notePh: "a note about this room",
  symPh: "\xB7\xB7",
  go: "go",
  link: "link\u2026",
  unlink: "unlink",
  oneway: "one-way",
  cost: "cost",
  commands: "commands\u2026",
  remove: "remove",
  unexplored: "unexplored",
  here: "here",
  floor: "floor",
  area: "area",
  vnum: "vnum",
  locked: "locked",
  merge: (n) => `Merge \u201C${n}\u201D into: click the room that stays \xB7 Esc cancels`,
  linkBanner: (k) => `Link exit \u201C${k}\u201D: click the destination room \xB7 Esc cancels`,
  lockedTip: "the tracker never moves, merges or relabels this room",
  commandsTitle: (k) => `Commands sent for \u201C${k}\u201D`,
  commandsLabel: "one per line, or separated by ;",
  doorLabel: "door"
};
var PAD = [
  [-1, -1, "\u2196", "northwest"],
  [0, -1, "\u2191", "north"],
  [1, -1, "\u2197", "northeast"],
  [-1, 0, "\u2190", "west"],
  [0, 0, "", ""],
  [1, 0, "\u2192", "east"],
  [-1, 1, "\u2199", "southwest"],
  [0, 1, "\u2193", "south"],
  [1, 1, "\u2198", "southeast"]
];
function buildInspector(ctx) {
  const { h, css } = ctx.mu.ui;
  const el = h("div", { class: "mu-map-insp", role: "region", "aria-label": "room inspector" });
  let deferred = false;
  const fieldFocused = () => {
    const a = el.ownerDocument.activeElement;
    return !!a && el.contains(a) && (a.tagName === "TEXTAREA" || a.tagName === "INPUT");
  };
  el.addEventListener("focusout", () => {
    if (deferred) queueMicrotask(() => {
      if (!fieldFocused() && deferred) {
        deferred = false;
        update();
      }
    });
  });
  const cmd = (label, run, extra = {}) => h("button", { class: css.cmd, type: "button", ...extra, onclick: run }, label);
  const sec = (title) => h("div", { class: `${css.secHead} mu-map-sec` }, title);
  function movePad(ids, withExtras) {
    const pad = h("div", { class: "mu-map-pad", role: "group", "aria-label": T2.move });
    for (const [dx, dy, glyph, name] of PAD) {
      if (!glyph) {
        pad.append(h("span", { class: "mu-map-pad-mid", "aria-hidden": "true" }, "\xB7"));
        continue;
      }
      pad.append(cmd(glyph, () => ctx.actions.moveSelection(dx, dy), { class: `${css.cmd} ${css.sq}`, title: `move ${name}`, "aria-label": `move ${name}` }));
    }
    const col = h(
      "div",
      { class: "mu-map-padcol" },
      cmd("\u25B4", () => ctx.actions.moveSelection(0, 0, 1), { class: `${css.cmd} ${css.sq}`, title: T2.floorUp, "aria-label": T2.floorUp }),
      cmd("\u25BE", () => ctx.actions.moveSelection(0, 0, -1), { class: `${css.cmd} ${css.sq}`, title: T2.floorDown, "aria-label": T2.floorDown })
    );
    const row = h("div", { class: "mu-map-row" }, pad, col);
    if (withExtras && ids.length === 1) {
      row.append(
        h("span", { class: "mu-map-gap" }),
        cmd(T2.connected, () => ctx.actions.selectConnected(ids[0]), { title: "select every room linked to this one on this floor" }),
        cmd(T2.clear, () => ctx.view.clearSelection(), { title: "clear the selection (Esc)" })
      );
    }
    return row;
  }
  function swatches(ids, current) {
    const row = h("div", { class: "mu-map-swatches", role: "radiogroup", "aria-label": T2.colour });
    for (const c of ROOM_COLORS) {
      const on = (current ?? "") === c;
      row.append(h("button", {
        class: `mu-map-swatch${on ? ` ${css.on}` : ""}`,
        type: "button",
        role: "radio",
        "aria-checked": on ? "true" : "false",
        "data-sw": c || "none",
        title: colorLabel(c),
        "aria-label": colorLabel(c),
        onclick: () => ctx.store.batch("colour", () => {
          for (const id of ids) ctx.store.update(id, { color: c });
        })
      }, c ? h("i") : "\xD7"));
    }
    return row;
  }
  function renderEmpty() {
    const v = ctx.view.state;
    const hints = [];
    if (!ctx.store.rooms().length) hints.push(T2.hintEmpty);
    if (!ctx.here()) hints.push(T2.hintUnknown);
    hints.push(v.mode === "edit" ? T2.hintEdit : T2.hintWalk);
    el.replaceChildren(...hints.map((t) => h("div", { class: "mu-map-hint" }, t)));
  }
  function renderMulti(ids) {
    el.replaceChildren(
      h("div", { class: "mu-map-title" }, T2.selected(ids.length)),
      h(
        "div",
        { class: "mu-map-actions" },
        cmd(T2.moveToArea, () => void moveToArea2(ids), { title: "move the selected rooms into another area" }),
        cmd(T2.deleteN(ids.length), () => void ctx.actions.deleteRooms(ids), { class: `${css.cmd} ${css.warn}` }),
        cmd(T2.clear, () => ctx.view.clearSelection())
      ),
      sec(T2.move),
      movePad(ids, false),
      sec(T2.colourAll),
      swatches(ids, void 0)
    );
  }
  async function moveToArea2(ids) {
    const area = await pickArea(ctx, `Move ${ids.length} rooms to area`);
    if (area === null) return;
    ctx.store.moveToArea(ids, area);
    ctx.toast(`${ids.length} rooms moved to ${areaName(ctx, area)}`);
  }
  function symbolRow(room) {
    const row = h("div", { class: "mu-map-glyphs", role: "group", "aria-label": T2.symbol });
    row.append(cmd("\xD7", () => ctx.store.update(room.id, { symbol: "" }), { class: `${css.cmd} ${css.sq}`, title: "no symbol", "aria-label": "no symbol" }));
    for (const g of SYMBOLS) {
      row.append(cmd(g.glyph, () => ctx.store.update(room.id, { symbol: g.glyph }), { class: `${css.cmd} ${css.sq}${room.symbol === g.glyph ? ` ${css.on}` : ""}`, title: g.name, "aria-label": g.name, "aria-pressed": room.symbol === g.glyph ? "true" : "false" }));
    }
    const inp = h("input", { class: `${css.field} mu-map-sym`, type: "text", maxlength: "2", value: room.symbol ?? "", placeholder: T2.symPh, "aria-label": T2.symbol });
    inp.addEventListener("change", () => ctx.store.update(room.id, { symbol: [...inp.value].slice(0, 2).join("") }));
    row.append(inp);
    return row;
  }
  function tagsRow(room) {
    const row = h("div", { class: "mu-map-chips" });
    for (const tag of room.tags ?? []) {
      row.append(h(
        "span",
        { class: "mu-map-chip" },
        tag,
        cmd("\xD7", () => ctx.store.update(room.id, { tags: (room.tags ?? []).filter((t) => t !== tag) }), { class: `${css.cmd} ${css.sq}`, title: `${T2.remove} ${tag}`, "aria-label": `${T2.remove} ${tag}` })
      ));
    }
    const inp = h("input", { class: css.field, type: "text", placeholder: T2.addTag, "aria-label": T2.addTag });
    const add = () => {
      const t = inp.value.trim().toLowerCase();
      if (!t) return;
      inp.value = "";
      if ((room.tags ?? []).includes(t)) return;
      ctx.store.update(room.id, { tags: [...room.tags ?? [], t] });
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        add();
      }
    });
    inp.addEventListener("change", add);
    row.append(inp);
    return row;
  }
  function exitRow(room, exit) {
    const dest = exit.to ? ctx.store.room(exit.to) : void 0;
    const here = ctx.here();
    const back = dest ? Object.values(dest.exits).some((e) => e.to === room.id) : false;
    const arrow = exit.to ? exit.oneway || !back ? "\u2192" : "\u21C4" : "\u2192";
    let destText = T2.unexplored;
    if (dest) {
      destText = dest.name || dest.id;
      if (dest.z !== room.z) destText += ` (${T2.floor} ${dest.z})`;
      if (dest.area !== room.area) destText += ` [${dest.area || "default"}]`;
    } else if (exit.to) destText = `${exit.to}?`;
    const tools = h("span", { class: "mu-map-exit-tools" });
    if (here && here.id === room.id) tools.append(cmd(T2.go, () => void ctx.walker.steps(ctx.sid, exit.commands?.length ? exit.commands : [exit.key]), { title: `send ${exit.key}` }));
    tools.append(cmd(T2.link, () => ctx.actions.startPick({ kind: "link", from: room.id, key: exit.key, banner: T2.linkBanner(exit.key) }), { title: "pick the room this exit leads to" }));
    if (exit.to) tools.append(cmd(T2.unlink, () => ctx.store.unlink(room.id, exit.key), { title: "forget where this exit leads" }));
    tools.append(cmd(T2.oneway, () => ctx.store.setExit(room.id, { ...exit, oneway: !exit.oneway }), { class: `${css.toggle}${exit.oneway ? "" : ` ${css.off}`}`, "aria-pressed": exit.oneway ? "true" : "false", title: "one-way: never draw or walk the way back" }));
    const cost = h("input", { class: `${css.field} mu-map-cost`, type: "number", min: "0", step: "1", value: String(exit.cost ?? 1), title: T2.cost, "aria-label": `${T2.cost} of ${exit.key}` });
    cost.addEventListener("change", () => {
      const n = Number(cost.value);
      if (Number.isFinite(n) && n >= 0) ctx.store.setExit(room.id, { ...exit, cost: n === 1 ? void 0 : n });
    });
    tools.append(cost);
    tools.append(cmd(T2.commands, () => void editCommands(room, exit), { title: "the commands sent instead of the key when walking" }));
    tools.append(cmd("\xD7", () => ctx.store.removeExit(room.id, exit.key), { class: `${css.cmd} ${css.sq} ${css.warn}`, title: `${T2.remove} ${exit.key}`, "aria-label": `${T2.remove} exit ${exit.key}` }));
    const d = parseDir(exit.key) ?? (exit.dir ? dirByName(exit.dir) : void 0);
    return h(
      "div",
      { class: "mu-map-exit", "data-key": exit.key },
      h("span", { class: "mu-map-key", title: d ? d.name : exit.key }, exit.key),
      exit.name && exit.name !== exit.key ? h("span", { class: "mu-map-meta" }, exit.name) : null,
      h("span", { class: "mu-map-arrow", "aria-hidden": "true" }, arrow),
      h("span", { class: `mu-map-dest${dest ? "" : " mu-map-none"}` }, destText),
      exit.door ? h("span", { class: "mu-map-door", title: T2.doorLabel }, exit.door) : null,
      exit.blocked ? h("span", { class: "mu-map-door" }, "blocked") : null,
      tools
    );
  }
  async function editCommands(room, exit) {
    const v = await ctx.mu.ui.prompt({ title: T2.commandsTitle(exit.key), label: T2.commandsLabel, value: (exit.commands ?? []).join("; ") });
    if (v === null) return;
    const commands = v.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    ctx.store.setExit(room.id, { ...exit, commands: commands.length ? commands : void 0 });
  }
  function renderRoom(room) {
    const here = ctx.here();
    const isHere = here?.id === room.id;
    const meta = [
      `${room.x}, ${room.y}`,
      `${T2.floor} ${room.z}`,
      cmd(`${T2.area} ${areaName(ctx, room.area)}`, () => openAreas(ctx, el, room.area), { class: `${css.cmd} mu-map-area-btn`, title: T2.areaTip })
    ];
    if (room.vnum) meta.push(`${T2.vnum} ${room.vnum}`);
    if (room.env) meta.push(room.env);
    if (room.locked) meta.push(T2.locked);
    const note = h("textarea", { class: css.field, placeholder: T2.notePh, "aria-label": T2.note, rows: "2" });
    note.value = room.note ?? "";
    note.addEventListener("change", () => ctx.store.update(room.id, { note: note.value.trim() || void 0 }));
    const exits = Object.values(room.exits).sort((a, b) => a.key.localeCompare(b.key));
    const parts = [
      h("div", { class: "mu-map-title" }, room.name || "(unnamed)", h("span", { class: "mu-map-id" }, room.id), isHere ? h("span", { class: `${css.plate} ${css.hot}` }, T2.here) : null),
      h("div", { class: "mu-map-meta" }, meta.flatMap((m, i) => i ? [" \xB7 ", m] : [m])),
      room.warn ? h("div", { class: "mu-map-warn" }, "\u26A0 ", room.warn, cmd(T2.looksRight, () => ctx.store.update(room.id, { warn: void 0 }), { title: "clear the warning" })) : null,
      h(
        "div",
        { class: "mu-map-actions" },
        cmd(T2.walkHere, () => ctx.actions.walkTo(room.id), { disabled: isHere || !here ? true : void 0, title: here ? "walk from where you are" : "position unknown" }),
        cmd(T2.imHere, () => ctx.actions.imHere(room.id), { disabled: isHere ? true : void 0, title: "declare that you stand here" }),
        cmd(T2.mergeInto, () => ctx.actions.startPick({ kind: "merge", from: room.id, banner: T2.merge(room.name || room.id) }), { title: "fold this room into another" }),
        cmd(room.locked ? T2.unlock : T2.lock, () => ctx.store.update(room.id, { locked: !room.locked }), { title: T2.lockedTip, "aria-pressed": room.locked ? "true" : "false" }),
        cmd(T2.del, () => void ctx.actions.deleteRooms([room.id]), { class: `${css.cmd} ${css.warn}`, title: "delete this room (Del)" })
      ),
      sec(T2.move),
      movePad([room.id], true),
      sec(T2.colour),
      swatches([room.id], room.color),
      sec(T2.symbol),
      symbolRow(room),
      sec(T2.tags),
      tagsRow(room),
      sec(T2.note),
      note,
      sec(`${T2.exits} (${exits.length})`),
      h("div", { class: "mu-map-exits" }, exits.map((e) => exitRow(room, e)))
    ];
    el.replaceChildren(...parts.filter((p) => !!p));
  }
  function update() {
    if (fieldFocused()) {
      deferred = true;
      return;
    }
    const sel = [...ctx.view.selection].filter((id) => ctx.store.room(id));
    if (!sel.length) {
      renderEmpty();
      return;
    }
    if (sel.length > 1) {
      renderMulti(sel);
      return;
    }
    const room = ctx.store.room(sel[0]);
    if (room) renderRoom(room);
    else renderEmpty();
  }
  update();
  return { el, update };
}

// src/lua/api.ts
var LUA_API = [
  /* reads */
  { fn: "version", sig: "version()", doc: "the Mapper version string" },
  { fn: "here", sig: "here()", doc: "the room you are in, or nil" },
  { fn: "room", sig: "room(id)", doc: "one room by id, or nil" },
  { fn: "rooms", sig: "rooms({ name?, area?, tag?, vnum?, near? = { id, radius }, limit? })", doc: "the rooms matching every given filter (name is a substring)" },
  { fn: "byVnum", sig: "byVnum(vnum)", doc: "the room with the game's room number, or nil" },
  { fn: "at", sig: "at(area, x, y, z)", doc: "the room at a cell, or nil" },
  { fn: "areas", sig: "areas()", doc: 'every area as { id, name, note, color, rooms }, the default area ("") included when it has rooms' },
  { fn: "area", sig: "area(id)", doc: "one area as { id, name, note, color, rooms }, or nil" },
  { fn: "areaLinks", sig: "areaLinks(id, { both? })", doc: "exits leading out of an area as { from, key, to, toArea }; with both, those leading in too" },
  { fn: "path", sig: "path(from?, to, { locked?, avoid? })", doc: "cheapest route as { ids, steps, cost }, or nil; from defaults to here" },
  { fn: "incoming", sig: "incoming(id)", doc: "rooms whose exits lead to id, as { room, key }" },
  /* writes */
  { fn: "add", sig: "add({ name, vnum?, area?, x?, y?, z?, desc?, env?, tags?, note?, symbol?, color?, exits? = { key = toId | true } })", doc: "create a room (cell defaults to a free one near here) and return it" },
  { fn: "set", sig: "set(id, { name?, vnum?, area?, x?, y?, z?, desc?, env?, tags?, note?, symbol?, color?, weight?, locked?, warn? })", doc: "change fields of a room and return it" },
  { fn: "remove", sig: "remove(id)", doc: "delete a room (exits into it become unexplored)" },
  { fn: "merge", sig: "merge(fromId, intoId)", doc: "fold one room into another" },
  { fn: "move", sig: "move(id | ids, dx, dy, dz?)", doc: "shift rooms on the grid; false when a target cell is taken" },
  { fn: "exit", sig: "exit(id, key, { to?, name?, commands?, cost?, door?, oneway?, dir?, blocked? })", doc: "create or update an exit; to = false unlinks it" },
  { fn: "removeExit", sig: "removeExit(id, key)", doc: "delete an exit" },
  { fn: "link", sig: "link(id, key, toId, { back? = true })", doc: "point an exit at a room, and the facing exit back" },
  { fn: "unlink", sig: "unlink(id, key)", doc: "make an exit unexplored again" },
  { fn: "addArea", sig: "addArea(name, { note?, color? })", doc: "create an area (id made from the name) and return it" },
  { fn: "setArea", sig: "setArea(id, { name?, note?, color? })", doc: "rename or annotate an area (created when new) and return it" },
  { fn: "removeArea", sig: 'removeArea(id, { rooms? = "delete" | "move", to? })', doc: 'delete an area; its rooms move to the default area (or to) unless rooms = "delete"' },
  { fn: "autoConnect", sig: "autoConnect(area?)", doc: "link facing exits of neighbouring rooms; returns how many" },
  { fn: "tag", sig: "tag(id, tag)", doc: "add a tag to a room" },
  { fn: "untag", sig: "untag(id, tag)", doc: "remove a tag from a room" },
  { fn: "note", sig: "note(id, text)", doc: "set a room's note" },
  { fn: "lock", sig: "lock(id, bool)", doc: "pin a room so the tracker never moves or merges it" },
  /* tracking */
  { fn: "scene", sig: 'scene({ name, vnum?, desc?, area?, env?, exits? = { key = toVnum | true } | { "n", "s" }, exitsComplete? })', doc: "tell the tracker which room the game is showing (maps games nothing else parses)", batchable: false },
  { fn: "moved", sig: "moved(key)", doc: "a movement command was sent or confirmed", batchable: false },
  { fn: "failed", sig: "failed(text, key?)", doc: "the game refused the last move", batchable: false },
  { fn: "anchor", sig: "anchor(id)", doc: "declare that you stand in this room", batchable: false },
  { fn: "pause", sig: "pause(bool)", doc: "pause or resume mapping (rooms are still recognised)", batchable: false },
  { fn: "track", sig: "track()", doc: "this session as { roomId, by, pending, paused, source, dropped }", batchable: false },
  /* walking */
  { fn: "goto", sig: "goto(id, { mode?, delayMs?, timeoutS?, locked? })", doc: "walk to a room; the callback fires when the walk ends with its final state (Lua: mapper.go)", batchable: false },
  { fn: "walk", sig: "walk(steps)", doc: "send a list of exit keys or commands as a walk", batchable: false },
  { fn: "stop", sig: "stop()", doc: "stop the walk", batchable: false },
  { fn: "walkPause", sig: "walkPause(bool)", doc: "pause or resume the walk", batchable: false },
  { fn: "walking", sig: "walking()", doc: "the walk state { status, target, route, at, reason? }", batchable: false },
  /* history, io */
  { fn: "batch", sig: 'batch(label, { { fn = "add", args = { ... } }, ... })', doc: "run several calls as one undo step; returns one { ok, result | error } per call", batchable: false },
  { fn: "undo", sig: "undo()", doc: "undo the last change; returns its label or nil", batchable: false },
  { fn: "redo", sig: "redo()", doc: "redo; returns its label or nil", batchable: false },
  { fn: "export", sig: "export()", doc: "the whole map (errors above 60 KB: use the panel)", batchable: false },
  { fn: "import", sig: "import(data)", doc: "replace the whole map; returns { rooms }", batchable: false },
  { fn: "erase", sig: 'erase("yes")', doc: "erase the whole map of this world", batchable: false },
  /* bridge */
  { fn: "events", sig: "events(bool)", doc: "turn mapper.event delivery on or off for this session (mapper.on does this for you)", batchable: false },
  { fn: "help", sig: "help()", doc: "this list", batchable: false }
];
var LUA_FN_NAMES = LUA_API.map((f) => f.fn);
function luaHelp() {
  return LUA_API.map((f) => `${f.sig} \u2014 ${f.doc}`);
}

// src/lua/library.ts
var luaMethodName = (fn) => fn === "goto" ? "go" : fn;
var WRAPPERS = LUA_API.map((f) => {
  const m = luaMethodName(f.fn);
  const alias = m !== f.fn ? ` mapper["${f.fn}"] = mapper.${m}` : "";
  return `function mapper.${m}(...) return call("${f.fn}", ...) end${alias}`;
}).join("\n");
var MAPPER_LUA = `-- mapper.lua: paste into a startup script (Settings \u2192 Scripts). Needs the Mapper extension.
-- Every function takes its arguments and, optionally, a LAST argument callback(ok, resultOrError).
-- Without a callback the call is fire-and-forget. Rooms arrive as tables; an unexplored exit is \`false\`.
-- Reference: docs/lua.md in the Mapper package, or mapper.help(function(ok, lines) display(lines) end).
mapper = mapper or {}
mapper._handlers = mapper._handlers or {}
local pending, nextId = {}, 1

-- Send one call. The callback, when given, is answered once from mapper.reply.
local function call(fn, ...)
  local args = table.pack(...)
  local cb
  if args.n > 0 and type(args[args.n]) == "function" then
    cb = args[args.n]; args[args.n] = nil; args.n = args.n - 1
  end
  args.n = nil -- a table with keys 1..n is sent as a list; nil holes would make it an object (pass false, not nil)
  local id
  if cb then id = nextId; nextId = nextId + 1; pending[id] = cb end
  local ok, sent = pcall(ext.emit, "mapper.call", { id = id, fn = fn, args = args })
  if ok and sent then return true end
  if cb then pending[id] = nil; cb(false, "mapper." .. fn .. ": " .. (ok and "dropped (rate limit)" or tostring(sent))) end
  return false
end

ext.on("mapper.reply", function(r)
  local cb = pending[r.id]; pending[r.id] = nil
  if cb then cb(r.ok, r.ok and r.result or r.error) end
end)

ext.on("mapper.event", function(e)
  for _, h in ipairs(mapper._handlers[e.type] or {}) do h(e) end
  for _, h in ipairs(mapper._handlers["*"] or {}) do h(e) end
end)

-- mapper.on("enter" | "created" | "lost" | "failed" | "walk" | "*", fn): fn(e) with e.type and the event's fields.
-- The first handler turns event delivery on for this session; mapper.off removes a handler.
function mapper.on(type, fn)
  local list = mapper._handlers[type] or {}
  mapper._handlers[type] = list
  list[#list + 1] = fn
  if not mapper._events then mapper._events = true; call("events", true) end
  return fn
end

function mapper.off(type, fn)
  local list = mapper._handlers[type] or {}
  for i = #list, 1, -1 do if list[i] == fn then table.remove(list, i) end end
  for _, l in pairs(mapper._handlers) do if #l > 0 then return end end
  mapper._events = false; call("events", false)
end

-- The wire functions, one method each (generated from the same table as help()).
${WRAPPERS}

-- Directions: short \u2192 long, and opposites (pure Lua, no round trip).
mapper.dirs = { n = "north", s = "south", e = "east", w = "west", ne = "northeast", nw = "northwest",
  se = "southeast", sw = "southwest", u = "up", d = "down", ["in"] = "in", out = "out" }
local OPP = { n = "s", s = "n", e = "w", w = "e", ne = "sw", sw = "ne", nw = "se", se = "nw", u = "d", d = "u", ["in"] = "out", out = "in" }
local LONG = {}
for short, long in pairs(mapper.dirs) do LONG[long] = short end
-- The letters a compact run ("3n2eu") may use: compass and up/down, never in/out.
local RUN = { n = true, s = true, e = true, w = true, ne = true, nw = true, se = true, sw = true, u = true, d = true }

-- mapper.opposite("n") \u2192 "s"; mapper.opposite("north") \u2192 "south"; nil for anything else.
function mapper.opposite(dir)
  if type(dir) ~= "string" then return nil end
  local d = dir:lower()
  if OPP[d] then return OPP[d] end
  if LONG[d] then return mapper.dirs[OPP[LONG[d]]] end
  return nil
end

-- One Mudlet-style run such as "3n2eu" \u2192 { "n", "n", "n", "e", "e", "u" }, or nil when it is not one.
local function run(tok)
  local out, i = {}, 1
  while i <= #tok do
    local cnt = tok:match("^%d*", i); i = i + #cnt
    local d = tok:sub(i, i + 1)
    if not RUN[d] then d = tok:sub(i, i) end
    if not RUN[d] then return nil end
    i = i + #d
    for _ = 1, tonumber(cnt) or 1 do out[#out + 1] = d end
  end
  return #out > 0 and out or nil
end

-- mapper.parseSpeedwalk("3n 2e u") \u2192 { "n", "n", "n", "e", "e", "u" }. Segments are separated by ";" and
-- a segment of direction tokens ("3n", "2east", "3n2eu", "north") expands; any other segment is one literal command.
function mapper.parseSpeedwalk(str)
  local steps = {}
  for seg in tostring(str or ""):gmatch("[^;]+") do
    seg = seg:match("^%s*(.-)%s*$")
    if seg ~= "" then
      local part, all = {}, true
      for tok in seg:gmatch("%S+") do
        local cnt, word = tok:match("^(%d*)(.*)$")
        local dirs = run(tok:lower())
        if LONG[word:lower()] then
          for _ = 1, tonumber(cnt) or 1 do part[#part + 1] = word:lower() end
        elseif dirs then
          for _, d in ipairs(dirs) do part[#part + 1] = d end
        else
          all = false; break
        end
      end
      if all then for _, d in ipairs(part) do steps[#steps + 1] = d end else steps[#steps + 1] = seg end
    end
  end
  return steps
end

-- mapper.speedwalk("3n 2e u;open door;n", cb): walk the parsed steps.
function mapper.speedwalk(str, cb)
  local steps = mapper.parseSpeedwalk(str)
  if #steps == 0 then if cb then cb(false, "mapper.speedwalk: nothing to walk") end return false end
  return mapper.walk(steps, cb)
end
`;

// src/lua/copy.ts
var COPY_LUA_LABEL = "Copy Lua library";
async function copyLuaLibrary(mu) {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : void 0;
  try {
    if (!clip) throw new Error("no clipboard");
    await clip.writeText(MAPPER_LUA);
    mu.ui.toast("Lua library copied", "Paste it into a startup script (Settings \u2192 Scripts), then use mapper.* in triggers and aliases", { kind: "mapper" });
    return true;
  } catch (e) {
    mu.ui.toast("Could not copy", `${e instanceof Error ? e.message : String(e)}. The library is in docs/lua.md of the package.`, { kind: "mapper" });
    return false;
  }
}

// src/panel/menus.ts
var T3 = {
  centreOnMe: "Centre on me",
  fitFloor: "Fit floor",
  pause: "Pause mapping",
  resume: "Resume mapping",
  names: "Show names",
  connect: "Connect matching exits",
  autoConnect: "Auto-connect new rooms",
  legend: "Legend",
  controls: "Controls",
  areas: "Areas\u2026",
  moveToArea: "Move to area\u2026",
  pickArea: (n) => n > 1 ? `Move ${n} rooms to area` : "Move room to area",
  movedTo: (n, a) => `${n} room${n === 1 ? "" : "s"} moved to ${a}`,
  exportMap: "Export map\u2026",
  importMap: "Import map\u2026",
  erase: "Erase whole map",
  walkHere: "Walk here",
  imHere: "I'm here",
  colour: "Colour\u2026",
  symbol: "Symbol\u2026",
  selectConnected: "Select connected",
  mergeInto: "Merge into\u2026",
  lock: "Lock",
  unlock: "Unlock",
  deleteRoom: "Delete room",
  deleteN: (n) => `Delete ${n} rooms`,
  newRoom: "New room here",
  moveHere: "Move selection here",
  centreHere: "Centre view here",
  connected: (n) => n ? `Linked ${n} exits` : "Nothing to link",
  eraseTitle: "Erase the whole map?",
  eraseBody: "Every room of this world goes. Export it first if you may want it back.",
  eraseOk: "Erase",
  importTitle: "Replace the map?",
  importBody: (n) => `This map has ${n} rooms. Importing replaces all of them.`,
  importOk: "Replace",
  imported: (n) => `Imported ${n} rooms`,
  importFailed: "Import failed",
  exported: "Map exported",
  noScene: "No room to place: the game has not shown one yet",
  posUnknown: "Position unknown",
  noneSelected: "Nothing selected",
  pickColour: "Room colour",
  pickSymbol: "Room symbol",
  none: "none",
  clear: "clear"
};
var openPop = null;
function closePopover() {
  openPop?.close();
}
function popover(ctx, x, y, build2, opts = {}) {
  closePopover();
  const { h } = ctx.mu.ui;
  const el = h("div", { class: "mu-map-pop", role: opts.role ?? "menu", "aria-label": opts.label ?? "menu", tabindex: "-1" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
    ctx.root.removeEventListener("pointerdown", onDown, true);
    ctx.root.removeEventListener("keydown", onKey, true);
    if (openPop === pop) openPop = null;
    ctx.canvas.focus({ preventScroll: true });
  };
  const onDown = (e) => {
    if (!el.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...el.querySelectorAll("button:not([disabled])")];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[n].focus();
  };
  build2(el, close);
  ctx.root.append(el);
  const rw = ctx.root.clientWidth || 300, rh = ctx.root.clientHeight || 200;
  const pw = el.offsetWidth || 160, ph = el.offsetHeight || 100;
  el.style.left = `${Math.max(0, Math.min(x, rw - pw))}px`;
  el.style.top = `${Math.max(0, Math.min(y, rh - ph))}px`;
  ctx.root.addEventListener("pointerdown", onDown, true);
  ctx.root.addEventListener("keydown", onKey, true);
  const pop = { el, close };
  openPop = pop;
  queueMicrotask(() => el.querySelector("button:not([disabled])")?.focus());
  return pop;
}
function itemsMenu(ctx, x, y, items, label) {
  const { h, css } = ctx.mu.ui;
  return popover(ctx, x, y, (el, close) => {
    for (const it of items) {
      if (it.sep) {
        el.append(h("div", { class: "mu-map-pop-sep", role: "separator" }));
        continue;
      }
      const cls = ["mi", it.warn ? css.warn : "", it.on ? css.on : ""].filter(Boolean).join(" ");
      el.append(h("button", {
        class: cls,
        type: "button",
        role: "menuitem",
        disabled: it.disabled ? true : void 0,
        "aria-pressed": it.on === void 0 ? void 0 : it.on ? "true" : "false",
        onclick: () => {
          close();
          it.run?.();
        }
      }, h("span", { class: "mu-map-mi-label" }, it.label), it.hint ? h("span", { class: "k" }, it.hint) : null));
    }
  }, { label });
}
function under(ctx, anchor) {
  const r = anchor.getBoundingClientRect(), p = ctx.root.getBoundingClientRect();
  return { x: r.left - p.left, y: r.bottom - p.top + 2 };
}
function openMainMenu(ctx, anchor) {
  const { x, y } = under(ctx, anchor);
  const paused = !!ctx.track()?.paused;
  const v = ctx.view.state;
  const auto = ctx.settings.get("autoConnect") !== false;
  const items = [
    { label: T3.centreOnMe, hint: "C", run: () => {
      if (!ctx.actions.centreOnMe()) ctx.toast(T3.posUnknown);
    } },
    { label: T3.fitFloor, hint: "F", run: () => ctx.actions.fit() },
    { sep: true, label: "" },
    { label: paused ? T3.resume : T3.pause, run: () => ctx.actions.togglePaused() },
    { label: T3.names, hint: "N", on: v.names, run: () => ctx.actions.toggleNames() },
    { label: T3.connect, run: () => {
      const n = ctx.store.autoConnect(v.area);
      ctx.toast(T3.connected(n));
    } },
    { label: T3.autoConnect, on: auto, run: () => ctx.mu.settings.set("autoConnect", !auto, ctx.worldId) },
    { sep: true, label: "" },
    { label: T3.areas, hint: "A", run: () => openAreas(ctx, anchor) },
    { label: T3.legend, run: () => openLegend(ctx, anchor) },
    { label: T3.controls, hint: "?", run: () => openControls(ctx, anchor) },
    { sep: true, label: "" },
    { label: T3.exportMap, run: () => void exportMap(ctx) },
    { label: T3.importMap, run: () => void importMap(ctx) },
    { label: COPY_LUA_LABEL, run: () => void copyLuaLibrary(ctx.mu) },
    { label: T3.erase, warn: true, run: () => void eraseMap(ctx) }
  ];
  const menu = itemsMenu(ctx, x, y, items, "map menu");
  anchor.setAttribute("aria-expanded", "true");
  const obs = new MutationObserver(() => {
    if (!menu.el.isConnected) {
      anchor.removeAttribute("aria-expanded");
      obs.disconnect();
    }
  });
  obs.observe(ctx.root, { childList: true });
}
async function exportMap(ctx) {
  const data = ctx.store.export();
  const name = `map-${ctx.worldId.replace(/[^a-z0-9_-]+/gi, "_")}.mu-map.json`;
  const ok = await ctx.mu.files.save({ name, type: "application/json", data: JSON.stringify(data, null, 1) });
  if (ok) ctx.toast(T3.exported, `${Object.keys(data.rooms).length} rooms`);
}
async function importMap(ctx) {
  const files = await ctx.mu.files.open({ accept: [".json", "application/json"] });
  const f = files[0];
  if (!f) return;
  let data;
  try {
    data = JSON.parse(await f.text());
  } catch {
    ctx.toast(T3.importFailed, "not JSON");
    return;
  }
  const n = ctx.store.rooms().length;
  if (n && !await ctx.mu.ui.confirm({ title: T3.importTitle, body: T3.importBody(n), confirm: T3.importOk, danger: true })) return;
  try {
    const r = ctx.store.import(data);
    ctx.toast(T3.imported(r.rooms));
    ctx.actions.fit();
  } catch (e) {
    ctx.toast(T3.importFailed, e instanceof Error ? e.message : String(e));
  }
}
async function eraseMap(ctx) {
  if (!await ctx.mu.ui.confirm({ title: T3.eraseTitle, body: T3.eraseBody, confirm: T3.eraseOk, danger: true })) return;
  ctx.store.erase();
  ctx.view.clearSelection();
}
function roomMenuItems(ctx, room) {
  const sel = ctx.view.selection;
  const many = sel.size > 1 && sel.has(room.id);
  const here = ctx.here()?.id === room.id;
  const items = [
    { label: T3.walkHere, disabled: here || !ctx.here(), run: () => ctx.actions.walkTo(room.id) },
    { label: T3.imHere, disabled: here, run: () => ctx.actions.imHere(room.id) },
    { sep: true, label: "" },
    { label: T3.colour, run: () => void pickColour(ctx, many ? [...sel] : [room.id]) },
    { label: T3.symbol, run: () => void pickSymbol(ctx, many ? [...sel] : [room.id]) },
    { label: T3.selectConnected, run: () => ctx.actions.selectConnected(room.id) },
    { label: T3.moveToArea, run: () => void moveToArea(ctx, many ? [...sel] : [room.id], many ? void 0 : room.area) },
    { label: T3.mergeInto, run: () => ctx.actions.startPick({ kind: "merge", from: room.id, banner: `Merge \u201C${room.name || room.id}\u201D into: click the room that stays \xB7 Esc cancels` }) },
    { label: room.locked ? T3.unlock : T3.lock, run: () => {
      ctx.store.update(room.id, { locked: !room.locked });
    } },
    { sep: true, label: "" },
    { label: many ? T3.deleteN(sel.size) : T3.deleteRoom, warn: true, hint: "Del", run: () => void ctx.actions.deleteRooms(many ? [...sel] : [room.id]) }
  ];
  ctx.deps.onRoomMenu?.(room.id, items);
  return items;
}
function openRoomMenu(ctx, room, x, y) {
  itemsMenu(ctx, x, y, roomMenuItems(ctx, room), `room ${room.name || room.id}`);
}
function openCellMenu(ctx, cell, x, y) {
  const v = ctx.view.state;
  const sel = ctx.view.selection;
  const anchor = sel.size ? ctx.store.room([...sel][0]) : void 0;
  const items = [
    { label: T3.newRoom, disabled: !ctx.track()?.lastScene, run: () => {
      const r = ctx.tracker.createHere(ctx.sid, { area: v.area, x: cell.x, y: cell.y, z: v.z });
      if (!r) ctx.toast(T3.noScene);
    } },
    { label: T3.moveHere, disabled: !anchor, run: () => {
      if (!anchor) return;
      const ok = ctx.store.move([...sel], cell.x - anchor.x, cell.y - anchor.y, v.z - anchor.z, v.area);
      if (!ok) ctx.toast("Blocked", "a room is in the way");
    } },
    { sep: true, label: "" },
    { label: T3.centreHere, run: () => ctx.view.centreOn(cell.x, cell.y) },
    { label: T3.centreOnMe, hint: "C", run: () => {
      if (!ctx.actions.centreOnMe()) ctx.toast(T3.posUnknown);
    } }
  ];
  itemsMenu(ctx, x, y, items, `cell ${cell.x}, ${cell.y}`);
}
async function moveToArea(ctx, ids, exclude) {
  const area = await pickArea(ctx, T3.pickArea(ids.length), exclude);
  if (area === null) return;
  ctx.store.moveToArea(ids, area);
  ctx.toast(T3.movedTo(ids.length, areaName(ctx, area)));
}
async function pickColour(ctx, ids) {
  const c = await ctx.mu.ui.pick({ title: T3.pickColour, items: ROOM_COLORS.map((c2) => ({ label: colorLabel(c2), value: c2 })) });
  if (c === null) return;
  ctx.store.batch("colour", () => {
    for (const id of ids) ctx.store.update(id, { color: c });
  });
}
async function pickSymbol(ctx, ids) {
  const s = await ctx.mu.ui.pick({ title: T3.pickSymbol, items: [{ label: T3.clear, value: "" }, ...SYMBOLS.map((g) => ({ label: g.glyph, hint: g.name, value: g.glyph }))] });
  if (s === null) return;
  ctx.store.batch("symbol", () => {
    for (const id of ids) ctx.store.update(id, { symbol: s });
  });
}
var svg = (inner, label) => {
  const span = document.createElement("span");
  span.setAttribute("aria-label", label);
  span.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${inner}</svg>`;
  return span;
};
var LEGEND = [
  ['<rect x="4" y="4" width="8" height="8"/>', "room", "a room; its fill is the room colour"],
  ['<rect x="4" y="4" width="8" height="8" stroke-width="2"/>', "current room", "you are here: bright border and glow"],
  ['<rect x="2" y="2" width="12" height="12" stroke-dasharray="2 2"/>', "selected", "selected (edit mode)"],
  ['<line x1="1" y1="8" x2="15" y2="8"/>', "link", "a two-way link between neighbours"],
  ['<line x1="1" y1="8" x2="12" y2="8"/><path d="M11 5l4 3-4 3z" fill="currentColor"/>', "one-way", "one-way: the arrow points where it goes"],
  ['<path d="M1 12 Q8 0 15 12" stroke-dasharray="2 2"/>', "off-grid link", "a link that does not match its direction (gold, dashed); the key is shown when zoomed in"],
  ['<line x1="4" y1="8" x2="10" y2="8"/><circle cx="12" cy="8" r="2"/>', "unexplored exit", "an exit not walked yet (filled: it leads to another floor)"],
  ['<path d="M9 5l3-4 3 4z" fill="currentColor"/><path d="M9 11l3 4 3-4z"/>', "up / down", "up (top corner) and down (bottom corner); filled when mapped"],
  ['<line x1="4" y1="8" x2="10" y2="8"/><circle cx="12" cy="8" r="2" fill="currentColor"/>', "to another area", "a mapped exit into another area (gold); the Areas dialog lists them"],
  ['<rect x="2" y="10" width="4" height="4" fill="currentColor"/>', "named exit", "an exit that is not a direction (enter, climb\u2026)"],
  ['<circle cx="3" cy="3" r="2" fill="currentColor"/>', "warning", 'the tracker was unsure where this room goes: check it and press "Looks right"']
];
function openLegend(ctx, anchor) {
  const { h } = ctx.mu.ui;
  const { x, y } = under(ctx, anchor);
  popover(ctx, x, y, (el, close) => {
    el.append(h("div", { class: "mu-map-pop-title" }, T3.legend));
    const dl = h("dl");
    for (const [ic, name, text] of LEGEND) dl.append(h("dt", null, svg(ic, name), name), h("dd", null, text));
    el.append(h("div", { class: "mu-map-pop-body" }, dl));
    el.append(h("button", { class: ctx.mu.ui.css.cmd, type: "button", onclick: close }, "Close"));
  }, { role: "dialog", label: T3.legend });
}
var CONTROLS = [
  ["Click", "walk there (walk mode) \xB7 select (edit mode)"],
  ["Shift+Click", "add to the selection (edit)"],
  ["Drag", "pan (walk) \xB7 move the selection or box-select (edit)"],
  ["Space+Drag / Middle", "pan in any mode"],
  ["Wheel", "zoom about the cursor"],
  ["Right-click", "room or cell menu"],
  ["Arrows", "pan \xB7 nudge the selection (edit)"],
  ["Page Up / Page Down", "floor up / down \xB7 move the selection a floor (edit)"],
  ["Delete", "delete the selection"],
  ["Ctrl+Z / Ctrl+Shift+Z", "undo / redo"],
  ["F", "fit the floor"],
  ["C", "centre on me"],
  ["N", "show names"],
  ["A", "areas"],
  ["W / E", "walk / edit mode"],
  ["+ / \u2212", "zoom"],
  ["Esc", "cancel pick, clear selection, stop walking"]
];
function openControls(ctx, anchor) {
  const { h } = ctx.mu.ui;
  const { x, y } = under(ctx, anchor);
  popover(ctx, x, y, (el, close) => {
    el.append(h("div", { class: "mu-map-pop-title" }, T3.controls));
    const dl = h("dl");
    for (const [k, text] of CONTROLS) dl.append(h("dt", null, h("kbd", null, k)), h("dd", null, text));
    el.append(h("div", { class: "mu-map-pop-body" }, dl));
    el.append(h("button", { class: ctx.mu.ui.css.cmd, type: "button", onclick: close }, "Close"));
  }, { role: "dialog", label: T3.controls });
}

// src/panel/toolbar.ts
var T4 = {
  walk: "Walk",
  edit: "Edit",
  fit: "Fit",
  follow: "\u25CE",
  zoomOut: "\u2212",
  zoomIn: "+",
  down: "\u25BE",
  up: "\u25B4",
  mapping: "Mapping",
  paused: "Paused",
  details: "Details",
  undo: "Undo",
  menu: "\u2630",
  tipWalk: "walk mode: click a room to walk there (W)",
  tipEdit: "edit mode: select, move and link rooms (E)",
  tipZoomOut: "zoom out (\u2212)",
  tipZoomIn: "zoom in (+)",
  tipFit: "fit the floor (F)",
  tipFollow: "follow me: keep my room in view (C centres)",
  tipDown: "floor down (Page Down)",
  tipUp: "floor up (Page Up)",
  tipFloor: "floor",
  tipArea: "area shown",
  areas: "Areas",
  tipAreas: "areas: list, create, rename, colour and delete areas (A)",
  tipMapping: "mapping is on: rooms are created and linked as you move. Click to pause",
  tipPaused: "mapping is paused: known rooms are recognised, nothing is created. Click to resume",
  tipDetails: "show the inspector",
  tipUndo: "undo the last map change (Ctrl+Z)",
  tipMenu: "map menu"
};
function buildToolbar(ctx) {
  const { h, css } = ctx.mu.ui;
  const btn = (label, title, run, extra = {}) => h("button", { class: css.cmd, type: "button", title, "aria-label": title, onclick: run, ...extra }, label);
  const walk = btn(T4.walk, T4.tipWalk, () => ctx.actions.setMode("walk"), { "aria-pressed": "false" });
  const edit = btn(T4.edit, T4.tipEdit, () => ctx.actions.setMode("edit"), { "aria-pressed": "false" });
  const zoomOut = btn(T4.zoomOut, T4.tipZoomOut, () => ctx.actions.zoom(1 / 1.25), { class: `${css.cmd} ${css.sq}` });
  const zoomIn = btn(T4.zoomIn, T4.tipZoomIn, () => ctx.actions.zoom(1.25), { class: `${css.cmd} ${css.sq}` });
  const fit = btn(T4.fit, T4.tipFit, () => ctx.actions.fit());
  const follow = btn(T4.follow, T4.tipFollow, () => ctx.actions.toggleFollow(), { class: `${css.cmd} ${css.sq}`, "aria-pressed": "false" });
  const down = btn(T4.down, T4.tipDown, () => ctx.actions.setFloor(-1), { class: `${css.cmd} ${css.sq}` });
  const up = btn(T4.up, T4.tipUp, () => ctx.actions.setFloor(1), { class: `${css.cmd} ${css.sq}` });
  const z = h("span", { class: "mu-map-z", title: T4.tipFloor, "aria-live": "polite" }, "Z0");
  const area = h("select", { class: css.field, title: T4.tipArea, "aria-label": T4.tipArea });
  area.addEventListener("change", () => {
    ctx.view.set({ area: area.value });
    ctx.actions.fit();
  });
  const areas = btn(T4.areas, T4.tipAreas, (e) => openAreas(ctx, e.currentTarget), { "aria-haspopup": "dialog" });
  const mapping = btn(T4.mapping, T4.tipMapping, () => ctx.actions.togglePaused(), { class: css.toggle, "aria-pressed": "true" });
  const details = btn(T4.details, T4.tipDetails, () => ctx.actions.toggleDetails(), { class: css.toggle, "aria-pressed": "true" });
  const undo = btn(T4.undo, T4.tipUndo, () => ctx.actions.undo());
  const menu = btn(T4.menu, T4.tipMenu, (e) => openMainMenu(ctx, e.currentTarget), { class: `${css.cmd} ${css.sq}`, "aria-haspopup": "menu" });
  const el = h(
    "div",
    { class: "mu-map-bar", role: "toolbar", "aria-label": "map tools" },
    h("span", { class: "mu-map-group" }, walk, edit),
    h("span", { class: "mu-map-group" }, zoomOut, zoomIn, fit, follow),
    h("span", { class: "mu-map-group" }, down, z, up),
    h("span", { class: "mu-map-group" }, area, areas),
    h("span", { class: "mu-map-gap" }),
    h("span", { class: "mu-map-group" }, mapping, details, undo, menu)
  );
  const pressed = (b, on) => {
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.classList.toggle(css.on, on);
  };
  function update() {
    const v = ctx.view.state;
    pressed(walk, v.mode === "walk");
    pressed(edit, v.mode === "edit");
    pressed(follow, v.follow);
    z.textContent = `Z${v.z}`;
    const paused = !!ctx.track()?.paused;
    mapping.textContent = paused ? T4.paused : T4.mapping;
    mapping.title = paused ? T4.tipPaused : T4.tipMapping;
    mapping.setAttribute("aria-label", mapping.title);
    mapping.setAttribute("aria-pressed", paused ? "false" : "true");
    mapping.classList.toggle(css.off, paused);
    details.setAttribute("aria-pressed", v.details ? "true" : "false");
    details.classList.toggle(css.off, !v.details);
    undo.disabled = !ctx.store.canUndo();
    const ids = areaIds(ctx);
    if (!ids.includes(v.area)) ids.push(v.area);
    if (ids.length > 1) {
      area.hidden = false;
      const want = ids.map((id) => ({ id, name: areaName(ctx, id) }));
      const have = [...area.options].map((o) => `${o.value}\0${o.textContent}`).join("|");
      const next = want.map((a) => `${a.id}\0${a.name}`).join("|");
      if (have !== next) area.replaceChildren(...want.map((a) => h("option", { value: a.id }, a.name)));
      area.value = v.area;
    } else area.hidden = true;
  }
  update();
  return { el, update };
}

// src/panel/canvas.ts
var T5 = {
  label: "map: arrows pan, +/\u2212 zoom, F fits, C centres on you, W and E switch walk and edit mode, right-click for menus",
  steps: (n) => `Click to walk \xB7 ${n} step${n === 1 ? "" : "s"}`,
  here: "You are here",
  noPath: "No known path from here",
  blocked: "Blocked",
  blockedBody: "a room is in the way",
  cancel: "Cancel",
  exits: "exits",
  warn: "\u26A0"
};
var HIT_HALF = 0.4;
var DRAG_PX = 4;
function attachCanvas(ctx) {
  const { canvas, stage, view, mu } = ctx;
  const { h, css } = mu.ui;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", T5.label);
  const banner = h("div", { class: "mu-map-banner", role: "status", hidden: true });
  const bannerText = h("span");
  const bannerCancel = h("button", { class: css.cmd, type: "button", onclick: () => ctx.actions.cancelPick() }, T5.cancel);
  banner.append(bannerText, h("span", { class: "mu-map-gap" }), bannerCancel);
  const tip = h("div", { class: "mu-map-tip", role: "tooltip", hidden: true });
  stage.append(banner, tip);
  let gesture = null;
  let spaceDown = false;
  let lastPointer = null;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  function roomAt(px, py) {
    const v = view.state;
    const c = view.cellAt(px, py);
    const r = ctx.store.at(v.area, c.x, c.y, v.z);
    return r && view.hitsRoom(px, py, r.x, r.y, HIT_HALF) ? r : null;
  }
  const cursor = (c) => {
    canvas.dataset.cursor = c;
  };
  function updateCursor(px, py) {
    if (gesture?.kind === "pan") return cursor("grabbing");
    if (gesture?.kind === "move") return cursor("move");
    if (spaceDown) return cursor("grab");
    if (view.pick) return cursor("crosshair");
    const r = px !== void 0 && py !== void 0 ? roomAt(px, py) : null;
    if (view.state.mode === "walk") return cursor(r ? "pointer" : "grab");
    cursor(r ? "move" : "default");
  }
  function showTip(room, px, py) {
    const here = ctx.here();
    const lines = [h("div", { class: "mu-map-tip-name" }, room.name || room.id)];
    const meta = [`${room.x}, ${room.y}, z${room.z}`];
    if (room.area) meta.push(room.area);
    lines.push(h("div", { class: "mu-map-tip-dim" }, meta.join(" \xB7 ")));
    const keys = Object.values(room.exits).map((e) => e.to ? e.key : `${e.key}?`);
    if (keys.length) lines.push(h("div", { class: "mu-map-tip-dim" }, `${T5.exits}: ${keys.join(" ")}`));
    if (room.note) lines.push(h("div", null, room.note));
    if (room.warn) lines.push(h("div", { class: "mu-map-tip-warn" }, `${T5.warn} ${room.warn}`));
    if (view.state.mode === "walk" && !view.pick) {
      if (here && here.id === room.id) lines.push(h("div", { class: "mu-map-tip-walk" }, T5.here));
      else if (here) {
        const p = ctx.store.path(here.id, room.id);
        lines.push(h("div", { class: "mu-map-tip-walk" }, p ? T5.steps(p.steps.length) : T5.noPath));
      }
    }
    tip.replaceChildren(...lines);
    tip.hidden = false;
    const w = stage.clientWidth || view.width, hgt = stage.clientHeight || view.height;
    const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 60;
    tip.style.left = `${Math.max(0, Math.min(px + 14, w - tw))}px`;
    tip.style.top = `${py + 18 + th > hgt ? Math.max(0, py - th - 8) : py + 18}px`;
  }
  const hideTip = () => {
    tip.hidden = true;
  };
  function setHover(id) {
    if (ctx.hover === id) return;
    ctx.hover = id;
    ctx.invalidate("canvas");
  }
  function onDown(e) {
    canvas.focus({ preventScroll: true });
    closePopover();
    if (e.button === 2) return;
    const { px, py } = local(e);
    hideTip();
    if (e.button === 1 || spaceDown) {
      e.preventDefault();
      gesture = { kind: "pan", lastX: px, lastY: py, moved: false };
      canvas.setPointerCapture?.(e.pointerId);
      updateCursor();
      return;
    }
    if (e.button !== 0) return;
    const room = roomAt(px, py);
    if (view.pick) {
      if (room) finishPick(room);
      return;
    }
    if (view.state.mode === "walk") {
      gesture = room ? { kind: "maybe", room, startX: px, startY: py, shift: e.shiftKey } : { kind: "pan", lastX: px, lastY: py, moved: false };
    } else {
      gesture = { kind: "maybe", room, startX: px, startY: py, shift: e.shiftKey };
    }
    canvas.setPointerCapture?.(e.pointerId);
    updateCursor(px, py);
  }
  function onMove(e) {
    const { px, py } = local(e);
    lastPointer = { px, py };
    if (!gesture) {
      const r = roomAt(px, py);
      setHover(r?.id ?? null);
      if (r) showTip(r, px, py);
      else hideTip();
      updateCursor(px, py);
      return;
    }
    if (gesture.kind === "pan") {
      view.panBy(px - gesture.lastX, py - gesture.lastY);
      gesture.lastX = px;
      gesture.lastY = py;
      gesture.moved = true;
      if (view.state.follow) view.set({ follow: false });
      return;
    }
    if (gesture.kind === "maybe") {
      if (Math.hypot(px - gesture.startX, py - gesture.startY) < DRAG_PX) return;
      if (view.state.mode === "walk") {
        gesture = { kind: "pan", lastX: gesture.startX, lastY: gesture.startY, moved: true };
        onMove(e);
        return;
      }
      if (gesture.room) {
        if (gesture.room.locked && !view.selection.has(gesture.room.id)) {
          gesture = null;
          return;
        }
        if (!view.selection.has(gesture.room.id)) view.select([gesture.room.id], gesture.shift);
        const ids = [...view.selection].filter((id) => !ctx.store.room(id)?.locked);
        gesture = { kind: "move", startCell: view.cellAt(gesture.startX, gesture.startY), ids, dx: 0, dy: 0 };
      } else {
        gesture = { kind: "box", x0: gesture.startX, y0: gesture.startY, shift: gesture.shift };
      }
      updateCursor();
    }
    if (gesture.kind === "move") {
      const c = view.cellAt(px, py);
      gesture.dx = c.x - gesture.startCell.x;
      gesture.dy = c.y - gesture.startCell.y;
      const { dx, dy } = gesture;
      ctx.drag = { cells: gesture.ids.map((id) => ctx.store.room(id)).filter((r) => !!r).map((r) => ({ x: r.x + dx, y: r.y + dy })) };
      ctx.invalidate("canvas");
      return;
    }
    if (gesture.kind === "box") {
      ctx.box = { x0: gesture.x0, y0: gesture.y0, x1: px, y1: py };
      ctx.invalidate("canvas");
    }
  }
  function onUp(e) {
    const g = gesture;
    gesture = null;
    canvas.releasePointerCapture?.(e.pointerId);
    const { px, py } = local(e);
    if (!g) return;
    if (g.kind === "maybe") {
      if (view.state.mode === "walk") {
        if (g.room) ctx.actions.walkTo(g.room.id);
      } else if (g.room) {
        if (g.shift) view.toggleSelect(g.room.id);
        else view.select([g.room.id]);
      } else if (!g.shift) view.clearSelection();
    } else if (g.kind === "move") {
      ctx.drag = null;
      if ((g.dx || g.dy) && g.ids.length) {
        if (!ctx.store.move(g.ids, g.dx, g.dy)) ctx.toast(T5.blocked, T5.blockedBody);
      }
      ctx.invalidate("canvas");
    } else if (g.kind === "box") {
      const b = ctx.box;
      ctx.box = null;
      if (b) {
        const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
        const v = view.state;
        const ids = ctx.store.rooms().filter((r) => r.z === v.z && r.area === v.area).filter((r) => {
          const p = view.pointOf(r.x, r.y);
          return p.px >= x0 && p.px <= x1 && p.py >= y0 && p.py <= y1;
        }).map((r) => r.id);
        view.select(ids, g.shift);
      }
      ctx.invalidate("canvas");
    }
    updateCursor(px, py);
  }
  function onCancel() {
    gesture = null;
    ctx.drag = null;
    ctx.box = null;
    ctx.invalidate("canvas");
    updateCursor();
  }
  function onLeave() {
    setHover(null);
    hideTip();
    lastPointer = null;
  }
  function onWheel(e) {
    e.preventDefault();
    const { px, py } = local(e);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    view.zoomAt(factor, px, py);
    hideTip();
  }
  function onContext(e) {
    e.preventDefault();
    const { px, py } = local(e);
    hideTip();
    const rootRect = ctx.root.getBoundingClientRect();
    const x = e.clientX - rootRect.left, y = e.clientY - rootRect.top;
    const room = roomAt(px, py);
    if (room) {
      if (view.state.mode === "edit" && !view.selection.has(room.id)) view.select([room.id]);
      openRoomMenu(ctx, room, x, y);
    } else openCellMenu(ctx, view.cellAt(px, py), x, y);
  }
  function finishPick(target) {
    const p = view.pick;
    if (!p) return;
    if (p.kind === "link" && p.key) {
      if (target.id === p.from) {
        ctx.toast("Not linked", "an exit cannot lead to its own room");
        return;
      }
      ctx.store.link(p.from, p.key, target.id, { back: true });
    } else if (p.kind === "merge") {
      if (target.id === p.from) {
        ctx.toast("Not merged", "pick another room");
        return;
      }
      ctx.store.merge(p.from, target.id);
      view.select([target.id]);
    }
    ctx.actions.cancelPick();
  }
  function updateBanner() {
    const p = view.pick;
    banner.hidden = !p;
    bannerText.textContent = p?.banner ?? "";
    updateCursor(lastPointer?.px, lastPointer?.py);
  }
  function onKey(e) {
    const v = view.state;
    const edit = v.mode === "edit";
    const sel = view.selection.size > 0;
    const step = Math.max(1, Math.round(60 / v.scale));
    const nudge = (dx, dy) => {
      if (edit && sel) ctx.actions.moveSelection(dx, dy);
      else view.panBy(-dx * step * v.scale, -dy * step * v.scale);
    };
    const k = e.key;
    let handled = true;
    if (k === " ") {
      spaceDown = true;
      updateCursor(lastPointer?.px, lastPointer?.py);
    } else if (k === "ArrowLeft") nudge(-1, 0);
    else if (k === "ArrowRight") nudge(1, 0);
    else if (k === "ArrowUp") nudge(0, -1);
    else if (k === "ArrowDown") nudge(0, 1);
    else if (k === "PageUp") {
      if (edit && sel) ctx.actions.moveSelection(0, 0, 1);
      else ctx.actions.setFloor(1);
    } else if (k === "PageDown") {
      if (edit && sel) ctx.actions.moveSelection(0, 0, -1);
      else ctx.actions.setFloor(-1);
    } else if (k === "Delete" || k === "Backspace") {
      if (edit && sel) void ctx.actions.deleteRooms([...view.selection]);
      else handled = false;
    } else if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) {
      if (e.shiftKey) ctx.actions.redo();
      else ctx.actions.undo();
    } else if ((e.ctrlKey || e.metaKey) && k === "y") ctx.actions.redo();
    else if ((e.ctrlKey || e.metaKey) && k === "a" && edit) {
      const ids = ctx.store.rooms().filter((r) => r.z === v.z && r.area === v.area).map((r) => r.id);
      view.select(ids);
    } else if (e.ctrlKey || e.metaKey || e.altKey) handled = false;
    else if (k === "f" || k === "F") ctx.actions.fit();
    else if (k === "c" || k === "C") {
      if (!ctx.actions.centreOnMe()) ctx.status("position unknown");
    } else if (k === "n" || k === "N") ctx.actions.toggleNames();
    else if (k === "a" || k === "A") ctx.actions.openAreas();
    else if (k === "w" || k === "W") ctx.actions.setMode("walk");
    else if (k === "e" || k === "E") ctx.actions.setMode("edit");
    else if (k === "+" || k === "=") ctx.actions.zoom(1.25);
    else if (k === "-" || k === "_") ctx.actions.zoom(1 / 1.25);
    else if (k === "Escape") {
      if (view.pick) ctx.actions.cancelPick();
      else if (gesture) onCancel();
      else if (view.selection.size) view.clearSelection();
      else if (ctx.walker.state(ctx.sid).status === "walking") ctx.walker.stop(ctx.sid);
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  }
  function onKeyUp(e) {
    if (e.key === " ") {
      spaceDown = false;
      updateCursor(lastPointer?.px, lastPointer?.py);
    }
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContext);
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("blur", () => {
    spaceDown = false;
  });
  const offView = view.onChange(updateBanner);
  updateBanner();
  updateCursor();
  return {
    banner,
    tip,
    dispose() {
      offView();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKeyUp);
      banner.remove();
      tip.remove();
    }
  };
}

// src/panel/index.ts
var T6 = {
  noStore: "No map for this session",
  noWorld: "No world",
  emptyMap: "No rooms yet",
  emptyFloor: "No rooms on this floor",
  rooms: (n) => `${n} room${n === 1 ? "" : "s"}`,
  walk: "walk",
  edit: "edit",
  floor: (z) => `z${z}`,
  here: (r) => `here: ${r.name || r.id}`,
  unknown: "position unknown",
  paused: "paused",
  walking: (s) => `walking ${Math.min(s.at + 1, s.route.length)}/${s.route.length}`,
  arrived: "arrived",
  failed: (why) => `walk failed${why ? `: ${why}` : ""}`,
  stopped: "walk stopped",
  deleteTitle: (n) => `Delete ${n} rooms?`,
  deleteBody: "Their links go too. Undo brings them back.",
  deleteOk: "Delete",
  blocked: "Blocked",
  blockedBody: "a room is in the way",
  noRoute: "No known route there",
  walkTip: "Walking\u2026",
  noPosition: "Position unknown",
  noPositionBody: `select a room and press "I'm here", or create one from an empty cell`
};
var TOKEN_VARS = [
  ["bg", "--bg"],
  ["bgElev", "--bg-elev"],
  ["bgDeep", "--bg-deep"],
  ["fg", "--fg"],
  ["fgDim", "--fg-dim"],
  ["fgFaint", "--fg-faint"],
  ["accent", "--accent"],
  ["accentBright", "--accent-bright"],
  ["gold", "--gold"],
  ["alert", "--alert"],
  ["ok", "--ok"],
  ["border", "--border"],
  ["borderBright", "--border-bright"],
  ["glow", "--glow"]
];
function tokensFromCss(el) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const [k, v] of TOKEN_VARS) out[k] = cs.getPropertyValue(v).trim() || "transparent";
  return out;
}
var styles = /* @__PURE__ */ new WeakMap();
function mountPanel(deps, el, pctx) {
  const { mu } = deps;
  const { h, css } = mu.ui;
  const worldId = pctx.worldId ?? "";
  const sid = pctx.sid ?? "";
  const found = worldId ? deps.store(worldId) : null;
  const sheet = styles.get(mu) ?? { uses: 0, dispose: mu.ui.style(PANEL_CSS) };
  sheet.uses++;
  styles.set(mu, sheet);
  const releaseStyle = () => {
    if (--sheet.uses === 0) {
      sheet.dispose();
      styles.delete(mu);
    }
  };
  const root = h("div", { class: "mu-map", "data-focus-region": "" });
  el.append(root);
  if (!found) {
    root.append(h("div", { class: css.empty }, worldId ? T6.noStore : T6.noWorld));
    return { unmount() {
      root.remove();
      releaseStyle();
    }, snapshot() {
      return void 0;
    }, restore() {
    } };
  }
  const store = found;
  const view = new View(mu.storage.world(worldId));
  const canvas = h("canvas");
  const stage = h("div", { class: "mu-map-stage" }, canvas);
  const status = h("div", { class: "mu-map-status", role: "status", "aria-live": "polite" });
  const statusMain = h("span");
  const statusMsg = h("span", { class: "mu-map-status-msg" });
  status.append(statusMain, h("span", { class: "mu-map-gap" }), statusMsg);
  let tokens = tokensFromCss(el);
  let reduceMotion = false;
  let calmPref = false;
  let perf = false;
  let statusText = null;
  let statusTimer = null;
  let dpr = 1;
  let frame = null;
  let dirtyAll = false;
  const subs = [];
  const ctx = {
    mu,
    sid,
    worldId,
    store,
    tracker: deps.tracker,
    walker: deps.walker,
    settings: deps.settings,
    deps,
    root,
    stage,
    canvas,
    view,
    actions: null,
    hover: null,
    drag: null,
    box: null,
    tokens: () => tokens,
    calm: () => reduceMotion || calmPref || perf,
    here: () => {
      const id = deps.tracker.track(sid)?.position.roomId;
      return id && store.room(id) || null;
    },
    track: () => deps.tracker.track(sid),
    invalidate,
    status: setStatus,
    toast: (title, body2) => mu.ui.toast(title, body2, { kind: "mapper" })
  };
  const floorCells = () => {
    const v = view.state;
    return store.rooms().filter((r) => r.z === v.z && r.area === v.area).map((r) => ({ x: r.x, y: r.y }));
  };
  const actions = {
    zoom(factor, at2) {
      const p = at2 ?? { px: view.width / 2, py: view.height / 2 };
      view.zoomAt(factor, p.px, p.py);
    },
    fit() {
      let cells = floorCells();
      if (!cells.length) {
        const here = ctx.here();
        const first = here ?? store.rooms()[0];
        if (!first) return;
        view.set({ z: first.z, area: first.area });
        cells = floorCells();
      }
      view.fitTo(cells);
    },
    centreOnMe() {
      const r = ctx.here();
      if (!r) return false;
      view.centreOn(r.x, r.y, r.z, r.area);
      return true;
    },
    setFloor(dz) {
      view.set({ z: view.state.z + dz });
    },
    setMode(mode) {
      if (view.state.mode === mode) return;
      view.set({ mode });
      if (mode === "walk") {
        view.clearSelection();
      }
      if (view.pick) actions.cancelPick();
    },
    walkTo(id) {
      const here = ctx.here();
      if (!here) {
        ctx.toast(T6.noPosition, T6.noPositionBody);
        return;
      }
      if (here.id === id) return;
      if (!store.path(here.id, id)) {
        ctx.toast(T6.noRoute);
        return;
      }
      void deps.walker.goto(sid, id).catch((e) => ctx.toast(T6.failed(), e instanceof Error ? e.message : String(e)));
      invalidate("all");
    },
    imHere(id) {
      deps.tracker.anchor(sid, id);
      invalidate("all");
    },
    async deleteRooms(ids) {
      const live = ids.filter((id) => store.room(id));
      if (!live.length) return;
      if (live.length > 1 && !await mu.ui.confirm({ title: T6.deleteTitle(live.length), body: T6.deleteBody, confirm: T6.deleteOk, danger: true })) return;
      store.batch("delete rooms", () => {
        for (const id of live) store.remove(id);
      });
      for (const id of live) view.selection.delete(id);
      invalidate("all");
    },
    moveSelection(dx, dy, dz = 0) {
      const ids = [...view.selection].filter((id) => store.room(id) && !store.room(id)?.locked);
      if (!ids.length) return;
      if (!store.move(ids, dx, dy, dz)) {
        ctx.toast(T6.blocked, T6.blockedBody);
        return;
      }
      if (dz) view.set({ z: view.state.z + dz });
    },
    selectConnected(id) {
      view.select(store.component(id));
      if (view.state.mode !== "edit") view.set({ mode: "edit" });
    },
    startPick(p) {
      if (view.state.mode !== "edit") view.set({ mode: "edit" });
      view.setPick(p);
      mu.a11y.announce(p.banner);
    },
    cancelPick() {
      if (view.pick) view.setPick(null);
    },
    undo() {
      const l = store.undo();
      if (l) setStatus(`undid ${l}`);
      invalidate("all");
    },
    redo() {
      const l = store.redo();
      if (l) setStatus(`redid ${l}`);
      invalidate("all");
    },
    togglePaused() {
      const t = ctx.track();
      deps.tracker.pause(sid, !t?.paused);
      invalidate("all");
    },
    toggleNames() {
      view.set({ names: !view.state.names });
    },
    toggleFollow() {
      view.set({ follow: !view.state.follow });
      if (view.state.follow) actions.centreOnMe();
    },
    toggleDetails() {
      view.set({ details: !view.state.details });
    },
    openAreas(area) {
      const anchor = root.querySelector('.mu-map-bar button[aria-haspopup="dialog"]') ?? root.querySelector(".mu-map-bar") ?? root;
      openAreas(ctx, anchor, area);
    }
  };
  ctx.actions = actions;
  const toolbar = buildToolbar(ctx);
  const inspector = buildInspector(ctx);
  const body = h("div", { class: "mu-map-body" }, stage, inspector.el);
  root.append(toolbar.el, body, status);
  const controller = attachCanvas(ctx);
  function setStatus(msg) {
    statusText = msg;
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (msg) statusTimer = setTimeout(() => {
      statusText = null;
      statusTimer = null;
      renderStatus();
    }, 4e3);
    renderStatus();
  }
  function renderStatus() {
    const v = view.state;
    const here = ctx.here();
    const parts = [v.mode === "edit" ? T6.edit : T6.walk, T6.floor(v.z), T6.rooms(store.rooms().length), here ? T6.here(here) : T6.unknown];
    if (ctx.track()?.paused) parts.push(T6.paused);
    const ws = deps.walker.state(sid);
    if (ws.status === "walking") parts.push(T6.walking(ws));
    statusMain.textContent = parts.join(" \xB7 ");
    statusMain.classList.toggle("mu-map-status-warn", !here);
    statusMsg.textContent = statusText ?? "";
  }
  function scene() {
    const v = view.state;
    const ws = deps.walker.state(sid);
    const here = ctx.here();
    const route = ws.status === "walking" || ws.status === "paused" ? here ? [here.id, ...ws.route.slice(ws.at)] : ws.route.slice(ws.at) : [];
    const all = store.rooms();
    const rooms = all.filter((r) => r.z === v.z && r.area === v.area);
    return {
      rooms,
      byId: (id) => store.room(id),
      view: { cx: v.cx, cy: v.cy, scale: v.scale, z: v.z, area: v.area, names: v.names, mode: v.mode },
      currentId: here?.id ?? null,
      selection: view.selection,
      hover: ctx.hover,
      route,
      drag: ctx.drag,
      box: ctx.box,
      tokens,
      calm: ctx.calm(),
      fontFamily: getComputedStyle(root).fontFamily || "monospace",
      emptyMessage: all.length ? T6.emptyFloor : T6.emptyMap,
      areaColor: store.area(v.area)?.color
    };
  }
  function paint() {
    frame = null;
    const all = dirtyAll;
    dirtyAll = false;
    if (all) {
      toolbar.update();
      inspector.update();
      renderStatus();
      inspector.el.hidden = !view.state.details;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    draw(g, view.width, view.height, dpr, scene());
  }
  function invalidate(what = "canvas") {
    if (what === "all") dirtyAll = true;
    if (frame !== null) return;
    frame = requestAnimationFrame(paint);
  }
  function resize() {
    const w = stage.clientWidth, hgt = stage.clientHeight;
    if (!w || !hgt) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    view.width = w;
    view.height = hgt;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    invalidate("canvas");
  }
  subs.push(view.onChange(() => invalidate("all")));
  subs.push(store.watch(() => invalidate("all")));
  subs.push(deps.tracker.on((e) => {
    if (e.sid !== sid) {
      if (e.type === "created" || e.type === "enter") invalidate("canvas");
      return;
    }
    if (e.type === "enter" || e.type === "created") {
      const r = e.room;
      if (view.state.follow) {
        const patch = {};
        if (r.z !== view.state.z) patch.z = r.z;
        if (r.area !== view.state.area) patch.area = r.area;
        if (Object.keys(patch).length) view.set(patch);
        if (!view.isVisible(r.x, r.y, 1)) view.centreOn(r.x, r.y);
      }
    } else if (e.type === "walk") {
      const s = e.state;
      if (s.status === "arrived") {
        setStatus(T6.arrived);
        mu.a11y.announce(T6.arrived);
      } else if (s.status === "failed") {
        setStatus(T6.failed(s.reason));
        mu.a11y.announce(T6.failed(s.reason));
      } else if (s.status === "stopped") setStatus(T6.stopped);
    } else if (e.type === "lost") setStatus(T6.unknown);
    invalidate("all");
  }));
  subs.push(mu.theme.watch((t) => {
    tokens = t.tokens ?? tokensFromCss(root);
    reduceMotion = !!t.reduceMotion;
    invalidate("canvas");
  }));
  const prefWatch = (name, set) => {
    try {
      const d = mu.prefs.watch(name, (v) => {
        set(!!v);
        invalidate("canvas");
      });
      if (typeof d === "function") subs.push(d);
    } catch {
    }
  };
  prefWatch("effects.calm", (v) => {
    calmPref = v;
  });
  prefWatch("effects.performance", (v) => {
    perf = v;
  });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(stage);
  resize();
  invalidate("all");
  return {
    unmount() {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (statusTimer) clearTimeout(statusTimer);
      ro?.disconnect();
      closePopover();
      controller.dispose();
      for (const d of subs.splice(0)) {
        try {
          d();
        } catch {
        }
      }
      view.dispose();
      root.remove();
      releaseStyle();
    },
    snapshot() {
      return { ...view.snapshot(), hover: ctx.hover };
    },
    restore(s) {
      view.restore(s);
      invalidate("all");
    }
  };
}

// src/lua/bridge.ts
var EVENTS_PER_S = 50;
var EXPORT_LIMIT_BYTES = 60 * 1024;
function toLuaRoom(r) {
  const exits = {};
  for (const [k, e] of Object.entries(r.exits)) exits[k] = e.to ?? false;
  const out = {
    id: r.id,
    name: r.name,
    area: r.area,
    x: r.x,
    y: r.y,
    z: r.z,
    exits,
    tags: [...r.tags ?? []],
    note: r.note ?? "",
    symbol: r.symbol ?? "",
    color: r.color ?? "",
    env: r.env ?? "",
    locked: !!r.locked
  };
  if (r.vnum !== void 0) out.vnum = r.vnum;
  if (r.desc !== void 0) out.desc = r.desc;
  return out;
}
function toLuaArea(a, rooms) {
  return { id: a.id, name: a.id ? a.name : "", note: a.note ?? "", color: a.color ?? "", rooms };
}
function areaOf(store, id) {
  const aid = str3(id, "id");
  const a = store.area(aid);
  if (a) return a;
  return store.find({ area: aid, limit: 1 }).length ? { id: aid, name: aid } : void 0;
}
function areaFields(t) {
  const out = {};
  if ("note" in t) out.note = t.note === null ? void 0 : str3(t.note, "note") || void 0;
  if ("color" in t) out.color = t.color === null ? void 0 : color(t.color) || void 0;
  for (const k of Object.keys(t)) if (!["name", "note", "color"].includes(k)) bad(`unknown area field "${k}"`);
  return out;
}
function toLuaPath(p) {
  return p ? { ids: p.ids, steps: p.steps.flat(), cost: p.cost } : null;
}
function toLuaWalk(w) {
  return { status: w.status, target: w.target, route: [...w.route], at: w.at, ...w.reason !== void 0 ? { reason: w.reason } : {} };
}
var ArgError = class extends Error {
};
var bad = (what) => {
  throw new ArgError(what);
};
var isObj3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var table = (v, what) => v === void 0 || v === null ? {} : Array.isArray(v) && v.length === 0 ? {} : isObj3(v) ? v : bad(`${what} must be a table`);
var str3 = (v, what) => typeof v === "string" ? v : bad(`${what} must be a string`);
var nonEmpty = (v, what) => typeof v === "string" && v.trim() ? v : bad(`${what} must be a non-empty string`);
var optStr = (v, what) => v === void 0 || v === null ? void 0 : str3(v, what);
var num3 = (v, what) => typeof v === "number" && Number.isFinite(v) ? v : bad(`${what} must be a number`);
var int = (v, what) => Math.trunc(num3(v, what));
var optInt = (v, what) => v === void 0 || v === null ? void 0 : int(v, what);
var bool = (v, what) => typeof v === "boolean" ? v : bad(`${what} must be true or false`);
var optBool = (v, what) => v === void 0 || v === null ? void 0 : bool(v, what);
var strList = (v, what) => {
  if (v === void 0 || v === null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) bad(`${what} must be a list of strings`);
  return v;
};
var color = (v) => ROOM_COLORS.includes(str3(v, "color")) ? v : bad(`color must be one of ${ROOM_COLORS.filter(Boolean).join(", ")} or ""`);
var symbol = (v) => [...str3(v, "symbol")].length <= 2 ? v : bad("symbol must be at most 2 characters");
var dirName = (v) => dirByName(str3(v, "dir")) ? v : bad(`dir must be a direction name such as "north"`);
var DOORS = ["", "open", "closed", "locked"];
var door = (v) => DOORS.includes(str3(v, "door")) ? v : bad('door must be "", "open", "closed" or "locked"');
var ROOM_FIELDS = {
  name: (v) => nonEmpty(v, "name"),
  vnum: (v) => str3(v, "vnum"),
  area: (v) => str3(v, "area"),
  x: (v) => int(v, "x"),
  y: (v) => int(v, "y"),
  z: (v) => int(v, "z"),
  desc: (v) => str3(v, "desc"),
  env: (v) => str3(v, "env"),
  note: (v) => str3(v, "note"),
  warn: (v) => str3(v, "warn"),
  tags: (v) => strList(v, "tags"),
  symbol,
  color,
  weight: (v) => num3(v, "weight"),
  locked: (v) => bool(v, "locked")
};
var CLEARED = { vnum: "", desc: "", env: "", note: "", warn: "", symbol: "", color: "", tags: [], locked: false };
function roomPatch(raw, what) {
  const t = table(raw, what);
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === "exits") continue;
    const check = ROOM_FIELDS[k];
    if (!check) bad(`unknown field "${k}"`);
    if (k === "id") bad("id cannot be changed");
    out[k] = v === null ? CLEARED[k] ?? bad(`${k} cannot be null`) : check(v);
  }
  return out;
}
var walkOpts = (raw) => {
  const t = table(raw, "options");
  const o = {};
  if (t.mode !== void 0 && t.mode !== null) {
    if (t.mode !== "step" && t.mode !== "burst") bad('mode must be "step" or "burst"');
    o.mode = t.mode;
  }
  const delayMs = optInt(t.delayMs, "delayMs");
  if (delayMs !== void 0) o.delayMs = delayMs;
  const timeoutS = optInt(t.timeoutS, "timeoutS");
  if (timeoutS !== void 0) o.timeoutS = timeoutS;
  const locked = optBool(t.locked, "locked");
  if (locked !== void 0) o.locked = locked;
  return o;
};
function argList(raw) {
  if (raw === void 0 || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  if (!isObj3(raw)) return null;
  const keys = Object.keys(raw);
  if (!keys.every((k) => /^[1-9]\d*$/.test(k))) return keys.length ? null : [];
  const out = [];
  for (const k of keys) out[Number(k) - 1] = raw[k];
  return out;
}
function luaBridge(deps) {
  const { mu, tracker, walker } = deps;
  const sessions = /* @__PURE__ */ new Map();
  const pendingWalks = /* @__PURE__ */ new Set();
  let disposed = false;
  const session = (sid) => {
    let s = sessions.get(sid);
    if (!s) sessions.set(sid, s = { sid, events: false, dropped: 0, window: 0, sent: 0 });
    return s;
  };
  const emit = (sid, name, data) => {
    if (disposed) return;
    void Promise.resolve(mu.lua.emit(name, data, { sid })).catch((e) => mu.log.warn("Mapper", "lua emit failed", e));
  };
  const storeOf = (sid) => {
    const worldId = deps.worldOf(sid);
    const store = worldId ? deps.storeFor(worldId) : null;
    return store ?? bad("no map for this session");
  };
  const roomOf = (store, id, what = "id") => store.room(nonEmpty(id, what)) ?? bad(`no room ${String(id)}`);
  const hereOf = (c) => {
    const id = tracker.track(c.sid)?.position.roomId;
    return id ? c.store.room(id) ?? null : null;
  };
  const luaTrack = (c) => {
    const t = tracker.track(c.sid);
    return { roomId: t?.position.roomId ?? null, by: t?.position.by ?? "none", pending: [...t?.pending ?? []], paused: !!t?.paused, source: t?.source ?? "", dropped: session(c.sid).dropped };
  };
  function exitsOfAdd(raw, store) {
    const out = {};
    for (const [key, to] of Object.entries(table(raw, "exits"))) {
      if (!key.trim()) bad("exit key must be a non-empty string");
      if (to === true) out[key] = { key, to: null };
      else if (typeof to === "string") {
        if (!store.room(to)) bad(`exit ${key}: no room ${to}`);
        out[key] = { key, to };
      } else bad(`exit ${key} must be a room id or true`);
    }
    return out;
  }
  function sceneExits(raw) {
    if (raw === void 0 || raw === null) return void 0;
    if (Array.isArray(raw)) return raw.map((k) => ({ key: nonEmpty(k, "exit key") }));
    const out = [];
    for (const [key, to] of Object.entries(table(raw, "exits"))) {
      if (!key.trim()) bad("exit key must be a non-empty string");
      if (to === true) out.push({ key });
      else if (typeof to === "string" || typeof to === "number") out.push({ key, to: String(to) });
      else bad(`exit ${key} must be a vnum or true`);
    }
    return out;
  }
  const fns = {
    version: () => deps.version,
    here: (c) => {
      const r = hereOf(c);
      return r ? toLuaRoom(r) : null;
    },
    room: (c, [id]) => {
      const r = c.store.room(nonEmpty(id, "id"));
      return r ? toLuaRoom(r) : null;
    },
    rooms: (c, [q]) => {
      const t = table(q, "query");
      const fq = {};
      const name = optStr(t.name, "name");
      if (name !== void 0) fq.name = name;
      const area = optStr(t.area, "area");
      if (area !== void 0) fq.area = area;
      const tag = optStr(t.tag, "tag");
      if (tag !== void 0) fq.tag = tag;
      if (t.vnum !== void 0 && t.vnum !== null) fq.vnum = typeof t.vnum === "number" ? String(t.vnum) : str3(t.vnum, "vnum");
      const limit = optInt(t.limit, "limit");
      if (limit !== void 0) fq.limit = limit;
      if (t.near !== void 0 && t.near !== null) {
        const n = table(t.near, "near");
        fq.near = { roomId: roomOf(c.store, n.id, "near.id").id, radius: int(n.radius, "near.radius") };
      }
      return c.store.find(fq).map(toLuaRoom);
    },
    byVnum: (c, [v]) => {
      const r = c.store.byVnum(typeof v === "number" ? String(v) : nonEmpty(v, "vnum"));
      return r ? toLuaRoom(r) : null;
    },
    at: (c, [area, x, y, z]) => {
      const r = c.store.at(str3(area, "area"), int(x, "x"), int(y, "y"), int(z ?? 0, "z"));
      return r ? toLuaRoom(r) : null;
    },
    areas: (c) => {
      const counts = c.store.areaCounts();
      const out = c.store.areas().map((a) => toLuaArea(a, counts[a.id] ?? 0));
      if (counts[""] && !c.store.area("")) out.unshift(toLuaArea({ id: "", name: "" }, counts[""]));
      for (const id of Object.keys(counts)) if (id && !c.store.area(id)) out.push(toLuaArea({ id, name: id }, counts[id]));
      return out;
    },
    area: (c, [id]) => {
      const a = areaOf(c.store, id);
      return a ? toLuaArea(a, c.store.areaCounts()[a.id] ?? 0) : null;
    },
    areaLinks: (c, [id, opts]) => {
      const a = areaOf(c.store, id) ?? bad(`no area ${String(id)}`);
      const both = optBool(table(opts, "options").both, "both");
      return c.store.areaLinks(a.id, { both: both ?? false }).map((l) => ({ from: l.from.id, key: l.exit.key, to: l.to.id, fromArea: l.from.area, toArea: l.to.area }));
    },
    path: (c, a) => {
      let [from, to, opts] = a;
      if (a.length === 1 || a.length === 2 && typeof to !== "string") {
        opts = to;
        to = from;
        from = void 0;
      }
      if (from === void 0 || from === null) from = hereOf(c)?.id ?? bad("position unknown and no from given");
      const o = table(opts, "options");
      return toLuaPath(c.store.path(roomOf(c.store, from, "from").id, roomOf(c.store, to, "to").id, { ...o.locked !== void 0 ? { locked: bool(o.locked, "locked") } : {}, avoid: strList(o.avoid, "avoid") }));
    },
    incoming: (c, [id]) => c.store.incoming(roomOf(c.store, id).id).map(({ room, exit }) => ({ room: toLuaRoom(room), key: exit.key })),
    add: (c, [spec]) => {
      const t = table(spec, "room");
      const patch = roomPatch(t, "room");
      const name = patch.name ?? bad("name is required");
      const exits = exitsOfAdd(t.exits, c.store);
      const here = hereOf(c);
      const area = patch.area ?? here?.area ?? "";
      let cell;
      if (patch.x !== void 0 && patch.y !== void 0) cell = { x: patch.x, y: patch.y, z: patch.z ?? here?.z ?? 0 };
      else cell = c.store.freeNear(area, here?.x ?? 0, here?.y ?? 0, patch.z ?? here?.z ?? 0);
      if (c.store.at(area, cell.x, cell.y, cell.z)) bad(`cell ${cell.x},${cell.y},${cell.z} in area "${area}" is taken`);
      if (patch.vnum !== void 0 && c.store.byVnum(patch.vnum)) bad(`vnum ${patch.vnum} is already room ${c.store.byVnum(patch.vnum).id}`);
      const { x: _x, y: _y, z: _z, ...rest } = patch;
      return toLuaRoom(c.store.create({ ...rest, name, area, ...cell, exits }));
    },
    set: (c, [id, patch]) => {
      const r = roomOf(c.store, id);
      const p = roomPatch(patch, "patch");
      if (p.vnum !== void 0) {
        const o = c.store.byVnum(p.vnum);
        if (o && o.id !== r.id) bad(`vnum ${p.vnum} is already room ${o.id}`);
      }
      const nx = p.x ?? r.x, ny = p.y ?? r.y, nz = p.z ?? r.z, na = p.area ?? r.area;
      const occupant = c.store.at(na, nx, ny, nz);
      if (occupant && occupant.id !== r.id) bad(`cell ${nx},${ny},${nz} in area "${na}" is taken by ${occupant.id}`);
      return toLuaRoom(c.store.update(r.id, p));
    },
    remove: (c, [id]) => {
      c.store.remove(roomOf(c.store, id).id);
      return true;
    },
    merge: (c, [from, into]) => {
      const a = roomOf(c.store, from, "from"), b = roomOf(c.store, into, "into");
      if (a.id === b.id) bad("from and into are the same room");
      c.store.merge(a.id, b.id);
      return true;
    },
    move: (c, [ids, dx, dy, dz]) => {
      const list = (Array.isArray(ids) ? ids : [ids]).map((id) => roomOf(c.store, id).id);
      return c.store.move(list, int(dx, "dx"), int(dy, "dy"), dz === void 0 || dz === null ? 0 : int(dz, "dz"));
    },
    exit: (c, [id, key, spec]) => {
      const r = roomOf(c.store, id);
      const k = nonEmpty(key, "key");
      const t = table(spec, "exit");
      const e = { ...r.exits[k] ?? { key: k, to: null } };
      for (const [f, v] of Object.entries(t)) {
        switch (f) {
          case "to":
            e.to = v === false || v === null ? null : roomOf(c.store, v, "to").id;
            break;
          case "name":
            e.name = str3(v, "name");
            break;
          case "commands":
            e.commands = strList(v, "commands");
            break;
          case "cost":
            e.cost = num3(v, "cost");
            break;
          case "door":
            e.door = door(v);
            break;
          case "oneway":
            e.oneway = bool(v, "oneway");
            break;
          case "dir":
            e.dir = dirName(v);
            break;
          case "blocked":
            e.blocked = bool(v, "blocked");
            break;
          case "handle":
            e.handle = str3(v, "handle");
            break;
          default:
            bad(`unknown exit field "${f}"`);
        }
      }
      c.store.setExit(r.id, e);
      return toLuaRoom(c.store.room(r.id));
    },
    removeExit: (c, [id, key]) => {
      const r = roomOf(c.store, id);
      const k = nonEmpty(key, "key");
      if (!r.exits[k]) bad(`no exit ${k} in ${r.id}`);
      c.store.removeExit(r.id, k);
      return true;
    },
    link: (c, [id, key, to, opts]) => {
      const r = roomOf(c.store, id), dest = roomOf(c.store, to, "to");
      const back = table(opts, "options").back;
      c.store.link(r.id, nonEmpty(key, "key"), dest.id, { back: back === void 0 || back === null ? true : bool(back, "back") });
      return toLuaRoom(c.store.room(r.id));
    },
    unlink: (c, [id, key]) => {
      const r = roomOf(c.store, id);
      const k = nonEmpty(key, "key");
      if (!r.exits[k]) bad(`no exit ${k} in ${r.id}`);
      c.store.unlink(r.id, k);
      return true;
    },
    addArea: (c, [name, fields]) => {
      const t = table(fields, "fields");
      return toLuaArea(c.store.createArea(nonEmpty(name, "name"), areaFields(t)), 0);
    },
    setArea: (c, [id, fields]) => {
      const aid = str3(id, "id");
      if (!aid) bad("the default area cannot be edited");
      const t = table(fields, "fields");
      const name = optStr(t.name, "name");
      const a = c.store.setArea({ id: aid, ...name !== void 0 ? { name: nonEmpty(name, "name") } : {}, ...areaFields(t) });
      return toLuaArea(a, c.store.areaCounts()[a.id] ?? 0);
    },
    removeArea: (c, [id, opts]) => {
      const a = areaOf(c.store, id) ?? bad(`no area ${String(id)}`);
      if (!a.id) bad("the default area cannot be deleted");
      const o = table(opts, "options");
      const mode = optStr(o.rooms, "rooms");
      if (mode !== void 0 && mode !== "delete" && mode !== "move") bad('rooms must be "delete" or "move"');
      const rooms = mode;
      const to = optStr(o.to, "to");
      if (to !== void 0 && to !== "" && !areaOf(c.store, to)) bad(`no area ${to}`);
      c.store.removeArea(a.id, { rooms: rooms ?? "move", to });
      return true;
    },
    autoConnect: (c, [area]) => c.store.autoConnect(optStr(area, "area")),
    tag: (c, [id, tag]) => {
      const r = roomOf(c.store, id);
      const t = nonEmpty(tag, "tag");
      const tags = r.tags ?? [];
      if (!tags.includes(t)) c.store.update(r.id, { tags: [...tags, t] });
      return toLuaRoom(c.store.room(r.id));
    },
    untag: (c, [id, tag]) => {
      const r = roomOf(c.store, id);
      const t = nonEmpty(tag, "tag");
      if (r.tags?.includes(t)) c.store.update(r.id, { tags: r.tags.filter((x) => x !== t) });
      return toLuaRoom(c.store.room(r.id));
    },
    note: (c, [id, text]) => {
      const r = roomOf(c.store, id);
      c.store.update(r.id, { note: str3(text ?? "", "text") });
      return toLuaRoom(c.store.room(r.id));
    },
    lock: (c, [id, on]) => {
      const r = roomOf(c.store, id);
      c.store.update(r.id, { locked: bool(on, "bool") });
      return toLuaRoom(c.store.room(r.id));
    },
    scene: (c, [spec]) => {
      const t = table(spec, "scene");
      const input = { sid: c.sid, source: "lua", name: nonEmpty(t.name, "name") };
      if (t.vnum !== void 0 && t.vnum !== null) input.vnum = typeof t.vnum === "number" ? String(t.vnum) : str3(t.vnum, "vnum");
      const desc = optStr(t.desc, "desc");
      if (desc !== void 0) input.desc = desc;
      const area = optStr(t.area, "area");
      if (area !== void 0) input.area = area;
      const env = optStr(t.env, "env");
      if (env !== void 0) input.env = env;
      const exits = sceneExits(t.exits);
      if (exits) input.exits = exits;
      const complete = optBool(t.exitsComplete, "exitsComplete");
      if (complete !== void 0) input.exitsComplete = complete;
      if (t.coords !== void 0 && t.coords !== null) {
        const k = table(t.coords, "coords");
        input.coords = { x: int(k.x, "coords.x"), y: int(k.y, "coords.y"), z: int(k.z ?? 0, "coords.z") };
      }
      tracker.scene(input);
      return luaTrack(c);
    },
    moved: (c, [key, opts]) => {
      const o = table(opts, "options");
      tracker.moved(c.sid, nonEmpty(key, "key"), { confirmed: optBool(o.confirmed, "confirmed") });
      return true;
    },
    failed: (c, [text, key]) => {
      tracker.failed(c.sid, str3(text ?? "", "text"), key === void 0 || key === null ? null : nonEmpty(key, "key"));
      return true;
    },
    anchor: (c, [id]) => {
      tracker.anchor(c.sid, roomOf(c.store, id).id);
      return luaTrack(c);
    },
    pause: (c, [on]) => {
      tracker.pause(c.sid, bool(on, "bool"));
      return luaTrack(c);
    },
    track: (c) => luaTrack(c),
    goto: (c, [id, opts]) => guardWalk(walker.goto(c.sid, roomOf(c.store, id).id, walkOpts(opts))),
    walk: (c, [steps, opts]) => {
      const list = strList(steps, "steps");
      if (!list.length) bad("steps must not be empty");
      return guardWalk(walker.steps(c.sid, list, walkOpts(opts)));
    },
    stop: (c) => {
      walker.stop(c.sid);
      return toLuaWalk(walker.state(c.sid));
    },
    walkPause: (c, [on]) => {
      if (bool(on, "bool")) walker.pause(c.sid);
      else walker.resume(c.sid);
      return toLuaWalk(walker.state(c.sid));
    },
    walking: (c) => toLuaWalk(walker.state(c.sid)),
    batch: (c, [label, calls]) => {
      const l = nonEmpty(label, "label");
      if (!Array.isArray(calls) || !calls.length) bad("calls must be a non-empty list of { fn, args }");
      if (c.inBatch) bad("batch cannot nest");
      const specs = calls.map((x, i) => {
        const t = table(x, `call ${i + 1}`);
        const fn = nonEmpty(t.fn, `call ${i + 1}: fn`);
        const def = LUA_API.find((d) => d.fn === fn) ?? bad(`call ${i + 1}: unknown function "${fn}"`);
        if (def.batchable === false) bad(`call ${i + 1}: ${fn} cannot run in a batch`);
        const args = t.args === void 0 || t.args === null ? [] : Array.isArray(t.args) ? t.args : bad(`call ${i + 1}: args must be a list`);
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
    import: (c, [data]) => {
      if (!isObj3(data)) bad("data must be a map table");
      try {
        return c.store.import(data);
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
    erase: (c, [confirm]) => {
      if (confirm !== "yes") bad('pass "yes" to erase the whole map');
      c.store.erase();
      return true;
    },
    events: (c, [on]) => {
      session(c.sid).events = bool(on, "bool");
      return session(c.sid).events;
    },
    help: () => luaHelp()
  };
  for (const d of LUA_API) if (!fns[d.fn]) throw new Error(`lua bridge: ${d.fn} is in the API table but not implemented`);
  function guardWalk(p) {
    return new Promise((resolve) => {
      let done = false;
      const settle = () => {
        if (!done) {
          done = true;
          pendingWalks.delete(h);
          resolve({ status: "stopped", target: null, route: [], at: 0, reason: "mapper unloaded" });
        }
      };
      const h = { settle };
      pendingWalks.add(h);
      p.then((s) => {
        if (!done) {
          done = true;
          pendingWalks.delete(h);
          resolve(toLuaWalk(s));
        }
      }, (e) => {
        if (!done) {
          done = true;
          pendingWalks.delete(h);
          resolve({ status: "failed", target: null, route: [], at: 0, reason: e instanceof Error ? e.message : String(e) });
        }
      });
    });
  }
  function run(c, fn, args) {
    const f = fns[fn];
    if (!f) return { ok: false, error: `mapper.${fn}: unknown function (see mapper.help())` };
    try {
      return { ok: true, result: f(c, args) };
    } catch (e) {
      if (e instanceof ArgError) return { ok: false, error: `mapper.${fn}: ${e.message}` };
      mu.log.error("Mapper", `lua ${fn}`, e);
      return { ok: false, error: `mapper.${fn}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const offCall = mu.lua.on("mapper.call", (data, meta) => {
    if (disposed) return;
    const sid = meta.sid;
    const call = isObj3(data) ? data : null;
    const id = call && typeof call.id === "number" ? call.id : void 0;
    const reply = (r2) => {
      if (id !== void 0) emit(sid, "mapper.reply", { id, ...r2 });
    };
    if (!call || typeof call.fn !== "string") {
      reply({ ok: false, error: "mapper.call: expected { id?, fn, args? }" });
      return;
    }
    const args = argList(call.args);
    if (!args) {
      reply({ ok: false, error: `mapper.${call.fn}: args must be a list` });
      return;
    }
    let store;
    try {
      store = storeOf(sid);
    } catch (e) {
      if (call.fn === "version" || call.fn === "help") {
        reply(run({ sid, store: null, inBatch: false }, call.fn, args));
        return;
      }
      reply({ ok: false, error: `mapper.${call.fn}: ${e.message}` });
      return;
    }
    const r = run({ sid, store, inBatch: false }, call.fn, args);
    if (r.ok && r.result instanceof Promise) {
      void r.result.then((result) => reply({ ok: true, result }), (e) => reply({ ok: false, error: `mapper.${call.fn}: ${e instanceof Error ? e.message : String(e)}` }));
      return;
    }
    reply(r);
  });
  const offEvents = tracker.on((e) => {
    if (e.type === "track" || e.type === "moved") return;
    const s = sessions.get(e.sid);
    if (!s?.events) return;
    const now = Date.now();
    if (now - s.window >= 1e3) {
      s.window = now;
      s.sent = 0;
    }
    if (s.sent >= EVENTS_PER_S) {
      s.dropped++;
      return;
    }
    s.sent++;
    emit(e.sid, "mapper.event", toLuaEvent(e));
  });
  const offClose = mu.sessions.on("close", (ref) => {
    sessions.delete(ref.id);
  });
  return () => {
    if (disposed) return;
    disposed = true;
    for (const w of [...pendingWalks]) w.settle();
    pendingWalks.clear();
    sessions.clear();
    offCall();
    offEvents();
    offClose();
  };
}
function toLuaEvent(e) {
  switch (e.type) {
    case "enter":
      return { type: "enter", room: toLuaRoom(e.room), prev: e.prev ? toLuaRoom(e.prev) : null, via: e.via, by: e.by };
    case "created":
      return { type: "created", room: toLuaRoom(e.room), via: e.via };
    case "lost":
      return { type: "lost", name: e.scene.name, vnum: e.scene.vnum ?? null };
    case "failed":
      return { type: "failed", key: e.key, text: e.text };
    case "walk":
      return { type: "walk", status: e.state.status, target: e.state.target, at: e.state.at, total: e.state.route.length, reason: e.state.reason ?? null };
    default:
      return null;
  }
}

// src/index.ts
var ID = "mapper";
var COPY = {
  title: "Mapper",
  open: "Mapper: open the map",
  focus: "Go to map",
  copyLua: `Mapper: ${COPY_LUA_LABEL.toLowerCase()}`,
  pause: "Mapper: pause or resume mapping",
  stop: "Mapper: stop walking",
  paused: "Mapping paused",
  resumed: "Mapping resumed",
  saveFailed: "Map not saved",
  saveFailedBody: "The map store is full or unavailable. Export the map from the panel menu.",
  mapLoaded: (n) => `Map loaded: ${n} rooms`,
  mapLoadFailed: "Could not load the map file",
  settings: {
    autoConnect: "Connect new rooms to matching neighbours",
    autoConnectHint: "a new room links to the room next to it when their exits face each other",
    areasFromGame: "Group rooms by the area the game names",
    areasFromGameHint: "off: every room goes in one area",
    areaOnEnter: "New area for in, out, enter, board and leave",
    areaOnEnterHint: "a room first reached by going in or out, or by enter, board, leave or exit, starts its own area; off: it is placed beside the previous room",
    keepDesc: "Keep room descriptions in the map",
    keepDescHint: "descriptions make rooms easier to tell apart in games without room ids, and make the map larger",
    fromText: "Read moves and exits from the game text",
    fromTextHint: "confirmations such as \u201CYou begin walking north.\u201D and exit lines; off: only GMCP/MSDP/Lua",
    walkMode: "Walk",
    walkStep: "step by step (wait for each room)",
    walkBurst: "all at once",
    walkDelay: "Pause between commands when walking all at once",
    walkTimeout: "Give up a step after"
  }
};
function hostOf(mu, s) {
  if (!s) return void 0;
  const name = s.worldName.trim();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(name)) return name;
  const home = mu.sessions.meta(s.id)?.links.home;
  if (home) {
    try {
      return new URL(home).hostname;
    } catch {
    }
  }
  return void 0;
}
var index_default = defineExtension({
  async activate(ctx) {
    const mu = ctx.mu;
    mu.settings.define({
      title: COPY.title,
      tile: { glyph: "\u2316", order: 1620 },
      items: [
        { key: "autoConnect", label: COPY.settings.autoConnect, default: true, kind: "toggle", scope: "both", group: "Mapping", hint: COPY.settings.autoConnectHint },
        { key: "areasFromGame", label: COPY.settings.areasFromGame, default: true, kind: "toggle", scope: "both", group: "Mapping", hint: COPY.settings.areasFromGameHint },
        { key: "areaOnEnter", label: COPY.settings.areaOnEnter, default: true, kind: "toggle", scope: "both", group: "Mapping", hint: COPY.settings.areaOnEnterHint },
        { key: "keepDesc", label: COPY.settings.keepDesc, default: true, kind: "toggle", scope: "both", group: "Mapping", hint: COPY.settings.keepDescHint },
        { key: "fromText", label: COPY.settings.fromText, default: true, kind: "toggle", scope: "both", group: "Mapping", hint: COPY.settings.fromTextHint },
        {
          key: "walk.mode",
          label: COPY.settings.walkMode,
          default: "step",
          kind: "select",
          scope: "both",
          group: "Walking",
          options: [{ value: "step", label: COPY.settings.walkStep }, { value: "burst", label: COPY.settings.walkBurst }]
        },
        { key: "walk.delayMs", label: COPY.settings.walkDelay, default: 150, kind: "range", min: 0, max: 2e3, step: 50, unit: "ms", scope: "both", group: "Walking", when: { key: "walk.mode", equals: "burst" } },
        { key: "walk.timeoutS", label: COPY.settings.walkTimeout, default: 10, kind: "range", min: 2, max: 60, step: 1, unit: "s", scope: "both", group: "Walking" },
        { key: "keys.focus", kind: "shortcut", command: "focus.mapper", group: "Keys" }
      ]
    });
    const setting = (key, worldId) => mu.settings.get(key, worldId === null ? void 0 : { worldId });
    const stores = /* @__PURE__ */ new Map();
    const storeFor = (worldId) => {
      if (!worldId) return null;
      let s = stores.get(worldId);
      if (!s) {
        const persist = storePersist(mu.storage.world(worldId));
        persist.onError = (e) => {
          mu.log.warn("mapper", "save failed", e);
          mu.ui.toast(COPY.saveFailed, COPY.saveFailedBody, { kind: ID, group: "mapper-save" });
        };
        s = createStore(worldId, persist);
        stores.set(worldId, s);
      }
      return s;
    };
    ctx.subscriptions.push(() => {
      for (const s of stores.values()) s.dispose();
      stores.clear();
    });
    const sessionOf = (sid) => mu.sessions.list().find((s) => s.id === sid);
    const worldOf = (sid) => sessionOf(sid)?.worldId ?? null;
    const registered = [];
    const profileOfWorld = (worldId) => {
      const s = worldId ? mu.sessions.list().find((x) => x.worldId === worldId) : void 0;
      return profileFor(hostOf(mu, s), registered);
    };
    const profileOf = (sid) => profileFor(hostOf(mu, sessionOf(sid)), registered);
    const tracker = createTracker({
      storeFor,
      worldOf,
      settings: { get: setting },
      moveVerbs: (worldId) => profileOfWorld(worldId).moveVerbs
    });
    const walker = createWalker({
      tracker,
      storeFor,
      worldOf,
      send: (sid, text) => mu.sessions.send(text, { sid, echo: true })
    });
    ctx.subscriptions.push(() => {
      for (const t of tracker.tracks()) walker.stop(t.sid);
    });
    mu.sessions.on("close", (s) => {
      walker.stop(s.id);
      tracker.drop(s.id);
    });
    gmcpSource(mu, tracker, worldOf);
    sceneSource(mu, tracker);
    const textOn = (sid) => mu.settings.get("fromText", { sid }) !== false;
    textSource(mu, {
      ...tracker,
      // The text source is gated per world by the `fromText` setting; the tracker itself always accepts.
      scene: (input) => {
        if (textOn(input.sid)) tracker.scene(input);
      },
      moved: (sid, key, o) => {
        if (textOn(sid)) tracker.moved(sid, key, o);
      },
      failed: (sid, text, key) => {
        if (textOn(sid)) tracker.failed(sid, text, key);
      }
    }, profileOf);
    const panelSettings = (worldId) => ({
      get: (key) => mu.settings.get(key, { worldId }),
      watch: (key, fn) => mu.settings.watch(key, () => fn(), { worldId })
    });
    const mounted = /* @__PURE__ */ new Map();
    mu.panels.register({
      id: ID,
      title: COPY.title,
      defaultPosition: "right-bottom",
      order: 40,
      show: "always",
      mount: (el, pctx) => {
        const m = mountPanel({ mu, store: storeFor, tracker, walker, settings: panelSettings(pctx.worldId ?? "") }, el, pctx);
        mounted.set(el, m);
        return () => {
          m.unmount();
          mounted.delete(el);
        };
      },
      snapshot: (el) => mounted.get(el)?.snapshot(),
      restore: (el, saved) => mounted.get(el)?.restore(saved)
    });
    const touched = /* @__PURE__ */ new Set();
    tracker.on((e) => {
      if ((e.type === "enter" || e.type === "created") && !touched.has(e.sid)) {
        touched.add(e.sid);
        mu.panels.touch(ID, e.sid);
      }
    });
    mu.sessions.on("close", (s) => touched.delete(s.id));
    mu.commands.register({ id: `${ID}.open`, title: COPY.open, group: "Map", when: "session", run: () => mu.panels.open(ID) });
    mu.commands.register({ id: "focus.mapper", title: COPY.focus, keys: ["Alt+M"], group: "Focus", when: "session", run: () => {
      if (!mu.panels.focus(ID)) mu.panels.open(ID, void 0, { focus: true });
    } });
    mu.commands.register({ id: `${ID}.copyLua`, title: COPY.copyLua, group: "Map", run: () => void copyLuaLibrary(mu) });
    mu.commands.register({ id: `${ID}.pause`, title: COPY.pause, group: "Map", when: "session", run: () => {
      const sid = mu.sessions.active()?.id;
      if (!sid) return;
      const paused = !tracker.track(sid)?.paused;
      tracker.pause(sid, paused);
      mu.ui.toast(paused ? COPY.paused : COPY.resumed, void 0, { kind: ID, timeoutMs: 1500 });
    } });
    mu.commands.register({ id: `${ID}.stop`, title: COPY.stop, group: "Map", when: (sid) => !!sid && walker.state(sid).status === "walking", run: () => {
      const sid = mu.sessions.active()?.id;
      if (sid) walker.stop(sid);
    } });
    luaBridge({ mu, storeFor, worldOf, tracker, walker, version: ctx.version });
    const activeWorld = () => mu.sessions.active()?.worldId ?? "";
    const activeSid = () => mu.sessions.active()?.id ?? null;
    const api = {
      version: ctx.version,
      store: (worldId) => storeFor(worldId ?? activeWorld()),
      tracker,
      walker,
      scene: (input) => tracker.scene(input),
      here: (sid) => {
        const id = sid ?? activeSid();
        if (!id) return null;
        const t = tracker.track(id);
        const w = worldOf(id);
        return t?.position.roomId && w ? storeFor(w)?.room(t.position.roomId) ?? null : null;
      },
      goto: (roomId, sid, opts) => {
        const id = sid ?? activeSid();
        if (!id) return Promise.resolve({ status: "failed", target: roomId, route: [], at: 0, reason: "no session" });
        const w = worldOf(id);
        return walker.goto(id, roomId, {
          mode: setting("walk.mode", w),
          delayMs: setting("walk.delayMs", w),
          timeoutS: setting("walk.timeoutS", w),
          ...opts
        });
      },
      on: (fn) => tracker.on(fn),
      loadMapFile: async (url, sid) => {
        const w = worldOf(sid);
        const store = w ? storeFor(w) : null;
        if (!store) return;
        try {
          const res = await mu.net.fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = readMapFile(await res.json());
          if (store.rooms().length && !await mu.ui.confirm({ title: "Replace the map?", body: `The game offers a map file (${url}). Importing replaces the ${store.rooms().length} rooms of this world's map.`, confirm: "Replace", danger: true })) return;
          const { rooms } = store.import(data);
          mu.ui.toast(COPY.mapLoaded(rooms), void 0, { kind: ID });
        } catch (e) {
          mu.log.warn("mapper", "loadMapFile", e);
          mu.ui.toast(COPY.mapLoadFailed, e instanceof Error ? e.message : String(e), { kind: ID });
        }
      },
      profile: (p) => {
        registered.push(p);
        return () => {
          const i = registered.indexOf(p);
          if (i >= 0) registered.splice(i, 1);
        };
      },
      luaLibrary: () => MAPPER_LUA
    };
    mu.log.info(COPY.title, ctx.version, "active");
    return api;
  }
});
export {
  index_default as default
};
