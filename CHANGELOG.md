# Changelog

## 0.1.2

- Directions: nautical forms are compass directions (`fore`/`forward`/`bow` → north, `aft`/`astern`/`stern` →
  south, `starboard` → east, `port`/`portside`/`larboard` → west, also fused: `fore starboard`, `up aft`, `uaft`),
  and the compound short forms `use`, `dsw`, `une`, `dn`… are parsed. Marker glyphs in exits lines (`^ up`,
  `v down`, `→`) are ignored.
- `in`, `out`, `enter <x>`, `board`, `leave` and `exit` open a new area named after the room reached (the exit taken
  links the two areas) when the game names no area; setting `areaOnEnter` (on) turns this off. Ordinary moves
  without a game-named area stay in the previous room's area.
- Look: the toolbar now renders at the host's control size (the panel's `font: inherit` reset was overriding
  `.sh-cmd` in the `ext` layer); bar spacing, the area select, popover menus (`.mi` rows with key hints), the
  inspector, tag chips and the status bar follow the host's Terminal bar and context menu. Rooms are larger
  (0.36 of a cell per half, default scale 40) so neighbours sit close; names alternate above and below along a
  row and shrink when crowded. `docs/look.md` records the host findings and the recommendations not taken.

## 0.1.1

- The panel is listed in ☰ → Views as soon as the extension is enabled in a world (`show: 'always'`); before, it
  stayed hidden until the first room was mapped. The Show panel setting (on / auto / off) still applies.

## 0.1.0

First release.

- Tracking from GMCP `Room.Info`, MSDP `ROOM_*`, the host scene model and plain game text, with vnum →
  exit-fingerprint → name/description identity, dead reckoning from the moves you send, pending-move queues and
  refusal handling.
- Areas from the game (with a note and a colour each), the Areas dialog (list, create, rename, colour, delete
  with move-or-delete of the rooms, move the selection in, cross-area exits), area tint and gold cross-area
  stubs on the canvas, `Move to area…` in the room menu; floors, automatic placement next to the room you came from, auto-connect of facing exits.
- Canvas panel with walk and edit modes, follow, inspector (move, colour, symbol, tags, note, lock, merge,
  delete), room / empty-cell / ☰ menus, legend and controls popovers, undo/redo.
- Click-to-walk and `goto` with step and burst modes, timeouts and failure stops.
- Import of mu-map JSON, Underspire userscript maps and Mudlet JSON; export; erase.
- Game profiles: `generic` (Diku-style) and underspire.net; other extensions can register more.
- Lua API: 47 `mapper.*` functions over `ext.emit`/`ext.on` with callbacks, events (`enter`, `created`, `lost`,
  `failed`, `walk`), speedwalk parsing, and a `Copy Lua library` menu entry. Documented in `docs/lua.md`.
- Settings: autoConnect, areasFromGame, keepDesc, fromText, walk.mode, walk.delayMs, walk.timeoutS, keys.focus.
- Commands: `mapper.open`, `focus.mapper` (Alt+M), `mapper.copyLua`, `mapper.pause`, `mapper.stop`.
