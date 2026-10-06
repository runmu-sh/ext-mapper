/**
 * The text source: an `observe` input stage (every command sent, by anyone, that is a move → `tracker.moved`)
 * and an `observe` line stage over output and prompt lines, read through the active {@link GameProfile}: move
 * confirmations, queued moves, refusals, and exits lines. Exits from the text complete a scene a better source
 * reported without them (Underspire prints the look before or after `Room.Name`, so an exits line is either
 * attached to the last scene or held for the next one), and for a game with no GMCP at all a room look (title,
 * description, blank-separated sections, the exits line) becomes a whole scene.
 */
import type { Dispose, InputEdit, InputStageCtx, LineEdit, LineStageCtx, Mu } from '@muclient/sdk';
import { splitExits } from '../profiles/generic';
import type { GameProfile, MapperEvent, SceneInput, SessionTrack, Tracker } from '../types';

export interface TextSourceOpts { now?(): number }

const DEFAULT_LOOK_WAIT_MS = 400;
const BUFFER_MAX = 60;
const MAX_TITLE = 80;

type ExitList = NonNullable<SceneInput['exits']>;

interface Per {
  /** Exits from a line (and the look's title and description when read), waiting for the scene they belong to. */
  held: { exits: ExitList; at: number; name?: string; desc?: string } | null;
  /** When the track's `lastScene` last changed, and which one it was. */
  sceneAt: number;
  lastScene: SceneInput | null;
  /** A move was sent or confirmed and no scene has arrived since. */
  inFlight: boolean;
  /** Recent output lines, for the generic room-text reader. */
  buffer: string[];
}

/** The first profile regex matching the text, with its match. */
function firstMatch(res: RegExp[] | undefined, text: string): RegExpExecArray | null {
  for (const re of res ?? []) { const m = re.exec(text); if (m) return m; }
  return null;
}

/** A confirmed-move capture to a key: `to the market` → `market`, `north` → `north`. */
export function moveKeyOf(raw: string): string {
  return raw.trim().replace(/^(?:to(?:wards?)? )?(?:the )?/i, '').replace(/[.!]+$/, '').trim();
}

/** Exits from a line through the profile, or null when the line is not an exits line. */
export function exitsFromLine(profile: GameProfile, text: string): ExitList | null {
  const m = firstMatch(profile.exitsLine, text.trim());
  if (!m) return null;
  const list = m[1] ?? '';
  return (profile.exitKeys ?? splitExits)(list).filter((e) => e.key);
}

const looksTitle = (t: string): boolean => t.length > 0 && t.length <= MAX_TITLE && !/[.!?:;,"')>\]]$/.test(t) && !/^(?:you|there|it) /i.test(t);
const HERE_RE = /^(.+?) (?:is|are) (?:[a-z]+ )?here\.?$/i;

/**
 * The room look a buffer of lines ends in (the last one being the exits line): blank-separated sections read
 * backwards; the nearest one with a title line gives the title and, after it, the description. The section just
 * before the exits line is who-is-here when it reads like it, and is skipped as a title then.
 */
export function roomFromLines(lines: readonly string[], maxSections = 4): { name: string; desc: string } | null {
  const sections: string[][] = [[]];
  for (const raw of lines) {
    const l = raw.trim();
    if (l) sections[sections.length - 1].push(l);
    else if (sections[sections.length - 1].length) sections.push([]);
  }
  if (!sections[sections.length - 1].length) sections.pop();
  if (!sections.length) return null;
  const tail = sections[sections.length - 1];
  const people = tail.some((l) => HERE_RE.test(l) || /^you (?:are|is) [a-z ]*here\.?$/i.test(l));
  for (let i = sections.length - 1; i >= Math.max(0, sections.length - maxSections); i--) {
    if (i === sections.length - 1 && people) continue;
    const sec = sections[i];
    let t = -1;
    for (let j = sec.length - 1; j >= 0; j--) if (looksTitle(sec[j]) && !HERE_RE.test(sec[j])) { t = j; break; }
    if (t < 0) continue;
    return { name: sec[t], desc: sec.slice(t + 1).join('\n') };
  }
  return null;
}

export function textSource(mu: Mu, tracker: Tracker, profileOf: (sid: string) => GameProfile, opts: TextSourceOpts = {}): Dispose {
  const now = opts.now ?? (() => Date.now());
  const per = new Map<string, Per>();
  const of = (sid: string): Per => per.get(sid) ?? per.set(sid, { held: null, sceneAt: 0, lastScene: null, inFlight: false, buffer: [] }).get(sid)!;
  const waitOf = (sid: string): number => profileOf(sid).lookWaitMs ?? DEFAULT_LOOK_WAIT_MS;
  const noGmcp = (sid: string): boolean => mu.gmcp.state('Room.Info', sid) === undefined && mu.gmcp.state('Room.Name', sid) === undefined;

  /** Report `scene` again with these exits (and the look's description when its title is the scene's name), as the text source. */
  function complete(scene: SceneInput, exits: ExitList, look?: { name: string; desc: string } | null): void {
    const s: SceneInput = { ...scene, source: 'text', exits, exitsComplete: true, replay: false };
    if (look && look.desc && scene.desc === undefined && look.name.toLowerCase() === scene.name.toLowerCase()) s.desc = look.desc;
    tracker.scene(s);
  }

  /** The track changed: a new incomplete scene takes held exits; any scene ends a move in flight. */
  function onTrack(track: SessionTrack): void {
    const p = of(track.sid);
    if (track.lastScene === p.lastScene) return;
    p.lastScene = track.lastScene;
    p.sceneAt = now();
    p.inFlight = false;
    const scene = track.lastScene;
    if (!scene || scene.exitsComplete === true || !p.held) return;
    const held = p.held;
    p.held = null;
    if (now() - held.at > waitOf(track.sid)) return;
    // The tracker emits `track` after its own state is settled, so reporting again from here is safe.
    complete(scene, held.exits, held.name !== undefined ? { name: held.name, desc: held.desc ?? '' } : null);
  }

  function onExitsLine(sid: string, exits: ExitList, look: { name: string; desc: string } | null): void {
    const p = of(sid);
    const track = tracker.track(sid);
    const scene = track?.lastScene ?? null;
    const wait = waitOf(sid);
    if (scene && scene.exitsComplete !== true && (now() - p.sceneAt <= wait || !p.inFlight)) {
      complete(scene, exits, look);
      return;
    }
    p.held = { exits, at: now(), ...(look ? { name: look.name, desc: look.desc } : {}) };
  }

  function onLine(line: LineEdit, ctx: LineStageCtx): void {
    if (line.kind !== 'output' && line.kind !== 'prompt') return;
    if (line.replay === true || line.backlog === true) return;
    const sid = ctx.sid;
    const text = line.text.trim();
    const profile = profileOf(sid);
    const p = of(sid);
    if (!text) { if (line.kind === 'output') p.buffer.push(''); return; }
    let m = firstMatch(profile.moveConfirmed, text);
    if (m) { tracker.moved(sid, moveKeyOf(m[1] ?? ''), { confirmed: true }); p.inFlight = true; return; }
    m = firstMatch(profile.moveQueued, text);
    if (m) {
      const key = moveKeyOf(m[1] ?? '');
      const pending = tracker.track(sid)?.pending ?? [];
      if (key && !pending.some((k) => k.toLowerCase() === key.toLowerCase())) tracker.moved(sid, key);
      return;
    }
    m = firstMatch(profile.moveFailed, text);
    if (m) {
      const key = m[1] !== undefined ? moveKeyOf(m[1]) : null;
      if (key !== null && /^command\b/i.test(text) && !tracker.isMove(sid, key)) return;
      tracker.failed(sid, text, key);
      return;
    }
    const exits = exitsFromLine(profile, text);
    if (exits) {
      const look = line.kind === 'output' ? roomFromLines(p.buffer) : null;
      p.buffer = [];
      if (look && noGmcp(sid)) {
        const src = tracker.track(sid)?.source ?? '';
        if (src !== 'gmcp' && src !== 'msdp') {
          const s: SceneInput = { sid, source: 'text', name: look.name, exits, exitsComplete: true };
          if (look.desc) s.desc = look.desc;
          tracker.scene(s);
          return;
        }
      }
      onExitsLine(sid, exits, look);
      return;
    }
    if (line.kind === 'output') {
      p.buffer.push(text);
      if (p.buffer.length > BUFFER_MAX) p.buffer.splice(0, p.buffer.length - BUFFER_MAX);
    }
  }

  function onInput(cmd: InputEdit, ctx: InputStageCtx): void {
    const sid = ctx.sid;
    const p = of(sid);
    p.buffer = [];
    let text = cmd.text.trim();
    if (!text) return;
    if (/^go\s+/i.test(text)) text = text.replace(/^go\s+/i, '').trim();
    if (tracker.isMove(sid, text)) { tracker.moved(sid, text); p.inFlight = true; }
  }

  const subs: Dispose[] = [
    mu.input.stage({ id: 'mapper-moves', phase: 'observe', run: onInput }),
    mu.lines.stage({ id: 'mapper-text', phase: 'observe', run: onLine }),
    tracker.on((e: MapperEvent) => {
      if (e.type === 'track') onTrack(e.track);
      else if (e.type === 'moved') of(e.sid).inFlight = true;
      else if (e.type === 'failed') of(e.sid).inFlight = false;
    }),
    mu.sessions.on('close', (s) => { per.delete(s.id); }),
  ];
  return () => { for (const d of subs.splice(0)) d(); per.clear(); };
}
