import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './lib/load.mjs';

const { createStore } = await loadTs('src/store.ts');
const { memoryPersist } = await loadTs('src/persist.ts');
const { createTracker } = await loadTs('src/tracker.ts');
const { createWalker } = await loadTs('src/walker.ts');

/** Fake timers: `advance(ms)` runs what is due, in order. */
function fakeTimers() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, id }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.values()].filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.delete(due.id);
        now = due.at;
        due.fn();
        await Promise.resolve();
      }
      now = end;
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}

/**
 * A corridor A(r1) -n-> B(r2) -n-> C(r3) -e-> D(r4), plus a side room S(r5) east of B, with the player at A.
 * C's east exit is a special one with two commands.
 */
async function world() {
  const store = createStore('w1', memoryPersist());
  await store.ready;
  const a = store.create({ name: 'A', area: '', x: 0, y: 0, z: 0, exits: { n: { key: 'n', to: null } } });
  const b = store.create({ name: 'B', area: '', x: 0, y: -1, z: 0, exits: { s: { key: 's', to: a.id }, n: { key: 'n', to: null }, e: { key: 'e', to: null } } });
  const c = store.create({ name: 'C', area: '', x: 0, y: -2, z: 0, exits: { s: { key: 's', to: b.id }, e: { key: 'e', to: null, commands: ['open door east', 'east'] } } });
  const d = store.create({ name: 'D', area: '', x: 1, y: -2, z: 0, exits: { w: { key: 'w', to: c.id } } });
  const s = store.create({ name: 'S', area: '', x: 1, y: -1, z: 0, exits: { w: { key: 'w', to: b.id }, n: { key: 'n', to: d.id } } });
  store.link(a.id, 'n', b.id); store.link(b.id, 'n', c.id); store.link(c.id, 'e', d.id); store.link(b.id, 'e', s.id);
  const timers = fakeTimers();
  const tracker = createTracker({ storeFor: () => store, worldOf: () => 'w1', settings: { get: () => undefined }, now: timers.now });
  const sent = [];
  const events = [];
  tracker.on((e) => { if (e.type === 'walk') events.push(e.state); });
  const walker = createWalker({ tracker, storeFor: () => store, worldOf: () => 'w1', send: async (sid, text) => { sent.push(text); return 'sent'; }, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  tracker.anchor('s1', a.id);
  /** The game put us in room `id` (a vnum-less scene identified by anchor-style enter). */
  const arrive = (id) => { tracker.anchor('s1', id); };
  return { store, tracker, walker, timers, sent, events, arrive, ids: { a: a.id, b: b.id, c: c.id, d: d.id, s: s.id } };
}

test('step mode: sends hop by hop on enter and arrives', async () => {
  const { walker, timers, sent, events, arrive, ids } = await world();
  const done = walker.goto('s1', ids.c);
  await timers.advance(0);
  assert.deepEqual(sent, ['n']);
  assert.equal(walker.state('s1').status, 'walking');
  assert.deepEqual(walker.state('s1').route, [ids.b, ids.c]);
  arrive(ids.b);
  await timers.advance(0);
  assert.deepEqual(sent, ['n', 'n']);
  assert.equal(walker.state('s1').at, 1);
  arrive(ids.c);
  const st = await done;
  assert.equal(st.status, 'arrived');
  assert.equal(walker.state('s1').status, 'idle');
  assert.deepEqual(events.map((e) => e.status), ['walking', 'walking', 'arrived']);
  assert.equal(timers.pending(), 0, 'no timer left');
});

test('a multi-command hop sends its commands 50 ms apart', async () => {
  const { walker, timers, sent, arrive, ids } = await world();
  arrive(ids.c);
  const done = walker.goto('s1', ids.d);
  await timers.advance(0);
  assert.deepEqual(sent, ['open door east']);
  await timers.advance(49);
  assert.deepEqual(sent, ['open door east']);
  await timers.advance(1);
  assert.deepEqual(sent, ['open door east', 'east']);
  arrive(ids.d);
  assert.equal((await done).status, 'arrived');
});

test('off route: re-plan once from a known room, then fail', async () => {
  const { walker, timers, sent, arrive, ids } = await world();
  const done = walker.goto('s1', ids.d);
  await timers.advance(0);
  assert.deepEqual(sent, ['n']);
  arrive(ids.s); // not B: a known detour; from S, D is one step north.
  await timers.advance(0);
  assert.deepEqual(walker.state('s1').route, [ids.d]);
  assert.deepEqual(sent, ['n', 'n']);
  arrive(ids.b); // off route again
  const st = await done;
  assert.deepEqual([st.status, st.reason], ['failed', 'off route']);
});

test('a failed event from the tracker stops the walk with the text', async () => {
  const { walker, tracker, timers, ids } = await world();
  const done = walker.goto('s1', ids.c);
  await timers.advance(0);
  tracker.failed('s1', 'The door is closed.', 'n');
  const st = await done;
  assert.deepEqual([st.status, st.reason], ['failed', 'The door is closed.']);
});

test('timeout: no room change within timeoutS fails', async () => {
  const { walker, timers, ids } = await world();
  const done = walker.goto('s1', ids.c, { timeoutS: 2 });
  await timers.advance(1999);
  assert.equal(walker.state('s1').status, 'walking');
  await timers.advance(1);
  const st = await done;
  assert.deepEqual([st.status, st.reason], ['failed', 'no room change']);
});

test('pause stops the clock and resume sends the pending hop again; stop ends it', async () => {
  const { walker, timers, sent, arrive, ids } = await world();
  const done = walker.goto('s1', ids.c, { timeoutS: 1 });
  await timers.advance(0);
  walker.pause('s1');
  assert.equal(walker.state('s1').status, 'paused');
  await timers.advance(5000);
  assert.equal(walker.state('s1').status, 'paused', 'no timeout while paused');
  walker.resume('s1');
  await timers.advance(0);
  assert.deepEqual(sent, ['n', 'n'], 'the hop is sent again');
  arrive(ids.b);
  await timers.advance(0);
  walker.stop('s1');
  const st = await done;
  assert.equal(st.status, 'stopped');
  assert.equal(walker.state('s1').status, 'idle');
});

test('burst mode sends everything delayMs apart and arrives', async () => {
  const { walker, timers, sent, ids } = await world();
  const done = walker.goto('s1', ids.d, { mode: 'burst', delayMs: 100 });
  await timers.advance(0);
  assert.deepEqual(sent, ['n']);
  await timers.advance(100);
  assert.deepEqual(sent, ['n', 'n']);
  await timers.advance(100);
  assert.deepEqual(sent, ['n', 'n', 'open door east']);
  assert.equal(walker.state('s1').at, 2);
  await timers.advance(100);
  const st = await done;
  assert.equal(st.status, 'arrived');
  assert.deepEqual(sent, ['n', 'n', 'open door east', 'east']);
});

test('steps() walks explicit commands in burst mode; goto with no route fails', async () => {
  const { walker, timers, sent, ids } = await world();
  const done = walker.steps('s1', ['n', 'e', 'say hi']);
  await timers.advance(0);
  assert.deepEqual(sent, ['n']);
  await timers.advance(300);
  assert.deepEqual(sent, ['n', 'e', 'say hi']);
  const st = await done;
  assert.deepEqual([st.status, st.target, st.at], ['arrived', null, 3]);
  const none = await walker.goto('s1', 'r99');
  assert.deepEqual([none.status, none.reason], ['failed', 'no route']);
  void ids;
});

test('a new goto stops the walk in progress', async () => {
  const { walker, timers, ids } = await world();
  const first = walker.goto('s1', ids.c);
  await timers.advance(0);
  const second = walker.goto('s1', ids.b);
  assert.equal((await first).status, 'stopped');
  walker.stop('s1');
  assert.equal((await second).status, 'stopped');
});
