# Mapper

An automapper for every MUD. It follows you from GMCP `Room.Info`, MSDP `ROOM_*`, the host's scene model, or
the plain game text (room title, `[Exits: …]` lines, "You can't go that way"), draws the map in a dock panel,
walks you to any room you click, and gives your Lua triggers and aliases a full mapping API.

A [μClient](https://runmu.sh) extension: `@runmu.sh/ext-mapper`, id `mapper`, API `^1.14`.

## What it does

- **Tracks** where you are. Rooms are recognised by the game's room number when there is one, else by an exit
  fingerprint plus dead reckoning from the moves you sent, else by name and description. Unconfirmed moves are
  queued and resolved as the room text arrives; refusals ("The gate is closed.") drop the pending move.
- **Places and links** new rooms next to the room you came from, in the direction you went, and connects facing
  exits automatically (optional). Areas from the game become separate coordinate spaces; floors are `z`.
- **Areas** group rooms. The `Areas` dialog (toolbar button or `A`) lists them with room counts, creates, renames,
  colours, annotates and deletes them (moving the rooms out or deleting them), moves the selection in, and lists
  every exit into another area. Uncoloured rooms take their area's colour as a tint; exits that cross into another
  area are drawn in gold.
- **Draws** the current floor on a canvas: rooms, links, unexplored stubs, one-way and door marks, up/down
  triangles, the room you are in, your route while walking. Follow mode keeps you in view.
- **Walks**: click a room (walk mode) or `mapper.go` from Lua. Step mode sends one move and waits for the room
  to change; burst mode sends them all with a delay. A refusal or timeout stops the walk.
- **Edits**: edit mode selects, drags, nudges, merges, colours, tags, notes, locks and deletes rooms; right-click
  an empty cell to add a room there or move a mis-placed one. Undo/redo, 100 deep.
- **Imports and exports** its own JSON, the earlier Underspire userscript's maps, and Mudlet JSON exports.
- **Game profiles** decide how the game text is read. `generic` covers Diku/ROM/Circle-style output; a profile
  for underspire.net reads its "exits to the market (m)" lines and `Room.Name`. Other extensions can register
  profiles through the API.
- **Lua**: 47 functions behind one `mapper` table — see [docs/lua.md](docs/lua.md).

Everything is per world: one map per world, saved on this device under the extension's world storage
(IndexedDB), with debounced writes and a "Map not saved" toast when a write fails.

## Panel

Open it from ☰ → Views → Mapper, with Alt+M, or the command `Mapper: open the map`; it also adds itself to the
dock the first time a room is mapped in a session. Settings → Extensions → Mapper → "Show panel" (on / auto /
off) decides per world whether it is offered.

Toolbar: `Walk` / `Edit` mode · `−` `+` `Fit` `◎` (follow) · floor `▾ Z0 ▴` · area select · `Areas` · `Mapping` (pause
toggle) · `Details` (inspector) · `Undo` · `☰`.

Keys when the map has focus: arrows pan, `+`/`−` zoom, `F` fit, `C` centre on me, `W`/`E` mode, `N` names,
`A` areas, `PageUp`/`PageDown` floor (in edit mode with a selection: move the selection a floor), `Delete` removes the
selection, `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` undo/redo, `Esc` cancels a pick, `?` controls.

☰ menu: Centre on me · Fit floor · Pause mapping · Show names · Connect matching exits · Auto-connect new rooms
· Areas… · Legend · Controls · Export map… · Import map… · Copy Lua library · Erase whole map.

Commands (palette): `mapper.open`, `focus.mapper` (Alt+M), `mapper.copyLua`, `mapper.pause`, `mapper.stop`.

## Settings

| Key | Default | What |
|---|---|---|
| `autoConnect` | on | link facing exits of neighbouring rooms as they are created |
| `areasFromGame` | on | make an area per `Room.Info.area` (off: one area) |
| `keepDesc` | on | store room descriptions (bigger map, better matching without GMCP) |
| `fromText` | on | read room text and exits lines when the game has no GMCP/MSDP room data |
| `walk.mode` | step | `step` or `burst` |
| `walk.delayMs` | 150 | burst: pause between steps |
| `walk.timeoutS` | 10 | step: give up when the room does not change |
| `keys.focus` | Alt+M | focus the panel |

## API for other extensions

`ctx.api('mapper')` returns a `MapperApi` (see `src/types.ts`): `store(worldId)`, `tracker`, `walker`,
`profile(p)` to register a game profile, `loadMapFile(url, sid)` to install a map from a URL (asks before
replacing a non-empty map), and `luaLibrary()` for the Lua text.

## Layout

| Path | What |
|---|---|
| `src/index.ts` | wiring: settings, stores per world, tracker, walker, sources, panel, commands, Lua bridge, API |
| `src/types.ts` | the shared contract: `MapRoom`, `MapExit`, `MapStore`, `Tracker`, `Walker`, `GameProfile`, `MapperApi` |
| `src/store.ts`, `src/persist.ts`, `src/path.ts`, `src/dirs.ts`, `src/hash.ts` | map data, indexes, Dijkstra, undo, storage |
| `src/tracker.ts`, `src/walker.ts` | where you are, and walking there |
| `src/sources/{gmcp,scene,text}.ts` | the inputs that feed the tracker |
| `src/profiles/{generic,underspire}.ts` | how a game's text reads |
| `src/panel/*` | the dock panel: canvas, toolbar, inspector, menus, CSS (theme tokens only) |
| `src/lua/*` | the `mapper.call`/`mapper.reply` bridge, the Lua library text, the API table that `help()` returns |
| `src/import.ts` | mu-map / userscript / Mudlet JSON readers |
| `docs/lua.md` | the Lua API, shipped with the package |
| `test/*.test.mjs` | `node --test`: pure modules, the panel under happy-dom, the Lua library under fengari, the whole extension under `@runmu.sh/dev/test` |
| `reference/` | local behaviour notes; not in the repository |

## Develop

```sh
npm install
npm run typecheck    # tsc --noEmit against the SDK types
npm test             # node --test test/*.test.mjs
npm run build        # dist/index.js + manifest check
npm run dev          # dev server on http://localhost:5199/ with hot reload
```

In μClient: **☰ → Extensions → Advanced → Developer → load from dev server** with `http://localhost:5199/`
(or open μClient with `?ext-dev=http://localhost:5199/`). Saving a file reloads the extension in place; the panel
keeps its view through `snapshot()`/`restore()`.

Conventions: clean room (no code or CSS from other mappers), colour only from theme tokens, `border-radius: 0`,
host glyphs, `mu.ui.css` primitives, every stylesheet rule under `.ext-panel[data-ext="mapper"]`, everything
registered through `mu` returns a Dispose. Coordinates: north is `-y`, east is `+x`, up is `+z` (Mudlet's
convention, so imports keep their floors).

## Publish

Bump `version` and `CHANGELOG.md`, then either link this repository on the
[marketplace](https://runmu.sh/marketplace/) and push a version tag, or upload the tarball:

```sh
npm run build && npm pack
curl -H "Authorization: Bearer $MKT_TOKEN" --data-binary @<file>.tgz https://market.runmu.sh/v1/publish
```

Versions are immutable. See <https://runmu.sh/docs/extensions/publish>.
