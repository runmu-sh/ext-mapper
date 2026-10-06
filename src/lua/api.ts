/**
 * The one table of Lua-facing functions. `bridge.ts` dispatches from it (and refuses to start when an entry
 * has no implementation), `library.ts` generates the `mapper.<fn>` wrappers from it, and `help()` lists it, so
 * the three can never drift. Pure data; imports nothing.
 */

export interface LuaFnSpec {
  /** The wire name (`fn` in `mapper.call`) and the Lua method name. */
  fn: string;
  /** The Lua signature, without the optional trailing callback. */
  sig: string;
  /** What it returns and does, one line. */
  doc: string;
  /** Allowed inside `batch` (synchronous, store-level). Default true. */
  batchable?: boolean;
}

export const LUA_API: readonly LuaFnSpec[] = [
  /* reads */
  { fn: 'version', sig: 'version()', doc: 'the Mapper version string', },
  { fn: 'here', sig: 'here()', doc: 'the room you are in, or nil' },
  { fn: 'room', sig: 'room(id)', doc: 'one room by id, or nil' },
  { fn: 'rooms', sig: 'rooms({ name?, area?, tag?, vnum?, near? = { id, radius }, limit? })', doc: 'the rooms matching every given filter (name is a substring)' },
  { fn: 'byVnum', sig: 'byVnum(vnum)', doc: "the room with the game's room number, or nil" },
  { fn: 'at', sig: 'at(area, x, y, z)', doc: 'the room at a cell, or nil' },
  { fn: 'areas', sig: 'areas()', doc: 'every area as { id, name, note, color, rooms }, the default area ("") included when it has rooms' },
  { fn: 'area', sig: 'area(id)', doc: 'one area as { id, name, note, color, rooms }, or nil' },
  { fn: 'areaLinks', sig: 'areaLinks(id, { both? })', doc: 'exits leading out of an area as { from, key, to, toArea }; with both, those leading in too' },
  { fn: 'path', sig: 'path(from?, to, { locked?, avoid? })', doc: 'cheapest route as { ids, steps, cost }, or nil; from defaults to here' },
  { fn: 'incoming', sig: 'incoming(id)', doc: 'rooms whose exits lead to id, as { room, key }' },
  /* writes */
  { fn: 'add', sig: 'add({ name, vnum?, area?, x?, y?, z?, desc?, env?, tags?, note?, symbol?, color?, exits? = { key = toId | true } })', doc: 'create a room (cell defaults to a free one near here) and return it' },
  { fn: 'set', sig: 'set(id, { name?, vnum?, area?, x?, y?, z?, desc?, env?, tags?, note?, symbol?, color?, weight?, locked?, warn? })', doc: 'change fields of a room and return it' },
  { fn: 'remove', sig: 'remove(id)', doc: 'delete a room (exits into it become unexplored)' },
  { fn: 'merge', sig: 'merge(fromId, intoId)', doc: 'fold one room into another' },
  { fn: 'move', sig: 'move(id | ids, dx, dy, dz?)', doc: 'shift rooms on the grid; false when a target cell is taken' },
  { fn: 'exit', sig: 'exit(id, key, { to?, name?, commands?, cost?, door?, oneway?, dir?, blocked? })', doc: 'create or update an exit; to = false unlinks it' },
  { fn: 'removeExit', sig: 'removeExit(id, key)', doc: 'delete an exit' },
  { fn: 'link', sig: 'link(id, key, toId, { back? = true })', doc: 'point an exit at a room, and the facing exit back' },
  { fn: 'unlink', sig: 'unlink(id, key)', doc: 'make an exit unexplored again' },
  { fn: 'addArea', sig: 'addArea(name, { note?, color? })', doc: 'create an area (id made from the name) and return it' },
  { fn: 'setArea', sig: 'setArea(id, { name?, note?, color? })', doc: 'rename or annotate an area (created when new) and return it' },
  { fn: 'removeArea', sig: 'removeArea(id, { rooms? = "delete" | "move", to? })', doc: 'delete an area; its rooms move to the default area (or to) unless rooms = "delete"' },
  { fn: 'autoConnect', sig: 'autoConnect(area?)', doc: 'link facing exits of neighbouring rooms; returns how many' },
  { fn: 'tag', sig: 'tag(id, tag)', doc: 'add a tag to a room' },
  { fn: 'untag', sig: 'untag(id, tag)', doc: 'remove a tag from a room' },
  { fn: 'note', sig: 'note(id, text)', doc: "set a room's note" },
  { fn: 'lock', sig: 'lock(id, bool)', doc: 'pin a room so the tracker never moves or merges it' },
  /* tracking */
  { fn: 'scene', sig: 'scene({ name, vnum?, desc?, area?, env?, exits? = { key = toVnum | true } | { "n", "s" }, exitsComplete? })', doc: 'tell the tracker which room the game is showing (maps games nothing else parses)', batchable: false },
  { fn: 'moved', sig: 'moved(key)', doc: 'a movement command was sent or confirmed', batchable: false },
  { fn: 'failed', sig: 'failed(text, key?)', doc: 'the game refused the last move', batchable: false },
  { fn: 'anchor', sig: 'anchor(id)', doc: 'declare that you stand in this room', batchable: false },
  { fn: 'pause', sig: 'pause(bool)', doc: 'pause or resume mapping (rooms are still recognised)', batchable: false },
  { fn: 'track', sig: 'track()', doc: 'this session as { roomId, by, pending, paused, source, dropped }', batchable: false },
  /* walking */
  { fn: 'goto', sig: 'goto(id, { mode?, delayMs?, timeoutS?, locked? })', doc: 'walk to a room; the callback fires when the walk ends with its final state (Lua: mapper.go)', batchable: false },
  { fn: 'walk', sig: 'walk(steps)', doc: 'send a list of exit keys or commands as a walk', batchable: false },
  { fn: 'stop', sig: 'stop()', doc: 'stop the walk', batchable: false },
  { fn: 'walkPause', sig: 'walkPause(bool)', doc: 'pause or resume the walk', batchable: false },
  { fn: 'walking', sig: 'walking()', doc: 'the walk state { status, target, route, at, reason? }', batchable: false },
  /* history, io */
  { fn: 'batch', sig: 'batch(label, { { fn = "add", args = { ... } }, ... })', doc: 'run several calls as one undo step; returns one { ok, result | error } per call', batchable: false },
  { fn: 'undo', sig: 'undo()', doc: 'undo the last change; returns its label or nil', batchable: false },
  { fn: 'redo', sig: 'redo()', doc: 'redo; returns its label or nil', batchable: false },
  { fn: 'export', sig: 'export()', doc: 'the whole map (errors above 60 KB: use the panel)', batchable: false },
  { fn: 'import', sig: 'import(data)', doc: 'replace the whole map; returns { rooms }', batchable: false },
  { fn: 'erase', sig: 'erase("yes")', doc: 'erase the whole map of this world', batchable: false },
  /* bridge */
  { fn: 'events', sig: 'events(bool)', doc: 'turn mapper.event delivery on or off for this session (mapper.on does this for you)', batchable: false },
  { fn: 'help', sig: 'help()', doc: 'this list', batchable: false },
];

export const LUA_FN_NAMES: readonly string[] = LUA_API.map((f) => f.fn);

/** One line per function, as `help()` returns them: `here() — the room you are in, or nil`. */
export function luaHelp(): string[] {
  return LUA_API.map((f) => `${f.sig} — ${f.doc}`);
}
