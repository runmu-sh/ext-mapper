/**
 * Harness for the Lua bridge tests: a headless host whose `mu.lua` is wrapped so the test can deliver a Lua
 * `ext.emit("mapper.call", …)` and read back every `mu.lua.emit`, a real store, and fake tracker/walker that
 * record calls and let the test fire events or end a walk.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTs, ROOT } from './load.mjs';

const { createHost } = await import(pathToFileURL(createRequire(join(ROOT, 'package.json')).resolve('@runmu.sh/dev/test')).href);

const { createStore } = await loadTs('src/store.ts');
const { memoryPersist } = await loadTs('src/persist.ts');
const bridgeMod = await loadTs('src/lua/bridge.ts');

export function fakeTracker() {
  const listeners = new Set();
  const tracks = new Map();
  const calls = [];
  const t = {
    calls,
    setHere(sid, roomId, by = 'vnum') { const tr = this.trackOf(sid); tr.position = { roomId, by }; },
    trackOf(sid) {
      let tr = tracks.get(sid);
      if (!tr) tracks.set(sid, (tr = { sid, worldId: 'w1', position: { roomId: null, by: 'none' }, pending: [], lastScene: null, paused: false, source: 'lua' }));
      return tr;
    },
    fire(e) { for (const fn of [...listeners]) fn(e); },
    track: (sid) => tracks.get(sid),
    tracks: () => [...tracks.values()],
    scene(input) { calls.push({ fn: 'scene', args: [input] }); this.trackOf(input.sid).lastScene = input; },
    moved: (sid, key, opts) => { calls.push({ fn: 'moved', args: [sid, key, opts] }); t.trackOf(sid).pending.push(key); },
    failed: (sid, text, key) => calls.push({ fn: 'failed', args: [sid, text, key] }),
    anchor: (sid, roomId) => { calls.push({ fn: 'anchor', args: [sid, roomId] }); t.setHere(sid, roomId, 'anchor'); },
    createHere: () => null,
    pause: (sid, paused) => { calls.push({ fn: 'pause', args: [sid, paused] }); t.trackOf(sid).paused = paused; },
    isMove: () => false,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    drop: (sid) => tracks.delete(sid),
    listenerCount: () => listeners.size,
  };
  return t;
}

export function fakeWalker() {
  const calls = [];
  const states = new Map();
  let resolver = null;
  const idle = { status: 'idle', target: null, route: [], at: 0 };
  const w = {
    calls,
    /** End the pending walk with this state. */
    finish(state) { const r = resolver; resolver = null; if (!r) throw new Error('no walk pending'); r(state); },
    hasPending: () => resolver !== null,
    goto: (sid, roomId, opts) => { calls.push({ fn: 'goto', args: [sid, roomId, opts] }); states.set(sid, { status: 'walking', target: roomId, route: [roomId], at: 0 }); return new Promise((res) => { resolver = res; }); },
    steps: (sid, steps, opts) => { calls.push({ fn: 'steps', args: [sid, steps, opts] }); return new Promise((res) => { resolver = res; }); },
    stop: (sid) => { calls.push({ fn: 'stop', args: [sid] }); states.set(sid, { ...idle, status: 'stopped' }); },
    pause: (sid) => { calls.push({ fn: 'pause', args: [sid] }); states.set(sid, { ...(states.get(sid) ?? idle), status: 'paused' }); },
    resume: (sid) => { calls.push({ fn: 'resume', args: [sid] }); states.set(sid, { ...(states.get(sid) ?? idle), status: 'walking' }); },
    state: (sid) => states.get(sid) ?? idle,
  };
  return w;
}

/**
 * `const h = await harness()`: `h.call(fn, ...args)` delivers `mapper.call` with an id and returns the reply;
 * `h.fire(fn, ...args)` delivers without an id; `h.emits` records every `mu.lua.emit`; `h.events()` the
 * `mapper.event` payloads; `h.store`, `h.tracker`, `h.walker`, `h.dispose()`.
 */
export async function harness(opts = {}) {
  const host = createHost({ root: ROOT, sessions: opts.sessions ?? [{ id: 's1', worldId: 'w1' }, { id: 's2', worldId: 'w2' }] });
  const handlers = new Map();
  const emits = [];
  const realLua = host.mu.lua;
  const lua = {
    on: (name, fn, o) => { handlers.set(name, fn); return realLua.on(name, fn, o); },
    emit: async (name, data, o) => { emits.push({ name, data: JSON.parse(JSON.stringify(data)), sid: o?.sid }); return true; },
  };
  const mu = new Proxy(host.mu, { get: (t, k) => (k === 'lua' ? lua : t[k]) });
  const stores = new Map();
  const storeFor = (worldId) => {
    if (worldId === 'nomap') return null;
    let s = stores.get(worldId);
    if (!s) stores.set(worldId, (s = createStore(worldId, memoryPersist())));
    return s;
  };
  const tracker = fakeTracker();
  const walker = fakeWalker();
  const dispose = bridgeMod.luaBridge({
    mu, storeFor, worldOf: (sid) => host.sessions.find((s) => s.id === sid)?.worldId ?? null, tracker, walker, version: '0.1.0-test',
  });
  const store = storeFor('w1');
  await store.ready;
  let nextId = 1;
  const deliver = (sid, data) => { const fn = handlers.get('mapper.call'); if (!fn) throw new Error('bridge did not subscribe mapper.call'); fn(data, { id: `${sid}:1`, sid, worldId: 'w1', ts: Date.now(), origin: { kind: 'automation' }, replay: false, name: 'mapper.call' }); };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const h = {
    host, mu, store, stores, tracker, walker, emits, handlers, dispose, deliver, settle,
    /** Deliver a call with an id (on session s1 unless `{ sid }` is the first arg object with `__sid`). */
    async call(fn, ...args) {
      const id = nextId++;
      deliver('s1', { id, fn, args });
      await settle();
      return h.replyFor(id);
    },
    async callOn(sid, fn, ...args) { const id = nextId++; deliver(sid, { id, fn, args }); await settle(); return h.replyFor(id); },
    /** Deliver a call with an id but do not wait: returns the id. */
    callNoWait(fn, ...args) { const id = nextId++; deliver('s1', { id, fn, args }); return id; },
    fire(fn, ...args) { deliver('s1', { fn, args }); },
    replyFor: (id) => emits.find((e) => e.name === 'mapper.reply' && e.data.id === id)?.data,
    events: (sid = 's1') => emits.filter((e) => e.name === 'mapper.event' && e.sid === sid).map((e) => e.data),
    replies: () => emits.filter((e) => e.name === 'mapper.reply'),
    /** A room in w1. */
    /** A room in w1 at (x, y, 0); `extra` adds fields (`{ vnum, tags, z }`). */
    room(name, x, y, extra = {}) { return store.create({ name, area: '', x, y, z: 0, exits: {}, ...extra }); },
  };
  return h;
}

export { bridgeMod };
