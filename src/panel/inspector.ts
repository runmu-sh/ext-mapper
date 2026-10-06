/**
 * The inspector under the stage: hints when nothing is selected, the multi-select tools, or one room's fields and
 * exits. It re-renders from the store on every update, except while one of its inputs has focus: then the render is
 * deferred to the blur, so a note being typed is never clobbered.
 */
import { ROOM_COLORS, type MapExit, type MapRoom, type RoomColor } from '../types';
import { dirByName, parseDir } from '../dirs';
import type { PanelCtx } from './deps';
import { areaName, openAreas, pickArea } from './areas';

export interface Inspector { el: HTMLElement; update(): void }

/** The symbol glyphs offered (from the host glyph set and the block range the Glyphs face covers). */
export const SYMBOLS: ReadonlyArray<{ glyph: string; name: string }> = [
  { glyph: '★', name: 'star' }, { glyph: '◆', name: 'diamond' }, { glyph: '●', name: 'dot' }, { glyph: '▲', name: 'triangle' },
  { glyph: '⌂', name: 'home' }, { glyph: '⚑', name: 'flag' }, { glyph: '⚠', name: 'warning' }, { glyph: '✓', name: 'check' },
  { glyph: '×', name: 'cross' }, { glyph: '♪', name: 'music' }, { glyph: '$', name: 'shop' }, { glyph: '!', name: 'quest' },
  { glyph: '?', name: 'unknown' }, { glyph: '⇄', name: 'portal' }, { glyph: '↑', name: 'up' }, { glyph: '↓', name: 'down' },
];

export function colorLabel(c: RoomColor): string { return c === '' ? 'none' : c; }

const T = {
  hintWalk: 'Click a room to walk there · right-click for more · E to edit',
  hintEdit: 'Click a room to select · drag to move · shift for more · right-click an empty cell to add',
  hintUnknown: 'Position unknown: right-click an empty cell → New room here, or select a room and press "I\'m here"',
  hintEmpty: 'No rooms yet: move around with mapping on, or import a map from the ☰ menu',
  selected: (n: number) => `${n} rooms selected`, deleteN: (n: number) => `Delete ${n}`, colourAll: 'colour all',
  move: 'move', connected: 'Connected', clear: 'Clear', moveToArea: 'Move to area…', areaTip: 'areas: show, rename, colour, delete (A)', floorUp: 'floor up', floorDown: 'floor down',
  looksRight: 'Looks right', walkHere: 'Walk here', imHere: "I'm here", mergeInto: 'Merge into…', lock: 'Lock', unlock: 'Unlock', del: 'Delete',
  colour: 'colour', symbol: 'symbol', tags: 'tags', note: 'note', exits: 'exits', addTag: 'add tag', notePh: 'a note about this room',
  symPh: '··', go: 'go', link: 'link…', unlink: 'unlink', oneway: 'one-way', cost: 'cost', commands: 'commands…', remove: 'remove',
  unexplored: 'unexplored', here: 'here', floor: 'floor', area: 'area', vnum: 'vnum', locked: 'locked', merge: (n: string) => `Merge “${n}” into: click the room that stays · Esc cancels`,
  linkBanner: (k: string) => `Link exit “${k}”: click the destination room · Esc cancels`, lockedTip: 'the tracker never moves, merges or relabels this room',
  commandsTitle: (k: string) => `Commands sent for “${k}”`, commandsLabel: 'one per line, or separated by ;', doorLabel: 'door',
};

const PAD: Array<[number, number, string, string]> = [
  [-1, -1, '↖', 'northwest'], [0, -1, '↑', 'north'], [1, -1, '↗', 'northeast'],
  [-1, 0, '←', 'west'], [0, 0, '', ''], [1, 0, '→', 'east'],
  [-1, 1, '↙', 'southwest'], [0, 1, '↓', 'south'], [1, 1, '↘', 'southeast'],
];

export function buildInspector(ctx: PanelCtx): Inspector {
  const { h, css } = ctx.mu.ui;
  const el = h('div', { class: 'mu-map-insp', role: 'region', 'aria-label': 'room inspector' });
  let deferred = false;

  const fieldFocused = (): boolean => {
    const a = el.ownerDocument.activeElement;
    return !!a && el.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
  };
  el.addEventListener('focusout', () => { if (deferred) queueMicrotask(() => { if (!fieldFocused() && deferred) { deferred = false; update(); } }); });

  const cmd = (label: string, run: () => void, extra: Record<string, unknown> = {}): HTMLButtonElement =>
    h('button', { class: css.cmd, type: 'button', ...extra, onclick: run }, label);
  const sec = (title: string): HTMLElement => h('div', { class: `${css.secHead} mu-map-sec` }, title);

  function movePad(ids: string[], withExtras: boolean): HTMLElement {
    const pad = h('div', { class: 'mu-map-pad', role: 'group', 'aria-label': T.move });
    for (const [dx, dy, glyph, name] of PAD) {
      if (!glyph) { pad.append(h('span', { class: 'mu-map-pad-mid', 'aria-hidden': 'true' }, '·')); continue; }
      pad.append(cmd(glyph, () => ctx.actions.moveSelection(dx, dy), { class: `${css.cmd} ${css.sq}`, title: `move ${name}`, 'aria-label': `move ${name}` }));
    }
    const col = h('div', { class: 'mu-map-padcol' },
      cmd('▴', () => ctx.actions.moveSelection(0, 0, 1), { class: `${css.cmd} ${css.sq}`, title: T.floorUp, 'aria-label': T.floorUp }),
      cmd('▾', () => ctx.actions.moveSelection(0, 0, -1), { class: `${css.cmd} ${css.sq}`, title: T.floorDown, 'aria-label': T.floorDown }),
    );
    const row = h('div', { class: 'mu-map-row' }, pad, col);
    if (withExtras && ids.length === 1) {
      row.append(h('span', { class: 'mu-map-gap' }),
        cmd(T.connected, () => ctx.actions.selectConnected(ids[0]), { title: 'select every room linked to this one on this floor' }),
        cmd(T.clear, () => ctx.view.clearSelection(), { title: 'clear the selection (Esc)' }));
    }
    return row;
  }

  function swatches(ids: string[], current: RoomColor | undefined): HTMLElement {
    const row = h('div', { class: 'mu-map-swatches', role: 'radiogroup', 'aria-label': T.colour });
    for (const c of ROOM_COLORS) {
      const on = (current ?? '') === c;
      row.append(h('button', {
        class: `mu-map-swatch${on ? ` ${css.on}` : ''}`, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false',
        'data-sw': c || 'none', title: colorLabel(c), 'aria-label': colorLabel(c),
        onclick: () => ctx.store.batch('colour', () => { for (const id of ids) ctx.store.update(id, { color: c }); }),
      }, c ? h('i') : '×'));
    }
    return row;
  }

  function renderEmpty(): void {
    const v = ctx.view.state;
    const hints: string[] = [];
    if (!ctx.store.rooms().length) hints.push(T.hintEmpty);
    if (!ctx.here()) hints.push(T.hintUnknown);
    hints.push(v.mode === 'edit' ? T.hintEdit : T.hintWalk);
    el.replaceChildren(...hints.map((t) => h('div', { class: 'mu-map-hint' }, t)));
  }

  function renderMulti(ids: string[]): void {
    el.replaceChildren(
      h('div', { class: 'mu-map-title' }, T.selected(ids.length)),
      h('div', { class: 'mu-map-actions' },
        cmd(T.moveToArea, () => void moveToArea(ids), { title: 'move the selected rooms into another area' }),
        cmd(T.deleteN(ids.length), () => void ctx.actions.deleteRooms(ids), { class: `${css.cmd} ${css.warn}` }),
        cmd(T.clear, () => ctx.view.clearSelection())),
      sec(T.move), movePad(ids, false),
      sec(T.colourAll), swatches(ids, undefined),
    );
  }

  async function moveToArea(ids: string[]): Promise<void> {
    const area = await pickArea(ctx, `Move ${ids.length} rooms to area`);
    if (area === null) return;
    ctx.store.moveToArea(ids, area);
    ctx.toast(`${ids.length} rooms moved to ${areaName(ctx, area)}`);
  }

  function symbolRow(room: MapRoom): HTMLElement {
    const row = h('div', { class: 'mu-map-glyphs', role: 'group', 'aria-label': T.symbol });
    row.append(cmd('×', () => ctx.store.update(room.id, { symbol: '' }), { class: `${css.cmd} ${css.sq}`, title: 'no symbol', 'aria-label': 'no symbol' }));
    for (const g of SYMBOLS) {
      row.append(cmd(g.glyph, () => ctx.store.update(room.id, { symbol: g.glyph }), { class: `${css.cmd} ${css.sq}${room.symbol === g.glyph ? ` ${css.on}` : ''}`, title: g.name, 'aria-label': g.name, 'aria-pressed': room.symbol === g.glyph ? 'true' : 'false' }));
    }
    const inp = h('input', { class: `${css.field} mu-map-sym`, type: 'text', maxlength: '2', value: room.symbol ?? '', placeholder: T.symPh, 'aria-label': T.symbol }) as HTMLInputElement;
    inp.addEventListener('change', () => ctx.store.update(room.id, { symbol: [...inp.value].slice(0, 2).join('') }));
    row.append(inp);
    return row;
  }

  function tagsRow(room: MapRoom): HTMLElement {
    const row = h('div', { class: 'mu-map-chips' });
    for (const tag of room.tags ?? []) {
      row.append(h('span', { class: 'mu-map-chip' }, tag,
        cmd('×', () => ctx.store.update(room.id, { tags: (room.tags ?? []).filter((t) => t !== tag) }), { class: `${css.cmd} ${css.sq}`, title: `${T.remove} ${tag}`, 'aria-label': `${T.remove} ${tag}` })));
    }
    const inp = h('input', { class: css.field, type: 'text', placeholder: T.addTag, 'aria-label': T.addTag }) as HTMLInputElement;
    const add = (): void => {
      const t = inp.value.trim().toLowerCase();
      if (!t) return;
      inp.value = '';
      if ((room.tags ?? []).includes(t)) return;
      ctx.store.update(room.id, { tags: [...(room.tags ?? []), t] });
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    inp.addEventListener('change', add);
    row.append(inp);
    return row;
  }

  function exitRow(room: MapRoom, exit: MapExit): HTMLElement {
    const dest = exit.to ? ctx.store.room(exit.to) : undefined;
    const here = ctx.here();
    const back = dest ? Object.values(dest.exits).some((e) => e.to === room.id) : false;
    const arrow = exit.to ? (exit.oneway || !back ? '→' : '⇄') : '→';
    let destText = T.unexplored;
    if (dest) {
      destText = dest.name || dest.id;
      if (dest.z !== room.z) destText += ` (${T.floor} ${dest.z})`;
      if (dest.area !== room.area) destText += ` [${dest.area || 'default'}]`;
    } else if (exit.to) destText = `${exit.to}?`;
    const tools = h('span', { class: 'mu-map-exit-tools' });
    if (here && here.id === room.id) tools.append(cmd(T.go, () => void ctx.walker.steps(ctx.sid, exit.commands?.length ? exit.commands : [exit.key]), { title: `send ${exit.key}` }));
    tools.append(cmd(T.link, () => ctx.actions.startPick({ kind: 'link', from: room.id, key: exit.key, banner: T.linkBanner(exit.key) }), { title: 'pick the room this exit leads to' }));
    if (exit.to) tools.append(cmd(T.unlink, () => ctx.store.unlink(room.id, exit.key), { title: 'forget where this exit leads' }));
    tools.append(cmd(T.oneway, () => ctx.store.setExit(room.id, { ...exit, oneway: !exit.oneway }), { class: `${css.toggle}${exit.oneway ? '' : ` ${css.off}`}`, 'aria-pressed': exit.oneway ? 'true' : 'false', title: 'one-way: never draw or walk the way back' }));
    const cost = h('input', { class: `${css.field} mu-map-cost`, type: 'number', min: '0', step: '1', value: String(exit.cost ?? 1), title: T.cost, 'aria-label': `${T.cost} of ${exit.key}` }) as HTMLInputElement;
    cost.addEventListener('change', () => { const n = Number(cost.value); if (Number.isFinite(n) && n >= 0) ctx.store.setExit(room.id, { ...exit, cost: n === 1 ? undefined : n }); });
    tools.append(cost);
    tools.append(cmd(T.commands, () => void editCommands(room, exit), { title: 'the commands sent instead of the key when walking' }));
    tools.append(cmd('×', () => ctx.store.removeExit(room.id, exit.key), { class: `${css.cmd} ${css.sq} ${css.warn}`, title: `${T.remove} ${exit.key}`, 'aria-label': `${T.remove} exit ${exit.key}` }));
    const d = parseDir(exit.key) ?? (exit.dir ? dirByName(exit.dir) : undefined);
    return h('div', { class: 'mu-map-exit', 'data-key': exit.key },
      h('span', { class: 'mu-map-key', title: d ? d.name : exit.key }, exit.key),
      exit.name && exit.name !== exit.key ? h('span', { class: 'mu-map-meta' }, exit.name) : null,
      h('span', { class: 'mu-map-arrow', 'aria-hidden': 'true' }, arrow),
      h('span', { class: `mu-map-dest${dest ? '' : ' mu-map-none'}` }, destText),
      exit.door ? h('span', { class: 'mu-map-door', title: T.doorLabel }, exit.door) : null,
      exit.blocked ? h('span', { class: 'mu-map-door' }, 'blocked') : null,
      tools,
    );
  }

  async function editCommands(room: MapRoom, exit: MapExit): Promise<void> {
    const v = await ctx.mu.ui.prompt({ title: T.commandsTitle(exit.key), label: T.commandsLabel, value: (exit.commands ?? []).join('; ') });
    if (v === null) return;
    const commands = v.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    ctx.store.setExit(room.id, { ...exit, commands: commands.length ? commands : undefined });
  }

  function renderRoom(room: MapRoom): void {
    const here = ctx.here();
    const isHere = here?.id === room.id;
    const meta: Array<string | HTMLElement> = [`${room.x}, ${room.y}`, `${T.floor} ${room.z}`,
      cmd(`${T.area} ${areaName(ctx, room.area)}`, () => openAreas(ctx, el, room.area), { class: `${css.cmd} mu-map-area-btn`, title: T.areaTip })];
    if (room.vnum) meta.push(`${T.vnum} ${room.vnum}`);
    if (room.env) meta.push(room.env);
    if (room.locked) meta.push(T.locked);
    const note = h('textarea', { class: css.field, placeholder: T.notePh, 'aria-label': T.note, rows: '2' }) as HTMLTextAreaElement;
    note.value = room.note ?? '';
    note.addEventListener('change', () => ctx.store.update(room.id, { note: note.value.trim() || undefined }));
    const exits = Object.values(room.exits).sort((a, b) => a.key.localeCompare(b.key));
    const parts: Array<HTMLElement | null> = [
      h('div', { class: 'mu-map-title' }, room.name || '(unnamed)', h('span', { class: 'mu-map-id' }, room.id), isHere ? h('span', { class: `${css.plate} ${css.hot}` }, T.here) : null),
      h('div', { class: 'mu-map-meta' }, meta.flatMap((m, i) => (i ? [' · ', m] : [m]))),
      room.warn ? h('div', { class: 'mu-map-warn' }, '⚠ ', room.warn, cmd(T.looksRight, () => ctx.store.update(room.id, { warn: undefined }), { title: 'clear the warning' })) : null,
      h('div', { class: 'mu-map-actions' },
        cmd(T.walkHere, () => ctx.actions.walkTo(room.id), { disabled: isHere || !here ? true : undefined, title: here ? 'walk from where you are' : 'position unknown' }),
        cmd(T.imHere, () => ctx.actions.imHere(room.id), { disabled: isHere ? true : undefined, title: 'declare that you stand here' }),
        cmd(T.mergeInto, () => ctx.actions.startPick({ kind: 'merge', from: room.id, banner: T.merge(room.name || room.id) }), { title: 'fold this room into another' }),
        cmd(room.locked ? T.unlock : T.lock, () => ctx.store.update(room.id, { locked: !room.locked }), { title: T.lockedTip, 'aria-pressed': room.locked ? 'true' : 'false' }),
        cmd(T.del, () => void ctx.actions.deleteRooms([room.id]), { class: `${css.cmd} ${css.warn}`, title: 'delete this room (Del)' }),
      ),
      sec(T.move), movePad([room.id], true),
      sec(T.colour), swatches([room.id], room.color),
      sec(T.symbol), symbolRow(room),
      sec(T.tags), tagsRow(room),
      sec(T.note), note,
      sec(`${T.exits} (${exits.length})`),
      h('div', { class: 'mu-map-exits' }, exits.map((e) => exitRow(room, e))),
    ];
    el.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }

  function update(): void {
    if (fieldFocused()) { deferred = true; return; }
    const sel = [...ctx.view.selection].filter((id) => ctx.store.room(id));
    if (!sel.length) { renderEmpty(); return; }
    if (sel.length > 1) { renderMulti(sel); return; }
    const room = ctx.store.room(sel[0]);
    if (room) renderRoom(room); else renderEmpty();
  }

  update();
  return { el, update };
}
