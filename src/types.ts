/**
 * The Mapper's contract: the map data, the tracker, the walker, the events and the exported API. Every module
 * in `src/` codes against these types and nothing else crosses module boundaries. Shipped in the package
 * (`types` in package.json) so other extensions can `ctx.api<MapperApi>('mapper')`.
 *
 * Design notes (how this differs from Mudlet's mapper API):
 *  - Rooms have our own ids (`r12`), never the game's: a game vnum is one *identity strategy* among three
 *    (`vnum`, exit `fingerprint`, text `signature` + dead reckoning), so games without room numbers map too.
 *  - Exits are keyed by the command that takes them; a special exit is just an exit with `commands`.
 *  - Areas are separate coordinate spaces, floors (`z`) sit inside an area.
 *  - Everything that changes the map goes through `MapStore` and is undoable and observable.
 */
import type { Dispose } from '@muclient/sdk';

/* ────────────────────────────── directions ────────────────────────────── */

/** The canonical direction names (compass, vertical, in/out, and the compound ones such as `up northwest`). */
export type DirName =
  | 'north' | 'south' | 'east' | 'west' | 'northeast' | 'northwest' | 'southeast' | 'southwest'
  | 'up' | 'down' | 'in' | 'out'
  | 'up north' | 'up south' | 'up east' | 'up west' | 'up northeast' | 'up northwest' | 'up southeast' | 'up southwest'
  | 'down north' | 'down south' | 'down east' | 'down west' | 'down northeast' | 'down northwest' | 'down southeast' | 'down southwest';

/** A parsed direction: its canonical name, its grid vector and its opposite. */
export interface Dir {
  name: DirName;
  /** The short form the game usually accepts (`n`, `ne`, `u`, `une`, `in`). */
  short: string;
  dx: number; dy: number; dz: number; // north is -y (screen), up is +z
  opposite: DirName;
}

/* ────────────────────────────── map data ────────────────────────────── */

/** Named room colours. They are drawn from theme tokens (never a free colour), so they follow the theme. */
export type RoomColor = '' | 'accent' | 'gold' | 'ok' | 'alert' | 'dim' | 'sky' | 'moss' | 'plum' | 'rust';
export const ROOM_COLORS: readonly RoomColor[] = ['', 'accent', 'gold', 'ok', 'alert', 'dim', 'sky', 'moss', 'plum', 'rust'];

export interface MapExit {
  /** The command that takes this exit (`north`, `n`, `enter portal`). Unique within its room. */
  key: string;
  /** What to show when it differs from the key (`The street continues north`). */
  name?: string;
  /** Destination room id; null while unexplored. */
  to: string | null;
  /** A stable id the game gave the exit (an exit handle, a GMCP exit vnum), used by the fingerprint identity. */
  handle?: string;
  /** Commands sent instead of `key` when walking (a special exit: `['open door north', 'north']`). */
  commands?: string[];
  /** Pathfinding cost, default 1. */
  cost?: number;
  door?: '' | 'open' | 'closed' | 'locked';
  /** The game told us (or the player marked) this exit as one-way. */
  oneway?: boolean;
  /** Where to draw it when `key` is not a direction (`enter portal` drawn as `up`). */
  dir?: DirName;
  /** Never walk through it. */
  blocked?: boolean;
}

export interface MapRoom {
  id: string;
  /** The game's own room id (GMCP `Room.Info.num`, MSDP `ROOM_VNUM`, a Lua-supplied id), when it has one. */
  vnum?: string;
  name: string;
  /** Area id; `''` is the default area. */
  area: string;
  x: number; y: number; z: number;
  /** Exits by key. */
  exits: Record<string, MapExit>;
  /** Hash of name + description, for the signature identity (games with no ids and no handles). */
  sig?: string;
  /** The description, kept only when the setting `keepDesc` is on. */
  desc?: string;
  /** Environment / terrain the game named (GMCP `environment`, MSDP `ROOM_TERRAIN`). */
  env?: string;
  color?: RoomColor;
  /** One or two characters drawn in the room. */
  symbol?: string;
  note?: string;
  /** Free tags (`shop`, `bank`, `safe`, …), for `find` and Lua. */
  tags?: string[];
  /** A placement warning the tracker left (`displaced`, `unanchored`, `teleport?`); cleared by the player. */
  warn?: string;
  /** Pathfinding cost of entering the room, default 1. */
  weight?: number;
  /** The player pinned it: the tracker never moves, merges or relabels it. */
  locked?: boolean;
  /** Epoch ms of the last change. */
  updated?: number;
}

/** A group of rooms with its own coordinate space. `''` is the default area (unnamed, always there). */
export interface MapArea {
  id: string;
  name: string;
  /** Free text: the level range, how to get there, anything. */
  note?: string;
  /** Drawn behind rooms of the area that have no colour of their own. */
  color?: RoomColor;
}

/** One exit leading from a room of one area into a room of another. */
export interface AreaLink { from: MapRoom; exit: MapExit; to: MapRoom }

/** Where the player is in one session, as far as the map knows. */
export interface Position {
  roomId: string | null;
  /** How the current room was recognised. */
  by: 'vnum' | 'fingerprint' | 'signature' | 'anchor' | 'created' | 'none';
}

/** The whole map of one world, as exported and imported. */
export interface MapData {
  format: 'mu-map';
  v: 2;
  rooms: Record<string, MapRoom>;
  areas: Record<string, MapArea>;
  nextId: number;
}

/* ────────────────────────────── the store ────────────────────────────── */

export type PathResult = { ids: string[]; steps: string[][]; cost: number } | null;

export interface FindQuery {
  /** Case-insensitive substring of the name. */
  name?: string;
  /** Exact area id. */
  area?: string;
  tag?: string;
  vnum?: string;
  /** Rooms within `radius` cells of this room (same area and floor). */
  near?: { roomId: string; radius: number };
  limit?: number;
}

export interface StoreEvent {
  /** `rooms` for any change of rooms or exits; `areas`; `reset` after import, erase or undo. */
  kind: 'rooms' | 'areas' | 'reset';
  ids?: string[];
}

/**
 * The map of one world. Pure data operations plus persistence; nothing here knows about sessions or the game.
 * Every mutating call records an undo step unless called inside `batch`, and notifies watchers once per call
 * (once per batch).
 */
export interface MapStore {
  readonly worldId: string;
  readonly ready: Promise<void>;
  /* reads */
  room(id: string): MapRoom | undefined;
  rooms(): MapRoom[];
  area(id: string): MapArea | undefined;
  areas(): MapArea[];
  /** The room at a cell, or undefined. */
  at(area: string, x: number, y: number, z: number): MapRoom | undefined;
  byVnum(vnum: string): MapRoom | undefined;
  /** The room owning an exit handle. */
  byHandle(handle: string): MapRoom | undefined;
  bySig(sig: string): MapRoom[];
  find(q: FindQuery): MapRoom[];
  /** Rooms whose exits point at `id`. */
  incoming(id: string): Array<{ room: MapRoom; exit: MapExit }>;
  /** Cheapest path by exit cost + room weight, honouring `blocked`, `door: 'locked'` (unless `opts.locked`). */
  path(from: string, to: string, opts?: { locked?: boolean; avoid?: string[] }): PathResult;
  /** A free cell at or nearest to the given one, spiralling out on the same floor. */
  freeNear(area: string, x: number, y: number, z: number): { x: number; y: number; z: number };
  /** A free cell along a direction from a room (so a displaced room still reads as "that way"). */
  freeAlong(room: MapRoom, dir: Dir): { x: number; y: number; z: number };
  /* writes */
  create(room: Omit<MapRoom, 'id'> & { id?: string }): MapRoom;
  update(id: string, patch: Partial<Omit<MapRoom, 'id'>>): MapRoom | undefined;
  remove(id: string): void;
  /** Fold `from` into `into`: exits, incoming links, notes; `from` is removed. */
  merge(from: string, into: string): void;
  /** Move rooms by a delta; false (and nothing moved) when a target cell is taken by a room outside `ids`. */
  move(ids: string[], dx: number, dy: number, dz?: number, area?: string): boolean;
  /** Add or update one exit of a room (by key). */
  setExit(roomId: string, exit: MapExit): void;
  removeExit(roomId: string, key: string): void;
  /** Link an exit to a room; with `back` also the opposite exit of the destination when it exists and is unlinked. */
  link(roomId: string, key: string, to: string, opts?: { back?: boolean }): void;
  unlink(roomId: string, key: string): void;
  /** Link facing exits of neighbouring rooms; returns how many were linked. */
  autoConnect(area?: string): number;
  /** Every room reachable from `id` on its floor, through links in either direction. */
  component(id: string): Set<string>;
  /** Create or update an area (fields merged; an absent `note`/`color` is kept, `undefined` clears). */
  setArea(area: Partial<MapArea> & { id: string }): MapArea;
  /** A new area named `name`, with a fresh id made from the name (`the-keep`, `the-keep-2`, …). */
  createArea(name: string, fields?: Omit<Partial<MapArea>, 'id' | 'name'>): MapArea;
  /** Delete an area. `rooms: 'delete'` (default) removes its rooms; `'move'` puts them into `to` (default `''`) on free cells. */
  removeArea(id: string, opts?: { rooms?: 'delete' | 'move'; to?: string }): void;
  /** Put rooms into another area, keeping their cells where free, else the nearest free cell on the same floor. */
  moveToArea(ids: string[], area: string): void;
  /** The exits of rooms in `id` that lead into other areas (and, with `both`, those leading in). */
  areaLinks(id: string, opts?: { both?: boolean }): AreaLink[];
  /** How many rooms each area has, including the default area and areas only rooms name. */
  areaCounts(): Record<string, number>;
  /* history, io */
  batch<T>(label: string, fn: () => T): T;
  undo(): string | null;
  redo(): string | null;
  canUndo(): boolean;
  canRedo(): boolean;
  export(): MapData;
  /** Replace the whole map; throws on an unknown format. Accepts `MapData`, the 0.x Underspire userscript map and Mudlet JSON exports where recognisable. */
  import(data: unknown): { rooms: number };
  erase(): void;
  watch(fn: (e: StoreEvent) => void): Dispose;
  /** Flush pending writes now (the store also saves itself, debounced). */
  flush(): Promise<void>;
  dispose(): void;
}

/* ────────────────────────────── the tracker ────────────────────────────── */

/** What a source reports about the room the player is in now. */
export interface SceneInput {
  sid: string;
  /** `gmcp`, `msdp`, `text`, `scene`, `lua`, or an extension id. */
  source: string;
  vnum?: string;
  name: string;
  desc?: string;
  area?: string;
  env?: string;
  exits?: Array<{ key: string; name?: string; handle?: string; /** destination vnum the game told us */ to?: string; door?: MapExit['door'] }>;
  /** True when `exits` is the complete list from the game; false or absent when it may be partial. */
  exitsComplete?: boolean;
  /** Coordinates the game gave (some GMCP `Room.Info` carry them). */
  coords?: { x: number; y: number; z: number };
  /** A replayed event (reconnect snapshot): locate, never create or link. */
  replay?: boolean;
}

export interface SessionTrack {
  sid: string;
  worldId: string;
  position: Position;
  /** Movement commands sent and not yet confirmed, oldest first. */
  pending: string[];
  /** The last scene the source reported (what "I'm here" and "New room here" use). */
  lastScene: SceneInput | null;
  /** Mapping paused: known rooms are still recognised, nothing is created or linked. */
  paused: boolean;
  /** Which source currently drives this session (the best one seen: gmcp > msdp > lua > text > scene). */
  source: string;
}

export type MapperEvent =
  | { type: 'enter'; sid: string; room: MapRoom; prev: MapRoom | null; via: string | null; by: Position['by'] }
  | { type: 'created'; sid: string; room: MapRoom; via: string | null }
  | { type: 'lost'; sid: string; scene: SceneInput }
  | { type: 'moved'; sid: string; key: string }
  | { type: 'failed'; sid: string; key: string | null; text: string }
  | { type: 'walk'; sid: string; state: WalkState }
  | { type: 'track'; sid: string; track: SessionTrack };

/**
 * Turns scenes and sent commands into positions and map edits, one track per session. The tracker owns no
 * rendering and no game parsing: sources (`sources/*`) call `scene`/`moved`/`failed`, profiles (`profiles/*`)
 * give the text regexes to the text source.
 */
export interface Tracker {
  track(sid: string): SessionTrack | undefined;
  tracks(): SessionTrack[];
  scene(input: SceneInput): void;
  /** A movement command was sent (or confirmed by the game); `key` is the exit key or direction. */
  moved(sid: string, key: string, opts?: { confirmed?: boolean }): void;
  /** The game said the last move did not happen. */
  failed(sid: string, text: string, key?: string | null): void;
  /** Declare the player's position: take the last scene's exits into that room. */
  anchor(sid: string, roomId: string): void;
  /** Create a room for the last scene at a cell and stand there. */
  createHere(sid: string, cell: { area: string; x: number; y: number; z: number }): MapRoom | null;
  pause(sid: string, paused: boolean): void;
  /** Whether `key` is something that moves you from the session's current room (a direction or an exit key). */
  isMove(sid: string, key: string): boolean;
  on(fn: (e: MapperEvent) => void): Dispose;
  /** Forget a session. */
  drop(sid: string): void;
}

/* ────────────────────────────── the walker ────────────────────────────── */

export interface WalkState {
  status: 'idle' | 'walking' | 'paused' | 'arrived' | 'failed' | 'stopped';
  target: string | null;
  /** Room ids of the route (not including the start). */
  route: string[];
  /** Index of the next step to send. */
  at: number;
  /** The reason, for `failed`. */
  reason?: string;
}

export interface WalkOptions {
  /** `step` (default): send one step, wait for the room to change, send the next. `burst`: send all with `delayMs` between. */
  mode?: 'step' | 'burst';
  delayMs?: number;
  /** Seconds to wait for a room change before giving up (step mode). */
  timeoutS?: number;
  /** Walk through locked doors (the route may include `commands`). */
  locked?: boolean;
}

export interface Walker {
  goto(sid: string, roomId: string, opts?: WalkOptions): Promise<WalkState>;
  /** Walk a list of steps (exit keys / commands) with no destination. */
  steps(sid: string, steps: string[], opts?: WalkOptions): Promise<WalkState>;
  stop(sid: string): void;
  pause(sid: string): void;
  resume(sid: string): void;
  state(sid: string): WalkState;
}

/* ────────────────────────────── profiles ────────────────────────────── */

/**
 * How one game talks about moving, for the text source. The generic profile covers common phrasings; a game
 * profile (`underspire`) adds its own and may read exits from the look text.
 */
export interface GameProfile {
  id: string;
  /** World hosts this profile picks itself for (`*.underspire.net`). */
  hosts?: string[];
  /** The game confirmed a move: capture 1 is the direction / exit key. */
  moveConfirmed?: RegExp[];
  /** The game queued a move for later (Underspire routes): capture 1 is the key. */
  moveQueued?: RegExp[];
  /** A move did not happen. Optional capture 1 is the key it refused. */
  moveFailed: RegExp[];
  /** Lines ending a room look that carry the exits. Capture 1 is the list. */
  exitsLine?: RegExp[];
  /** Split an exits list into exit keys (default: commas / and / or, drop parentheses and `the`). */
  exitKeys?(list: string): Array<{ key: string; name?: string }>;
  /** Commands that are moves in this game besides directions (`enter`, `climb`, `board`). */
  moveVerbs?: string[];
  /** Seconds to wait for a look after a room name before taking the room as having no exits. */
  lookWaitMs?: number;
}

/* ────────────────────────────── Lua bridge ────────────────────────────── */

/** Lua → extension: `ext.emit('mapper.call', { id, fn, args })`. */
export interface LuaCall { id?: number; fn: string; args?: unknown[] }
/** Extension → Lua: `mapper.reply`. */
export interface LuaReply { id: number; ok: boolean; result?: unknown; error?: string }
/**
 * A room as Lua sees it: flat, with exits as `{ key = to_id_or_false }`. An unexplored exit is `false`, not
 * `nil`: a JSON null in a Lua table removes the key, and the script must still see the exit exists.
 * `desc` is present only when the map keeps descriptions (the `keepDesc` setting).
 */
export interface LuaRoom {
  id: string; vnum?: string; name: string; area: string; x: number; y: number; z: number;
  exits: Record<string, string | false>;
  tags: string[]; note: string; symbol: string; color: string; env: string; locked: boolean;
  desc?: string;
}

/* ────────────────────────────── exported API ────────────────────────────── */

/** `ctx.api<MapperApi>('mapper')`. */
export interface MapperApi {
  version: string;
  /** The store of a world (created on first use). Default the active world. */
  store(worldId?: string): MapStore | null;
  tracker: Tracker;
  walker: Walker;
  /** Feed a room from another extension (a game-specific parser). `source` is your extension id. */
  scene(input: SceneInput): void;
  here(sid?: string): MapRoom | null;
  goto(roomId: string, sid?: string, opts?: WalkOptions): Promise<WalkState>;
  on(fn: (e: MapperEvent) => void): Dispose;
  /** The 0.x `client-map` adapter hook: import a map file by URL (`mu-map` JSON or Mudlet JSON). */
  loadMapFile?(url: string, sid: string): Promise<void>;
  /** Register a game profile at runtime (another extension bringing its game's phrasings). */
  profile(p: GameProfile): Dispose;
  /** The Lua helper library (`mapper.*`) players paste into a startup script; see `docs/lua.md`. */
  luaLibrary(): string;
}
