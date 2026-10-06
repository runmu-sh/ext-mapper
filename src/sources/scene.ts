/**
 * The scene-model source: whatever reaches the host's `mu.scene` (GMCP, MSDP, another extension's `scene.set`)
 * is reported as source `scene`, the lowest priority — the tracker ignores it once a better source has spoken
 * for the session. One watch per session through `sessions.each`.
 */
import type { Dispose, Mu, SceneView } from '@muclient/sdk';
import type { SceneInput, Tracker } from '../types';

/** A `SceneView` → scene input, or null when no room is known. */
export function sceneInputOf(sid: string, v: SceneView): SceneInput | null {
  if (!v.known || !v.title) return null;
  const exits = (v.exits ?? []).filter((k) => typeof k === 'string' && k.trim()).map((k) => ({ key: k.trim() }));
  const s: SceneInput = { sid, source: 'scene', name: v.title, exits, exitsComplete: exits.length > 0 };
  if (v.id) s.vnum = v.id;
  if (v.desc) s.desc = v.desc;
  if (v.area) s.area = v.area;
  return s;
}

export function sceneSource(mu: Mu, tracker: Tracker): Dispose {
  return mu.sessions.each((s) => {
    let last = '';
    return mu.scene.watch((v) => {
      const input = sceneInputOf(s.id, v);
      if (!input) return;
      const key = JSON.stringify([input.vnum ?? '', input.name, input.exits?.map((e) => e.key) ?? []]);
      if (key === last) return;
      last = key;
      tracker.scene(input);
    }, s.id);
  });
}
