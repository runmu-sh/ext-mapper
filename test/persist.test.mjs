import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './lib/load.mjs';

const { storePersist, memoryPersist } = await loadTs('src/persist.ts');
const { createStore } = await loadTs('src/store.ts');

class FakeQuota extends Error {
  constructor() { super('QuotaExceeded: the world storage of this extension is limited to 2097152 bytes'); this.name = 'QuotaExceeded'; }
}

/** A Map-backed stand-in for the SDK `Store`, recording every write. */
function fakeStore(opts = {}) {
  const keys = new Map();
  const collections = new Map();
  const log = [];
  const store = {
    ready: Promise.resolve(),
    log,
    get: (k, fallback) => (keys.has(k) ? JSON.parse(keys.get(k)) : fallback),
    set: (k, v) => { log.push(['set', k]); if (opts.quota) throw new FakeQuota(); keys.set(k, JSON.stringify(v)); },
    delete: (k) => { log.push(['delete', k]); keys.delete(k); },
    keys: (prefix = '') => [...keys.keys()].filter((k) => k.startsWith(prefix)),
    watch: () => () => {},
    watchAll: () => () => {},
    collection(name) {
      let c = collections.get(name);
      if (!c) {
        const items = new Map();
        c = {
          items,
          add: (v) => { const id = `c${items.size + 1}`; c.put(id, v); return id; },
          put: (id, v) => { log.push(['put', name, id]); if (opts.quota) throw new FakeQuota(); items.set(id, JSON.stringify(v)); },
          patch: (id, f) => c.put(id, { ...c.get(id), ...f }),
          remove: (id) => { log.push(['remove', name, id]); items.delete(id); },
          get: (id) => (items.has(id) ? JSON.parse(items.get(id)) : undefined),
          list: () => [...items].map(([id, v]) => ({ id, value: JSON.parse(v) })),
          watch: () => () => {},
        };
        collections.set(name, c);
      }
      return c;
    },
  };
  return store;
}

const data = (rooms, areas = {}, nextId = 10) => ({ format: 'mu-map', v: 2, rooms, areas, nextId });
const room = (id, name, x = 0, y = 0) => ({ id, name, area: '', x, y, z: 0, exits: {} });

test('load of an empty store is null', async () => {
  const p = storePersist(fakeStore());
  assert.equal(await p.load(), null);
});

test('save writes only the rooms that changed; load rebuilds MapData', async () => {
  const sdk = fakeStore();
  const p = storePersist(sdk);
  await p.save(data({ r1: room('r1', 'A'), r2: room('r2', 'B', 1, 0) }, { t: { id: 't', name: 'Town' } }, 3));
  assert.deepEqual(sdk.log, [['put', 'rooms', 'r1'], ['put', 'rooms', 'r2'], ['set', 'areas'], ['set', 'meta']]);
  sdk.log.length = 0;
  await p.save(data({ r1: room('r1', 'A'), r2: room('r2', 'B2', 1, 0) }, { t: { id: 't', name: 'Town' } }, 3));
  assert.deepEqual(sdk.log, [['put', 'rooms', 'r2']], 'only the changed room, no areas or meta');
  sdk.log.length = 0;
  await p.save(data({ r2: room('r2', 'B2', 1, 0), r3: room('r3', 'C', 2, 0) }, {}, 4));
  assert.deepEqual(sdk.log, [['put', 'rooms', 'r3'], ['remove', 'rooms', 'r1'], ['set', 'areas'], ['set', 'meta']]);
  sdk.log.length = 0;
  await p.save(data({ r2: room('r2', 'B2', 1, 0), r3: room('r3', 'C', 2, 0) }, {}, 4));
  assert.deepEqual(sdk.log, [], 'nothing changed, nothing written');
  // A fresh Persist over the same SDK store reads it back.
  const loaded = await storePersist(sdk).load();
  assert.deepEqual(loaded, data({ r2: room('r2', 'B2', 1, 0), r3: room('r3', 'C', 2, 0) }, {}, 4));
  assert.deepEqual(sdk.get('meta'), { nextId: 4, v: 2 });
});

test('load raises nextId past the highest stored room id', async () => {
  const sdk = fakeStore();
  sdk.collection('rooms').put('r12', room('r12', 'X'));
  sdk.log.length = 0;
  const loaded = await storePersist(sdk).load();
  assert.equal(loaded.nextId, 13);
  assert.deepEqual(loaded.areas, {});
});

test('a second Persist after load diffs against what was loaded', async () => {
  const sdk = fakeStore();
  await storePersist(sdk).save(data({ r1: room('r1', 'A') }, {}, 2));
  const p = storePersist(sdk);
  await p.load();
  sdk.log.length = 0;
  await p.save(data({ r1: room('r1', 'A') }, {}, 2));
  assert.deepEqual(sdk.log, [], 'unchanged since load');
});

test('quota errors are reported through onError and never thrown', async () => {
  const sdk = fakeStore({ quota: true });
  const p = storePersist(sdk);
  const errors = [];
  p.onError = (e) => errors.push(e);
  await p.save(data({ r1: room('r1', 'A') }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, 'QuotaExceeded');
  // Without onError it is swallowed.
  const quiet = storePersist(fakeStore({ quota: true }));
  await quiet.save(data({ r1: room('r1', 'A') }));
  // And the store keeps working; the error reaches the Persist's onError.
  const store = createStore('w', p);
  await store.ready;
  store.create({ name: 'B', area: '', x: 1, y: 1, z: 0, exits: {} });
  await store.flush();
  assert.equal(errors.length, 2);
  assert.equal(store.rooms().length, 1);
  store.dispose();
});

test('works end to end through a MapStore', async () => {
  const sdk = fakeStore();
  const store = createStore('w', storePersist(sdk));
  await store.ready;
  store.create({ name: 'A', area: '', x: 0, y: 0, z: 0, exits: { n: { key: 'n', to: null } } });
  store.create({ name: 'B', area: '', x: 0, y: -1, z: 0, exits: { s: { key: 's', to: null } } });
  store.setArea({ id: 'z', name: 'Zone' });
  await store.flush();
  assert.equal(sdk.collection('rooms').list().length, 2);
  sdk.log.length = 0;
  store.autoConnect();
  await store.flush();
  assert.deepEqual(sdk.log, [['put', 'rooms', 'r1'], ['put', 'rooms', 'r2']], 'the two linked rooms, not areas or meta');
  store.dispose();
  const again = createStore('w', storePersist(sdk));
  await again.ready;
  assert.equal(again.room('r1').exits.n.to, 'r2');
  assert.equal(again.area('z').name, 'Zone');
  assert.equal(again.create({ name: 'C', area: '', x: 5, y: 5, z: 0, exits: {} }).id, 'r3');
  again.dispose();
});

test('memoryPersist round trips and counts saves', async () => {
  const p = memoryPersist();
  assert.equal(await p.load(), null);
  await p.save(data({ r1: room('r1', 'A') }));
  assert.equal(p.saves, 1);
  const loaded = await p.load();
  assert.deepEqual(loaded, p.data);
  assert.notEqual(loaded, p.data, 'a copy');
});
