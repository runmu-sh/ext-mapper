/**
 * Persistence of a `MapData` in an SDK `Store` (`mu.storage.world(worldId)`): rooms as items of
 * `collection('rooms')` keyed by room id, areas and meta under keys. `save` diffs against the last saved copy and
 * writes only the rooms that changed, so a large map does not rewrite everything on each change. A
 * `QuotaExceeded` (or any other write error) is reported through `onError` and never thrown.
 */
import type { Collection, Store } from '@muclient/sdk';
import type { Persist } from './store';
import type { MapArea, MapData, MapRoom } from './types';

const KEY_AREAS = 'areas';
const KEY_META = 'meta';
const COLLECTION = 'rooms';

interface Meta { nextId: number; v: 2 }

/** The subset of the SDK `Store` this module uses, so a test can hand in a small fake. */
export type PersistStore = Pick<Store, 'get' | 'set' | 'delete'> & { collection<T>(name: string): Pick<Collection<T>, 'put' | 'remove' | 'list'> } & { ready?: Promise<void> };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function storePersist(store: PersistStore): Persist {
  const col = store.collection<MapRoom>(COLLECTION);
  /** JSON of each room as last written, by id; areas and meta as last written. */
  let lastRooms = new Map<string, string>();
  let lastAreas: string | null = null;
  let lastMeta: string | null = null;

  const persist: Persist = {
    async load() {
      if (store.ready) await store.ready;
      const items = col.list();
      const meta = store.get<Meta | undefined>(KEY_META, undefined);
      const areasRaw = store.get<Record<string, MapArea> | undefined>(KEY_AREAS, undefined);
      if (!items.length && !meta && !areasRaw) return null;
      const rooms: Record<string, MapRoom> = {};
      lastRooms = new Map();
      for (const { id, value } of items) {
        if (!value || typeof value !== 'object') continue;
        const room: MapRoom = { ...value, id: value.id ?? id, exits: value.exits ?? {} };
        rooms[room.id] = room;
        lastRooms.set(room.id, JSON.stringify(room));
      }
      const areas = areasRaw && typeof areasRaw === 'object' ? areasRaw : {};
      lastAreas = JSON.stringify(areas);
      let nextId = typeof meta?.nextId === 'number' ? meta.nextId : 1;
      for (const id of Object.keys(rooms)) {
        const m = /^r(\d+)$/.exec(id);
        if (m && Number(m[1]) >= nextId) nextId = Number(m[1]) + 1;
      }
      lastMeta = JSON.stringify({ nextId, v: 2 });
      return { format: 'mu-map', v: 2, rooms, areas, nextId };
    },
    async save(data) {
      try {
        const seen = new Set<string>();
        for (const [id, room] of Object.entries(data.rooms)) {
          seen.add(id);
          const json = JSON.stringify(room);
          if (lastRooms.get(id) === json) continue;
          col.put(id, room);
          lastRooms.set(id, json);
        }
        for (const id of [...lastRooms.keys()]) {
          if (seen.has(id)) continue;
          col.remove(id);
          lastRooms.delete(id);
        }
        const areasJson = JSON.stringify(data.areas);
        if (areasJson !== lastAreas) { store.set(KEY_AREAS, data.areas); lastAreas = areasJson; }
        const meta: Meta = { nextId: data.nextId, v: 2 };
        if (!same(meta, lastMeta === null ? null : JSON.parse(lastMeta))) { store.set(KEY_META, meta); lastMeta = JSON.stringify(meta); }
      } catch (e) {
        if (persist.onError) persist.onError(e);
      }
    },
  };
  return persist;
}

/** An in-memory `Persist` for tests; `data` is what was last saved. */
export function memoryPersist(initial: MapData | null = null): Persist & { data: MapData | null; saves: number } {
  const p = {
    data: initial,
    saves: 0,
    async load() { return p.data ? (JSON.parse(JSON.stringify(p.data)) as MapData) : null; },
    async save(data: MapData) { p.saves++; p.data = JSON.parse(JSON.stringify(data)) as MapData; },
    onError: undefined as ((e: unknown) => void) | undefined,
  };
  return p;
}
