import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, sleep } from './lib/load.mjs';

const { createStore } = await loadTs('src/store.ts');
const { memoryPersist } = await loadTs('src/persist.ts');

async function fresh(initial = null) {
  const persist = memoryPersist(initial);
  const store = createStore('w1', persist);
  await store.ready;
  return { store, persist };
}
const room = (name, x, y, z = 0, extra = {}) => ({ name, area: '', x, y, z, exits: {}, ...extra });

test('persistence: debounced save, flush, load on create, watcher count after dispose', async () => {
  const { store, persist } = await fresh();
  const stop = store.watch(() => {});
  store.watch(() => {});
  assert.equal(store.watcherCount(), 2);
  store.create(room('A', 0, 0));
  store.create(room('B', 1, 0));
  assert.equal(persist.saves, 0, 'not saved yet');
  await sleep(300);
  assert.equal(persist.saves, 1, 'one debounced save for two changes');
  assert.deepEqual(Object.keys(persist.data.rooms), ['r1', 'r2']);
  store.update('r1', { name: 'A2' });
  await store.flush();
  assert.equal(persist.saves, 2, 'flush saves at once');
  assert.equal(persist.data.rooms.r1.name, 'A2');
  await store.flush();
  assert.equal(persist.saves, 2, 'nothing pending, nothing saved');
  stop();
  assert.equal(store.watcherCount(), 1);
  store.remove('r2');
  store.dispose();
  assert.equal(store.watcherCount(), 0);
  await sleep(300);
  assert.equal(persist.saves, 3, 'dispose flushed');
  assert.deepEqual(Object.keys(persist.data.rooms), ['r1']);
  // a new store over the same persist loads it
  const again = createStore('w1', persist);
  const events = [];
  again.watch((e) => events.push(e.kind));
  await again.ready;
  assert.deepEqual(events, ['reset']);
  assert.equal(again.room('r1').name, 'A2');
  assert.equal(again.at('', 0, 0, 0).id, 'r1');
  assert.equal(again.create(room('C', 2, 2)).id, 'r3');
  again.dispose();
});

test('persistence errors go to onError, not the caller', async () => {
  const errors = [];
  const persist = { load: async () => { throw new Error('boom'); }, save: async () => { throw new Error('quota'); }, onError: (e) => errors.push(e.message) };
  const store = createStore('w2', persist);
  await store.ready;
  assert.deepEqual(errors, ['boom']);
  store.create(room('A', 0, 0));
  await store.flush();
  assert.deepEqual(errors, ['boom', 'quota']);
  store.dispose();
});
