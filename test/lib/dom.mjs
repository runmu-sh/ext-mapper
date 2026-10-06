/**
 * A happy-dom window as the globals the panel expects, a recording canvas 2D context, and a build of `src/panel`.
 */
import { Window } from 'happy-dom';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GLOBALS = ['document', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'WheelEvent', 'Event', 'CustomEvent', 'FocusEvent'];

/** Install a window on globalThis; returns the window and an `off` that removes the globals. */
export function installDom({ width = 800, height = 600 } = {}) {
  const win = new Window({ width, height });
  const saved = new Map();
  for (const k of GLOBALS) { saved.set(k, globalThis[k]); globalThis[k] = win[k]; }
  saved.set('window', globalThis.window);
  globalThis.window = win;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  // Fake layout: every element reports a size (happy-dom lays nothing out).
  const sizes = new WeakMap();
  let fallback = () => null;
  const size = (el, w, h) => { sizes.set(el, { w, h }); };
  const of = (el) => sizes.get(el) ?? fallback(el) ?? { w: 0, h: 0 };
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return of(this).w; } });
  Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return of(this).h; } });
  Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return of(this).w; } });
  Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return of(this).h; } });
  win.HTMLElement.prototype.getBoundingClientRect = function () { const s = of(this); return { x: 0, y: 0, left: 0, top: 0, right: s.w, bottom: s.h, width: s.w, height: s.h }; };
  const off = () => {
    for (const [k, v] of saved) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
    win.close?.();
  };
  return { win, document: win.document, size, off, fallback: (fn) => { fallback = fn; } };
}

/** Replace `HTMLCanvasElement.prototype.getContext` with one that returns a recording context; returns the recorder. */
export function recordCanvas(win) {
  const rec = { calls: [], count(name) { return rec.calls.filter((c) => c.name === name).length; }, texts() { return rec.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]); }, reset() { rec.calls.length = 0; }, props: {} };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'canvas') return null;
      if (typeof k === 'string' && k in rec.props) return rec.props[k];
      return (...args) => { rec.calls.push({ name: k, args, fill: rec.props.fillStyle, stroke: rec.props.strokeStyle, dash: rec.props.lineDash }); };
    },
    set(t, k, v) { rec.props[k] = v; return true; },
  });
  win.HTMLCanvasElement.prototype.getContext = () => ctx;
  rec.ctx = ctx;
  return rec;
}

/** Build one TS module of this package (esbuild, SDK stubbed) and import it. */
let n = 0;
export async function buildModule(root, src) {
  const esbuild = await import('esbuild');
  const r = await esbuild.build({
    entryPoints: [join(root, src)], bundle: true, format: 'esm', target: 'es2022', platform: 'neutral', write: false, logLevel: 'silent', absWorkingDir: root,
    plugins: [{ name: 'sdk-stub', setup(b) { b.onResolve({ filter: /^@muclient\/sdk$/ }, () => ({ path: 'sdk', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const h = null;', loader: 'js' })); } }],
  });
  const dir = join(root, 'node_modules', '.cache', 'mapper-panel-test');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `panel-${process.pid}-${++n}.mjs`);
  writeFileSync(out, r.outputFiles[0].contents);
  return import(pathToFileURL(out).href);
}

export const flush = () => new Promise((r) => setTimeout(r, 5));

/** Haemal, as `ThemeInfo.tokens`. */
export const TOKENS = { bg: '#0a0806', bgElev: '#100c0a', bgDeep: '#060403', fg: '#cdbfa6', fgDim: '#9d907a', fgFaint: '#857a68', accent: '#b21f1a', accentBright: '#e13f35', gold: '#c9a44c', alert: '#e0362b', ok: '#7f9a5c', border: '#251a14', borderBright: '#432f24', glow: 'rgba(224,54,43,.45)' };
