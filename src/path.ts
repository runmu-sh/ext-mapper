/**
 * Pure graph and grid helpers for the store: Dijkstra over exits, the free-cell spiral, the component walk.
 * Nothing here mutates; the store passes it read-only views.
 */
import type { Dir, MapRoom, PathResult } from './types';

/** A small binary min-heap of `[cost, id]`, insertion order breaking ties. */
class Heap {
  private a: Array<{ c: number; n: number; id: string }> = [];
  private seq = 0;
  get size(): number { return this.a.length; }
  push(c: number, id: string): void {
    const a = this.a;
    a.push({ c, n: this.seq++, id });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break;
    }
  }
  pop(): { c: number; id: string } | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
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
  private less(x: { c: number; n: number }, y: { c: number; n: number }): boolean {
    return x.c < y.c || (x.c === y.c && x.n < y.n);
  }
}

export interface PathOpts { locked?: boolean; avoid?: string[] }

/**
 * Cheapest route from `from` to `to`. Cost of a hop = (exit.cost ?? 1) + (destination.weight ?? 1). Skips blocked
 * exits, locked doors (unless `opts.locked`), rooms in `opts.avoid` and exits to unknown rooms.
 */
export function dijkstra(rooms: ReadonlyMap<string, MapRoom>, from: string, to: string, opts: PathOpts = {}): PathResult {
  if (!rooms.has(from) || !rooms.has(to)) return null;
  if (from === to) return { ids: [], steps: [], cost: 0 };
  const avoid = new Set(opts.avoid ?? []);
  avoid.delete(from);
  if (avoid.has(to)) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { id: string; steps: string[] }>();
  const done = new Set<string>();
  const heap = new Heap();
  heap.push(0, from);
  while (heap.size) {
    const cur = heap.pop()!;
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    if (cur.id === to) break;
    const room = rooms.get(cur.id)!;
    for (const e of Object.values(room.exits)) {
      if (!e.to || e.blocked) continue;
      if (e.door === 'locked' && !opts.locked) continue;
      if (avoid.has(e.to) || done.has(e.to)) continue;
      const dest = rooms.get(e.to);
      if (!dest) continue;
      const c = cur.c + (e.cost ?? 1) + (dest.weight ?? 1);
      const old = dist.get(e.to);
      if (old === undefined || c < old) {
        dist.set(e.to, c);
        prev.set(e.to, { id: cur.id, steps: e.commands ?? [e.key] });
        heap.push(c, e.to);
      }
    }
  }
  if (!done.has(to)) return null;
  const ids: string[] = [];
  const steps: string[][] = [];
  for (let at = to; at !== from;) {
    const p = prev.get(at)!;
    ids.unshift(at);
    steps.unshift([...p.steps]);
    at = p.id;
  }
  return { ids, steps, cost: dist.get(to)! };
}

export type Cell = { x: number; y: number; z: number };

/** The nearest free cell to `(x, y)` on floor `z`, spiralling out in Chebyshev rings up to `maxRadius`. */
export function spiralFree(taken: (x: number, y: number, z: number) => boolean, x: number, y: number, z: number, maxRadius = 60): Cell {
  if (!taken(x, y, z)) return { x, y, z };
  for (let r = 1; r <= maxRadius; r++) {
    // Walk the ring clockwise from the top-left corner, trying the straight neighbours' side first.
    for (let i = -r; i <= r; i++) if (!taken(x + i, y - r, z)) return { x: x + i, y: y - r, z };
    for (let j = -r + 1; j <= r; j++) if (!taken(x + r, y + j, z)) return { x: x + r, y: y + j, z };
    for (let i = r - 1; i >= -r; i--) if (!taken(x + i, y + r, z)) return { x: x + i, y: y + r, z };
    for (let j = r - 1; j >= -r + 1; j--) if (!taken(x - r, y + j, z)) return { x: x - r, y: y + j, z };
  }
  return { x, y, z };
}

/** A free cell along `dir` from a room: k = 1..12 steps out, else the nearest free cell to the first step. */
export function alongFree(taken: (x: number, y: number, z: number) => boolean, room: Cell, dir: Dir): Cell {
  for (let k = 1; k <= 12; k++) {
    const x = room.x + dir.dx * k, y = room.y + dir.dy * k, z = room.z + dir.dz * k;
    if (!taken(x, y, z)) return { x, y, z };
  }
  return spiralFree(taken, room.x + dir.dx, room.y + dir.dy, room.z + dir.dz);
}

/** Rooms reachable from `start` on its floor and area, through links in either direction. */
export function componentOf(rooms: ReadonlyMap<string, MapRoom>, start: string): Set<string> {
  const out = new Set<string>();
  const root = rooms.get(start);
  if (!root) return out;
  const same = (r: MapRoom | undefined): r is MapRoom => !!r && r.area === root.area && r.z === root.z;
  // Reverse adjacency for this floor, built once.
  const back = new Map<string, string[]>();
  for (const r of rooms.values()) {
    if (!same(r)) continue;
    for (const e of Object.values(r.exits)) {
      if (!e.to) continue;
      let list = back.get(e.to);
      if (!list) back.set(e.to, (list = []));
      list.push(r.id);
    }
  }
  const queue = [start];
  out.add(start);
  while (queue.length) {
    const id = queue.shift()!;
    const r = rooms.get(id)!;
    const next: string[] = [];
    for (const e of Object.values(r.exits)) if (e.to) next.push(e.to);
    for (const b of back.get(id) ?? []) next.push(b);
    for (const n of next) {
      if (out.has(n)) continue;
      if (!same(rooms.get(n))) continue;
      out.add(n);
      queue.push(n);
    }
  }
  return out;
}
