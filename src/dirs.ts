/**
 * Directions: parsing the long, short and compound forms a game accepts, their grid vectors and opposites.
 * Pure; imports types only.
 */
import type { Dir, DirName } from './types';

type Compass = 'north' | 'south' | 'east' | 'west' | 'northeast' | 'northwest' | 'southeast' | 'southwest';

const COMPASS: ReadonlyArray<{ name: Compass; short: string; dx: number; dy: number; opposite: Compass }> = [
  { name: 'north', short: 'n', dx: 0, dy: -1, opposite: 'south' },
  { name: 'south', short: 's', dx: 0, dy: 1, opposite: 'north' },
  { name: 'east', short: 'e', dx: 1, dy: 0, opposite: 'west' },
  { name: 'west', short: 'w', dx: -1, dy: 0, opposite: 'east' },
  { name: 'northeast', short: 'ne', dx: 1, dy: -1, opposite: 'southwest' },
  { name: 'northwest', short: 'nw', dx: -1, dy: -1, opposite: 'southeast' },
  { name: 'southeast', short: 'se', dx: 1, dy: 1, opposite: 'northwest' },
  { name: 'southwest', short: 'sw', dx: -1, dy: 1, opposite: 'northeast' },
];

function build(): Dir[] {
  const out: Dir[] = [];
  for (const c of COMPASS) out.push({ name: c.name, short: c.short, dx: c.dx, dy: c.dy, dz: 0, opposite: c.opposite });
  out.push({ name: 'up', short: 'u', dx: 0, dy: 0, dz: 1, opposite: 'down' });
  out.push({ name: 'down', short: 'd', dx: 0, dy: 0, dz: -1, opposite: 'up' });
  out.push({ name: 'in', short: 'in', dx: 0, dy: 0, dz: 0, opposite: 'out' });
  out.push({ name: 'out', short: 'out', dx: 0, dy: 0, dz: 0, opposite: 'in' });
  for (const vert of ['up', 'down'] as const) {
    const dz = vert === 'up' ? 1 : -1;
    const other = vert === 'up' ? 'down' : 'up';
    for (const c of COMPASS) {
      out.push({
        name: `${vert} ${c.name}` as DirName,
        short: `${vert[0]}${c.short}`,
        dx: c.dx, dy: c.dy, dz,
        opposite: `${other} ${c.opposite}` as DirName,
      });
    }
  }
  return out;
}

/** Every direction, canonical order: compass, up, down, in, out, then the compound ones. */
export const DIRS: readonly Dir[] = Object.freeze(build());

const BY_NAME = new Map<string, Dir>();
const BY_SHORT = new Map<string, Dir>();
for (const d of DIRS) { BY_NAME.set(d.name, d); BY_SHORT.set(d.short, d); }

/** Normalise raw input: lower case, hyphens and underscores to spaces, runs of spaces collapsed. */
function norm(raw: string): string {
  return raw.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const VERT_WORDS: Record<string, 'up' | 'down'> = { up: 'up', u: 'up', down: 'down', d: 'down' };

function compass(word: string): Dir | undefined {
  const d = BY_NAME.get(word) ?? BY_SHORT.get(word);
  return d && d.dz === 0 && (d.dx !== 0 || d.dy !== 0) ? d : undefined;
}

/**
 * Parse a direction in any accepted form: `north`, `n`, `northeast`, `ne`, `up`, `u`, `in`, `out`,
 * `up northwest`, `up-northwest`, `up_nw`, `unw`, `dne`, `down east`. Anything else is null.
 */
export function parseDir(raw: string): Dir | null {
  if (typeof raw !== 'string') return null;
  const s = norm(raw);
  if (!s) return null;
  const whole = BY_NAME.get(s) ?? BY_SHORT.get(s);
  if (whole) return whole;
  const words = s.split(' ');
  if (words.length === 3) {
    // `up north east`
    const v = VERT_WORDS[words[0]];
    const c = compass(words[1] + words[2]);
    return v && c ? BY_NAME.get(`${v} ${c.name}`) ?? null : null;
  }
  if (words.length === 2) {
    // `north east` (a split compass name), or a vertical and a compass part: `up ne`, `u northwest`.
    const fused = compass(words[0] + words[1]);
    if (fused) return fused;
    const v = VERT_WORDS[words[0]];
    const c = compass(words[1]);
    if (v && c) return BY_NAME.get(`${v} ${c.name}`) ?? null;
    return null;
  }
  // A single word fused from a vertical and a compass part: `unorth`, `dne`.
  if (words.length === 1) {
    for (const [vw, v] of Object.entries(VERT_WORDS)) {
      if (s.length > vw.length && s.startsWith(vw)) {
        const c = compass(s.slice(vw.length));
        if (c) return BY_NAME.get(`${v} ${c.name}`) ?? null;
      }
    }
  }
  return null;
}

/** The opposite of a canonical direction name. */
export function opposite(name: DirName): DirName {
  const d = BY_NAME.get(name);
  if (!d) throw new Error(`not a direction: ${name}`);
  return d.opposite;
}

/** Whether a string parses as a direction (in any form). */
export function isDirKey(s: string): boolean {
  return parseDir(s) !== null;
}

/** Whether two raw strings name the same direction (`n` and `north`, `dne` and `down-northeast`). */
export function sameDir(a: string, b: string): boolean {
  const da = parseDir(a);
  const db = parseDir(b);
  return !!da && !!db && da.name === db.name;
}

/** The short form of a canonical direction name (`north` → `n`, `up northwest` → `unw`). */
export function shortOf(name: DirName): string {
  const d = BY_NAME.get(name);
  if (!d) throw new Error(`not a direction: ${name}`);
  return d.short;
}

/** The Dir for a canonical name (`undefined` for anything else). */
export function dirByName(name: string): Dir | undefined {
  return BY_NAME.get(name);
}
