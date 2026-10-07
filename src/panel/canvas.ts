/**
 * Canvas interaction: pan, zoom, click-to-walk, selection and drag-move, box select, menus, pick mode, the hover
 * tooltip and the keyboard. The canvas is focusable (`tabindex=0`) with the host focus ring and an `aria-label`.
 */
import type { MapRoom } from '../types';
import type { PanelCtx } from './deps';
import { closePopover, openCellMenu, openRoomMenu } from './menus';

const T = {
  label: 'map: arrows pan, +/− zoom, F fits, C centres on you, W and E switch walk and edit mode, right-click for menus',
  steps: (n: number) => `Click to walk · ${n} step${n === 1 ? '' : 's'}`, here: 'You are here', noPath: 'No known path from here',
  blocked: 'Blocked', blockedBody: 'a room is in the way', cancel: 'Cancel', exits: 'exits', warn: '⚠',
};

/** How close to a room's centre a pointer must be (in cells) to hit it: the drawn square (ROOM_HALF 0.36) plus a hair. */
const HIT_HALF = 0.4;
const DRAG_PX = 4;

type Gesture =
  | { kind: 'pan'; lastX: number; lastY: number; moved: boolean }
  | { kind: 'maybe'; room: MapRoom | null; startX: number; startY: number; shift: boolean }
  | { kind: 'move'; startCell: { x: number; y: number }; ids: string[]; dx: number; dy: number }
  | { kind: 'box'; x0: number; y0: number; shift: boolean };

export interface CanvasController { dispose(): void; banner: HTMLElement; tip: HTMLElement }

export function attachCanvas(ctx: PanelCtx): CanvasController {
  const { canvas, stage, view, mu } = ctx;
  const { h, css } = mu.ui;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', T.label);

  const banner = h('div', { class: 'mu-map-banner', role: 'status', hidden: true });
  const bannerText = h('span');
  const bannerCancel = h('button', { class: css.cmd, type: 'button', onclick: () => ctx.actions.cancelPick() }, T.cancel);
  banner.append(bannerText, h('span', { class: 'mu-map-gap' }), bannerCancel);
  const tip = h('div', { class: 'mu-map-tip', role: 'tooltip', hidden: true });
  stage.append(banner, tip);

  let gesture: Gesture | null = null;
  let spaceDown = false;
  let lastPointer: { px: number; py: number } | null = null;

  const local = (e: MouseEvent): { px: number; py: number } => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  /** The room under a canvas point on the shown floor, or null. */
  function roomAt(px: number, py: number): MapRoom | null {
    const v = view.state;
    const c = view.cellAt(px, py);
    const r = ctx.store.at(v.area, c.x, c.y, v.z);
    return r && view.hitsRoom(px, py, r.x, r.y, HIT_HALF) ? r : null;
  }

  const cursor = (c: string): void => { canvas.dataset.cursor = c; };

  function updateCursor(px?: number, py?: number): void {
    if (gesture?.kind === 'pan') return cursor('grabbing');
    if (gesture?.kind === 'move') return cursor('move');
    if (spaceDown) return cursor('grab');
    if (view.pick) return cursor('crosshair');
    const r = px !== undefined && py !== undefined ? roomAt(px, py) : null;
    if (view.state.mode === 'walk') return cursor(r ? 'pointer' : 'grab');
    cursor(r ? 'move' : 'default');
  }

  /* ── tooltip ── */

  function showTip(room: MapRoom, px: number, py: number): void {
    const here = ctx.here();
    const lines: HTMLElement[] = [h('div', { class: 'mu-map-tip-name' }, room.name || room.id)];
    const meta = [`${room.x}, ${room.y}, z${room.z}`];
    if (room.area) meta.push(room.area);
    lines.push(h('div', { class: 'mu-map-tip-dim' }, meta.join(' · ')));
    const keys = Object.values(room.exits).map((e) => (e.to ? e.key : `${e.key}?`));
    if (keys.length) lines.push(h('div', { class: 'mu-map-tip-dim' }, `${T.exits}: ${keys.join(' ')}`));
    if (room.note) lines.push(h('div', null, room.note));
    if (room.warn) lines.push(h('div', { class: 'mu-map-tip-warn' }, `${T.warn} ${room.warn}`));
    if (view.state.mode === 'walk' && !view.pick) {
      if (here && here.id === room.id) lines.push(h('div', { class: 'mu-map-tip-walk' }, T.here));
      else if (here) {
        const p = ctx.store.path(here.id, room.id);
        lines.push(h('div', { class: 'mu-map-tip-walk' }, p ? T.steps(p.steps.length) : T.noPath));
      }
    }
    tip.replaceChildren(...lines);
    tip.hidden = false;
    const w = stage.clientWidth || view.width, hgt = stage.clientHeight || view.height;
    const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 60;
    tip.style.left = `${Math.max(0, Math.min(px + 14, w - tw))}px`;
    tip.style.top = `${py + 18 + th > hgt ? Math.max(0, py - th - 8) : py + 18}px`;
  }

  const hideTip = (): void => { tip.hidden = true; };

  function setHover(id: string | null): void {
    if (ctx.hover === id) return;
    ctx.hover = id;
    ctx.invalidate('canvas');
  }

  /* ── pointer ── */

  function onDown(e: PointerEvent): void {
    canvas.focus({ preventScroll: true });
    closePopover();
    if (e.button === 2) return; // contextmenu handles it
    const { px, py } = local(e);
    hideTip();
    if (e.button === 1 || spaceDown) {
      e.preventDefault();
      gesture = { kind: 'pan', lastX: px, lastY: py, moved: false };
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
    if (view.state.mode === 'walk') {
      gesture = room ? { kind: 'maybe', room, startX: px, startY: py, shift: e.shiftKey } : { kind: 'pan', lastX: px, lastY: py, moved: false };
    } else {
      gesture = { kind: 'maybe', room, startX: px, startY: py, shift: e.shiftKey };
    }
    canvas.setPointerCapture?.(e.pointerId);
    updateCursor(px, py);
  }

  function onMove(e: PointerEvent): void {
    const { px, py } = local(e);
    lastPointer = { px, py };
    if (!gesture) {
      const r = roomAt(px, py);
      setHover(r?.id ?? null);
      if (r) showTip(r, px, py); else hideTip();
      updateCursor(px, py);
      return;
    }
    if (gesture.kind === 'pan') {
      view.panBy(px - gesture.lastX, py - gesture.lastY);
      gesture.lastX = px; gesture.lastY = py; gesture.moved = true;
      if (view.state.follow) view.set({ follow: false });
      return;
    }
    if (gesture.kind === 'maybe') {
      if (Math.hypot(px - gesture.startX, py - gesture.startY) < DRAG_PX) return;
      if (view.state.mode === 'walk') {
        gesture = { kind: 'pan', lastX: gesture.startX, lastY: gesture.startY, moved: true };
        onMove(e);
        return;
      }
      if (gesture.room) {
        if (gesture.room.locked && !view.selection.has(gesture.room.id)) { gesture = null; return; }
        if (!view.selection.has(gesture.room.id)) view.select([gesture.room.id], gesture.shift);
        const ids = [...view.selection].filter((id) => !ctx.store.room(id)?.locked);
        gesture = { kind: 'move', startCell: view.cellAt(gesture.startX, gesture.startY), ids, dx: 0, dy: 0 };
      } else {
        gesture = { kind: 'box', x0: gesture.startX, y0: gesture.startY, shift: gesture.shift };
      }
      updateCursor();
    }
    if (gesture.kind === 'move') {
      const c = view.cellAt(px, py);
      gesture.dx = c.x - gesture.startCell.x; gesture.dy = c.y - gesture.startCell.y;
      const { dx, dy } = gesture;
      ctx.drag = { cells: gesture.ids.map((id) => ctx.store.room(id)).filter((r): r is MapRoom => !!r).map((r) => ({ x: r.x + dx, y: r.y + dy })) };
      ctx.invalidate('canvas');
      return;
    }
    if (gesture.kind === 'box') {
      ctx.box = { x0: gesture.x0, y0: gesture.y0, x1: px, y1: py };
      ctx.invalidate('canvas');
    }
  }

  function onUp(e: PointerEvent): void {
    const g = gesture;
    gesture = null;
    canvas.releasePointerCapture?.(e.pointerId);
    const { px, py } = local(e);
    if (!g) return;
    if (g.kind === 'maybe') {
      if (view.state.mode === 'walk') { if (g.room) ctx.actions.walkTo(g.room.id); }
      else if (g.room) { if (g.shift) view.toggleSelect(g.room.id); else view.select([g.room.id]); }
      else if (!g.shift) view.clearSelection();
    } else if (g.kind === 'move') {
      ctx.drag = null;
      if ((g.dx || g.dy) && g.ids.length) {
        if (!ctx.store.move(g.ids, g.dx, g.dy)) ctx.toast(T.blocked, T.blockedBody);
      }
      ctx.invalidate('canvas');
    } else if (g.kind === 'box') {
      const b = ctx.box;
      ctx.box = null;
      if (b) {
        const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
        const v = view.state;
        const ids = ctx.store.rooms().filter((r) => r.z === v.z && r.area === v.area).filter((r) => { const p = view.pointOf(r.x, r.y); return p.px >= x0 && p.px <= x1 && p.py >= y0 && p.py <= y1; }).map((r) => r.id);
        view.select(ids, g.shift);
      }
      ctx.invalidate('canvas');
    }
    updateCursor(px, py);
  }

  function onCancel(): void {
    gesture = null; ctx.drag = null; ctx.box = null;
    ctx.invalidate('canvas');
    updateCursor();
  }

  function onLeave(): void { setHover(null); hideTip(); lastPointer = null; }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { px, py } = local(e);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    view.zoomAt(factor, px, py);
    hideTip();
  }

  function onContext(e: MouseEvent): void {
    e.preventDefault();
    const { px, py } = local(e);
    hideTip();
    const rootRect = ctx.root.getBoundingClientRect();
    const x = e.clientX - rootRect.left, y = e.clientY - rootRect.top;
    const room = roomAt(px, py);
    if (room) { if (view.state.mode === 'edit' && !view.selection.has(room.id)) view.select([room.id]); openRoomMenu(ctx, room, x, y); }
    else openCellMenu(ctx, view.cellAt(px, py), x, y);
  }

  /* ── pick mode ── */

  function finishPick(target: MapRoom): void {
    const p = view.pick;
    if (!p) return;
    if (p.kind === 'link' && p.key) {
      if (target.id === p.from) { ctx.toast('Not linked', 'an exit cannot lead to its own room'); return; }
      ctx.store.link(p.from, p.key, target.id, { back: true });
    } else if (p.kind === 'merge') {
      if (target.id === p.from) { ctx.toast('Not merged', 'pick another room'); return; }
      ctx.store.merge(p.from, target.id);
      view.select([target.id]);
    }
    ctx.actions.cancelPick();
  }

  function updateBanner(): void {
    const p = view.pick;
    banner.hidden = !p;
    bannerText.textContent = p?.banner ?? '';
    updateCursor(lastPointer?.px, lastPointer?.py);
  }

  /* ── keyboard ── */

  function onKey(e: KeyboardEvent): void {
    const v = view.state;
    const edit = v.mode === 'edit';
    const sel = view.selection.size > 0;
    const step = Math.max(1, Math.round(60 / v.scale));
    const nudge = (dx: number, dy: number): void => { if (edit && sel) ctx.actions.moveSelection(dx, dy); else view.panBy(-dx * step * v.scale, -dy * step * v.scale); };
    const k = e.key;
    let handled = true;
    if (k === ' ') { spaceDown = true; updateCursor(lastPointer?.px, lastPointer?.py); }
    else if (k === 'ArrowLeft') nudge(-1, 0);
    else if (k === 'ArrowRight') nudge(1, 0);
    else if (k === 'ArrowUp') nudge(0, -1);
    else if (k === 'ArrowDown') nudge(0, 1);
    else if (k === 'PageUp') { if (edit && sel) ctx.actions.moveSelection(0, 0, 1); else ctx.actions.setFloor(1); }
    else if (k === 'PageDown') { if (edit && sel) ctx.actions.moveSelection(0, 0, -1); else ctx.actions.setFloor(-1); }
    else if (k === 'Delete' || k === 'Backspace') { if (edit && sel) void ctx.actions.deleteRooms([...view.selection]); else handled = false; }
    else if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { if (e.shiftKey) ctx.actions.redo(); else ctx.actions.undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') ctx.actions.redo();
    else if ((e.ctrlKey || e.metaKey) && k === 'a' && edit) { const ids = ctx.store.rooms().filter((r) => r.z === v.z && r.area === v.area).map((r) => r.id); view.select(ids); }
    else if (e.ctrlKey || e.metaKey || e.altKey) handled = false;
    else if (k === 'f' || k === 'F') ctx.actions.fit();
    else if (k === 'c' || k === 'C') { if (!ctx.actions.centreOnMe()) ctx.status('position unknown'); }
    else if (k === 'n' || k === 'N') ctx.actions.toggleNames();
    else if (k === 'a' || k === 'A') ctx.actions.openAreas();
    else if (k === 'w' || k === 'W') ctx.actions.setMode('walk');
    else if (k === 'e' || k === 'E') ctx.actions.setMode('edit');
    else if (k === '+' || k === '=') ctx.actions.zoom(1.25);
    else if (k === '-' || k === '_') ctx.actions.zoom(1 / 1.25);
    else if (k === 'Escape') {
      if (view.pick) ctx.actions.cancelPick();
      else if (gesture) onCancel();
      else if (view.selection.size) view.clearSelection();
      else if (ctx.walker.state(ctx.sid).status === 'walking') ctx.walker.stop(ctx.sid);
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') { spaceDown = false; updateCursor(lastPointer?.px, lastPointer?.py); }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', () => { spaceDown = false; });
  const offView = view.onChange(updateBanner);
  updateBanner();
  updateCursor();

  return {
    banner, tip,
    dispose() {
      offView();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('keyup', onKeyUp);
      banner.remove();
      tip.remove();
    },
  };
}
