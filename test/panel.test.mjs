/**
 * The dock panel in happy-dom: layout, drawing (a recording 2D context), modes, selection by synthetic clicks, the
 * inspector, the toolbar's undo, snapshot/restore and unmount. The store, tracker and walker are fakes
 * (`test/lib/fakeStore.mjs`); `mu` is `createHost().mu` with `ui.h` and `theme.watch` wrapped.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDom, recordCanvas, buildModule, flush, TOKENS } from './lib/dom.mjs';
import { fakeStore, fakeTracker, fakeWalker, threeRooms } from './lib/fakeStore.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createHost } = await import(pathToFileURL(createRequire(join(ROOT, 'package.json')).resolve('@runmu.sh/dev/test')).href);

let dom, rec, panel, render, viewMod;
before(async () => {
  dom = installDom();
  rec = recordCanvas(dom.win);
  panel = await buildModule(ROOT, 'src/panel/index.ts');
  render = await buildModule(ROOT, 'src/panel/render.ts');
  viewMod = await buildModule(ROOT, 'src/panel/view.ts');
});
after(() => dom.off());

/** The SDK's `h`, as the panel gets it from `mu.ui.h`. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) { if (v == null || v === false) continue; if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v); else el.setAttribute(k, v === true ? '' : String(v)); }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) { c.forEach(add); return; } el.append(typeof c === 'object' ? c : document.createTextNode(String(c))); };
  children.forEach(add);
  return el;
}

/** A host `mu` with `ui.h`, a theme watch that reports tokens, and recorders for files/a11y. */
function makeMu(host) {
  const base = host.mu;
  const themeWatchers = new Set();
  const ui = new Proxy(base.ui, { get: (t, k) => (k === 'h' ? h : t[k]) });
  const theme = {
    cssVar: (n) => `var(--${n})`,
    watch(fn) { themeWatchers.add(fn); fn({ id: 'haemal', tokens: TOKENS, reduceMotion: false }); return () => themeWatchers.delete(fn); },
    emit(t) { for (const f of themeWatchers) f(t); },
  };
  return new Proxy(base, { get: (t, k) => (k === 'ui' ? ui : k === 'theme' ? theme : t[k]) });
}

function mount({ rooms = threeRooms(), here = 'r1', settings = {}, host = createHost({ root: ROOT }), mu = makeMu(host) } = {}) {
  const store = fakeStore('w1', rooms);
  const tracker = fakeTracker('s1', here);
  const walker = fakeWalker();
  const el = document.createElement('div');
  document.body.append(el);
  const deps = { mu, store: (id) => (id === 'w1' ? store : null), tracker, walker, settings: { get: (k) => settings[k], watch: () => () => {} } };
  // happy-dom lays nothing out and its ResizeObserver never fires: give the stage and canvas a size before mount.
  dom.fallback((e) => (e.classList?.contains('mu-map-stage') || e.tagName === 'CANVAS' ? { w: 400, h: 300 } : e.classList?.contains('mu-map') ? { w: 400, h: 500 } : null));
  const p = panel.mountPanel(deps, el, { sid: 's1', worldId: 'w1', params: {} });
  const stage = el.querySelector('.mu-map-stage');
  const canvas = el.querySelector('canvas');
  return { host, mu, store, tracker, walker, el, p, stage, canvas, deps };
}

const click = (el, x, y, extra = {}) => {
  const o = { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, ...extra };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
};
const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

test('mounts the toolbar, stage, inspector and status line; injects one stylesheet', async () => {
  const m = mount();
  await flush();
  assert.ok(m.el.querySelector('.mu-map-bar[role=toolbar]'), 'toolbar');
  assert.ok(m.el.querySelector('.mu-map-stage canvas[tabindex="0"][aria-label]'), 'focusable canvas with a label');
  assert.ok(m.el.querySelector('.mu-map-insp'), 'inspector');
  assert.match(m.el.querySelector('.mu-map-status').textContent, /walk · z0 · 3 rooms · here: Gate/);
  const labels = [...m.el.querySelectorAll('.mu-map-bar button')].map((b) => b.textContent);
  assert.deepEqual(labels, ['Walk', 'Edit', '−', '+', 'Fit', '◎', '▾', '▴', 'Areas', 'Mapping', 'Details', 'Undo', '☰']);
  assert.equal(m.el.querySelector('.mu-map-bar select').hidden, true, 'one area: no area select');
  assert.equal(m.host.live().filter((k) => k === 'ui.style').length, 1);
  assert.equal(m.host.errors.length, 0);
  m.p.unmount();
});

test('draw: 3 rooms are 3 room fillRects, with the straight links, the one-way arrow, the off-grid curve, stubs and the warn dot', () => {
  const rooms = threeRooms();
  const byId = (id) => rooms.find((r) => r.id === id);
  const scene = {
    rooms, byId, view: { cx: 1, cy: 0, scale: 50, z: 0, area: '', names: true, mode: 'walk' },
    currentId: 'r1', selection: new Set(['r3']), hover: null, route: ['r1', 'r2', 'r3'], drag: null, box: null, tokens: TOKENS, calm: true, fontFamily: 'monospace', emptyMessage: null,
  };
  rec.reset();
  render.draw(rec.ctx, 400, 300, 1, scene);
  const fills = rec.calls.filter((c) => c.name === 'fillRect');
  const half = render.ROOM_HALF * 50;
  const roomFills = fills.filter((c) => c.args[2] === half * 2 && c.args[3] === half * 2);
  assert.equal(roomFills.length, 3, 'one square per room');
  assert.deepEqual(roomFills.map((c) => c.fill), [TOKENS.border, TOKENS.gold, TOKENS.border], 'room colours from tokens');
  assert.ok(fills[0].args[2] === 400 && fills[0].fill === TOKENS.bg, 'the background first');
  const gridDots = fills.filter((c) => c.fill === TOKENS.border && c.args[2] <= 1.5);
  assert.ok(gridDots.length > 50, 'grid dots at scale ≥ 22');
  assert.equal(rec.count('quadraticCurveTo'), 1, 'r3→r1 south is off-grid: one dashed curve');
  const curveStroke = rec.calls.find((c) => c.name === 'quadraticCurveTo');
  assert.equal(curveStroke.stroke, TOKENS.gold);
  // Arrow heads are closePath+fill triangles: the one-way curve has one, r1⇄r2 and r2⇄r3 have none (both linked back).
  const triangles = rec.calls.filter((c) => c.name === 'closePath');
  assert.ok(triangles.length >= 1, 'at least the one-way arrow head');
  // Stubs: r1 north (hollow circle) + r1 up (corner triangle) ; the warn dot on r3 is an arc too.
  assert.ok(rec.count('arc') >= 2, 'the unexplored stub circle and the warn dot');
  const warn = rec.calls.filter((c) => c.name === 'arc' && c.fill === TOKENS.alert);
  assert.equal(warn.length, 1, 'one warn dot in alert');
  const texts = rec.texts();
  assert.ok(texts.includes('$'), 'the symbol');
  assert.ok(texts.includes('Gate') && texts.includes('Street') && texts.includes('Square'), 'names at scale ≥ 40');
  assert.ok(texts.includes('south'), 'the key chip of the off-grid link at scale ≥ 44');
  const dashed = rec.calls.filter((c) => c.name === 'strokeRect' && c.stroke === TOKENS.gold);
  assert.equal(dashed.length, 2, 'the selection box of r3 and the key chip border');
  assert.equal(rec.props.shadowBlur, 0, 'calm: no glow left on');
  const route = rec.calls.filter((c) => c.name === 'stroke' && String(c.stroke).startsWith(TOKENS.gold) && c.stroke.length === 9);
  assert.equal(route.length, 1, 'the translucent gold route');
});

test('draw: an empty floor writes the message and no rooms; current room glows unless calm', () => {
  rec.reset();
  render.draw(rec.ctx, 200, 100, 2, { rooms: [], byId: () => undefined, view: { cx: 0, cy: 0, scale: 10, z: 0, area: '', names: false, mode: 'walk' }, currentId: null, selection: new Set(), hover: null, route: [], drag: null, box: null, tokens: TOKENS, calm: false, fontFamily: 'm', emptyMessage: 'No rooms yet' });
  assert.equal(rec.count('fillRect'), 1, 'only the background (no grid at scale 10)');
  assert.ok(rec.texts()[0].startsWith('N O'), 'the empty message, tracked');
  assert.deepEqual(rec.calls.find((c) => c.name === 'setTransform').args, [2, 0, 0, 2, 0, 0]);
  rec.reset();
  const rooms = threeRooms();
  render.draw(rec.ctx, 200, 100, 1, { rooms, byId: (id) => rooms.find((r) => r.id === id), view: { cx: 1, cy: 0, scale: 30, z: 0, area: '', names: false, mode: 'walk' }, currentId: 'r2', selection: new Set(), hover: null, route: [], drag: null, box: null, tokens: TOKENS, calm: false, fontFamily: 'm', emptyMessage: null });
  const glow = rec.calls.find((c) => c.name === 'fillRect' && c.args[2] === render.ROOM_HALF * 60 && c.fill === TOKENS.gold);
  assert.ok(glow, 'the current room is drawn');
});

test('pure helpers: edgePoint and roomColorHex', () => {
  assert.deepEqual(render.edgePoint(10, 10, 1, 0, 4), { x: 14, y: 10 });
  assert.deepEqual(render.edgePoint(10, 10, -1, 1, 4), { x: 6, y: 14 });
  assert.equal(render.roomColorHex('', TOKENS), TOKENS.border);
  assert.equal(render.roomColorHex(undefined, TOKENS), TOKENS.border);
  assert.equal(render.roomColorHex('dim', TOKENS), TOKENS.fgDim);
  assert.equal(render.roomColorHex('alert', TOKENS), TOKENS.alert);
  assert.match(render.roomColorHex('sky', TOKENS), /^#[0-9a-f]{6}$/);
  assert.equal(render.roomColorHex('sky', TOKENS), render.mix(TOKENS.accent, TOKENS.bg, 0.62));
  assert.notEqual(render.roomColorHex('moss', TOKENS), render.roomColorHex('plum', TOKENS));
});

test('mode switching: toolbar buttons and W/E keys; the inspector hint follows', async () => {
  const m = mount();
  await flush();
  const [walk, edit] = m.el.querySelectorAll('.mu-map-bar button');
  assert.equal(walk.getAttribute('aria-pressed'), 'true');
  edit.click();
  await flush();
  assert.equal(edit.getAttribute('aria-pressed'), 'true');
  assert.equal(walk.getAttribute('aria-pressed'), 'false');
  assert.match(m.el.querySelector('.mu-map-insp').textContent, /drag to move/);
  key(m.canvas, 'w');
  await flush();
  assert.equal(walk.getAttribute('aria-pressed'), 'true');
  assert.match(m.el.querySelector('.mu-map-insp').textContent, /Click a room to walk/);
  m.p.unmount();
});

test('edit mode: a click selects a room, shift-click adds, the inspector shows the fields and exits', async () => {
  const m = mount();
  await flush();
  key(m.canvas, 'e');
  await flush();
  // The view: compute client coords of r2 at (1,0) from the view's own mapping.
  const snap = m.p.snapshot();
  const view = new viewMod.View(null);
  view.restore({ view: snap.view });
  view.width = 400; view.height = 300;
  const p2 = view.pointOf(1, 0);
  click(m.canvas, p2.px, p2.py);
  await flush();
  assert.deepEqual(m.p.snapshot().selection, ['r2']);
  const insp = m.el.querySelector('.mu-map-insp');
  assert.match(insp.querySelector('.mu-map-title').textContent, /Street/);
  assert.match(insp.querySelector('.mu-map-meta').textContent, /1, 0 · floor 0 · area default/);
  const exits = [...insp.querySelectorAll('.mu-map-exit')].map((e) => e.dataset.key);
  assert.deepEqual(exits, ['east', 'west']);
  assert.match(insp.querySelector('.mu-map-exit[data-key=east] .mu-map-dest').textContent, /Square/);
  assert.ok(insp.querySelector('.mu-map-swatch[data-sw=gold].on'), 'the gold swatch is checked');
  assert.equal(insp.querySelector('input.mu-map-sym').value, '$');
  assert.ok(insp.querySelector('textarea'), 'the note');
  const buttons = [...insp.querySelectorAll('.mu-map-actions button')].map((b) => b.textContent);
  assert.deepEqual(buttons, ['Walk here', "I'm here", 'Merge into…', 'Lock', 'Delete']);
  // Shift-click r3 adds to the selection: the multi-select inspector.
  const p3 = view.pointOf(2, 0);
  click(m.canvas, p3.px, p3.py, { shiftKey: true });
  await flush();
  assert.deepEqual(m.p.snapshot().selection.sort(), ['r2', 'r3']);
  assert.match(insp.textContent, /2 rooms selected/);
  assert.ok([...insp.querySelectorAll('button')].some((b) => b.textContent === 'Delete 2'));
  // Esc clears.
  key(m.canvas, 'Escape');
  await flush();
  assert.deepEqual(m.p.snapshot().selection, []);
  m.p.unmount();
});

test('inspector: Walk here calls walker.goto(sid, id); I\'m here anchors; note edits reach the store; the undo button calls store.undo', async () => {
  const m = mount();
  await flush();
  key(m.canvas, 'e');
  m.p.restore({ selection: ['r3'] });
  await flush();
  const insp = m.el.querySelector('.mu-map-insp');
  const btn = (label) => [...insp.querySelectorAll('button')].find((b) => b.textContent === label);
  btn('Walk here').click();
  assert.deepEqual(m.walker.calls.map((c) => [c.name, c.sid, c.roomId]), [['goto', 's1', 'r3']]);
  assert.match(insp.querySelector('.mu-map-warn').textContent, /displaced/);
  btn('Looks right').click();
  assert.equal(m.store.room('r3').warn, undefined);
  btn("I'm here").click();
  assert.deepEqual(m.tracker.calls.at(-1), { name: 'anchor', s: 's1', id: 'r3' });
  await flush();
  const note = insp.querySelector('textarea');
  note.value = 'market day';
  note.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(m.store.room('r3').note, 'market day');
  const undo = [...m.el.querySelectorAll('.mu-map-bar button')].find((b) => b.textContent === 'Undo');
  assert.equal(undo.disabled, false);
  undo.click();
  assert.ok(m.store.calls.some((c) => c.name === 'undo'));
  assert.equal(m.store.room('r3').note, 'busy', 'the note edit was undone (back to the fixture)');
  // Ctrl+Shift+Z redoes.
  key(m.canvas, 'Z', { ctrlKey: true, shiftKey: true });
  assert.equal(m.store.room('r3').note, 'market day');
  m.p.unmount();
});

test('walk mode: a click on a room walks there when a path exists, else toasts; a click on nothing walks nowhere', async () => {
  const m = mount();
  await flush();
  const view = new viewMod.View(null);
  view.restore({ view: m.p.snapshot().view });
  view.width = 400; view.height = 300;
  const p3 = view.pointOf(2, 0);
  click(m.canvas, p3.px, p3.py);
  assert.deepEqual(m.walker.calls.map((c) => c.roomId), ['r3']);
  const empty = view.pointOf(0, 3);
  click(m.canvas, empty.px, empty.py);
  assert.equal(m.walker.calls.length, 1);
  // No position: the toast says so.
  m.tracker.setPosition(null);
  click(m.canvas, p3.px, p3.py);
  assert.equal(m.walker.calls.length, 1);
  assert.match(m.host.toasts.at(-1).title, /Position unknown/);
  m.p.unmount();
});

test('keys: arrows pan in walk mode, PgUp changes the floor, +/− zoom, F fits, N toggles names; the view persists to world storage', async () => {
  const m = mount();
  await flush();
  const v0 = m.p.snapshot().view;
  key(m.canvas, 'ArrowRight');
  assert.ok(m.p.snapshot().view.cx > v0.cx, 'panned right');
  key(m.canvas, 'PageUp');
  assert.equal(m.p.snapshot().view.z, 1);
  key(m.canvas, 'PageDown');
  key(m.canvas, '+');
  assert.ok(m.p.snapshot().view.scale > v0.scale);
  key(m.canvas, '-');
  key(m.canvas, 'n');
  assert.equal(m.p.snapshot().view.names, true);
  key(m.canvas, 'f');
  const fitted = m.p.snapshot().view;
  assert.equal(fitted.cx, 1, 'fit centres on the three rooms');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(m.mu.storage.world('w1').get('view').names, true, 'persisted (debounced)');
  m.p.unmount();
});

test('right-click opens the room menu as a popover inside the panel, with the onRoomMenu hook\'s entries', async () => {
  const m = mount();
  m.deps.onRoomMenu = (id, items) => items.push({ label: `Extra for ${id}`, run() {} });
  await flush();
  const view = new viewMod.View(null);
  view.restore({ view: m.p.snapshot().view });
  view.width = 400; view.height = 300;
  const p2 = view.pointOf(1, 0);
  m.canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: p2.px, clientY: p2.py, bubbles: true, cancelable: true }));
  const pop = m.el.querySelector('.mu-map-pop[role=menu]');
  assert.ok(pop, 'a popover in the panel root');
  assert.equal(document.body.querySelector(':scope > .mu-map-pop'), null, 'not on document.body');
  const labels = [...pop.querySelectorAll('button')].map((b) => b.firstChild.textContent);
  assert.ok(labels.includes('Walk here') && labels.includes('Merge into…') && labels.includes('Delete room'));
  assert.ok(labels.includes('Extra for r2'));
  key(pop, 'Escape');
  assert.equal(m.el.querySelector('.mu-map-pop'), null, 'Esc closes it');
  // An empty cell: the cell menu.
  const e = view.pointOf(0, 4);
  m.canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: e.px, clientY: e.py, bubbles: true, cancelable: true }));
  const cell = [...m.el.querySelectorAll('.mu-map-pop button')].map((b) => b.firstChild.textContent);
  assert.ok(cell.includes('New room here') && cell.includes('Centre view here'));
  m.p.unmount();
});

test('the ☰ menu lists its entries; "Connect matching exits" calls store.autoConnect', async () => {
  const m = mount();
  await flush();
  const menu = [...m.el.querySelectorAll('.mu-map-bar button')].find((b) => b.textContent === '☰');
  menu.click();
  const items = [...m.el.querySelectorAll('.mu-map-pop button')].map((b) => b.textContent.replace(/[A-Z?]$/, '').trim());
  assert.ok(items.some((t) => t.startsWith('Centre on me')));
  for (const want of ['Fit floor', 'Pause mapping', 'Show names', 'Connect matching exits', 'Auto-connect new rooms', 'Legend', 'Controls', 'Export map…', 'Import map…', 'Erase whole map']) {
    assert.ok(items.some((t) => t.startsWith(want)), want);
  }
  [...m.el.querySelectorAll('.mu-map-pop button')].find((b) => b.textContent.startsWith('Connect matching')).click();
  assert.ok(m.store.calls.some((c) => c.name === 'autoConnect'));
  assert.match(m.host.toasts.at(-1).title, /Nothing to link/);
  m.p.unmount();
});

test('snapshot/restore carry the view and the selection; tracker events redraw and follow', async () => {
  const m = mount();
  await flush();
  key(m.canvas, 'e');
  m.p.restore({ view: { cx: 7, scale: 50, z: 2 }, selection: ['r1', 'r2'] });
  const s = m.p.snapshot();
  assert.equal(s.view.cx, 7); assert.equal(s.view.scale, 50); assert.equal(s.view.z, 2); assert.equal(s.view.mode, 'edit');
  assert.deepEqual(s.selection.sort(), ['r1', 'r2']);
  // Follow: entering a room on floor 0 while showing floor 2 switches the floor and centres.
  key(m.canvas, 'w');
  m.tracker.setPosition('r3');
  m.tracker.emit({ type: 'enter', sid: 's1', room: m.store.room('r3'), prev: null, via: 'east', by: 'vnum' });
  await flush();
  const after = m.p.snapshot().view;
  assert.equal(after.z, 0);
  assert.equal(after.cx, 2);
  assert.match(m.el.querySelector('.mu-map-status').textContent, /here: Square/);
  m.p.unmount();
});

test('unmount disposes everything registered through mu and removes the DOM', async () => {
  const m = mount();
  await flush();
  const before = m.host.live();
  assert.ok(before.includes('ui.style'));
  m.p.unmount();
  assert.deepEqual(m.host.live(), [], 'nothing left live');
  assert.equal(m.el.querySelector('.mu-map'), null);
  assert.equal(m.host.errors.length, 0);
  // Two panels on one host (two sessions) share one stylesheet, released with the last.
  const a = mount();
  const b = mount({ host: a.host, mu: a.mu });
  assert.equal(a.host.live().filter((k) => k === 'ui.style').length, 1, 'one sheet for both');
  a.p.unmount();
  assert.equal(a.host.live().filter((k) => k === 'ui.style').length, 1, 'still held by the second panel');
  b.p.unmount();
  assert.deepEqual(a.host.live(), [], 'released with the last panel');
});

test('Areas dialog: lists areas with counts, shows one, renames, colours, moves the selection in, lists cross-area links, deletes (moving rooms out)', async () => {
  const rooms = threeRooms();
  rooms[2].area = 'keep';
  const host = createHost({ root: ROOT });
  const prompts = [], confirms = [], picks = [];
  const mu0 = makeMu(host);
  const ui = new Proxy(mu0.ui, { get: (t, k) => (k === 'prompt' ? async (spec) => { prompts.push(spec); return prompts.length === 1 ? 'The Keep' : 'Citadel'; } : k === 'confirm' ? async (spec) => { confirms.push(spec); return true; } : k === 'pick' ? async (spec) => { picks.push(spec); return spec.items.find((i) => i.value === 'move') ? 'move' : spec.items[0].value; } : t[k]) });
  const mu = new Proxy(mu0, { get: (t, k) => (k === 'ui' ? ui : t[k]) });
  const m = mount({ rooms, host, mu });
  await flush();
  const select = m.el.querySelector('.mu-map-bar select');
  assert.equal(select.hidden, false, 'two areas: the select shows');
  assert.deepEqual([...select.options].map((o) => o.textContent), ['default', 'keep']);
  // Open with the toolbar button.
  const areasBtn = [...m.el.querySelectorAll('.mu-map-bar button')].find((b) => b.textContent === 'Areas');
  areasBtn.click();
  await flush();
  let dlg = m.el.querySelector('.mu-map-pop[role=dialog].mu-map-areas');
  assert.ok(dlg, 'the dialog is a popover in the panel root');
  const rows = () => [...dlg.querySelectorAll('.mu-map-area-row')].map((b) => b.textContent);
  assert.deepEqual(rows(), ['default2 rooms', 'keep1 room']);
  const detail = () => dlg.querySelector('.mu-map-area-detail');
  assert.equal(detail().dataset.area, '', 'the shown area is chosen first');
  assert.match(detail().textContent, /links to other areas \(1\)/, 'r2 → r3 crosses into keep');
  assert.match(detail().textContent, /Street —east→ Square \[keep\]/);
  // Choose keep: rename, colour, note.
  dlg.querySelector('.mu-map-area-row[data-area="keep"]').click();
  assert.equal(detail().dataset.area, 'keep');
  const act = (label) => [...detail().querySelectorAll('button')].find((b) => b.textContent === label);
  act('Rename…').click();
  await flush(); await flush();
  assert.equal(prompts.length, 1);
  assert.equal(m.store.area('keep').name, 'The Keep');
  assert.ok(rows().includes('The Keep1 room'), 'the list re-renders from the store');
  detail().querySelector('.mu-map-swatch[data-sw="moss"]').click();
  assert.equal(m.store.area('keep').color, 'moss');
  const note = detail().querySelector('textarea');
  note.value = 'levels 5-10'; note.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(m.store.area('keep').note, 'levels 5-10');
  // Show it: the view follows.
  act('Show').click();
  assert.equal(m.p.snapshot().view.area, 'keep');
  await flush();
  assert.equal(select.value, 'keep');
  // Move the selection in: select r1 in edit mode, reopen, the button appears.
  key(dlg, 'Escape');
  key(m.canvas, 'e');
  m.p.restore({ view: { ...m.p.snapshot().view, area: '' } });
  await flush();
  const view = new viewMod.View(null);
  view.restore({ view: m.p.snapshot().view });
  view.width = 400; view.height = 300;
  const p1 = view.pointOf(0, 0);
  click(m.canvas, p1.px, p1.py);
  await flush();
  areasBtn.click();
  dlg = m.el.querySelector('.mu-map-pop.mu-map-areas');
  dlg.querySelector('.mu-map-area-row[data-area="keep"]').click();
  act('Move 1 selected here').click();
  assert.equal(m.store.room('r1').area, 'keep');
  assert.deepEqual(rows(), ['default1 room', 'The Keep2 rooms']);
  // New area via the prompt.
  [...dlg.querySelectorAll('.mu-map-area-tools button')].find((b) => b.textContent === 'New area…').click();
  await flush(); await flush();
  assert.equal(m.store.area('citadel').name, 'Citadel');
  assert.equal(detail().dataset.area, 'citadel', 'the new area is chosen');
  assert.ok(rows().includes('Citadel0 rooms'));
  // Delete The Keep, moving its rooms out: pick offers move/delete, rooms land in default.
  dlg.querySelector('.mu-map-area-row[data-area="keep"]').click();
  act('Delete…').click();
  await flush(); await flush();
  assert.equal(picks.length, 1);
  assert.equal(m.store.area('keep'), undefined);
  assert.equal(m.store.rooms().length, 3, 'rooms were moved, not deleted');
  assert.ok(m.store.rooms().every((r) => r.area === ''));
  assert.ok(m.host.toasts.some((t) => /deleted/.test(t.title)));
  m.p.unmount();
});

test('A opens the Areas dialog; the ☰ menu has Areas…; the room menu has Move to area…', async () => {
  const m = mount();
  await flush();
  key(m.canvas, 'a');
  assert.ok(m.el.querySelector('.mu-map-pop.mu-map-areas'), 'A opens it');
  key(m.el.querySelector('.mu-map-pop'), 'Escape');
  [...m.el.querySelectorAll('.mu-map-bar button')].find((b) => b.textContent === '☰').click();
  const labels = [...m.el.querySelectorAll('.mu-map-pop button')].map((b) => b.firstChild.textContent);
  assert.ok(labels.includes('Areas…'));
  key(m.el.querySelector('.mu-map-pop'), 'Escape');
  const view = new viewMod.View(null);
  view.restore({ view: m.p.snapshot().view });
  view.width = 400; view.height = 300;
  const p2 = view.pointOf(1, 0);
  m.canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: p2.px, clientY: p2.py, bubbles: true, cancelable: true }));
  const room = [...m.el.querySelectorAll('.mu-map-pop button')].map((b) => b.firstChild.textContent);
  assert.ok(room.includes('Move to area…'));
  m.p.unmount();
});
