/**
 * The view of one panel: where the camera is, which floor and area are shown, the mode, and what is selected.
 * `ViewState` is persisted per world under `view` in `mu.storage.world(worldId)` (debounced); the selection and
 * the pick state are not. `cellAt` / `pointOf` map between CSS px of the canvas and map cells.
 */
import type { Store } from '@muclient/sdk';
import { ROOM_HALF } from './render';

export interface ViewState {
  /** Centre of the view in cell units. */
  cx: number;
  cy: number;
  /** Px per cell. */
  scale: number;
  z: number;
  area: string;
  /** Keep the player's room in view. */
  follow: boolean;
  mode: 'walk' | 'edit';
  /** Always draw room names (at a readable scale). */
  names: boolean;
  /** The inspector is open. */
  details: boolean;
}

/** Waiting for the player to click a target room. */
export interface PickState {
  kind: 'link' | 'merge';
  /** The room (and exit) the pick is for. */
  from: string;
  key?: string;
  banner: string;
}

export const MIN_SCALE = 8;
export const MAX_SCALE = 120;
/** Px per cell at first: a 29px room with an 11px link between neighbours (ROOM_HALF 0.36). */
export const DEFAULT_SCALE = 40;

export const DEFAULT_VIEW: ViewState = {
  cx: 0, cy: 0, scale: DEFAULT_SCALE, z: 0, area: '', follow: true, mode: 'walk', names: false, details: true,
};

const STORAGE_KEY = 'view';
const SAVE_DELAY_MS = 400;

function clean(v: unknown): ViewState {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const num = (k: keyof ViewState, fb: number): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : fb);
  const bool = (k: keyof ViewState, fb: boolean): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : fb);
  return {
    cx: num('cx', 0), cy: num('cy', 0),
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, num('scale', DEFAULT_SCALE))),
    z: Math.round(num('z', 0)),
    area: typeof o.area === 'string' ? o.area : '',
    follow: bool('follow', true),
    mode: o.mode === 'edit' ? 'edit' : 'walk',
    names: bool('names', false),
    details: bool('details', true),
  };
}

export class View {
  state: ViewState;
  /** Selected room ids (edit mode). Not persisted. */
  readonly selection = new Set<string>();
  pick: PickState | null = null;
  /** The canvas size in CSS px, set by the panel on resize. */
  width = 300;
  height = 200;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: Store | null) {
    this.state = clean(store?.get(STORAGE_KEY));
  }

  /** Change the view; persists (debounced) and notifies. */
  set(patch: Partial<ViewState>): void {
    let changed = false;
    for (const k of Object.keys(patch) as Array<keyof ViewState>) {
      const v = patch[k];
      if (v !== undefined && this.state[k] !== v) { (this.state as unknown as Record<string, unknown>)[k] = v; changed = true; }
    }
    if (!changed) return;
    this.state.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.state.scale));
    this.scheduleSave();
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void { for (const f of [...this.listeners]) f(); }

  private scheduleSave(): void {
    if (!this.store) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, SAVE_DELAY_MS);
  }

  /** Write the view state now (on unmount). */
  saveNow(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try { this.store?.set(STORAGE_KEY, { ...this.state }); } catch { /* over quota: the view is not worth a toast */ }
  }

  /* ── coordinates ── */

  /** The CSS px of the centre of cell (x, y). */
  pointOf(x: number, y: number): { px: number; py: number } {
    const s = this.state.scale;
    return { px: this.width / 2 + (x - this.state.cx) * s, py: this.height / 2 + (y - this.state.cy) * s };
  }

  /** The cell under CSS px (px, py) (the nearest cell centre). */
  cellAt(px: number, py: number): { x: number; y: number } {
    const s = this.state.scale;
    return { x: Math.round(this.state.cx + (px - this.width / 2) / s), y: Math.round(this.state.cy + (py - this.height / 2) / s) };
  }

  /** The cell under CSS px without rounding (for hit tests against a room square). */
  cellAtExact(px: number, py: number): { x: number; y: number } {
    const s = this.state.scale;
    return { x: this.state.cx + (px - this.width / 2) / s, y: this.state.cy + (py - this.height / 2) / s };
  }

  /** Whether (px, py) falls within the square of the room at cell (x, y), half-size `half` cells (the drawn square by default). */
  hitsRoom(px: number, py: number, x: number, y: number, half = ROOM_HALF): boolean {
    const c = this.cellAtExact(px, py);
    return Math.abs(c.x - x) <= half && Math.abs(c.y - y) <= half;
  }

  /** Zoom by `factor` keeping the map point under (px, py) still. */
  zoomAt(factor: number, px: number, py: number): void {
    const before = this.cellAtExact(px, py);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.state.scale * factor));
    if (scale === this.state.scale) return;
    const cx = before.x - (px - this.width / 2) / scale;
    const cy = before.y - (py - this.height / 2) / scale;
    this.set({ scale, cx, cy });
  }

  /** Pan by CSS px. */
  panBy(dxPx: number, dyPx: number): void {
    const s = this.state.scale;
    this.set({ cx: this.state.cx - dxPx / s, cy: this.state.cy - dyPx / s });
  }

  /** Centre on a cell, optionally switching floor and area. */
  centreOn(x: number, y: number, z?: number, area?: string): void {
    const patch: Partial<ViewState> = { cx: x, cy: y };
    if (z !== undefined) patch.z = z;
    if (area !== undefined) patch.area = area;
    this.set(patch);
  }

  /** Scale and centre so every given cell is visible with a margin. */
  fitTo(cells: Array<{ x: number; y: number }>, maxScale = 60): void {
    if (!cells.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
    const w = x1 - x0 + 2, hgt = y1 - y0 + 2;
    const scale = Math.min(maxScale, Math.max(MIN_SCALE, Math.floor(Math.min(this.width / w, this.height / hgt))));
    this.set({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale });
  }

  /** Whether a cell is on screen (with a margin of `pad` cells inside the edge). */
  isVisible(x: number, y: number, pad = 0.5): boolean {
    const p = this.pointOf(x, y);
    const m = pad * this.state.scale;
    return p.px >= m && p.py >= m && p.px <= this.width - m && p.py <= this.height - m;
  }

  /* ── selection ── */

  select(ids: Iterable<string>, add = false): void {
    if (!add) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.emit();
  }

  toggleSelect(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
    this.emit();
  }

  clearSelection(): void {
    if (!this.selection.size) return;
    this.selection.clear();
    this.emit();
  }

  /** The single selected room id, or null. */
  single(): string | null {
    return this.selection.size === 1 ? [...this.selection][0] : null;
  }

  setPick(p: PickState | null): void {
    this.pick = p;
    this.emit();
  }

  /** The hot-reload snapshot. */
  snapshot(): { view: ViewState; selection: string[] } {
    return { view: { ...this.state }, selection: [...this.selection] };
  }

  restore(s: unknown): void {
    if (!s || typeof s !== 'object') return;
    const o = s as { view?: unknown; selection?: unknown };
    if (o.view) this.state = clean({ ...this.state, ...(o.view as object) });
    if (Array.isArray(o.selection)) { this.selection.clear(); for (const id of o.selection) if (typeof id === 'string') this.selection.add(id); }
    this.emit();
  }

  dispose(): void {
    this.saveNow();
    this.listeners.clear();
  }
}
