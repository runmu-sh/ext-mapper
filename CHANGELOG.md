# Changelog

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
