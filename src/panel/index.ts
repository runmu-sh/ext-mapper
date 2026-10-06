/**
 * The Mapper dock panel: toolbar, canvas stage, inspector and status line, for one session (`pctx.sid`) and its
 * world's map (`pctx.worldId`). `mountPanel` wires the pieces, subscribes to the store, the tracker and the theme,
 * coalesces redraws on `requestAnimationFrame` and sizes the canvas for the device pixel ratio.
 */
import type { Dispose, PanelMountCtx, ThemeInfo } from '@muclient/sdk';
import type { MapRoom, MapStore, MapperEvent, SessionTrack, WalkState } from '../types';
import type { PanelActions, PanelCtx, PanelDeps, Tokens } from './deps';
import { PANEL_CSS } from './css';
import { View, type PickState } from './view';
import { draw, type Scene } from './render';
import { buildToolbar } from './toolbar';
import { openAreas } from './areas';
import { attachCanvas } from './canvas';
import { buildInspector } from './inspector';
import { closePopover } from './menus';

export type { PanelDeps, PanelSettings, MenuItem } from './deps';
export type { ViewState } from './view';

export interface MountedPanel { unmount(): void; snapshot(): unknown; restore(s: unknown): void }

const T = {
  noStore: 'No map for this session', noWorld: 'No world',
  emptyMap: 'No rooms yet', emptyFloor: 'No rooms on this floor',
  rooms: (n: number) => `${n} room${n === 1 ? '' : 's'}`, walk: 'walk', edit: 'edit', floor: (z: number) => `z${z}`,
  here: (r: MapRoom) => `here: ${r.name || r.id}`, unknown: 'position unknown', paused: 'paused',
  walking: (s: WalkState) => `walking ${Math.min(s.at + 1, s.route.length)}/${s.route.length}`,
  arrived: 'arrived', failed: (why?: string) => `walk failed${why ? `: ${why}` : ''}`, stopped: 'walk stopped',
  deleteTitle: (n: number) => `Delete ${n} rooms?`, deleteBody: 'Their links go too. Undo brings them back.', deleteOk: 'Delete',
  blocked: 'Blocked', blockedBody: 'a room is in the way', noRoute: 'No known route there', walkTip: 'Walking…',
  noPosition: 'Position unknown', noPositionBody: 'select a room and press "I\'m here", or create one from an empty cell',
};

const TOKEN_VARS: Array<[keyof Tokens, string]> = [
  ['bg', '--bg'], ['bgElev', '--bg-elev'], ['bgDeep', '--bg-deep'], ['fg', '--fg'], ['fgDim', '--fg-dim'], ['fgFaint', '--fg-faint'],
  ['accent', '--accent'], ['accentBright', '--accent-bright'], ['gold', '--gold'], ['alert', '--alert'], ['ok', '--ok'],
  ['border', '--border'], ['borderBright', '--border-bright'], ['glow', '--glow'],
];

/** Tokens from the element's computed custom properties, for a host whose `ThemeInfo` carries none. */
function tokensFromCss(el: HTMLElement): Tokens {
  const cs = getComputedStyle(el);
  const out = {} as Tokens;
  for (const [k, v] of TOKEN_VARS) out[k] = cs.getPropertyValue(v).trim() || 'transparent';
  return out;
}

/** One injected stylesheet per host, shared by every mounted panel and released with the last. */
const styles = new WeakMap<object, { uses: number; dispose: Dispose }>();

export function mountPanel(deps: PanelDeps, el: HTMLElement, pctx: PanelMountCtx): MountedPanel {
  const { mu } = deps;
  const { h, css } = mu.ui;
  const worldId = pctx.worldId ?? '';
  const sid = pctx.sid ?? '';
  const found = worldId ? deps.store(worldId) : null;

  const sheet = styles.get(mu) ?? { uses: 0, dispose: mu.ui.style(PANEL_CSS) };
  sheet.uses++;
  styles.set(mu, sheet);
  const releaseStyle = (): void => { if (--sheet.uses === 0) { sheet.dispose(); styles.delete(mu); } };

  const root = h('div', { class: 'mu-map', 'data-focus-region': '' });
  el.append(root);

  if (!found) {
    root.append(h('div', { class: css.empty }, worldId ? T.noStore : T.noWorld));
    return { unmount() { root.remove(); releaseStyle(); }, snapshot() { return undefined; }, restore() { /* nothing */ } };
  }
  const store: MapStore = found;

  const view = new View(mu.storage.world(worldId));
  const canvas = h('canvas') as HTMLCanvasElement;
  const stage = h('div', { class: 'mu-map-stage' }, canvas);
  const status = h('div', { class: 'mu-map-status', role: 'status', 'aria-live': 'polite' });
  const statusMain = h('span');
  const statusMsg = h('span', { class: 'mu-map-status-msg' });
  status.append(statusMain, h('span', { class: 'mu-map-gap' }), statusMsg);

  let tokens: Tokens = tokensFromCss(el);
  let reduceMotion = false;
  let calmPref = false;
  let perf = false;
  let statusText: string | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let dpr = 1;
  let frame: number | null = null;
  let dirtyAll = false;
  const subs: Dispose[] = [];

  const ctx: PanelCtx = {
    mu, sid, worldId, store, tracker: deps.tracker, walker: deps.walker, settings: deps.settings, deps,
    root, stage, canvas, view,
    actions: null as unknown as PanelActions,
    hover: null, drag: null, box: null,
    tokens: () => tokens,
    calm: () => reduceMotion || calmPref || perf,
    here: () => { const id = deps.tracker.track(sid)?.position.roomId; return (id && store.room(id)) || null; },
    track: (): SessionTrack | undefined => deps.tracker.track(sid),
    invalidate, status: setStatus,
    toast: (title, body) => mu.ui.toast(title, body, { kind: 'mapper' }),
  };

  /* ── actions ── */

  const floorCells = (): Array<{ x: number; y: number }> => {
    const v = view.state;
    return store.rooms().filter((r) => r.z === v.z && r.area === v.area).map((r) => ({ x: r.x, y: r.y }));
  };

  const actions: PanelActions = {
    zoom(factor, at) {
      const p = at ?? { px: view.width / 2, py: view.height / 2 };
      view.zoomAt(factor, p.px, p.py);
    },
    fit() {
      let cells = floorCells();
      if (!cells.length) {
        // Nothing on this floor: fit the floor that has rooms (the player's, else the first).
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
    setFloor(dz) { view.set({ z: view.state.z + dz }); },
    setMode(mode) {
      if (view.state.mode === mode) return;
      view.set({ mode });
      if (mode === 'walk') { view.clearSelection(); }
      if (view.pick) actions.cancelPick();
    },
    walkTo(id) {
      const here = ctx.here();
      if (!here) { ctx.toast(T.noPosition, T.noPositionBody); return; }
      if (here.id === id) return;
      if (!store.path(here.id, id)) { ctx.toast(T.noRoute); return; }
      void deps.walker.goto(sid, id).catch((e: unknown) => ctx.toast(T.failed(), e instanceof Error ? e.message : String(e)));
      invalidate('all');
    },
    imHere(id) {
      deps.tracker.anchor(sid, id);
      invalidate('all');
    },
    async deleteRooms(ids) {
      const live = ids.filter((id) => store.room(id));
      if (!live.length) return;
      if (live.length > 1 && !(await mu.ui.confirm({ title: T.deleteTitle(live.length), body: T.deleteBody, confirm: T.deleteOk, danger: true }))) return;
      store.batch('delete rooms', () => { for (const id of live) store.remove(id); });
      for (const id of live) view.selection.delete(id);
      invalidate('all');
    },
    moveSelection(dx, dy, dz = 0) {
      const ids = [...view.selection].filter((id) => store.room(id) && !store.room(id)?.locked);
      if (!ids.length) return;
      if (!store.move(ids, dx, dy, dz)) { ctx.toast(T.blocked, T.blockedBody); return; }
      if (dz) view.set({ z: view.state.z + dz });
    },
    selectConnected(id) {
      view.select(store.component(id));
      if (view.state.mode !== 'edit') view.set({ mode: 'edit' });
    },
    startPick(p: PickState) {
      if (view.state.mode !== 'edit') view.set({ mode: 'edit' });
      view.setPick(p);
      mu.a11y.announce(p.banner);
    },
    cancelPick() { if (view.pick) view.setPick(null); },
    undo() { const l = store.undo(); if (l) setStatus(`undid ${l}`); invalidate('all'); },
    redo() { const l = store.redo(); if (l) setStatus(`redid ${l}`); invalidate('all'); },
    togglePaused() { const t = ctx.track(); deps.tracker.pause(sid, !t?.paused); invalidate('all'); },
    toggleNames() { view.set({ names: !view.state.names }); },
    toggleFollow() { view.set({ follow: !view.state.follow }); if (view.state.follow) actions.centreOnMe(); },
    toggleDetails() { view.set({ details: !view.state.details }); },
    openAreas(area) {
      const anchor = root.querySelector<HTMLElement>('.mu-map-bar button[aria-haspopup="dialog"]') ?? root.querySelector<HTMLElement>('.mu-map-bar') ?? root;
      openAreas(ctx, anchor, area);
    },
  };
  ctx.actions = actions;

  /* ── layout ── */

  const toolbar = buildToolbar(ctx);
  const inspector = buildInspector(ctx);
  const body = h('div', { class: 'mu-map-body' }, stage, inspector.el);
  root.append(toolbar.el, body, status);
  const controller = attachCanvas(ctx);

  /* ── drawing ── */

  function setStatus(msg: string | null): void {
    statusText = msg;
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (msg) statusTimer = setTimeout(() => { statusText = null; statusTimer = null; renderStatus(); }, 4000);
    renderStatus();
  }

  function renderStatus(): void {
    const v = view.state;
    const here = ctx.here();
    const parts = [v.mode === 'edit' ? T.edit : T.walk, T.floor(v.z), T.rooms(store.rooms().length), here ? T.here(here) : T.unknown];
    if (ctx.track()?.paused) parts.push(T.paused);
    const ws = deps.walker.state(sid);
    if (ws.status === 'walking') parts.push(T.walking(ws));
    statusMain.textContent = parts.join(' · ');
    statusMain.classList.toggle('mu-map-status-warn', !here);
    statusMsg.textContent = statusText ?? '';
  }

  function scene(): Scene {
    const v = view.state;
    const ws = deps.walker.state(sid);
    const here = ctx.here();
    const route = ws.status === 'walking' || ws.status === 'paused' ? (here ? [here.id, ...ws.route.slice(ws.at)] : ws.route.slice(ws.at)) : [];
    const all = store.rooms();
    const rooms = all.filter((r) => r.z === v.z && r.area === v.area);
    return {
      rooms, byId: (id) => store.room(id),
      view: { cx: v.cx, cy: v.cy, scale: v.scale, z: v.z, area: v.area, names: v.names, mode: v.mode },
      currentId: here?.id ?? null, selection: view.selection, hover: ctx.hover, route,
      drag: ctx.drag, box: ctx.box, tokens, calm: ctx.calm(),
      fontFamily: getComputedStyle(root).fontFamily || 'monospace',
      emptyMessage: all.length ? T.emptyFloor : T.emptyMap,
      areaColor: store.area(v.area)?.color,
    };
  }

  function paint(): void {
    frame = null;
    const all = dirtyAll;
    dirtyAll = false;
    if (all) { toolbar.update(); inspector.update(); renderStatus(); inspector.el.hidden = !view.state.details; }
    const g = canvas.getContext('2d');
    if (!g) return;
    draw(g, view.width, view.height, dpr, scene());
  }

  function invalidate(what: 'canvas' | 'all' = 'canvas'): void {
    if (what === 'all') dirtyAll = true;
    if (frame !== null) return;
    frame = requestAnimationFrame(paint);
  }

  function resize(): void {
    const w = stage.clientWidth, hgt = stage.clientHeight;
    if (!w || !hgt) return; // hidden, or a DOM with no layout: keep the last size
    dpr = Math.min(2, window.devicePixelRatio || 1);
    view.width = w; view.height = hgt;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
    invalidate('canvas');
  }

  /* ── subscriptions ── */

  subs.push(view.onChange(() => invalidate('all')));
  subs.push(store.watch(() => invalidate('all')));
  subs.push(deps.tracker.on((e: MapperEvent) => {
    if (e.sid !== sid) { if (e.type === 'created' || e.type === 'enter') invalidate('canvas'); return; }
    if (e.type === 'enter' || e.type === 'created') {
      const r = e.room;
      if (view.state.follow) {
        const patch: Partial<typeof view.state> = {};
        if (r.z !== view.state.z) patch.z = r.z;
        if (r.area !== view.state.area) patch.area = r.area;
        if (Object.keys(patch).length) view.set(patch);
        if (!view.isVisible(r.x, r.y, 1)) view.centreOn(r.x, r.y);
      }
    } else if (e.type === 'walk') {
      const s = e.state;
      if (s.status === 'arrived') { setStatus(T.arrived); mu.a11y.announce(T.arrived); }
      else if (s.status === 'failed') { setStatus(T.failed(s.reason)); mu.a11y.announce(T.failed(s.reason)); }
      else if (s.status === 'stopped') setStatus(T.stopped);
    } else if (e.type === 'lost') setStatus(T.unknown);
    invalidate('all');
  }));
  subs.push(mu.theme.watch((t: ThemeInfo) => {
    tokens = t.tokens ?? tokensFromCss(root);
    reduceMotion = !!t.reduceMotion;
    invalidate('canvas');
  }));
  // `effects.performance` is SDK 1.14; the installed `dist/index.d.ts` is 1.12, so the name is widened here.
  const prefWatch = (name: 'effects.calm' | 'effects.performance', set: (v: boolean) => void): void => {
    try {
      const d = mu.prefs.watch(name as 'effects.calm', (v) => { set(!!v); invalidate('canvas'); });
      if (typeof d === 'function') subs.push(d);
    } catch { /* a host without prefs: the theme's reduceMotion is enough */ }
  };
  prefWatch('effects.calm', (v) => { calmPref = v; });
  prefWatch('effects.performance', (v) => { perf = v; });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(stage);
  resize();
  invalidate('all');

  return {
    unmount() {
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      if (statusTimer) clearTimeout(statusTimer);
      ro?.disconnect();
      closePopover();
      controller.dispose();
      for (const d of subs.splice(0)) { try { d(); } catch { /* already gone */ } }
      view.dispose();
      root.remove();
      releaseStyle();
    },
    snapshot() { return { ...view.snapshot(), hover: ctx.hover }; },
    restore(s) {
      view.restore(s);
      invalidate('all');
    },
  };
}
