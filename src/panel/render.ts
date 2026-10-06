/**
 * Pure canvas drawing of one floor of the map. `draw` takes a 2D context and a plain `Scene` and touches nothing
 * else, so a recording context can test it. Colours come in as theme token hexes (`ThemeInfo.tokens`).
 *
 * Room colours: the named `RoomColor`s map to tokens (`'' → border`, `accent`, `gold`, `ok`, `alert`, `dim → fg-dim`).
 * `sky`, `moss`, `plum` and `rust` have no token of their own, so they are derived here, mixed with `bg` so they stay
 * in the theme's register (the share is of the first colour):
 *   sky  = 62% accent  + 38% bg
 *   moss = 62% ok      + 38% bg
 *   plum = 50% (accent+gold mixed 50/50) + 50% bg
 *   rust = 55% gold    + 45% bg
 */
import type { MapExit, MapRoom, RoomColor } from '../types';
import { dirByName, parseDir } from '../dirs';
import type { BoxSelect, DragPreview, Tokens } from './deps';

export interface SceneView { cx: number; cy: number; scale: number; z: number; area: string; names: boolean; mode: 'walk' | 'edit' }

export interface Scene {
  /** The rooms of the shown floor and area. */
  rooms: readonly MapRoom[];
  /** Any room of the map (for link destinations). */
  byId(id: string): MapRoom | undefined;
  view: SceneView;
  currentId: string | null;
  selection: ReadonlySet<string>;
  hover: string | null;
  /** The walker's route, room ids in order (the start first when known). */
  route: readonly string[];
  drag: DragPreview | null;
  box: BoxSelect | null;
  tokens: Tokens;
  /** Reduce motion / calm: no glow blur. */
  calm: boolean;
  fontFamily: string;
  /** Shown when `rooms` is empty. */
  emptyMessage: string | null;
  /** The shown area's colour: rooms without a colour of their own take a dimmed version of it. */
  areaColor?: RoomColor;
}

/** Half the side of a room square, in cells. */
export const ROOM_HALF = 0.27;
/** Grid dots appear from this scale. */
export const GRID_MIN_SCALE = 22;
/** Names draw (with `names` on) from this scale. */
export const NAMES_MIN_SCALE = 40;
/** Curved links get their key chip from this scale. */
export const CHIP_MIN_SCALE = 44;

/* ────────────────────────────── colours ────────────────────────────── */

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** `share` of `a` with the rest `b`, both hex. A colour that does not parse is returned as is. */
export function mix(a: string, b: string, share: number): string {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return a;
  const t = Math.max(0, Math.min(1, share));
  return `#${toHex(pa[0] * t + pb[0] * (1 - t))}${toHex(pa[1] * t + pb[1] * (1 - t))}${toHex(pa[2] * t + pb[2] * (1 - t))}`;
}

/** A hex colour with an alpha (0–1). Non-hex colours are returned as is. */
export function withAlpha(c: string, alpha: number): string {
  const p = parseHex(c);
  if (!p) return c;
  return `#${toHex(p[0])}${toHex(p[1])}${toHex(p[2])}${toHex(alpha * 255)}`;
}

/** The hex of a named room colour under these tokens. */
export function roomColorHex(color: RoomColor | undefined, t: Tokens): string {
  switch (color) {
    case 'accent': return t.accent;
    case 'gold': return t.gold;
    case 'ok': return t.ok;
    case 'alert': return t.alert;
    case 'dim': return t.fgDim;
    case 'sky': return mix(t.accent, t.bg, 0.62);
    case 'moss': return mix(t.ok, t.bg, 0.62);
    case 'plum': return mix(mix(t.accent, t.gold, 0.5), t.bg, 0.5);
    case 'rust': return mix(t.gold, t.bg, 0.55);
    default: return t.border;
  }
}

/* ────────────────────────────── geometry ────────────────────────────── */

/** The point on the edge of a square of half-size `half` centred at (cx, cy), in direction (dx, dy) ∈ {-1,0,1}. */
export function edgePoint(cx: number, cy: number, dx: number, dy: number, half: number): { x: number; y: number } {
  return { x: cx + Math.sign(dx) * half, y: cy + Math.sign(dy) * half };
}

/** The grid vector of an exit: its key as a direction, else its declared `dir`. */
export function exitVector(exit: MapExit): { dx: number; dy: number; dz: number } | null {
  const d = parseDir(exit.key) ?? (exit.dir ? dirByName(exit.dir) : undefined);
  return d ? { dx: d.dx, dy: d.dy, dz: d.dz } : null;
}

function sameFloor(a: MapRoom, b: MapRoom): boolean { return a.z === b.z && a.area === b.area; }

function hasBackLink(target: MapRoom, roomId: string): boolean {
  for (const e of Object.values(target.exits)) if (e.to === roomId) return true;
  return false;
}

function ellipsise(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/* ────────────────────────────── drawing ────────────────────────────── */

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, scene: Scene): void {
  const { view, tokens: t } = scene;
  const s = view.scale;
  const half = ROOM_HALF * s;
  const px = (x: number): number => w / 2 + (x - view.cx) * s;
  const py = (y: number): number => h / 2 + (y - view.cy) * s;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  if (s >= GRID_MIN_SCALE) drawGrid(ctx, w, h, scene);
  drawRoute(ctx, scene, px, py);

  const onFloor = new Map<string, MapRoom>();
  for (const r of scene.rooms) onFloor.set(r.id, r);
  const drawnPairs = new Set<string>();
  for (const r of scene.rooms) drawLinks(ctx, r, scene, drawnPairs, px, py, half);
  for (const r of scene.rooms) drawDecor(ctx, r, scene, px, py, half);
  for (const r of scene.rooms) drawRoom(ctx, r, scene, px, py, half);
  for (const r of scene.rooms) drawName(ctx, r, scene, px, py, half);
  if (scene.drag) drawDrag(ctx, scene.drag, t, px, py, half);
  if (scene.box) drawBox(ctx, scene.box, t);
  if (!scene.rooms.length && scene.emptyMessage) drawEmpty(ctx, w, h, scene);
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
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

function drawRoute(ctx: CanvasRenderingContext2D, scene: Scene, px: (x: number) => number, py: (y: number) => number): void {
  if (scene.route.length < 2) return;
  const s = scene.view.scale;
  ctx.strokeStyle = withAlpha(scene.tokens.gold, 0.35);
  ctx.lineWidth = Math.max(4, s * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (const id of scene.route) {
    const r = scene.byId(id);
    if (!r || r.z !== scene.view.z || r.area !== scene.view.area) { pen = false; continue; }
    if (pen) ctx.lineTo(px(r.x), py(r.y)); else ctx.moveTo(px(r.x), py(r.y));
    pen = true;
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawLinks(ctx: CanvasRenderingContext2D, room: MapRoom, scene: Scene, drawn: Set<string>, px: (x: number) => number, py: (y: number) => number, half: number): void {
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
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (oneway) {
        ctx.fillStyle = t.fgDim;
        arrowHead(ctx, b.x, b.y, Math.atan2(b.y - a.y, b.x - a.x), Math.max(4, s * 0.14));
      }
      continue;
    }
    // A link that does not go where its direction says (or has none): a dashed gold curve with the key.
    const ddx = tx - cx, ddy = ty - cy;
    const len = Math.hypot(ddx, ddy) || 1;
    const nx = -ddy / len, ny = ddx / len;
    const bend = Math.min(len * 0.25, s * 0.9);
    const mx = (cx + tx) / 2 + nx * bend, my = (cy + ty) / 2 + ny * bend;
    ctx.strokeStyle = t.gold;
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.setLineDash([Math.max(3, s * 0.12), Math.max(3, s * 0.1)]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    if (oneway) {
      ctx.fillStyle = t.gold;
      const end = edgePoint(tx, ty, Math.sign(tx - mx), Math.sign(ty - my), half);
      arrowHead(ctx, end.x, end.y, Math.atan2(ty - my, tx - mx), Math.max(4, s * 0.14));
    }
    if (s >= CHIP_MIN_SCALE) {
      const label = exit.key;
      ctx.font = `${Math.max(9, Math.round(s * 0.22))}px ${scene.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + 8;
      const th = Math.max(12, s * 0.28);
      const bx = (cx + 2 * mx + tx) / 4, by = (cy + 2 * my + ty) / 4; // the curve's midpoint
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

/** Stubs, corner triangles, tags and the warn dot of one room. */
function drawDecor(ctx: CanvasRenderingContext2D, room: MapRoom, scene: Scene, px: (x: number) => number, py: (y: number) => number, half: number): void {
  const { tokens: t, view } = scene;
  const s = view.scale;
  const cx = px(room.x), cy = py(room.y);
  let tags = 0;
  for (const exit of Object.values(room.exits)) {
    const target = exit.to ? scene.byId(exit.to) : undefined;
    if (target && sameFloor(target, room)) continue; // drawn as a link
    const crossArea = !!target && target.area !== room.area;
    const v = exitVector(exit);
    if (crossArea && v && (v.dx || v.dy)) { drawStub(ctx, cx, cy, v.dx, v.dy, half, s, { ...t, fgDim: t.gold }, true, v.dz !== 0); continue; }
    if (crossArea && v && !v.dx && !v.dy && v.dz !== 0) { drawCornerTriangle(ctx, cx, cy, v.dz > 0, half, s, { ...t, fgDim: t.gold }, true); continue; }
    if (crossArea) { drawStub(ctx, cx, cy, 1, 1, half, s, { ...t, fgDim: t.gold }, true, false); continue; }
    if (!v) {
      if (!target) tags++; // a named exit with no direction and no destination: the gold tag
      else drawStub(ctx, cx, cy, 1, 1, half, s, t, true, false); // a dir-less exit to another floor
      continue;
    }
    const otherFloor = !!target || v.dz !== 0;
    if (v.dz !== 0 && !v.dx && !v.dy) { drawCornerTriangle(ctx, cx, cy, v.dz > 0, half, s, t, !!target); continue; }
    if (!v.dx && !v.dy) { if (!target) tags++; continue; } // in / out with no destination
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

function drawStub(ctx: CanvasRenderingContext2D, cx: number, cy: number, dx: number, dy: number, half: number, s: number, t: Tokens, filled: boolean, diagonalFloor: boolean): void {
  const a = edgePoint(cx, cy, dx, dy, half);
  const len = Math.max(4, s * 0.2);
  const n = Math.hypot(dx, dy) || 1;
  const ex = a.x + (dx / n) * len, ey = a.y + (dy / n) * len;
  ctx.strokeStyle = t.fgDim;
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
  const r = Math.max(2, s * 0.07);
  ctx.beginPath();
  ctx.arc(ex + (dx / n) * r, ey + (dy / n) * r, r, 0, Math.PI * 2);
  if (filled) { ctx.fillStyle = t.fgDim; ctx.fill(); } else { ctx.stroke(); }
  if (diagonalFloor) {
    const tr = r * 1.2;
    const tx = ex + (dx / n) * r * 3, ty = ey + (dy / n) * r * 3;
    ctx.fillStyle = t.fgDim;
    ctx.beginPath(); ctx.moveTo(tx, ty - tr); ctx.lineTo(tx + tr, ty + tr); ctx.lineTo(tx - tr, ty + tr); ctx.closePath(); ctx.fill();
  }
}

/** Up: the top-right corner, pointing up. Down: the bottom-right corner, pointing down. Filled when mapped. */
function drawCornerTriangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, up: boolean, half: number, s: number, t: Tokens, filled: boolean): void {
  const size = Math.max(4, s * 0.16);
  const x = cx + half + 1, y = up ? cy - half - 1 : cy + half + 1;
  ctx.beginPath();
  if (up) { ctx.moveTo(x + size / 2, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y); }
  else { ctx.moveTo(x + size / 2, y + size); ctx.lineTo(x + size, y); ctx.lineTo(x, y); }
  ctx.closePath();
  ctx.lineWidth = 1;
  if (filled) { ctx.fillStyle = t.fgDim; ctx.fill(); } else { ctx.strokeStyle = t.fgDim; ctx.setLineDash([]); ctx.stroke(); }
}

function drawRoom(ctx: CanvasRenderingContext2D, room: MapRoom, scene: Scene, px: (x: number) => number, py: (y: number) => number, half: number): void {
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
  ctx.shadowColor = 'transparent';

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
    ctx.fillStyle = room.color && room.color !== 'dim' ? t.bgDeep : t.fg;
    ctx.font = `500 ${Math.max(8, Math.round(half * 1.2))}px ${scene.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(room.symbol.slice(0, 2), cx, cy + 0.5);
  }
}

function drawName(ctx: CanvasRenderingContext2D, room: MapRoom, scene: Scene, px: (x: number) => number, py: (y: number) => number, half: number): void {
  const { tokens: t, view } = scene;
  const s = view.scale;
  const single = scene.selection.size === 1 && scene.selection.has(room.id);
  const show = room.id === scene.hover || single || (view.names && s >= NAMES_MIN_SCALE);
  if (!show || !room.name) return;
  const cx = px(room.x), cy = py(room.y);
  const size = Math.max(9, Math.min(13, Math.round(s * 0.26)));
  ctx.font = `${size}px ${scene.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const maxW = Math.max(60, Math.min(180, s * 3.4));
  const label = ellipsise(ctx, room.name, maxW);
  const tw = ctx.measureText(label).width + 6;
  const th = size + 4;
  const y = cy + half + 3;
  ctx.fillStyle = withAlpha(t.bgDeep, 0.9);
  ctx.fillRect(cx - tw / 2, y, tw, th);
  ctx.fillStyle = room.id === scene.currentId ? t.accentBright : t.fg;
  ctx.fillText(label, cx, y + 2);
}

function drawDrag(ctx: CanvasRenderingContext2D, drag: DragPreview, t: Tokens, px: (x: number) => number, py: (y: number) => number, half: number): void {
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  for (const c of drag.cells) ctx.strokeRect(px(c.x) - half, py(c.y) - half, half * 2, half * 2);
  ctx.setLineDash([]);
}

function drawBox(ctx: CanvasRenderingContext2D, box: BoxSelect, t: Tokens): void {
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

function drawEmpty(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  ctx.fillStyle = scene.tokens.fgFaint;
  ctx.font = `10px ${scene.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((scene.emptyMessage ?? '').toUpperCase().split('').join(' '), w / 2, h / 2);
}
