/**
 * The Underspire profile (an Evennia game): "You begin walking <dir>." confirms a move, "You add <dir> to your
 * route" queues one, refusals include "Command 'x' is not available" (a move failure only when x is a move: the
 * text source checks capture 1 with `tracker.isMove`). Exits come from the look text: "There are exits to the
 * market (m), the well and Shard services (s)." — a name with a parenthesised key keeps both.
 */
import type { GameProfile } from '../types';
import { GENERIC_MOVE_FAILED } from './generic';

export const UNDERSPIRE_EXITS_LINE: RegExp[] = [
  /^(?:there (?:are|is) (?:an? )?(?:exits?|ways?(?: out)?) (?:to|leading to) |(?:obvious )?exits?: )(.+?)\.?$/i,
  /^(?:the |a )?[\w' -]+? (?:continues|leads|runs|goes on|heads) ((?:north|south|east|west|up|down|in|out)(?:east|west)?(?:,? (?:and |or )?(?:north|south|east|west|up|down|in|out)(?:east|west)?)*)\.?$/i,
];

/** `the market (m), the well and Shard services (s)` → `{ key: 'm', name: 'market' }`, `{ key: 'well' }`, `{ key: 's', name: 'Shard services' }`. */
export function underspireExitKeys(list: string): Array<{ key: string; name?: string }> {
  const out: Array<{ key: string; name?: string }> = [];
  for (const raw of list.replace(/\.\s*$/, '').split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i)) {
    let part = raw.trim();
    if (!part) continue;
    let key: string | undefined;
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(part);
    if (m) { part = m[1].trim(); key = m[2].trim(); }
    const name = part.replace(/^the\s+/i, '').trim();
    if (!name && !key) continue;
    const entry: { key: string; name?: string } = { key: (key ?? name).toLowerCase() };
    if (key && name && name.toLowerCase() !== entry.key) entry.name = name;
    if (!out.some((e) => e.key === entry.key)) out.push(entry);
  }
  return out;
}

export const UNDERSPIRE: GameProfile = {
  id: 'underspire',
  hosts: ['underspire.net', '*.underspire.net'],
  moveConfirmed: [/^You begin walking (.+?)\.?$/i],
  moveQueued: [/^You add (.+?) to your route/i],
  moveFailed: [...GENERIC_MOVE_FAILED, /^Command '(.+?)' is not available/i],
  exitsLine: UNDERSPIRE_EXITS_LINE,
  exitKeys: underspireExitKeys,
  moveVerbs: ['enter', 'climb', 'board', 'leave', 'exit', 'go', 'take'],
  lookWaitMs: 350,
};
