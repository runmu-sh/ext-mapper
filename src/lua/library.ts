/**
 * The Lua helper library players paste into a startup script: a global `mapper` table with one method per
 * wire function (generated from `LUA_API`, so it matches `help()`), event handlers, `opposite` and `speedwalk`.
 * `parseSpeedwalk` is the JavaScript twin of the Lua parser; the tests hold the two to the same behaviour.
 *
 * `goto` is a Lua keyword, so the method is `mapper.go` (with `mapper["goto"]` as an alias).
 */
import { LUA_API } from './api';

/** The wire names a Lua script reaches as `mapper.<name>` (`goto` as `go`). */
export const luaMethodName = (fn: string): string => (fn === 'goto' ? 'go' : fn);

const WRAPPERS = LUA_API.map((f) => {
  const m = luaMethodName(f.fn);
  const alias = m !== f.fn ? ` mapper["${f.fn}"] = mapper.${m}` : '';
  return `function mapper.${m}(...) return call("${f.fn}", ...) end${alias}`;
}).join('\n');

export const MAPPER_LUA = `-- mapper.lua: paste into a startup script (Settings → Scripts). Needs the Mapper extension.
-- Every function takes its arguments and, optionally, a LAST argument callback(ok, resultOrError).
-- Without a callback the call is fire-and-forget. Rooms arrive as tables; an unexplored exit is \`false\`.
-- Reference: docs/lua.md in the Mapper package, or mapper.help(function(ok, lines) display(lines) end).
mapper = mapper or {}
mapper._handlers = mapper._handlers or {}
local pending, nextId = {}, 1

-- Send one call. The callback, when given, is answered once from mapper.reply.
local function call(fn, ...)
  local args = table.pack(...)
  local cb
  if args.n > 0 and type(args[args.n]) == "function" then
    cb = args[args.n]; args[args.n] = nil; args.n = args.n - 1
  end
  args.n = nil -- a table with keys 1..n is sent as a list; nil holes would make it an object (pass false, not nil)
  local id
  if cb then id = nextId; nextId = nextId + 1; pending[id] = cb end
  local ok, sent = pcall(ext.emit, "mapper.call", { id = id, fn = fn, args = args })
  if ok and sent then return true end
  if cb then pending[id] = nil; cb(false, "mapper." .. fn .. ": " .. (ok and "dropped (rate limit)" or tostring(sent))) end
  return false
end

ext.on("mapper.reply", function(r)
  local cb = pending[r.id]; pending[r.id] = nil
  if cb then cb(r.ok, r.ok and r.result or r.error) end
end)

ext.on("mapper.event", function(e)
  for _, h in ipairs(mapper._handlers[e.type] or {}) do h(e) end
  for _, h in ipairs(mapper._handlers["*"] or {}) do h(e) end
end)

-- mapper.on("enter" | "created" | "lost" | "failed" | "walk" | "*", fn): fn(e) with e.type and the event's fields.
-- The first handler turns event delivery on for this session; mapper.off removes a handler.
function mapper.on(type, fn)
  local list = mapper._handlers[type] or {}
  mapper._handlers[type] = list
  list[#list + 1] = fn
  if not mapper._events then mapper._events = true; call("events", true) end
  return fn
end

function mapper.off(type, fn)
  local list = mapper._handlers[type] or {}
  for i = #list, 1, -1 do if list[i] == fn then table.remove(list, i) end end
  for _, l in pairs(mapper._handlers) do if #l > 0 then return end end
  mapper._events = false; call("events", false)
end

-- The wire functions, one method each (generated from the same table as help()).
${WRAPPERS}

-- Directions: short → long, and opposites (pure Lua, no round trip).
mapper.dirs = { n = "north", s = "south", e = "east", w = "west", ne = "northeast", nw = "northwest",
  se = "southeast", sw = "southwest", u = "up", d = "down", ["in"] = "in", out = "out" }
local OPP = { n = "s", s = "n", e = "w", w = "e", ne = "sw", sw = "ne", nw = "se", se = "nw", u = "d", d = "u", ["in"] = "out", out = "in" }
local LONG = {}
for short, long in pairs(mapper.dirs) do LONG[long] = short end
-- The letters a compact run ("3n2eu") may use: compass and up/down, never in/out.
local RUN = { n = true, s = true, e = true, w = true, ne = true, nw = true, se = true, sw = true, u = true, d = true }

-- mapper.opposite("n") → "s"; mapper.opposite("north") → "south"; nil for anything else.
function mapper.opposite(dir)
  if type(dir) ~= "string" then return nil end
  local d = dir:lower()
  if OPP[d] then return OPP[d] end
  if LONG[d] then return mapper.dirs[OPP[LONG[d]]] end
  return nil
end

-- One Mudlet-style run such as "3n2eu" → { "n", "n", "n", "e", "e", "u" }, or nil when it is not one.
local function run(tok)
  local out, i = {}, 1
  while i <= #tok do
    local cnt = tok:match("^%d*", i); i = i + #cnt
    local d = tok:sub(i, i + 1)
    if not RUN[d] then d = tok:sub(i, i) end
    if not RUN[d] then return nil end
    i = i + #d
    for _ = 1, tonumber(cnt) or 1 do out[#out + 1] = d end
  end
  return #out > 0 and out or nil
end

-- mapper.parseSpeedwalk("3n 2e u") → { "n", "n", "n", "e", "e", "u" }. Segments are separated by ";" and
-- a segment of direction tokens ("3n", "2east", "3n2eu", "north") expands; any other segment is one literal command.
function mapper.parseSpeedwalk(str)
  local steps = {}
  for seg in tostring(str or ""):gmatch("[^;]+") do
    seg = seg:match("^%s*(.-)%s*$")
    if seg ~= "" then
      local part, all = {}, true
      for tok in seg:gmatch("%S+") do
        local cnt, word = tok:match("^(%d*)(.*)$")
        local dirs = run(tok:lower())
        if LONG[word:lower()] then
          for _ = 1, tonumber(cnt) or 1 do part[#part + 1] = word:lower() end
        elseif dirs then
          for _, d in ipairs(dirs) do part[#part + 1] = d end
        else
          all = false; break
        end
      end
      if all then for _, d in ipairs(part) do steps[#steps + 1] = d end else steps[#steps + 1] = seg end
    end
  end
  return steps
end

-- mapper.speedwalk("3n 2e u;open door;n", cb): walk the parsed steps.
function mapper.speedwalk(str, cb)
  local steps = mapper.parseSpeedwalk(str)
  if #steps == 0 then if cb then cb(false, "mapper.speedwalk: nothing to walk") end return false end
  return mapper.walk(steps, cb)
end
`;

/* ────────────────────────────── the JavaScript twin ────────────────────────────── */

const RUN = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd']);
const LONG: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', up: 'u', down: 'd', in: 'in', out: 'out' };

/** A Mudlet-style run (`3n2eu`) expanded, or null when the token is not one. Mirrors the Lua `run`. */
function runOf(tok: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < tok.length) {
    const cnt = /^\d*/.exec(tok.slice(i))![0];
    i += cnt.length;
    let d = tok.slice(i, i + 2);
    if (!RUN.has(d)) d = tok.slice(i, i + 1);
    if (!RUN.has(d)) return null;
    i += d.length;
    for (let k = 0; k < (cnt ? Number(cnt) : 1); k++) out.push(d);
  }
  return out.length ? out : null;
}

/**
 * `"3n 2e u"` → `['n','n','n','e','e','u']`. Segments split on `;`; a segment whose every token is a direction
 * (`3n`, `2east`, `3n2eu`, `north`) expands, any other segment is one literal command. Identical to the Lua.
 */
export function parseSpeedwalk(str: string): string[] {
  const steps: string[] = [];
  for (let seg of String(str ?? '').split(';')) {
    seg = seg.trim();
    if (!seg) continue;
    const part: string[] = [];
    let all = true;
    for (const tok of seg.split(/\s+/)) {
      const m = /^(\d*)(.*)$/.exec(tok)!;
      const cnt = m[1], lw = m[2].toLowerCase();
      if (LONG[lw]) for (let k = 0; k < (cnt ? Number(cnt) : 1); k++) part.push(lw);
      else { const dirs = runOf(tok.toLowerCase()); if (dirs) part.push(...dirs); else { all = false; break; } }
    }
    if (all) steps.push(...part); else steps.push(seg);
  }
  return steps;
}
