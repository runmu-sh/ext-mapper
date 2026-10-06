# Mapper: module map and rules for everyone working in this package

Repository: `~/work/ext-mapper` (will become `runmu-sh/ext-mapper`, npm `@runmu.sh/ext-mapper`, id `mapper`).
SDK: `@muclient/sdk` 1.14 (local file link; types in `node_modules/@muclient/sdk/index.ts`). Headless host for tests:
`node_modules/@runmu.sh/dev/test.mjs` (`createHost`). Build: `npm run build`; types: `npm run typecheck`; tests: `npm test`
(`node --test test/*.test.mjs`; tests import `src/*.ts` through the host's loader, or build with esbuild first).

**The contract is `src/types.ts`. Do not change it without telling the integrator; add, never rename.**

| Module | Owns | Imports |
|---|---|---|
| `src/dirs.ts` | `parseDir`, `opposite`, `DIRS`, `isDirKey`, `shortOf` | types only |
| `src/store.ts` | `createStore(worldId, persist)` → `MapStore`: data, indexes (vnum, handle, sig, cell), path (Dijkstra), undo/redo, batch, import/export, `freeNear/freeAlong`, `autoConnect`, `merge`, `component` | dirs, types |
| `src/persist.ts` | save/load a `MapData` in `mu.storage.world(worldId)` (device tier; chunked under a 2 MB quota: rooms in a `collection('rooms')`, areas + meta under keys) | SDK Store type |
| `src/tracker.ts` | `createTracker(stores, opts)` → `Tracker`: identity (vnum → fingerprint → signature+dead reckoning), placement, linking, pending moves, pause, anchor, events | store, dirs, types |
| `src/walker.ts` | `createWalker(tracker, send)` → `Walker`: step/burst walking, timeouts, failure stops, events | tracker, types |
| `src/sources/gmcp.ts` | `Room.Info` (+ `exits` object/list/string, `coords`, `environment`), MSDP `ROOM_*` → `tracker.scene` | SDK, types |
| `src/sources/scene.ts` | `mu.scene.watch` fallback (any game whose room reaches the host's scene model) → `tracker.scene`, lowest priority | SDK, types |
| `src/sources/text.ts` | an `observe` line stage + an `observe` input stage: move confirmations, failures, exits lines, through the active `GameProfile` | SDK, profiles, types |
| `src/profiles/generic.ts`, `src/profiles/underspire.ts` | `GameProfile`s | types |
| `src/panel/*` | the dock panel: `render.ts` (canvas), `inspector.ts`, `menus.ts`, `areas.ts` (Areas dialog, area picker), `keys.ts`, `index.ts` (`mountPanel`) | SDK, store, tracker, walker, types |
| `src/lua/bridge.ts`, `src/lua/mapper.lua.ts` | `mapper.call` / `mapper.reply` over `mu.lua.on/emit`, and the Lua helper library text players paste into a startup script | SDK, store, tracker, walker, types |
| `src/index.ts` | wiring: settings, panel registration, commands, context kinds, exported API | everything |

Rules (from the muclient skills; they apply to extensions):
- Clean room. `reference/` is for behaviour only. No copied code or CSS.
- Colour only from theme tokens (`mu.theme.cssVar('--gold')` or CSS `var(--gold)`), glyphs from the host set; room colours are the
  named `RoomColor`s mapped to tokens. Use `mu.ui.css` classes for buttons/inputs/section heads; `mu.ui.style(css)` for the panel
  stylesheet, every rule under `.ext-panel[data-ext="mapper"]`.
- Everything registered through `mu` returns a Dispose; push into `ctx.subscriptions` or return it.
- State is per world (the map) and per session (the track). The store's persistence is `mu.storage.world(worldId)` on this device
  (maps can be large; export/import JSON moves them). A later version may offer `{ sync: true }` opt-in.
- Capabilities: `read-output` (lines), `send-commands` (walking, exit buttons). Nothing else.
- Never name Underspire in `src/index.ts` beyond selecting a profile by host.
- Tests: `node:test`, headless host (`createHost({ root })`), plus pure-function tests importing modules directly. Keep each test
  file under 400 lines; `npm test` must pass.
- TypeScript strict, `noUnusedLocals`. Keep files under ~600 lines; split instead.
