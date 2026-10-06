/**
 * The generic game profile: the move refusals, exits lines and move verbs most MUD codebases (Diku, ROM, Smaug,
 * LP, Evennia, MOO) share. A game profile adds its own phrasings; the text source consults whichever is active.
 * Unknown-command lines ("Huh?", "I don't understand that") are not move failures and are left out on purpose.
 */
import { parseDir } from '../dirs';
import type { GameProfile } from '../types';

export const GENERIC_MOVE_FAILED: RegExp[] = [
  /^Alas, you cannot go that way/i,
  /^You can(?:'|’)?t go (?:that way|in that direction|there)/i,
  /^You cannot go (?:that way|in that direction|there)/i,
  /^There(?:'s| is) no (?:exit|way|door|passage)\b/i,
  /^There is no exit\b/i,
  /^You don(?:'|’)?t see (?:any|an|that) (?:exit|way|door)\b/i,
  /^That way is blocked/i,
  /^There is nothing in that direction/i,
  /^The (?:door|gate|hatch|portal|way) (?:is|seems to be) (?:closed|locked|shut|barred)/i,
  /\b(?:is|are) (?:closed|locked|shut|barred)\.?$/i,
  /\bblocks? (?:your|the) (?:way|path|passage)\b/i,
  /^You bump into\b/i,
  /^You (?:cannot|can(?:'|’)?t) (?:fit|pass|squeeze) through\b/i,
  /^You stop walking/i,
];

export const GENERIC_EXITS_LINE: RegExp[] = [
  /^\[?\s*(?:obvious |visible )?exits?\s*(?:are)?\s*:\s*(.+?)\s*\]?\.?$/i,
  /^exits? (?:are|is)\s+(.+?)\.?$/i,
  /^there (?:are|is) (?:an? )?(?:exits?|ways?(?: out)?|doors?) (?:to(?: the)?|leading(?: to)?|lead(?:ing)? to)\s+(.+?)\.?$/i,
  /^you (?:can|may) (?:go|travel|head|walk)\s+(.+?)\.?$/i,
  /^(?:the )?(?:obvious |visible )?exits? (?:here )?(?:lead|leads|go|goes|are|is)\s+(.+?)\.?$/i,
];

export const DEFAULT_MOVE_VERBS = ['enter', 'climb', 'board', 'leave', 'exit', 'go'];

/**
 * Split an exits list into keys: commas, `and`, `or`; a parenthetical and a leading `the` are dropped, a
 * trailing period too; multi-word names are kept. `north, east and the market (m)` → north, east, market.
 */
export function splitExits(list: string): Array<{ key: string; name?: string }> {
  const out: Array<{ key: string; name?: string }> = [];
  const push = (key: string): void => { if (key && !out.some((e) => e.key === key)) out.push({ key }); };
  const parts = list.replace(/[\[\]]/g, '').replace(/\.\s*$/, '').split(/\s*[,;|]\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i);
  for (let part of parts) {
    part = part.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^(?:the|a|an)\s+/i, '').replace(/^-\s*/, '').trim();
    part = part.replace(/^(.+?):\s*.+$/, '$1'); // `north: A street` (Diku `exits` tables) → north
    if (!part || /^(?:none|nothing|no exits?|nowhere)$/i.test(part)) continue;
    const words = part.toLowerCase().split(/\s+/);
    // `north east south` (Diku's `[Exits: n e s]`): a run of plain directions is several exits, not one name.
    if (words.length > 1 && words.every((w) => parseDir(w)) && !parseDir(part)) { for (const w of words) push(w); continue; }
    push(part.toLowerCase());
  }
  return out;
}

export const GENERIC: GameProfile = {
  id: 'generic',
  moveFailed: GENERIC_MOVE_FAILED,
  exitsLine: GENERIC_EXITS_LINE,
  exitKeys: splitExits,
  moveVerbs: DEFAULT_MOVE_VERBS,
  lookWaitMs: 400,
};
