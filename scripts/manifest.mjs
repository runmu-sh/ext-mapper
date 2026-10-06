/**
 * The `muclient` manifest rules (R-EXT-PKG; R-SDK-MAN-1/-2/-3), as a dependency-free module.
 *
 * The schema is clients/extensions/schema/muclient-manifest.v1.schema.json, and the shared fixtures are
 * clients/extensions/schema/fixtures/manifests.json. The other validators are the host
 * (clients/web/src/features/extensions/manifest.ts and semver.ts) and the backend
 * (crates/extpkg/src/manifest.rs). Where they differ this takes the stricter rule: `exports` must be a
 * string (the host's rule), and a bad `contributes` panel or command is refused (the backend's rule;
 * the host only drops it).
 *
 * `api` is a semver range. With `{ sdkVersion }` it must be satisfied by that SDK version (the host's
 * check); without one it must be a valid range that admits some 1.x.y (the backend's check).
 *
 * The scaffolder checks what it writes with it, the generated project's build checks its own
 * package.json with a copy of it (scripts/manifest.mjs, so this file must stay self-contained), and
 * the tests use it.
 */

// ---- semver (the same grammar as clients/web/src/features/extensions/semver.ts) ----
const NUM = '0|[1-9]\\d*';
const PRE = '(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?';
const BUILD = '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const FULL_RE = new RegExp(`^v?(${NUM})\\.(${NUM})\\.(${NUM})${PRE}${BUILD}$`);
const XR = `${NUM}|[xX*]`;
const PARTIAL_RE = new RegExp(`^v?(${XR})(?:\\.(${XR})(?:\\.(${XR})${PRE}${BUILD})?)?$`);
const parsePre = (s) => (s ? s.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : []);
const V = (major, minor, patch, pre = []) => ({ major, minor, patch, pre });
const isX = (s) => s === undefined || s === 'x' || s === 'X' || s === '*';

/** A full version (`1.8.0`, `1.8.0-beta.1`) → `{ major, minor, patch, pre }`, or null. */
export function parseVersion(s) {
  const m = FULL_RE.exec(String(s ?? '').trim());
  return m ? V(+m[1], +m[2], +m[3], parsePre(m[4])) : null;
}

function compare(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function parsePartial(s) {
  if (s === '' || s === '*' || s === 'x' || s === 'X') return { pre: [] };
  const m = PARTIAL_RE.exec(s);
  if (!m) return null;
  const [, a, b, c, pre] = m;
  if (isX(a)) return (b === undefined || isX(b)) && (c === undefined || isX(c)) && !pre ? { pre: [] } : null;
  if (isX(b)) return (c === undefined || isX(c)) && !pre ? { major: +a, pre: [] } : null;
  if (isX(c)) return pre ? null : { major: +a, minor: +b, pre: [] };
  return { major: +a, minor: +b, patch: +c, pre: parsePre(pre) };
}

const cmp = (op, v, explicit = false) => ({ op, v, explicit });

function desugar(tok) {
  const m = /^(\^|~>?|>=|<=|>|<|=)?(.*)$/.exec(tok);
  const op = m[1] === '~>' ? '~' : (m[1] ?? '');
  if (m[2] === '') return null;
  const p = parsePartial(m[2]);
  if (!p) return null;
  const { major: M, minor: m2, patch: pt, pre } = p;
  const ex = pre.length > 0;
  if (M === undefined) return op === '<' || op === '>' ? [cmp('<', V(0, 0, 0, [0]))] : [];
  switch (op) {
    case '^': {
      const hi = M > 0 || m2 === undefined ? V(M + 1, 0, 0, [0]) : m2 > 0 || pt === undefined ? V(0, m2 + 1, 0, [0]) : V(0, 0, pt + 1, [0]);
      return [cmp('>=', V(M, m2 ?? 0, pt ?? 0, pre), ex), cmp('<', hi)];
    }
    case '~': return [cmp('>=', V(M, m2 ?? 0, pt ?? 0, pre), ex), cmp('<', m2 === undefined ? V(M + 1, 0, 0, [0]) : V(M, m2 + 1, 0, [0]))];
    case '': case '=':
      if (m2 === undefined) return [cmp('>=', V(M, 0, 0)), cmp('<', V(M + 1, 0, 0, [0]))];
      if (pt === undefined) return [cmp('>=', V(M, m2, 0)), cmp('<', V(M, m2 + 1, 0, [0]))];
      return [cmp('=', V(M, m2, pt, pre), ex)];
    case '>':
      if (m2 === undefined) return [cmp('>=', V(M + 1, 0, 0))];
      if (pt === undefined) return [cmp('>=', V(M, m2 + 1, 0))];
      return [cmp('>', V(M, m2, pt, pre), ex)];
    case '>=': return [cmp('>=', V(M, m2 ?? 0, pt ?? 0, pre), ex)];
    case '<': return [cmp('<', pt === undefined ? V(M, m2 ?? 0, 0, [0]) : V(M, m2, pt, pre), ex)];
    case '<=':
      if (m2 === undefined) return [cmp('<', V(M + 1, 0, 0, [0]))];
      if (pt === undefined) return [cmp('<', V(M, m2 + 1, 0, [0]))];
      return [cmp('<=', V(M, m2, pt, pre), ex)];
  }
  return null;
}

function parseRange(range) {
  if (typeof range !== 'string' || range.trim() === '') return null;
  const sets = [];
  for (const part of range.split('||')) {
    const s = part.trim().replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1');
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(s);
    const set = [];
    if (hy) {
      const a = parsePartial(hy[1]), b = parsePartial(hy[2]);
      if (!a || !b) return null;
      if (a.major !== undefined) set.push(cmp('>=', V(a.major, a.minor ?? 0, a.patch ?? 0, a.pre), a.pre.length > 0));
      if (b.major !== undefined) {
        if (b.minor === undefined) set.push(cmp('<', V(b.major + 1, 0, 0, [0])));
        else if (b.patch === undefined) set.push(cmp('<', V(b.major, b.minor + 1, 0, [0])));
        else set.push(cmp('<=', V(b.major, b.minor, b.patch, b.pre), b.pre.length > 0));
      }
    } else if (s !== '') {
      for (const tok of s.split(/\s+/)) { const d = desugar(tok); if (!d) return null; set.push(...d); }
    }
    sets.push(set);
  }
  return sets;
}

const passes = (c, v) => {
  const r = compare(v, c.v);
  return c.op === '>=' ? r >= 0 : c.op === '>' ? r > 0 : c.op === '<' ? r < 0 : c.op === '<=' ? r <= 0 : r === 0;
};

/** True when `range` is a valid semver range. */
export const validRange = (range) => parseRange(range) !== null;

/** Does `version` satisfy `range`? Pre-releases follow npm's rule. */
export function satisfies(version, range) {
  const v = parseVersion(version), sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some((set) => set.every((c) => passes(c, v))
    && (!v.pre.length || set.some((c) => c.explicit && c.v.pre.length && c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch)));
}

/** Does `range` admit some release `major.x.y`? (the backend's `api` rule) */
export function admitsMajor(range, major) {
  const sets = parseRange(range);
  if (!sets) return false;
  return sets.some((set) => {
    let lo = V(major, 0, 0), loIn = true, hi = V(major + 1, 0, 0, [0]), hiIn = false;
    for (const c of set) {
      if (c.op === '>=' || c.op === '>' || c.op === '=') { const r = compare(c.v, lo); if (r > 0 || (r === 0 && c.op === '>')) { lo = c.v; loIn = c.op !== '>'; } }
      if (c.op === '<' || c.op === '<=' || c.op === '=') { const r = compare(c.v, hi); if (r < 0 || (r === 0 && c.op === '<')) { hi = c.v; hiIn = c.op !== '<'; } }
    }
    const r = compare(lo, hi);
    return r < 0 || (r === 0 && loIn && hiIn);
  });
}

/** A path inside the package: no `..`, no leading `/`, no scheme, `?` or `#` (host.ts packagePath). */
export function packagePath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || p.includes('\\') || p.startsWith('/')) return null;
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' || seg.includes(':') || seg.includes('?') || seg.includes('#')) return null;
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

/** `muclient.wasm`: a list of paths, or an object of path → sha256 hex (or null). */
export function wasmDecl(raw, key = 'muclient.wasm') {
  if (raw === undefined || raw === null) return undefined;
  const out = {};
  const add = (p, h) => {
    const clean = packagePath(p);
    if (!clean) throw new Error(`${key}: "${String(p)}" is not a path inside the package.`);
    if (h !== null && (typeof h !== 'string' || !/^[0-9a-f]{64}$/i.test(h))) throw new Error(`${key}: the hash for ${clean} is not a sha256 hex string.`);
    out[clean] = h === null ? null : h.toLowerCase();
  };
  if (Array.isArray(raw)) for (const p of raw) add(p, null);
  else if (typeof raw === 'object') for (const [p, h] of Object.entries(raw)) add(p, h);
  else throw new Error(`${key} must be a list of paths or an object of path → sha256.`);
  return out;
}
/** `muclient.modules` (SDK 1.13): the same shape, for lazily imported ES modules. */
export const modulesDecl = (raw) => wasmDecl(raw, 'muclient.modules');

/** The extension id the host derives: `muclient.id`, else the package name without scope and `ext-`. */
export function idOf(pkg) {
  return String(pkg?.muclient?.id ?? pkg?.name ?? '').replace(/^@[^/]+\//, '').replace(/^ext-/, '');
}

export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** npm package names: lowercase, URL-safe, optional scope. */
export const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
/** `contributes.panels[].id` and `contributes.commands[].id` (the schema's panelId / commandId). */
export const PANEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const ACTIVATION_RE = /^(?:onWorld|global|on(?:Gmcp|Msdp|Lua|Panel|Command):\S.*)$/;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** R-SDK-MAN-1: null when `api` is acceptable, else the message (manifest.ts `validateApi`). */
export function apiProblem(api, sdkVersion) {
  const a = typeof api === 'string' ? api.trim() : '';
  if (sdkVersion) return a && satisfies(sdkVersion, a) ? null : `needs μClient extension API ${a || '(unspecified)'}; this μClient has ${sdkVersion}. Update μClient.`;
  return a && admitsMajor(a, 1) ? null : `needs μClient extension API ${a || '(unspecified)'}; this μClient provides 1.x.`;
}

/** R-SDK-MAN-2: `contributes` must be an object; its panels and commands need a valid id and a title (manifest.ts `contribEntryProblem`). */
export function normalizeContributes(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) throw new Error('muclient.contributes must be an object.');
  for (const kind of ['panels', 'commands']) {
    const v = raw[kind];
    if (v === undefined) continue;
    if (!Array.isArray(v)) throw new Error(`muclient.contributes.${kind} must be a list.`);
    const re = kind === 'panels' ? PANEL_ID_RE : COMMAND_ID_RE;
    const seen = new Set();
    v.forEach((e, i) => {
      const at = `muclient.contributes.${kind}[${i}]`;
      if (!isObj(e)) throw new Error(`${at} must be an object with "id" and "title".`);
      if (typeof e.id !== 'string' || !re.test(e.id)) throw new Error(`${at}: "id" must match ${re.source}.`);
      if (!nonEmpty(e.title)) throw new Error(`${at} (${e.id}): needs a "title".`);
      if (seen.has(e.id)) throw new Error(`${at}: duplicate id "${e.id}".`);
      seen.add(e.id);
    });
  }
  const bad = mcpProblem(raw.mcp);
  if (bad) throw new Error(bad);
  return raw;
}

/** An MCP package or message name, and a `major.minor` version (manifest.ts `MCP_PACKAGE_RE`). */
export const MCP_PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
export const MCP_VERSION_RE = /^\d{1,4}\.\d{1,4}$/;
const reservedMcp = (n) => { const x = n.toLowerCase(); return x === 'mcp' || x.startsWith('mcp-negotiate') || x.startsWith('mcp-cord'); };

/** R-SDK-MCP-3: `contributes.mcp` (manifest.ts `mcpProblem`, extpkg `check_mcp`): null when fine, else the message. */
export function mcpProblem(v) {
  if (v === undefined) return null;
  if (!Array.isArray(v)) return 'muclient.contributes.mcp must be a list.';
  for (let i = 0; i < v.length; i++) {
    const at = `muclient.contributes.mcp[${i}]`;
    const m = v[i];
    if (!isObj(m) || typeof m.package !== 'string' || typeof m.min !== 'string' || typeof m.max !== 'string') return `${at} must be { package, min, max }.`;
    if (!MCP_PACKAGE_RE.test(m.package) || reservedMcp(m.package)) return `${at}: "package" must match ${MCP_PACKAGE_RE.source} and not be mcp, mcp-negotiate or mcp-cord.`;
    if (!MCP_VERSION_RE.test(m.min) || !MCP_VERSION_RE.test(m.max)) return `${at} (${m.package}): "min" and "max" must be versions like "1.0".`;
    const [a, b] = [m.min.split('.').map(Number), m.max.split('.').map(Number)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) return `${at} (${m.package}): "min" is above "max".`;
    if (m.messages === undefined) continue;
    if (!isObj(m.messages)) return `${at} (${m.package}): "messages" must be an object of message name → { dir, schema? }.`;
    for (const [name, d] of Object.entries(m.messages)) {
      if (!MCP_PACKAGE_RE.test(name) || reservedMcp(name)) return `${at}.messages: "${name}" is not a message name.`;
      if (!isObj(d) || !['in', 'out', 'both'].includes(d.dir)) return `${at}.messages.${name}: "dir" must be "in", "out" or "both".`;
      if (d.schema !== undefined && typeof d.schema !== 'string') return `${at}.messages.${name}: "schema" must be a package path.`;
    }
  }
  return null;
}

/** R-SDK-MAN-3: `dependsOn` (id or package name → range), as manifest.ts `normalizeDependsOn`. */
export function normalizeDependsOn(raw) {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) throw new Error('muclient.dependsOn must be an object of extension id or package name → version range.');
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(ID_RE.test(k) || (NPM_NAME_RE.test(k) && k.length <= 214))) throw new Error(`muclient.dependsOn: "${k}" is not an extension id or package name.`);
    if (typeof v !== 'string' || !validRange(v)) throw new Error(`muclient.dependsOn: "${k}" has an invalid version range "${String(v)}".`);
    out[k] = v.trim();
  }
  return out;
}

/** `activation`: default ['onWorld']; "global" → ['global']; unknown events dropped (manifest.ts `normalizeActivation`). */
export function normalizeActivation(raw) {
  if (raw === undefined || raw === null) return ['onWorld'];
  if (raw === 'global') return ['global'];
  if (typeof raw === 'string') raw = [raw];
  if (!Array.isArray(raw)) throw new Error('muclient.activation must be a list of activation events, or "global".');
  const out = [];
  for (const e of raw) if (typeof e === 'string' && ACTIVATION_RE.test(e.trim()) && !out.includes(e.trim())) out.push(e.trim());
  return out.length ? out : ['onWorld'];
}

/**
 * Validate a parsed package.json. Returns the normalised manifest or throws with the host's message.
 * `sdkVersion`: check `api` against that SDK (as the host does); without it, `api` must admit some 1.x.
 */
export function validateManifest(pkg, { sdkVersion } = {}) {
  const m = pkg?.muclient;
  if (!m || typeof m !== 'object') throw new Error('This package has no "muclient" manifest, so it is not a μClient extension.');
  if (typeof pkg.exports !== 'string') throw new Error('The manifest needs "exports" naming the built entry file.');
  const entry = packagePath(pkg.exports);
  if (!entry) throw new Error(`Unsafe "exports" path "${pkg.exports}".`);
  const api = typeof m.api === 'string' ? m.api.trim() : '';
  const bad = apiProblem(api, sdkVersion);
  if (bad) throw new Error(`It ${bad}`);
  const id = idOf(pkg);
  if (!ID_RE.test(id)) throw new Error(`Invalid extension id "${id}".`);
  if (typeof pkg.name !== 'string' || !NPM_NAME_RE.test(pkg.name) || pkg.name.length > 214) throw new Error(`Invalid package name "${pkg.name}".`);
  if (m.source !== undefined && !packagePath(m.source)) throw new Error(`muclient.source: "${m.source}" is not a path inside the package.`);
  const wasm = wasmDecl(m.wasm);
  const modules = modulesDecl(m.modules);
  const contributes = normalizeContributes(m.contributes);
  const dependsOn = normalizeDependsOn(m.dependsOn);
  const activation = normalizeActivation(m.activation);
  return {
    id, name: pkg.name, displayName: String(m.displayName ?? pkg.name), version: String(pkg.version ?? '0.0.0'),
    description: String(m.description ?? ''), entry, api, source: m.source ?? 'src/index.ts',
    capabilities: Array.isArray(m.capabilities) ? m.capabilities.map(String) : [],
    contributes, dependsOn, activation, ...(wasm ? { wasm } : {}), ...(modules ? { modules } : {}),
  };
}
