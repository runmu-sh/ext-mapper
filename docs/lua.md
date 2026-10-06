# Mapper from Lua

Your triggers, aliases and startup scripts run in μClient's backend Lua. The Mapper extension gives that Lua a
mapping API: read and edit the map, tell the tracker where you are, walk, and hear about rooms as you enter them.
It is one global table, `mapper`, that you paste into a startup script.

**Setup.** Mapper panel → ☰ → *Copy Lua library*, then Settings → Scripts → new startup script → paste. (Another
extension can get the same text with `ctx.api('mapper').luaLibrary()`.) Startup scripts run when a session starts;
the Lua state is per session, so each session has its own `mapper`.

```lua
mapper.here(function(ok, room)
  if ok and room then echo("You are in " .. room.name .. " (" .. room.id .. ")") end
end)
```

## How it works: the protocol

Lua has no timers, no coroutines that survive a call, and only one way to reach an extension: `ext.emit(name,
data)`. Every `mapper.*` call is therefore a message, and every answer is a callback:

| Direction | Message | Shape |
|---|---|---|
| Lua → Mapper | `ext.emit("mapper.call", …)` | `{ id = n?, fn = "name", args = { … } }` — `id` optional: without it the call is fire-and-forget |
| Mapper → Lua | `ext.on("mapper.reply", …)` | `{ id, ok = true, result = … }` or `{ id, ok = false, error = "mapper.<fn>: what" }` — only when `id` was given |
| Mapper → Lua | `ext.on("mapper.event", …)` | `{ type = "enter" | "created" | "lost" | "failed" | "walk", … }` — only after `events(true)` |

The library hides this: `mapper.<fn>(args..., cb?)`. The **last argument may be a callback `cb(ok, resultOrError)`**;
leave it off and the call is fire-and-forget. Nothing blocks: the callback runs later, when the reply arrives.

```lua
mapper.room("r12", function(ok, r) if ok then display(r) else printError(r) end end)
mapper.tag("r12", "shop")   -- no callback: sent and forgotten
```

**Values.** Rooms arrive as tables (below). An **unexplored exit is `false`, not `nil`** — a JSON `null` would
delete the key from the Lua table and you could no longer see the exit exists. Things that are genuinely absent
(`here()` with no position, `path()` with no route, `undo()` with nothing to undo, `prev` on the first `enter`)
are `nil`.

```lua
room = {
  id = "r12", vnum = "3001", name = "Market Square", area = "town", x = 2, y = -1, z = 0,
  exits = { n = "r13", e = "r20", ["enter portal"] = false },  -- false: unexplored
  tags = { "shop" }, note = "", symbol = "$", color = "gold", env = "city", locked = false,
  desc = "..."  -- only when the map keeps descriptions
}
```

**Limits** (inherited from `ext.emit`): each message is at most 64 KB (so `export()` refuses maps above 60 KB and
`rooms{}` should be given a `limit` on big maps); at most 200 `ext.emit` calls per second per session (the
library tells your callback `dropped (rate limit)` when one is lost); payloads are data only — no functions.
Mapper sends at most 50 `mapper.event` per second per session and counts the rest in `track().dropped`.

## Functions

Every function below is `mapper.<name>(args..., cb?)`. `mapper.help(cb)` returns this list from the running
extension, so it is always the right version.

### Reading the map

| Call | Result |
|---|---|
| `version()` | the Mapper version string |
| `here()` | the room you are in, or `nil` |
| `room(id)` | one room, or `nil` |
| `rooms({ name?, area?, tag?, vnum?, near? = { id, radius }, limit? })` | rooms matching every given filter; `name` is a case-insensitive substring, `near` is a Chebyshev radius on the same floor |
| `byVnum(vnum)` | the room with the game's room number (string or number), or `nil` |
| `at(area, x, y, z)` | the room at a cell, or `nil` |
| `areas()` | `{ { id, name, note, color, rooms }, … }`: every area, the default area (`id = ""`) included when it holds rooms |
| `area(id)` | one area as `{ id, name, note, color, rooms }`, or `nil` |
| `areaLinks(id, { both? })` | exits that lead out of the area, as `{ from, key, to, fromArea, toArea }` (room ids); with `both = true` those leading in as well |
| `path(from?, to, { locked?, avoid? })` | `{ ids = {...}, steps = {...}, cost = n }` or `nil`. `from` defaults to here. `steps` is the flat command list (special exits expand to their `commands`). `locked = true` routes through locked doors; `avoid` is a list of room ids |
| `incoming(id)` | `{ { room, key }, … }`: rooms with an exit into `id` |

```lua
mapper.rooms({ tag = "shop", near = { id = "r12", radius = 6 } }, function(ok, list)
  for _, r in ipairs(list) do echo(r.name) end
end)
```

### Editing the map

| Call | Does |
|---|---|
| `add({ name, vnum?, area?, x?, y?, z?, desc?, env?, tags?, note?, symbol?, color?, exits? })` | creates a room and returns it. Without `x`/`y` it takes a free cell next to where you are (or 0,0,0). `exits = { n = "r13", s = true }`: an id links, `true` makes an unexplored stub |
| `set(id, patch)` | changes fields (any of the above plus `weight`, `locked`, `warn`; never `id` or `exits`) and returns the room. `color` must be one of `""`, `accent`, `gold`, `ok`, `alert`, `dim`, `sky`, `moss`, `plum`, `rust`; `symbol` at most 2 characters; `tags` a list of strings. Clear a text field with `""`, tags with `{}` |
| `remove(id)` | deletes a room; exits into it become unexplored |
| `merge(fromId, intoId)` | folds one room into another (exits, incoming links, note, tags) |
| `move(id | { ids }, dx, dy, dz?)` | shifts rooms; `false` (and nothing moves) when a target cell is taken |
| `exit(id, key, { to?, name?, commands?, cost?, door?, oneway?, dir?, blocked? })` | creates or updates the exit `key` and returns the room. `to = "r13"` links, `to = false` unlinks. `commands = { "open door", "north" }` makes a special exit; `dir = "up"` says where to draw a non-direction key; `door` is `""`, `"open"`, `"closed"` or `"locked"` |
| `removeExit(id, key)` | deletes an exit |
| `link(id, key, toId, { back? = true })` | points an exit at a room and, with `back`, the facing exit of the destination back at you |
| `unlink(id, key)` | makes an exit unexplored again |
| `autoConnect(area?)` | links facing exits of neighbouring rooms; returns how many it linked |
| `tag(id, tag)` / `untag(id, tag)` | add or remove a tag; returns the room |
| `note(id, text)` | sets the note; returns the room |
| `lock(id, bool)` | pins the room so the tracker never moves, merges or relabels it |

### Areas

An area is a named group of rooms with its own coordinate space. Rooms name their area (`room.area`); the
default area has the id `""` and cannot be edited or deleted.

| Call | Does |
|---|---|
| `addArea(name, { note?, color? })` | creates an area (the id is a slug of the name: `"Temple District"` → `temple-district`) and returns it |
| `setArea(id, { name?, note?, color? })` | changes fields and returns the area; `color` is a room colour name, uncoloured rooms in the area take it as a tint |
| `removeArea(id, { rooms? = "delete" \| "move", to? })` | deletes an area; `rooms = "move"` (the default) moves its rooms to `to` (default: the default area) on free cells, `"delete"` removes them too |

```lua
mapper.addArea("Sewers", { note = "wet", color = "moss" }, function(ok, a)
  if ok then mapper.set("r12", { area = a.id }) end
end)
mapper.areaLinks("midgaard", function(ok, links)
  for _, l in ipairs(links) do echo(l.from .. " -" .. l.key .. "-> " .. l.to .. " [" .. l.toArea .. "]") end
end)
```

Exits are keyed by the command that takes them: `n`, `north`, `enter portal` are all just keys. There is no
"special exit" table — an exit with `commands` is a special exit.

```lua
mapper.add({ name = "Hidden Vault", exits = { ["enter crack"] = true } }, function(ok, vault)
  if not ok then return printError(vault) end
  mapper.exit("r12", "enter crack", { to = vault.id, commands = { "push stone", "enter crack" }, dir = "down" })
end)
```

### Telling the tracker where you are

| Call | Does |
|---|---|
| `scene({ name, vnum?, desc?, area?, env?, exits?, exitsComplete?, coords? })` | reports the room the game is showing, as a GMCP source would. `exits` is `{ n = true, s = "3002" }` (a vnum links the exit) or a plain list `{ "n", "s" }`. `exitsComplete = true` when that is every exit. Returns `track()` |
| `moved(key)` | a movement command was sent or confirmed (`"n"`, `"enter portal"`) |
| `failed(text, key?)` | the game refused the last move (`"The door is locked."`) |
| `anchor(id)` | declares that you stand in this room; the last scene's exits attach to it |
| `pause(bool)` | pauses mapping: known rooms are still recognised, nothing is created or linked |
| `track()` | `{ roomId, by, pending, paused, source, dropped }` — `by` is how the room was recognised (`vnum`, `fingerprint`, `signature`, `anchor`, `created`, `none`), `pending` the moves not yet confirmed, `dropped` how many events the 50/s cap dropped |

The tracker takes the best source it has seen (`gmcp > msdp > lua > text > scene`), so a Lua `scene` from a
trigger is used when the game has no GMCP and ignored when GMCP is already describing rooms.

### Walking

| Call | Does |
|---|---|
| `goto(id, { mode?, delayMs?, timeoutS?, locked? })` — in Lua **`mapper.go`** (`goto` is a keyword; `mapper["goto"]` also works) | walks to a room. The callback fires **when the walk ends** with the final state `{ status, target, route, at, reason? }` — `status` is `arrived`, `failed` or `stopped`. `mode = "step"` (default: one step, wait for the room to change) or `"burst"` (all steps, `delayMs` apart) |
| `walk({ "n", "n", "open door", "e" })` | sends a list of steps as a walk; the callback fires when it ends |
| `speedwalk("3n 2e u", cb)` | `walk` of the parsed string (below) |
| `stop()` | stops the walk; returns the walk state |
| `walkPause(bool)` | pauses or resumes the walk |
| `walking()` | the walk state now |

**Speedwalk syntax.** Segments are separated by `;`. A segment made only of direction tokens expands: `3n 2e u`,
Mudlet's compact `3n2eu`, `n n e`, `2east`, `NE`. Any other segment is sent as one literal command: `open door
north; 2n` is `open door north`, `n`, `n`. `mapper.parseSpeedwalk(str)` returns the step list without walking.

### History and the whole map

| Call | Does |
|---|---|
| `batch(label, { { fn = "add", args = { … } }, … })` | runs several calls as **one undo step**; returns one `{ ok, result | error }` per call. Only map edits and reads may be batched (not `goto`, `scene`, `export`…) |
| `undo()` / `redo()` | returns the label of the step undone or redone, or `nil` |
| `export()` | the whole map as a `mu-map` table; **errors above 60 KB** (`use the panel`) |
| `import(data)` | replaces the whole map with a `mu-map` (or recognised Mudlet JSON) table; returns `{ rooms = n }` |
| `erase("yes")` | erases the whole map of this world; the literal `"yes"` is required |

### Events

```lua
mapper.on("enter", function(e) … end)     -- e.room, e.prev (nil at first), e.via (exit key or nil), e.by
mapper.on("created", function(e) … end)   -- e.room, e.via
mapper.on("lost", function(e) … end)      -- e.name (the room the game showed and the map does not know)
mapper.on("failed", function(e) … end)    -- e.key (or nil), e.text
mapper.on("walk", function(e) … end)      -- e.status, e.target, e.at, e.total, e.reason
mapper.on("*", function(e) … end)         -- everything, with e.type
mapper.off(type, fn)                      -- remove a handler
```

The first `mapper.on` turns delivery on for this session (`events(true)`); sessions with no handlers cost nothing.
`events(bool)` is also callable directly.

### Helpers (pure Lua, no round trip)

`mapper.dirs` (`n = "north"`, …, `u = "up"`, `["in"] = "in"`), `mapper.opposite("ne")` → `"sw"` (long forms
too: `"north"` → `"south"`), `mapper.parseSpeedwalk(str)`.

## Coming from Mudlet

| Mudlet | Mapper |
|---|---|
| `addRoom()` + `setRoomName` + `setRoomCoordinates` + `setRoomArea` | `mapper.add{ name =, x =, y =, z =, area = }` (ids are allocated for you: `r12`) |
| `setExit(from, to, dir)` / `addSpecialExit(from, to, cmd)` | `mapper.exit(from, key, { to = })` — a special exit is an exit whose key is the command, optionally with `commands` |
| `setExitStub(id, dir, true)` | `mapper.exit(id, dir, {})` or `add{ exits = { n = true } }` (an unexplored exit) |
| `connectExitStub` | `mapper.link(id, key, to)` or `mapper.autoConnect()` |
| `getRoomExits(id)` / `getSpecialExits(id)` | `mapper.room(id, cb)` → `room.exits` (one table, `false` = unexplored) |
| `getPath(from, to)` + `speedWalkDir` | `mapper.path(from, to, cb)` → `{ ids, steps, cost }` |
| `gotoRoom(id)` | `mapper.go(id, {}, cb)` (the callback fires when you arrive or the walk fails) |
| `speedwalk("3n2e")` | `mapper.speedwalk("3n2e")` |
| `searchRoom(name)` | `mapper.rooms({ name = name }, cb)` |
| `getRoomsByPosition(area, x, y, z)` | `mapper.at(area, x, y, z, cb)` |
| `setRoomUserData(id, key, value)` / `getRoomUserData` | `mapper.tag`, `mapper.note`, `mapper.set(id, { … })` (typed fields: tags are a list, not a string) |
| `setRoomChar(id, "$")` | `mapper.set(id, { symbol = "$" })` |
| `setRoomEnv(id, n)` / `setRoomWeight` | `mapper.set(id, { env = "city", weight = 2 })` (env is a name, colour is a theme colour) |
| `lockRoom(id, true)` | `mapper.lock(id, true)` |
| `lockExit(from, dir, true)` | `mapper.exit(from, key, { blocked = true })` |
| `getRoomArea(id)` / `setRoomArea` | `room.area`; `mapper.set(id, { area = })` |
| `addAreaName`, `setAreaName`, `deleteArea`, `getAreaTable` | `mapper.addArea`, `mapper.setArea`, `mapper.removeArea`, `mapper.areas` |
| `getAreaExits(areaId)` | `mapper.areaLinks(id)` |
| `centerview(id)` | not in Lua — the view belongs to the panel (click a room, or *Centre on me*) |
| `createMapLabel`, `setMapZoom`, `openMapWidget` | not yet / not in Lua (UI is the panel's) |
| `sysMapAreaChanged`, `onMoveMap` | `mapper.on("enter" | "created" | "lost" | "failed" | "walk")` |
| `deleteRoom(id)` | `mapper.remove(id)` |
| `saveMap`, `loadMap` | the map saves itself; `mapper.export()` / `import()` (small maps) or the panel's Export/Import |
| `getCurrentRoom` / `centerview` as position | `mapper.here(cb)`; `mapper.anchor(id)` to set it |
| — | `mapper.batch(...)`, `mapper.undo()`, `mapper.redo()`: no Mudlet equivalent |

## Worked examples

### 1. Mapping a game with no GMCP from its text

A trigger on the room name line and one on the exits line. Many games print the name, a description and then
`Exits: north, south.`; the exits line closes the room, so that is where `scene` is sent.

```lua
-- Startup script: a buffer the two triggers share.
roomBuf = roomBuf or { name = nil, desc = {} }
```

```lua
-- Trigger "room name", regex: ^([A-Z][A-Za-z' ,-]{3,60})$    (a bare capitalised line: the room title)
roomBuf.name = matches[2]; roomBuf.desc = {}
```

```lua
-- Trigger "room exits", regex: ^(?:Exits|Obvious exits):\s*(.+?)\.?$
if not roomBuf.name then return end
local exits = {}
for word in matches[2]:gmatch("[^,%s]+") do
  if word ~= "and" then exits[#exits + 1] = word end     -- "north, south and east" → n/s/e
end
mapper.scene({ name = roomBuf.name, desc = table.concat(roomBuf.desc, " "), exits = exits, exitsComplete = true })
roomBuf.name = nil
```

```lua
-- Trigger "move refused", regex: ^(You can't go that way|Alas, you cannot go that way|The door is closed)
mapper.failed(matches[1])
```

Movement commands are seen by the Mapper's own input stage; for games with unusual move verbs add
`mapper.moved("board ferry")` in an alias.

### 2. An alias `goto <name>` that finds a room by name and walks there

```lua
-- Alias "goto", regex: ^goto (.+)$
local wanted = matches[2]
mapper.rooms({ name = wanted, limit = 2 }, function(ok, list)
  if not ok then return printError(list) end
  if #list == 0 then return echo("No room named " .. wanted) end
  if #list > 1 then echo("Several match; taking " .. list[1].name .. " (" .. list[1].id .. ")") end
  mapper.path(list[1].id, function(ok, p)
    if not ok or not p then return echo("No route to " .. list[1].name) end
    echo(("Walking %d steps: %s"):format(#p.steps, table.concat(p.steps, " ")))
    mapper.go(list[1].id, { mode = "step", timeoutS = 8 }, function(ok, w)
      if ok and w.status == "arrived" then echo("Arrived at " .. list[1].name)
      else echo("Walk " .. (ok and w.status or "error") .. (ok and w.reason and (": " .. w.reason) or "")) end
    end)
  end)
end)
```

### 3. Notes on arrival, and tagging shops as you find them

```lua
-- Startup script, after the library.
mapper.on("enter", function(e)
  if e.room.note ~= "" then echo("[map] " .. e.room.note) end
end)
mapper.on("created", function(e)
  local d = (e.room.desc or e.room.name):lower()
  if d:find("shop") or d:find("merchant") then
    mapper.tag(e.room.id, "shop")
    mapper.set(e.room.id, { symbol = "$", color = "gold" })
  end
end)
```

(`e.room.desc` is present only when the *keep descriptions* setting is on; the name is always there.)
