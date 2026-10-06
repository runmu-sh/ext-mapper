/**
 * The Areas dialog: a popover (inside the panel root, like the menus) listing every area with its room count,
 * and for the chosen one its name, note, colour, the exits that lead to other areas, and the actions: show,
 * new, rename, delete (rooms deleted or moved), move the selection in. `mu.ui.prompt`/`confirm`/`pick` do the
 * asking so the dialogs match the host's.
 */
import { ROOM_COLORS, type AreaLink, type MapArea, type RoomColor } from '../types';
import type { PanelCtx } from './deps';
import { colorLabel } from './inspector';
import { popover } from './menus';

const T = {
  title: 'Areas', defaultName: 'default', rooms: (n: number) => `${n} room${n === 1 ? '' : 's'}`,
  show: 'Show', newArea: 'New area…', rename: 'Rename…', note: 'note', colour: 'colour', del: 'Delete…',
  moveSel: (n: number) => `Move ${n} selected here`, links: 'links to other areas', noLinks: 'no exits lead out of this area',
  linkRow: (l: AreaLink, name: (id: string) => string) => `${l.from.name || l.from.id} —${l.exit.key}→ ${l.to.name || l.to.id} [${name(l.to.area)}]`,
  newTitle: 'New area', newLabel: 'name', newPh: 'The Keep', renameTitle: 'Rename area', nameNeeded: 'a name is needed',
  delTitle: (n: string) => `Delete area “${n}”?`, delBody: (n: number) => (n ? `It has ${n} rooms. Delete them too, or move them to the default area?` : 'It has no rooms.'),
  delRooms: 'Delete rooms', delMove: 'Move rooms out', delOk: 'Delete', pickColour: 'Area colour', notePh: 'a note about this area',
  defaultTip: 'the default area has no name, note or colour and cannot be deleted', close: 'Close', created: (n: string) => `Area “${n}” created`,
  deleted: (n: string) => `Area “${n}” deleted`, moved: (n: number, a: string) => `${n} room${n === 1 ? '' : 's'} moved to ${a}`,
};

/** Every area id in use: declared areas and those rooms name, the default area first. */
export function areaIds(ctx: PanelCtx): string[] {
  const counts = ctx.store.areaCounts();
  const ids = new Set<string>(Object.keys(counts));
  for (const a of ctx.store.areas()) ids.add(a.id);
  const out = [...ids].filter((id) => id !== '' && (counts[id] || ctx.store.area(id)));
  out.sort((a, b) => areaName(ctx, a).localeCompare(areaName(ctx, b)));
  if (counts[''] || ctx.view.state.area === '') out.unshift('');
  return out;
}

export function areaName(ctx: PanelCtx, id: string): string {
  if (id === '') return T.defaultName;
  return ctx.store.area(id)?.name || id;
}

export function openAreas(ctx: PanelCtx, anchor: HTMLElement, chosen: string = ctx.view.state.area): void {
  const { h, css } = ctx.mu.ui;
  const r = anchor.getBoundingClientRect(), p = ctx.root.getBoundingClientRect();
  const x = r.left - p.left, y = r.bottom - p.top + 2;
  let current = chosen;
  let unwatch: (() => void) | null = null;
  const pop = popover(ctx, x, y, (el, close) => {
    el.classList.add('mu-map-areas');
    const render = (): void => {
      const ids = areaIds(ctx);
      if (!ids.includes(current)) current = ids[0] ?? '';
      const counts = ctx.store.areaCounts();
      const list = h('div', { class: 'mu-map-area-list', role: 'listbox', 'aria-label': T.title });
      for (const id of ids) {
        const on = id === current;
        const a = ctx.store.area(id);
        list.append(h('button', {
          class: `${css.cmd} mu-map-area-row${on ? ` ${css.on}` : ''}`, type: 'button', role: 'option', 'aria-selected': on ? 'true' : 'false',
          'data-area': id, onclick: () => { current = id; render(); },
        },
          a?.color ? h('i', { class: 'mu-map-area-sw', 'data-sw': a.color, 'aria-hidden': 'true' }) : h('i', { class: 'mu-map-area-sw mu-map-area-sw-none', 'aria-hidden': 'true' }),
          h('span', { class: 'mu-map-area-name' }, areaName(ctx, id)),
          h('span', { class: 'mu-map-pop-hint' }, T.rooms(counts[id] ?? 0)),
        ));
      }
      el.replaceChildren(
        h('div', { class: 'mu-map-pop-title' }, T.title),
        list,
        h('div', { class: 'mu-map-area-tools' },
          btn(T.newArea, () => void newArea(ctx, (id) => { current = id; render(); }), { title: 'create an empty area' }),
          btn(T.close, close),
        ),
        detail(current),
      );
    };
    const btn = (label: string, run: () => void, extra: Record<string, unknown> = {}): HTMLButtonElement =>
      h('button', { class: css.cmd, type: 'button', ...extra, onclick: run }, label);

    const detail = (id: string): HTMLElement => {
      const a: MapArea | undefined = ctx.store.area(id);
      const isDefault = id === '';
      const count = ctx.store.areaCounts()[id] ?? 0;
      const sel = [...ctx.view.selection].map((rid) => ctx.store.room(rid)).filter((rm): rm is NonNullable<typeof rm> => !!rm && rm.area !== id);
      const links = ctx.store.areaLinks(id);
      const body = h('div', { class: 'mu-map-area-detail', 'data-area': id });
      body.append(h('div', { class: 'mu-map-title' }, areaName(ctx, id), h('span', { class: 'mu-map-id' }, isDefault ? '' : id)));
      if (isDefault) body.append(h('div', { class: 'mu-map-meta' }, T.defaultTip));
      body.append(h('div', { class: 'mu-map-actions' },
        btn(T.show, () => { ctx.view.set({ area: id }); ctx.actions.fit(); }, { disabled: ctx.view.state.area === id ? true : undefined, title: 'show this area on the map' }),
        isDefault ? null : btn(T.rename, () => void rename(ctx, id, a?.name ?? id, render)),
        isDefault ? null : btn(T.del, () => void remove(ctx, id, count, (gone) => { if (gone) { current = ''; } render(); }), { class: `${css.cmd} ${css.warn}` }),
        sel.length ? btn(T.moveSel(sel.length), () => { ctx.store.moveToArea(sel.map((rm) => rm.id), id); ctx.toast(T.moved(sel.length, areaName(ctx, id))); render(); }, { title: 'move the selected rooms into this area' }) : null,
      ));
      if (!isDefault) {
        const note = h('textarea', { class: css.field, placeholder: T.notePh, 'aria-label': T.note, rows: '2' }) as HTMLTextAreaElement;
        note.value = a?.note ?? '';
        note.addEventListener('change', () => ctx.store.setArea({ id, note: note.value.trim() || undefined }));
        body.append(h('div', { class: `${css.secHead} mu-map-sec` }, T.note), note);
        const sw = h('div', { class: 'mu-map-swatches', role: 'radiogroup', 'aria-label': T.colour });
        for (const c of ROOM_COLORS) {
          const on = (a?.color ?? '') === c;
          sw.append(h('button', {
            class: `mu-map-swatch${on ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-sw': c, title: colorLabel(c), 'aria-label': colorLabel(c),
            onclick: () => { ctx.store.setArea({ id, color: c || undefined }); render(); },
          }, c ? h('i') : '×'));
        }
        body.append(h('div', { class: `${css.secHead} mu-map-sec` }, T.colour), sw);
      }
      body.append(h('div', { class: `${css.secHead} mu-map-sec` }, `${T.links} (${links.length})`));
      if (!links.length) body.append(h('div', { class: 'mu-map-hint' }, T.noLinks));
      else {
        const ul = h('div', { class: 'mu-map-area-links' });
        for (const l of links.slice(0, 40)) {
          ul.append(h('button', {
            class: `${css.cmd} mu-map-area-link`, type: 'button', title: 'show this exit on the map',
            onclick: () => { ctx.view.set({ area: l.from.area, z: l.from.z }); ctx.view.centreOn(l.from.x, l.from.y); if (ctx.view.state.mode === 'edit') ctx.view.select([l.from.id]); close(); },
          }, T.linkRow(l, (aid) => areaName(ctx, aid))));
        }
        if (links.length > 40) ul.append(h('div', { class: 'mu-map-hint' }, `… and ${links.length - 40} more`));
        body.append(ul);
      }
      return body;
    };
    render();
    unwatch = ctx.store.watch(() => { if (el.isConnected) render(); });
  }, { role: 'dialog', label: T.title });
  anchor.setAttribute('aria-expanded', 'true');
  const obs = new MutationObserver(() => { if (!pop.el.isConnected) { anchor.removeAttribute('aria-expanded'); unwatch?.(); obs.disconnect(); } });
  obs.observe(ctx.root, { childList: true });
}

async function newArea(ctx: PanelCtx, done: (id: string) => void): Promise<void> {
  const name = await ctx.mu.ui.prompt({ title: T.newTitle, label: T.newLabel, placeholder: T.newPh, validate: (v) => (v.trim() ? null : T.nameNeeded) });
  if (name === null || !name.trim()) return;
  const a = ctx.store.createArea(name.trim());
  ctx.toast(T.created(a.name));
  done(a.id);
}

async function rename(ctx: PanelCtx, id: string, current: string, done: () => void): Promise<void> {
  const name = await ctx.mu.ui.prompt({ title: T.renameTitle, label: T.newLabel, value: current, validate: (v) => (v.trim() ? null : T.nameNeeded) });
  if (name === null || !name.trim() || name.trim() === current) return;
  ctx.store.setArea({ id, name: name.trim() });
  done();
}

async function remove(ctx: PanelCtx, id: string, count: number, done: (gone: boolean) => void): Promise<void> {
  const name = areaName(ctx, id);
  if (!count) {
    if (!(await ctx.mu.ui.confirm({ title: T.delTitle(name), body: T.delBody(0), confirm: T.delOk, danger: true }))) return done(false);
    ctx.store.removeArea(id);
  } else {
    const how = await ctx.mu.ui.pick<'delete' | 'move'>({ title: T.delTitle(name), items: [
      { label: T.delMove, hint: `${count} → ${T.defaultName}`, value: 'move' },
      { label: T.delRooms, hint: String(count), value: 'delete' },
    ] });
    if (how === null) return done(false);
    if (how === 'delete' && !(await ctx.mu.ui.confirm({ title: T.delTitle(name), body: `${count} rooms will be deleted.`, confirm: T.delOk, danger: true }))) return done(false);
    ctx.store.removeArea(id, { rooms: how, to: '' });
  }
  if (ctx.view.state.area === id) ctx.view.set({ area: '' });
  ctx.view.clearSelection();
  ctx.toast(T.deleted(name));
  done(true);
}

/** `mu.ui.pick` of an area for the room menu's "Move to area…"; `null` when cancelled. */
export async function pickArea(ctx: PanelCtx, title: string, exclude?: string): Promise<string | null> {
  const counts = ctx.store.areaCounts();
  const items = areaIds(ctx).filter((id) => id !== exclude).map((id) => ({ label: areaName(ctx, id), hint: T.rooms(counts[id] ?? 0), value: id }));
  items.push({ label: T.newArea, hint: '', value: '\u0000new' });
  const picked = await ctx.mu.ui.pick<string>({ title, items, filter: items.length > 8 });
  if (picked === null) return null;
  if (picked !== '\u0000new') return picked;
  const name = await ctx.mu.ui.prompt({ title: T.newTitle, label: T.newLabel, placeholder: T.newPh, validate: (v) => (v.trim() ? null : T.nameNeeded) });
  if (name === null || !name.trim()) return null;
  return ctx.store.createArea(name.trim()).id;
}

export type { RoomColor };
