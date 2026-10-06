/**
 * The panel's menus: the ☰ menu, the room menu, the empty-cell menu, and the Legend and Controls popovers. Menus
 * are small positioned popovers of `mu.ui.css.cmd` buttons appended to the panel root (never `document.body`: the
 * panel may be popped out). `mu.ui.pick` is used where a flat list fits (colour, symbol).
 */
import { ROOM_COLORS, type MapData, type MapRoom, type RoomColor } from '../types';
import type { MenuItem, PanelCtx } from './deps';
import { SYMBOLS, colorLabel } from './inspector';
import { COPY_LUA_LABEL, copyLuaLibrary } from '../lua/copy';
import { areaName, openAreas, pickArea } from './areas';

const T = {
  centreOnMe: 'Centre on me', fitFloor: 'Fit floor', pause: 'Pause mapping', resume: 'Resume mapping', names: 'Show names',
  connect: 'Connect matching exits', autoConnect: 'Auto-connect new rooms', legend: 'Legend', controls: 'Controls', areas: 'Areas…', moveToArea: 'Move to area…', pickArea: (n: number) => (n > 1 ? `Move ${n} rooms to area` : 'Move room to area'), movedTo: (n: number, a: string) => `${n} room${n === 1 ? '' : 's'} moved to ${a}`,
  exportMap: 'Export map…', importMap: 'Import map…', erase: 'Erase whole map',
  walkHere: 'Walk here', imHere: "I'm here", colour: 'Colour…', symbol: 'Symbol…', selectConnected: 'Select connected',
  mergeInto: 'Merge into…', lock: 'Lock', unlock: 'Unlock', deleteRoom: 'Delete room', deleteN: (n: number) => `Delete ${n} rooms`,
  newRoom: 'New room here', moveHere: 'Move selection here', centreHere: 'Centre view here',
  connected: (n: number) => (n ? `Linked ${n} exits` : 'Nothing to link'), eraseTitle: 'Erase the whole map?',
  eraseBody: 'Every room of this world goes. Export it first if you may want it back.', eraseOk: 'Erase',
  importTitle: 'Replace the map?', importBody: (n: number) => `This map has ${n} rooms. Importing replaces all of them.`, importOk: 'Replace',
  imported: (n: number) => `Imported ${n} rooms`, importFailed: 'Import failed', exported: 'Map exported', noScene: 'No room to place: the game has not shown one yet',
  posUnknown: 'Position unknown', noneSelected: 'Nothing selected', pickColour: 'Room colour', pickSymbol: 'Room symbol', none: 'none', clear: 'clear',
};

/* ────────────────────────────── popover ────────────────────────────── */

export interface Popover { el: HTMLElement; close(): void }

let openPop: Popover | null = null;

/** Close the open popover, if any. */
export function closePopover(): void { openPop?.close(); }

/** A positioned popover inside the panel root at (x, y) in root px, clamped into the root. */
export function popover(ctx: PanelCtx, x: number, y: number, build: (el: HTMLElement, close: () => void) => void, opts: { role?: string; label?: string } = {}): Popover {
  closePopover();
  const { h } = ctx.mu.ui;
  const el = h('div', { class: 'mu-map-pop', role: opts.role ?? 'menu', 'aria-label': opts.label ?? 'menu', tabindex: '-1' });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    el.remove();
    ctx.root.removeEventListener('pointerdown', onDown, true);
    ctx.root.removeEventListener('keydown', onKey, true);
    if (openPop === pop) openPop = null;
    ctx.canvas.focus({ preventScroll: true });
  };
  const onDown = (e: Event): void => { if (!el.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[n].focus();
  };
  build(el, close);
  ctx.root.append(el);
  // Clamp into the root.
  const rw = ctx.root.clientWidth || 300, rh = ctx.root.clientHeight || 200;
  const pw = el.offsetWidth || 160, ph = el.offsetHeight || 100;
  el.style.left = `${Math.max(0, Math.min(x, rw - pw))}px`;
  el.style.top = `${Math.max(0, Math.min(y, rh - ph))}px`;
  ctx.root.addEventListener('pointerdown', onDown, true);
  ctx.root.addEventListener('keydown', onKey, true);
  const pop: Popover = { el, close };
  openPop = pop;
  queueMicrotask(() => el.querySelector<HTMLElement>('button:not([disabled])')?.focus());
  return pop;
}

/** A menu of items at (x, y) in root px. */
export function itemsMenu(ctx: PanelCtx, x: number, y: number, items: MenuItem[], label: string): Popover {
  const { h, css } = ctx.mu.ui;
  return popover(ctx, x, y, (el, close) => {
    for (const it of items) {
      if (it.sep) { el.append(h('div', { class: 'mu-map-pop-sep', role: 'separator' })); continue; }
      const cls = [css.cmd, it.warn ? css.warn : '', it.on ? css.on : ''].filter(Boolean).join(' ');
      el.append(h('button', {
        class: cls, type: 'button', role: 'menuitem', disabled: it.disabled ? true : undefined,
        'aria-pressed': it.on === undefined ? undefined : it.on ? 'true' : 'false',
        onclick: () => { close(); it.run?.(); },
      }, it.label, it.hint ? h('span', { class: 'mu-map-pop-hint' }, it.hint) : null));
    }
  }, { label });
}

/** Position a menu under an anchor element of the panel. */
function under(ctx: PanelCtx, anchor: HTMLElement): { x: number; y: number } {
  const r = anchor.getBoundingClientRect(), p = ctx.root.getBoundingClientRect();
  return { x: r.left - p.left, y: r.bottom - p.top + 2 };
}

/* ────────────────────────────── the ☰ menu ────────────────────────────── */

export function openMainMenu(ctx: PanelCtx, anchor: HTMLElement): void {
  const { x, y } = under(ctx, anchor);
  const paused = !!ctx.track()?.paused;
  const v = ctx.view.state;
  const auto = ctx.settings.get<boolean>('autoConnect') !== false;
  const items: MenuItem[] = [
    { label: T.centreOnMe, hint: 'C', run: () => { if (!ctx.actions.centreOnMe()) ctx.toast(T.posUnknown); } },
    { label: T.fitFloor, hint: 'F', run: () => ctx.actions.fit() },
    { sep: true, label: '' },
    { label: paused ? T.resume : T.pause, run: () => ctx.actions.togglePaused() },
    { label: T.names, hint: 'N', on: v.names, run: () => ctx.actions.toggleNames() },
    { label: T.connect, run: () => { const n = ctx.store.autoConnect(v.area); ctx.toast(T.connected(n)); } },
    { label: T.autoConnect, on: auto, run: () => ctx.mu.settings.set('autoConnect', !auto, ctx.worldId) },
    { sep: true, label: '' },
    { label: T.areas, hint: 'A', run: () => openAreas(ctx, anchor) },
    { label: T.legend, run: () => openLegend(ctx, anchor) },
    { label: T.controls, hint: '?', run: () => openControls(ctx, anchor) },
    { sep: true, label: '' },
    { label: T.exportMap, run: () => void exportMap(ctx) },
    { label: T.importMap, run: () => void importMap(ctx) },
    { label: COPY_LUA_LABEL, run: () => void copyLuaLibrary(ctx.mu) },
    { label: T.erase, warn: true, run: () => void eraseMap(ctx) },
  ];
  const menu = itemsMenu(ctx, x, y, items, 'map menu');
  anchor.setAttribute('aria-expanded', 'true');
  const obs = new MutationObserver(() => { if (!menu.el.isConnected) { anchor.removeAttribute('aria-expanded'); obs.disconnect(); } });
  obs.observe(ctx.root, { childList: true });
}

async function exportMap(ctx: PanelCtx): Promise<void> {
  const data = ctx.store.export();
  const name = `map-${ctx.worldId.replace(/[^a-z0-9_-]+/gi, '_')}.mu-map.json`;
  const ok = await ctx.mu.files.save({ name, type: 'application/json', data: JSON.stringify(data, null, 1) });
  if (ok) ctx.toast(T.exported, `${Object.keys(data.rooms).length} rooms`);
}

async function importMap(ctx: PanelCtx): Promise<void> {
  const files = await ctx.mu.files.open({ accept: ['.json', 'application/json'] });
  const f = files[0];
  if (!f) return;
  let data: unknown;
  try { data = JSON.parse(await f.text()); } catch { ctx.toast(T.importFailed, 'not JSON'); return; }
  const n = ctx.store.rooms().length;
  if (n && !(await ctx.mu.ui.confirm({ title: T.importTitle, body: T.importBody(n), confirm: T.importOk, danger: true }))) return;
  try {
    const r = ctx.store.import(data as MapData);
    ctx.toast(T.imported(r.rooms));
    ctx.actions.fit();
  } catch (e) { ctx.toast(T.importFailed, e instanceof Error ? e.message : String(e)); }
}

async function eraseMap(ctx: PanelCtx): Promise<void> {
  if (!(await ctx.mu.ui.confirm({ title: T.eraseTitle, body: T.eraseBody, confirm: T.eraseOk, danger: true }))) return;
  ctx.store.erase();
  ctx.view.clearSelection();
}

/* ────────────────────────────── room and cell menus ────────────────────────────── */

export function roomMenuItems(ctx: PanelCtx, room: MapRoom): MenuItem[] {
  const sel = ctx.view.selection;
  const many = sel.size > 1 && sel.has(room.id);
  const here = ctx.here()?.id === room.id;
  const items: MenuItem[] = [
    { label: T.walkHere, disabled: here || !ctx.here(), run: () => ctx.actions.walkTo(room.id) },
    { label: T.imHere, disabled: here, run: () => ctx.actions.imHere(room.id) },
    { sep: true, label: '' },
    { label: T.colour, run: () => void pickColour(ctx, many ? [...sel] : [room.id]) },
    { label: T.symbol, run: () => void pickSymbol(ctx, many ? [...sel] : [room.id]) },
    { label: T.selectConnected, run: () => ctx.actions.selectConnected(room.id) },
    { label: T.moveToArea, run: () => void moveToArea(ctx, many ? [...sel] : [room.id], many ? undefined : room.area) },
    { label: T.mergeInto, run: () => ctx.actions.startPick({ kind: 'merge', from: room.id, banner: `Merge “${room.name || room.id}” into: click the room that stays · Esc cancels` }) },
    { label: room.locked ? T.unlock : T.lock, run: () => { ctx.store.update(room.id, { locked: !room.locked }); } },
    { sep: true, label: '' },
    { label: many ? T.deleteN(sel.size) : T.deleteRoom, warn: true, hint: 'Del', run: () => void ctx.actions.deleteRooms(many ? [...sel] : [room.id]) },
  ];
  ctx.deps.onRoomMenu?.(room.id, items);
  return items;
}

export function openRoomMenu(ctx: PanelCtx, room: MapRoom, x: number, y: number): void {
  itemsMenu(ctx, x, y, roomMenuItems(ctx, room), `room ${room.name || room.id}`);
}

export function openCellMenu(ctx: PanelCtx, cell: { x: number; y: number }, x: number, y: number): void {
  const v = ctx.view.state;
  const sel = ctx.view.selection;
  const anchor = sel.size ? ctx.store.room([...sel][0]) : undefined;
  const items: MenuItem[] = [
    { label: T.newRoom, disabled: !ctx.track()?.lastScene, run: () => {
      const r = ctx.tracker.createHere(ctx.sid, { area: v.area, x: cell.x, y: cell.y, z: v.z });
      if (!r) ctx.toast(T.noScene);
    } },
    { label: T.moveHere, disabled: !anchor, run: () => {
      if (!anchor) return;
      const ok = ctx.store.move([...sel], cell.x - anchor.x, cell.y - anchor.y, v.z - anchor.z, v.area);
      if (!ok) ctx.toast('Blocked', 'a room is in the way');
    } },
    { sep: true, label: '' },
    { label: T.centreHere, run: () => ctx.view.centreOn(cell.x, cell.y) },
    { label: T.centreOnMe, hint: 'C', run: () => { if (!ctx.actions.centreOnMe()) ctx.toast(T.posUnknown); } },
  ];
  itemsMenu(ctx, x, y, items, `cell ${cell.x}, ${cell.y}`);
}

async function moveToArea(ctx: PanelCtx, ids: string[], exclude?: string): Promise<void> {
  const area = await pickArea(ctx, T.pickArea(ids.length), exclude);
  if (area === null) return;
  ctx.store.moveToArea(ids, area);
  ctx.toast(T.movedTo(ids.length, areaName(ctx, area)));
}

async function pickColour(ctx: PanelCtx, ids: string[]): Promise<void> {
  const c = await ctx.mu.ui.pick<RoomColor>({ title: T.pickColour, items: ROOM_COLORS.map((c) => ({ label: colorLabel(c), value: c })) });
  if (c === null) return;
  ctx.store.batch('colour', () => { for (const id of ids) ctx.store.update(id, { color: c }); });
}

async function pickSymbol(ctx: PanelCtx, ids: string[]): Promise<void> {
  const s = await ctx.mu.ui.pick<string>({ title: T.pickSymbol, items: [{ label: T.clear, value: '' }, ...SYMBOLS.map((g) => ({ label: g.glyph, hint: g.name, value: g.glyph }))] });
  if (s === null) return;
  ctx.store.batch('symbol', () => { for (const id of ids) ctx.store.update(id, { symbol: s }); });
}

/* ────────────────────────────── legend and controls ────────────────────────────── */

const svg = (inner: string, label: string): HTMLElement => {
  const span = document.createElement('span');
  span.setAttribute('aria-label', label);
  span.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${inner}</svg>`;
  return span;
};

const LEGEND: Array<[string, string, string]> = [
  ['<rect x="4" y="4" width="8" height="8"/>', 'room', 'a room; its fill is the room colour'],
  ['<rect x="4" y="4" width="8" height="8" stroke-width="2"/>', 'current room', 'you are here: bright border and glow'],
  ['<rect x="2" y="2" width="12" height="12" stroke-dasharray="2 2"/>', 'selected', 'selected (edit mode)'],
  ['<line x1="1" y1="8" x2="15" y2="8"/>', 'link', 'a two-way link between neighbours'],
  ['<line x1="1" y1="8" x2="12" y2="8"/><path d="M11 5l4 3-4 3z" fill="currentColor"/>', 'one-way', 'one-way: the arrow points where it goes'],
  ['<path d="M1 12 Q8 0 15 12" stroke-dasharray="2 2"/>', 'off-grid link', 'a link that does not match its direction (gold, dashed); the key is shown when zoomed in'],
  ['<line x1="4" y1="8" x2="10" y2="8"/><circle cx="12" cy="8" r="2"/>', 'unexplored exit', 'an exit not walked yet (filled: it leads to another floor)'],
  ['<path d="M9 5l3-4 3 4z" fill="currentColor"/><path d="M9 11l3 4 3-4z"/>', 'up / down', 'up (top corner) and down (bottom corner); filled when mapped'],
  ['<line x1="4" y1="8" x2="10" y2="8"/><circle cx="12" cy="8" r="2" fill="currentColor"/>', 'to another area', 'a mapped exit into another area (gold); the Areas dialog lists them'],
  ['<rect x="2" y="10" width="4" height="4" fill="currentColor"/>', 'named exit', 'an exit that is not a direction (enter, climb…)'],
  ['<circle cx="3" cy="3" r="2" fill="currentColor"/>', 'warning', 'the tracker was unsure where this room goes: check it and press "Looks right"'],
];

export function openLegend(ctx: PanelCtx, anchor: HTMLElement): void {
  const { h } = ctx.mu.ui;
  const { x, y } = under(ctx, anchor);
  popover(ctx, x, y, (el, close) => {
    el.append(h('div', { class: 'mu-map-pop-title' }, T.legend));
    const dl = h('dl');
    for (const [ic, name, text] of LEGEND) dl.append(h('dt', null, svg(ic, name), name), h('dd', null, text));
    el.append(h('div', { class: 'mu-map-pop-body' }, dl));
    el.append(h('button', { class: ctx.mu.ui.css.cmd, type: 'button', onclick: close }, 'Close'));
  }, { role: 'dialog', label: T.legend });
}

const CONTROLS: Array<[string, string]> = [
  ['Click', 'walk there (walk mode) · select (edit mode)'],
  ['Shift+Click', 'add to the selection (edit)'],
  ['Drag', 'pan (walk) · move the selection or box-select (edit)'],
  ['Space+Drag / Middle', 'pan in any mode'],
  ['Wheel', 'zoom about the cursor'],
  ['Right-click', 'room or cell menu'],
  ['Arrows', 'pan · nudge the selection (edit)'],
  ['Page Up / Page Down', 'floor up / down · move the selection a floor (edit)'],
  ['Delete', 'delete the selection'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'undo / redo'],
  ['F', 'fit the floor'], ['C', 'centre on me'], ['N', 'show names'], ['A', 'areas'], ['W / E', 'walk / edit mode'], ['+ / −', 'zoom'], ['Esc', 'cancel pick, clear selection, stop walking'],
];

export function openControls(ctx: PanelCtx, anchor: HTMLElement): void {
  const { h } = ctx.mu.ui;
  const { x, y } = under(ctx, anchor);
  popover(ctx, x, y, (el, close) => {
    el.append(h('div', { class: 'mu-map-pop-title' }, T.controls));
    const dl = h('dl');
    for (const [k, text] of CONTROLS) dl.append(h('dt', null, h('kbd', null, k)), h('dd', null, text));
    el.append(h('div', { class: 'mu-map-pop-body' }, dl));
    el.append(h('button', { class: ctx.mu.ui.css.cmd, type: 'button', onclick: close }, 'Close'));
  }, { role: 'dialog', label: T.controls });
}
