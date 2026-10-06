/**
 * Picking a profile for a world: the first registered profile whose `hosts` glob matches the world's host, else
 * the built-in one for the host (Underspire), else the generic profile.
 */
import type { GameProfile } from '../types';
import { GENERIC } from './generic';
import { UNDERSPIRE } from './underspire';

export { GENERIC } from './generic';
export { UNDERSPIRE } from './underspire';

export const BUILTIN_PROFILES: readonly GameProfile[] = [UNDERSPIRE, GENERIC];

/** Whether a host matches a pattern: `underspire.net` exact, `*.underspire.net` any subdomain (not the bare host), `*` anything; case-insensitive, a port on the host is ignored. */
export function matchHost(pattern: string, host: string): boolean {
  const h = host.trim().toLowerCase().replace(/:\d+$/, '');
  const p = pattern.trim().toLowerCase();
  if (!h || !p) return false;
  if (p === '*') return true;
  if (!p.includes('*')) return h === p;
  const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]+')}$`);
  return re.test(h);
}

/** The profile for a host: registered ones first (in registration order), then the built-ins, then GENERIC. */
export function profileFor(host: string | undefined, registered: GameProfile[] = []): GameProfile {
  const h = host ?? '';
  for (const list of [registered, BUILTIN_PROFILES]) {
    for (const p of list) if (h && p.hosts?.some((pat) => matchHost(pat, h))) return p;
  }
  return GENERIC;
}
