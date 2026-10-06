/**
 * The toolbar strip: `[Walk][Edit]` `[−][+][Fit][◎]` `[▾][Z0][▴]` [area ▾][Areas] … `[Mapping|Paused]` `[Details]` `[Undo]` `[☰]`.
 * Host primitives only (`mu.ui.css.cmd` / `toggle`, `on`); tooltips carry the key hints.
 */
import type { PanelCtx } from './deps';
import { openMainMenu } from './menus';
import { areaIds, areaName, openAreas } from './areas';

export interface Toolbar { el: HTMLElement; update(): void }

const T = {
  walk: 'Walk', edit: 'Edit', fit: 'Fit', follow: '◎', zoomOut: '−', zoomIn: '+', down: '▾', up: '▴',
  mapping: 'Mapping', paused: 'Paused', details: 'Details', undo: 'Undo', menu: '☰',
  tipWalk: 'walk mode: click a room to walk there (W)', tipEdit: 'edit mode: select, move and link rooms (E)',
  tipZoomOut: 'zoom out (−)', tipZoomIn: 'zoom in (+)', tipFit: 'fit the floor (F)', tipFollow: 'follow me: keep my room in view (C centres)',
  tipDown: 'floor down (Page Down)', tipUp: 'floor up (Page Up)', tipFloor: 'floor', tipArea: 'area shown', areas: 'Areas', tipAreas: 'areas: list, create, rename, colour and delete areas (A)',
  tipMapping: 'mapping is on: rooms are created and linked as you move. Click to pause', tipPaused: 'mapping is paused: known rooms are recognised, nothing is created. Click to resume',
  tipDetails: 'show the inspector', tipUndo: 'undo the last map change (Ctrl+Z)', tipMenu: 'map menu',
};

export function buildToolbar(ctx: PanelCtx): Toolbar {
  const { h, css } = ctx.mu.ui;
  const btn = (label: string, title: string, run: (e: MouseEvent) => void, extra: Record<string, unknown> = {}): HTMLButtonElement =>
    h('button', { class: css.cmd, type: 'button', title, 'aria-label': title, onclick: run, ...extra }, label);

  const walk = btn(T.walk, T.tipWalk, () => ctx.actions.setMode('walk'), { 'aria-pressed': 'false' });
  const edit = btn(T.edit, T.tipEdit, () => ctx.actions.setMode('edit'), { 'aria-pressed': 'false' });
  const zoomOut = btn(T.zoomOut, T.tipZoomOut, () => ctx.actions.zoom(1 / 1.25), { class: `${css.cmd} ${css.sq}` });
  const zoomIn = btn(T.zoomIn, T.tipZoomIn, () => ctx.actions.zoom(1.25), { class: `${css.cmd} ${css.sq}` });
  const fit = btn(T.fit, T.tipFit, () => ctx.actions.fit());
  const follow = btn(T.follow, T.tipFollow, () => ctx.actions.toggleFollow(), { class: `${css.cmd} ${css.sq}`, 'aria-pressed': 'false' });
  const down = btn(T.down, T.tipDown, () => ctx.actions.setFloor(-1), { class: `${css.cmd} ${css.sq}` });
  const up = btn(T.up, T.tipUp, () => ctx.actions.setFloor(1), { class: `${css.cmd} ${css.sq}` });
  const z = h('span', { class: 'mu-map-z', title: T.tipFloor, 'aria-live': 'polite' }, 'Z0');
  const area = h('select', { title: T.tipArea, 'aria-label': T.tipArea }) as HTMLSelectElement;
  area.addEventListener('change', () => { ctx.view.set({ area: area.value }); ctx.actions.fit(); });
  const areas = btn(T.areas, T.tipAreas, (e) => openAreas(ctx, e.currentTarget as HTMLElement), { 'aria-haspopup': 'dialog' });
  const mapping = btn(T.mapping, T.tipMapping, () => ctx.actions.togglePaused(), { class: css.toggle, 'aria-pressed': 'true' });
  const details = btn(T.details, T.tipDetails, () => ctx.actions.toggleDetails(), { class: css.toggle, 'aria-pressed': 'true' });
  const undo = btn(T.undo, T.tipUndo, () => ctx.actions.undo());
  const menu = btn(T.menu, T.tipMenu, (e) => openMainMenu(ctx, e.currentTarget as HTMLElement), { class: `${css.cmd} ${css.sq}`, 'aria-haspopup': 'menu' });

  const el = h('div', { class: 'mu-map-bar', role: 'toolbar', 'aria-label': 'map tools' },
    h('span', { class: 'mu-map-group' }, walk, edit),
    h('span', { class: 'mu-map-group' }, zoomOut, zoomIn, fit, follow),
    h('span', { class: 'mu-map-group' }, down, z, up),
    h('span', { class: 'mu-map-group' }, area, areas),
    h('span', { class: 'mu-map-gap' }),
    h('span', { class: 'mu-map-group' }, mapping, details, undo, menu),
  );

  const pressed = (b: HTMLButtonElement, on: boolean): void => {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle(css.on, on);
  };

  function update(): void {
    const v = ctx.view.state;
    pressed(walk, v.mode === 'walk');
    pressed(edit, v.mode === 'edit');
    pressed(follow, v.follow);
    z.textContent = `Z${v.z}`;
    const paused = !!ctx.track()?.paused;
    mapping.textContent = paused ? T.paused : T.mapping;
    mapping.title = paused ? T.tipPaused : T.tipMapping;
    mapping.setAttribute('aria-label', mapping.title);
    mapping.setAttribute('aria-pressed', paused ? 'false' : 'true');
    mapping.classList.toggle(css.off, paused);
    details.setAttribute('aria-pressed', v.details ? 'true' : 'false');
    details.classList.toggle(css.off, !v.details);
    undo.disabled = !ctx.store.canUndo();
    // The area select lists every area in use (the default area when it has rooms or is shown). Alone, it hides.
    const ids = areaIds(ctx);
    if (!ids.includes(v.area)) ids.push(v.area);
    if (ids.length > 1) {
      area.hidden = false;
      const want = ids.map((id) => ({ id, name: areaName(ctx, id) }));
      const have = [...area.options].map((o) => `${o.value}\u0000${o.textContent}`).join('|');
      const next = want.map((a) => `${a.id}\u0000${a.name}`).join('|');
      if (have !== next) area.replaceChildren(...want.map((a) => h('option', { value: a.id }, a.name)));
      area.value = v.area;
    } else area.hidden = true;
  }

  update();
  return { el, update };
}
