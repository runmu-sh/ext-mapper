/**
 * The signature hash: FNV-1a (32-bit) over a string, as 8 hex digits. Used by the tracker for the
 * name + description signature of rooms with no ids and no exit handles.
 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The signature of a scene: hash of the name, a newline and the description (empty when none). */
export function sigOf(name: string, desc: string | undefined): string {
  return fnv1a(`${name.trim()}\n${(desc ?? '').trim()}`);
}
