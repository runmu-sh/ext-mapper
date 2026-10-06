/**
 * The walker: sends a route's commands and watches the tracker to know when each step landed. Step mode sends
 * one hop, waits for `enter`, checks it is the expected room (re-plans once from a known detour), and goes on;
 * burst mode sends everything on a timer. A `failed` event from the tracker stops the walk. Walk events go out
 * through the tracker's emitter, so one `tracker.on` sees everything.
 */
import type { TrackerImpl } from './tracker';
import type { MapStore, MapperEvent, WalkOptions, WalkState, Walker } from './types';

export interface WalkerOpts {
  tracker: TrackerImpl;
  storeFor(worldId: string): MapStore | null;
  worldOf(sid: string): string | null;
  send(sid: string, text: string): Promise<'sent' | 'duplicate' | 'refused'>;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
}

const HOP_GAP_MS = 50;
const DEFAULT_DELAY_MS = 150;
const DEFAULT_TIMEOUT_S = 10;

interface Walk {
  state: WalkState;
  /** The commands of each hop, parallel to `state.route`. */
  hops: string[][];
  mode: 'step' | 'burst';
  delayMs: number;
  timeoutMs: number;
  locked: boolean;
  replanned: boolean;
  timer: unknown;
  /** Burst mode: the index of the next command to send (flattened). */
  flat: string[];
  flatAt: number;
  done: (s: WalkState) => void;
}

const idle = (): WalkState => ({ status: 'idle', target: null, route: [], at: 0 });
const copy = (s: WalkState): WalkState => ({ ...s, route: [...s.route] });

export function createWalker(opts: WalkerOpts): Walker {
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const walks = new Map<string, Walk>();

  function announce(sid: string, w: Walk): void {
    opts.tracker.emit({ type: 'walk', sid, state: copy(w.state) });
  }
  function clearTimer(w: Walk): void {
    if (w.timer !== null && w.timer !== undefined) { clearT(w.timer); w.timer = null; }
  }
  function finish(sid: string, w: Walk, status: WalkState['status'], reason?: string): void {
    clearTimer(w);
    w.state = { ...w.state, status };
    if (reason !== undefined) w.state.reason = reason; else delete w.state.reason;
    walks.delete(sid);
    announce(sid, w);
    w.done(copy(w.state));
  }

  /* ── step mode ── */

  /** Send the commands of the hop at `state.at`, 50 ms apart, then wait for the room to change. */
  function sendHop(sid: string, w: Walk): void {
    const hop = w.hops[w.state.at];
    if (!hop) { finish(sid, w, 'arrived'); return; }
    let i = 0;
    const next = (): void => {
      if (w.state.status !== 'walking') return;
      if (i < hop.length) {
        void opts.send(sid, hop[i++]);
        if (i < hop.length) { w.timer = setT(next, HOP_GAP_MS); return; }
      }
      w.timer = setT(() => { w.timer = null; if (w.state.status === 'walking') finish(sid, w, 'failed', 'no room change'); }, w.timeoutMs);
    };
    next();
  }

  function onEnter(sid: string, w: Walk, roomId: string): void {
    if (w.state.status !== 'walking' || w.mode !== 'step') return;
    clearTimer(w);
    const expected = w.state.route[w.state.at];
    if (roomId === expected) {
      w.state = { ...w.state, at: w.state.at + 1 };
      if (w.state.at >= w.hops.length) { finish(sid, w, 'arrived'); return; }
      announce(sid, w);
      sendHop(sid, w);
      return;
    }
    if (roomId === w.state.target) { w.state = { ...w.state, at: w.state.route.length }; finish(sid, w, 'arrived'); return; }
    // A known detour: re-plan once from where we are.
    if (!w.replanned && w.state.target) {
      const store = storeFor(sid);
      const path = store?.path(roomId, w.state.target, { locked: w.locked });
      if (path && path.ids.length) {
        w.replanned = true;
        w.state = { ...w.state, route: path.ids, at: 0 };
        w.hops = path.steps;
        announce(sid, w);
        sendHop(sid, w);
        return;
      }
    }
    finish(sid, w, 'failed', 'off route');
  }

  /* ── burst mode ── */

  function sendBurst(sid: string, w: Walk): void {
    const tick = (): void => {
      w.timer = null;
      if (w.state.status !== 'walking') return;
      if (w.flatAt >= w.flat.length) { w.state = { ...w.state, at: w.hops.length }; finish(sid, w, 'arrived'); return; }
      void opts.send(sid, w.flat[w.flatAt++]);
      // `at` follows the hop the next command belongs to.
      let n = 0, at = 0;
      while (at < w.hops.length && n + w.hops[at].length <= w.flatAt) { n += w.hops[at].length; at++; }
      if (at !== w.state.at) { w.state = { ...w.state, at }; announce(sid, w); }
      if (w.flatAt >= w.flat.length) { finish(sid, w, 'arrived'); return; }
      w.timer = setT(tick, w.delayMs);
    };
    tick();
  }

  function storeFor(sid: string): MapStore | null {
    const w = opts.worldOf(sid);
    return w ? opts.storeFor(w) : null;
  }

  function begin(sid: string, target: string | null, route: string[], hops: string[][], o: WalkOptions): Promise<WalkState> {
    const old = walks.get(sid);
    if (old) finish(sid, old, 'stopped');
    return new Promise<WalkState>((done) => {
      const w: Walk = {
        state: { status: 'walking', target, route, at: 0 },
        hops, mode: o.mode ?? 'step', delayMs: o.delayMs ?? DEFAULT_DELAY_MS, timeoutMs: (o.timeoutS ?? DEFAULT_TIMEOUT_S) * 1000,
        locked: !!o.locked, replanned: false, timer: null, flat: hops.flat(), flatAt: 0, done,
      };
      walks.set(sid, w);
      announce(sid, w);
      if (!hops.length) { finish(sid, w, 'arrived'); return; }
      if (w.mode === 'burst') sendBurst(sid, w); else sendHop(sid, w);
    });
  }

  opts.tracker.on((e: MapperEvent) => {
    const w = walks.get(e.sid);
    if (!w) return;
    if (e.type === 'enter') onEnter(e.sid, w, e.room.id);
    else if (e.type === 'failed' && w.state.status === 'walking') finish(e.sid, w, 'failed', e.text);
  });

  const walker: Walker = {
    async goto(sid, roomId, o = {}) {
      const store = storeFor(sid);
      const here = opts.tracker.track(sid)?.position.roomId ?? null;
      if (!store || !here) return { ...idle(), status: 'failed', target: roomId, reason: 'position unknown' };
      const path = store.path(here, roomId, { locked: o.locked });
      if (!path) return { ...idle(), status: 'failed', target: roomId, reason: 'no route' };
      return begin(sid, roomId, path.ids, path.steps, o);
    },
    async steps(sid, steps, o = {}) {
      // No destination: `route` stays empty and `at` counts the commands sent.
      const hops = steps.filter((s) => s.trim()).map((s) => [s]);
      return begin(sid, null, [], hops, { ...o, mode: 'burst' });
    },
    stop(sid) {
      const w = walks.get(sid);
      if (w) finish(sid, w, 'stopped');
    },
    pause(sid) {
      const w = walks.get(sid);
      if (!w || w.state.status !== 'walking') return;
      clearTimer(w);
      w.state = { ...w.state, status: 'paused' };
      announce(sid, w);
    },
    resume(sid) {
      const w = walks.get(sid);
      if (!w || w.state.status !== 'paused') return;
      w.state = { ...w.state, status: 'walking' };
      announce(sid, w);
      if (w.mode === 'burst') sendBurst(sid, w); else sendHop(sid, w);
    },
    state(sid) {
      const w = walks.get(sid);
      return w ? copy(w.state) : idle();
    },
  };
  return walker;
}
