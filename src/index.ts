/**
 * Mapper: an automapper for every MUD.
 *
 * Wiring only; the parts live in their modules:
 *  - `store.ts` / `persist.ts`: one map per world, in `mu.storage.world(worldId)` (device tier).
 *  - `tracker.ts`: where each session is, fed by the sources (`sources/gmcp`, `sources/scene`, `sources/text`) and
 *    by other extensions or Lua (`api.scene`), with a game profile (`profiles/`) picked by the world's host.
 *  - `walker.ts`: walks a session along a path through `mu.sessions.send`.
 *  - `panel/`: the dock panel (canvas, inspector, menus); `show: 'always'` so it is in the Views menu as soon as the extension is enabled; it adds itself to the dock when a room is first known.
 *  - `lua/bridge.ts`: `mapper.call` / `mapper.reply` / `mapper.event` for the backend Lua, plus the pasteable library.
 *
 * Everything registered through `mu` is disposed on deactivate; the stores and the tracker are in `ctx.subscriptions`.
 */
import { defineExtension, type Dispose, type Mu, type SessionRef } from '@muclient/sdk';
import type { GameProfile, MapRoom, MapStore, MapperApi, MapperEvent, SceneInput, WalkOptions, WalkState } from './types';
import { createStore, type MapStoreImpl } from './store';
import { storePersist } from './persist';
import { createTracker, type TrackerImpl } from './tracker';
import { createWalker } from './walker';
import { gmcpSource } from './sources/gmcp';
import { sceneSource } from './sources/scene';
import { textSource } from './sources/text';
import { profileFor } from './profiles';
import { mountPanel } from './panel';
import { luaBridge } from './lua/bridge';
import { MAPPER_LUA } from './lua/library';
import { copyLuaLibrary, COPY_LUA_LABEL } from './lua/copy';
import { readMapFile } from './import';

const ID = 'mapper';

const COPY = {
  title: 'Mapper',
  open: 'Mapper: open the map',
  focus: 'Go to map',
  copyLua: `Mapper: ${COPY_LUA_LABEL.toLowerCase()}`,
  pause: 'Mapper: pause or resume mapping',
  stop: 'Mapper: stop walking',
  paused: 'Mapping paused', resumed: 'Mapping resumed',
  saveFailed: 'Map not saved', saveFailedBody: 'The map store is full or unavailable. Export the map from the panel menu.',
  mapLoaded: (n: number) => `Map loaded: ${n} rooms`, mapLoadFailed: 'Could not load the map file',
  settings: {
    autoConnect: 'Connect new rooms to matching neighbours',
    autoConnectHint: 'a new room links to the room next to it when their exits face each other',
    areasFromGame: 'Group rooms by the area the game names',
    areasFromGameHint: 'off: every room goes in one area',
    keepDesc: 'Keep room descriptions in the map',
    keepDescHint: 'descriptions make rooms easier to tell apart in games without room ids, and make the map larger',
    fromText: 'Read moves and exits from the game text',
    fromTextHint: 'confirmations such as “You begin walking north.” and exit lines; off: only GMCP/MSDP/Lua',
    walkMode: 'Walk', walkStep: 'step by step (wait for each room)', walkBurst: 'all at once',
    walkDelay: 'Pause between commands when walking all at once',
    walkTimeout: 'Give up a step after',
  },
} as const;

/** Hosts of the player's worlds are not in the SDK; a world's host is read from the world name when it looks like one, else from the session's links. */
function hostOf(mu: Mu, s: SessionRef | undefined): string | undefined {
  if (!s) return undefined;
  const name = s.worldName.trim();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(name)) return name;
  const home = mu.sessions.meta(s.id)?.links.home;
  if (home) { try { return new URL(home).hostname; } catch { /* not a URL */ } }
  return undefined;
}

export default defineExtension({
  async activate(ctx) {
    const mu: Mu = ctx.mu;

    mu.settings.define({
      title: COPY.title,
      tile: { glyph: '⌖', order: 1620 },
      items: [
        { key: 'autoConnect', label: COPY.settings.autoConnect, default: true, kind: 'toggle', scope: 'both', group: 'Mapping', hint: COPY.settings.autoConnectHint },
        { key: 'areasFromGame', label: COPY.settings.areasFromGame, default: true, kind: 'toggle', scope: 'both', group: 'Mapping', hint: COPY.settings.areasFromGameHint },
        { key: 'keepDesc', label: COPY.settings.keepDesc, default: true, kind: 'toggle', scope: 'both', group: 'Mapping', hint: COPY.settings.keepDescHint },
        { key: 'fromText', label: COPY.settings.fromText, default: true, kind: 'toggle', scope: 'both', group: 'Mapping', hint: COPY.settings.fromTextHint },
        { key: 'walk.mode', label: COPY.settings.walkMode, default: 'step', kind: 'select', scope: 'both', group: 'Walking',
          options: [{ value: 'step', label: COPY.settings.walkStep }, { value: 'burst', label: COPY.settings.walkBurst }] },
        { key: 'walk.delayMs', label: COPY.settings.walkDelay, default: 150, kind: 'range', min: 0, max: 2000, step: 50, unit: 'ms', scope: 'both', group: 'Walking', when: { key: 'walk.mode', equals: 'burst' } },
        { key: 'walk.timeoutS', label: COPY.settings.walkTimeout, default: 10, kind: 'range', min: 2, max: 60, step: 1, unit: 's', scope: 'both', group: 'Walking' },
        { key: 'keys.focus', kind: 'shortcut', command: 'focus.mapper', group: 'Keys' },
      ],
    });
    const setting = <T,>(key: string, worldId: string | null): T => mu.settings.get<T>(key, worldId === null ? undefined : { worldId });

    /* ── stores: one per world, created on first use ── */
    const stores = new Map<string, MapStoreImpl>();
    const storeFor = (worldId: string): MapStoreImpl | null => {
      if (!worldId) return null;
      let s = stores.get(worldId);
      if (!s) {
        const persist = storePersist(mu.storage.world(worldId));
        persist.onError = (e) => { mu.log.warn('mapper', 'save failed', e); mu.ui.toast(COPY.saveFailed, COPY.saveFailedBody, { kind: ID, group: 'mapper-save' }); };
        s = createStore(worldId, persist);
        stores.set(worldId, s);
      }
      return s;
    };
    ctx.subscriptions.push(() => { for (const s of stores.values()) s.dispose(); stores.clear(); });

    /* ── sessions → worlds → profiles ── */
    const sessionOf = (sid: string): SessionRef | undefined => mu.sessions.list().find((s) => s.id === sid);
    const worldOf = (sid: string): string | null => sessionOf(sid)?.worldId ?? null;
    const registered: GameProfile[] = [];
    const profileOfWorld = (worldId: string | null): GameProfile => {
      const s = worldId ? mu.sessions.list().find((x) => x.worldId === worldId) : undefined;
      return profileFor(hostOf(mu, s), registered);
    };
    const profileOf = (sid: string): GameProfile => profileFor(hostOf(mu, sessionOf(sid)), registered);

    /* ── tracker + walker ── */
    const tracker: TrackerImpl = createTracker({
      storeFor, worldOf,
      settings: { get: setting },
      moveVerbs: (worldId) => profileOfWorld(worldId).moveVerbs,
    });
    const walker = createWalker({
      tracker, storeFor, worldOf,
      send: (sid, text) => mu.sessions.send(text, { sid, echo: true }),
    });
    ctx.subscriptions.push(() => { for (const t of tracker.tracks()) walker.stop(t.sid); });
    mu.sessions.on('close', (s) => { walker.stop(s.id); tracker.drop(s.id); });

    /* ── sources ── */
    gmcpSource(mu, tracker, worldOf);
    sceneSource(mu, tracker);
    const textOn = (sid: string): boolean => mu.settings.get<boolean>('fromText', { sid }) !== false;
    textSource(mu, { ...tracker,
      // The text source is gated per world by the `fromText` setting; the tracker itself always accepts.
      scene: (input: SceneInput) => { if (textOn(input.sid)) tracker.scene(input); },
      moved: (sid, key, o) => { if (textOn(sid)) tracker.moved(sid, key, o); },
      failed: (sid, text, key) => { if (textOn(sid)) tracker.failed(sid, text, key); },
    }, profileOf);

    /* ── panel ── */
    const panelSettings = (worldId: string) => ({
      get: <T,>(key: string): T => mu.settings.get<T>(key, { worldId }),
      watch: (key: string, fn: () => void): Dispose => mu.settings.watch(key, () => fn(), { worldId }),
    });
    const mounted = new Map<HTMLElement, ReturnType<typeof mountPanel>>();
    mu.panels.register({
      id: ID, title: COPY.title, defaultPosition: 'right-bottom', order: 40, show: 'always',
      mount: (el, pctx) => {
        const m = mountPanel({ mu, store: storeFor, tracker, walker, settings: panelSettings(pctx.worldId ?? '') }, el, pctx);
        mounted.set(el, m);
        return () => { m.unmount(); mounted.delete(el); };
      },
      snapshot: (el) => mounted.get(el)?.snapshot(),
      restore: (el, saved) => mounted.get(el)?.restore(saved),
    });
    // The first known room in a session adds the panel to the dock (one touch per session is enough).
    const touched = new Set<string>();
    tracker.on((e) => { if ((e.type === 'enter' || e.type === 'created') && !touched.has(e.sid)) { touched.add(e.sid); mu.panels.touch(ID, e.sid); } });
    mu.sessions.on('close', (s) => touched.delete(s.id));

    /* ── commands ── */
    mu.commands.register({ id: `${ID}.open`, title: COPY.open, group: 'Map', when: 'session', run: () => mu.panels.open(ID) });
    mu.commands.register({ id: 'focus.mapper', title: COPY.focus, keys: ['Alt+M'], group: 'Focus', when: 'session', run: () => { if (!mu.panels.focus(ID)) mu.panels.open(ID, undefined, { focus: true }); } });
    mu.commands.register({ id: `${ID}.copyLua`, title: COPY.copyLua, group: 'Map', run: () => void copyLuaLibrary(mu) });
    mu.commands.register({ id: `${ID}.pause`, title: COPY.pause, group: 'Map', when: 'session', run: () => {
      const sid = mu.sessions.active()?.id; if (!sid) return;
      const paused = !tracker.track(sid)?.paused;
      tracker.pause(sid, paused);
      mu.ui.toast(paused ? COPY.paused : COPY.resumed, undefined, { kind: ID, timeoutMs: 1500 });
    } });
    mu.commands.register({ id: `${ID}.stop`, title: COPY.stop, group: 'Map', when: (sid) => !!sid && walker.state(sid).status === 'walking', run: () => {
      const sid = mu.sessions.active()?.id; if (sid) walker.stop(sid);
    } });

    /* ── Lua ── */
    luaBridge({ mu, storeFor, worldOf, tracker, walker, version: ctx.version });

    /* ── API ── */
    const activeWorld = (): string => mu.sessions.active()?.worldId ?? '';
    const activeSid = (): string | null => mu.sessions.active()?.id ?? null;
    const api: MapperApi = {
      version: ctx.version,
      store: (worldId?: string): MapStore | null => storeFor(worldId ?? activeWorld()),
      tracker, walker,
      scene: (input) => tracker.scene(input),
      here: (sid?: string): MapRoom | null => {
        const id = sid ?? activeSid(); if (!id) return null;
        const t = tracker.track(id); const w = worldOf(id);
        return t?.position.roomId && w ? storeFor(w)?.room(t.position.roomId) ?? null : null;
      },
      goto: (roomId: string, sid?: string, opts?: WalkOptions): Promise<WalkState> => {
        const id = sid ?? activeSid();
        if (!id) return Promise.resolve({ status: 'failed', target: roomId, route: [], at: 0, reason: 'no session' });
        const w = worldOf(id);
        return walker.goto(id, roomId, {
          mode: setting<'step' | 'burst'>('walk.mode', w), delayMs: setting<number>('walk.delayMs', w), timeoutS: setting<number>('walk.timeoutS', w), ...opts,
        });
      },
      on: (fn: (e: MapperEvent) => void): Dispose => tracker.on(fn),
      loadMapFile: async (url: string, sid: string): Promise<void> => {
        const w = worldOf(sid); const store = w ? storeFor(w) : null;
        if (!store) return;
        try {
          const res = await mu.net.fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = readMapFile(await res.json());
          if (store.rooms().length && !(await mu.ui.confirm({ title: 'Replace the map?', body: `The game offers a map file (${url}). Importing replaces the ${store.rooms().length} rooms of this world's map.`, confirm: 'Replace', danger: true }))) return;
          const { rooms } = store.import(data);
          mu.ui.toast(COPY.mapLoaded(rooms), undefined, { kind: ID });
        } catch (e) {
          mu.log.warn('mapper', 'loadMapFile', e);
          mu.ui.toast(COPY.mapLoadFailed, e instanceof Error ? e.message : String(e), { kind: ID });
        }
      },
      profile: (p: GameProfile): Dispose => { registered.push(p); return () => { const i = registered.indexOf(p); if (i >= 0) registered.splice(i, 1); }; },
      luaLibrary: () => MAPPER_LUA,
    };

    mu.log.info(COPY.title, ctx.version, 'active');
    return api;
  },
});
