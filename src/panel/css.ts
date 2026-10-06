/**
 * The panel stylesheet: tokens only, every rule under `.ext-panel[data-ext="mapper"] .mu-map`. Controls are the
 * host primitives (`mu.ui.css`), so this file holds only layout and the pieces the host has no class for.
 */
const P = '.ext-panel[data-ext="mapper"] .mu-map';

export const PANEL_CSS = `
${P} { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-elev); color: var(--fg); font-family: var(--font-mono); font-size: var(--shell-font-size, 15px); }
${P} * { box-sizing: border-box; }
${P} button, ${P} input, ${P} select, ${P} textarea { font: inherit; }

${P} .mu-map-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 5px; padding: 4px 8px; background: var(--bg-elev); border-bottom: 1px solid var(--border); }
${P} .mu-map-bar .mu-map-group { display: inline-flex; align-items: center; gap: 1px; }
${P} .mu-map-bar .mu-map-gap { flex: 1; }
${P} .mu-map-bar select { min-height: 24px; max-width: 10em; background: var(--bg); color: var(--fg); border: 1px solid var(--border-bright); font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; padding: 0 .5ch; }
${P} .mu-map-bar .mu-map-z { display: inline-block; min-width: 3ch; text-align: center; color: var(--gold); font-size: .68rem; letter-spacing: .1em; }

${P} .mu-map-body { display: flex; flex: 1; min-height: 0; flex-direction: column; }
${P} .mu-map-stage { position: relative; flex: 1; min-height: 60px; background: var(--bg); overflow: hidden; }
${P} .mu-map-stage canvas { display: block; width: 100%; height: 100%; outline: none; cursor: default; touch-action: none; }
${P} .mu-map-stage canvas:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: -2px; }
${P} .mu-map-stage canvas[data-cursor="grab"] { cursor: grab; }
${P} .mu-map-stage canvas[data-cursor="grabbing"] { cursor: grabbing; }
${P} .mu-map-stage canvas[data-cursor="pointer"] { cursor: pointer; }
${P} .mu-map-stage canvas[data-cursor="crosshair"] { cursor: crosshair; }
${P} .mu-map-stage canvas[data-cursor="move"] { cursor: move; }

${P} .mu-map-banner { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--bg-elev); border-bottom: 1px solid var(--gold); color: var(--gold); font-size: .66rem; letter-spacing: .14em; text-transform: uppercase; z-index: 3; }
${P} .mu-map-banner .mu-map-gap { flex: 1; }

${P} .mu-map-tip { position: absolute; z-index: 4; pointer-events: none; max-width: 16rem; padding: 4px 8px; background: var(--bg-deep); border: 1px solid var(--border-bright); color: var(--fg); font-size: .72rem; line-height: 1.4; white-space: pre-line; }
${P} .mu-map-tip .mu-map-tip-name { color: var(--accent-bright); letter-spacing: .06em; }
${P} .mu-map-tip .mu-map-tip-dim { color: var(--fg-dim); }
${P} .mu-map-tip .mu-map-tip-warn { color: var(--alert); }
${P} .mu-map-tip .mu-map-tip-walk { color: var(--gold); font-size: .62rem; letter-spacing: .14em; text-transform: uppercase; }

${P} .mu-map-pop { position: absolute; z-index: 20; min-width: 9rem; max-width: 18rem; max-height: 70%; overflow: auto; display: flex; flex-direction: column; align-items: stretch; padding: 3px 0; background: var(--bg-elev); border: 1px solid var(--accent); }
${P} .mu-map-pop .cmd, ${P} .mu-map-pop .sh-cmd, ${P} .mu-map-pop .tool { justify-content: flex-start; width: 100%; padding: 0 1.2ch 0 .8ch; }
${P} .mu-map-pop .mu-map-pop-hint { margin-left: auto; padding-left: 1.5ch; color: var(--fg-faint); font-size: .6rem; letter-spacing: .08em; }
${P} .mu-map-pop .mu-map-pop-sep { height: 1px; margin: 2px 0; background: var(--border); }
${P} .mu-map-pop .mu-map-pop-title { padding: 2px .8ch; color: var(--gold); font-size: .6rem; letter-spacing: .24em; text-transform: uppercase; }
${P} .mu-map-pop .mu-map-pop-body { padding: 4px 1ch 6px; font-size: .74rem; line-height: 1.5; color: var(--fg-dim); }
${P} .mu-map-pop .mu-map-pop-body dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 1.2ch; margin: 0; }
${P} .mu-map-pop .mu-map-pop-body dt { color: var(--fg); white-space: nowrap; display: flex; align-items: center; gap: .6ch; }
${P} .mu-map-pop .mu-map-pop-body dd { margin: 0; }
${P} .mu-map-pop .mu-map-pop-body kbd { color: var(--gold); font-family: inherit; font-size: .66rem; letter-spacing: .08em; }
${P} .mu-map-pop svg { width: 14px; height: 14px; display: inline-block; vertical-align: middle; }

${P} .mu-map-insp { flex: 0 0 auto; max-height: 40%; min-height: 0; overflow: auto; background: var(--bg-elev); border-top: 1px solid var(--border-bright); padding: 4px 10px 8px; font-size: .78rem; }
${P} .mu-map-insp[hidden], ${P} .mu-map-banner[hidden], ${P} .mu-map [hidden] { display: none; }
${P} .mu-map-insp .mu-map-sec, ${P} .mu-map-area-detail .mu-map-sec { margin: .6rem 0 .3rem; }
${P} .mu-map-insp .mu-map-title, ${P} .mu-map-area-detail .mu-map-title { display: flex; align-items: baseline; gap: 1ch; color: var(--accent-bright); font-size: .82rem; letter-spacing: .1em; padding: 4px 0 2px; }
${P} .mu-map-insp .mu-map-title .mu-map-id, ${P} .mu-map-area-detail .mu-map-title .mu-map-id { color: var(--fg-faint); font-size: .62rem; letter-spacing: .08em; }
${P} .mu-map-insp .mu-map-meta, ${P} .mu-map-area-detail .mu-map-meta { color: var(--fg-dim); font-size: .7rem; letter-spacing: .04em; }
${P} .mu-map-insp .mu-map-hint, ${P} .mu-map-area-detail .mu-map-hint { color: var(--fg-faint); font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; padding: 8px 0; }
${P} .mu-map-insp .mu-map-warn, ${P} .mu-map-area-detail .mu-map-warn { display: flex; align-items: center; gap: 1ch; color: var(--alert); font-size: .7rem; padding: 2px 0; }
${P} .mu-map-insp .mu-map-actions, ${P} .mu-map-area-detail .mu-map-actions { display: flex; flex-wrap: wrap; gap: 2px 4px; margin: 2px 0 2px -.5ch; }
${P} .mu-map-insp .mu-map-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 2px 0; }
${P} .mu-map-insp .mu-map-row .mu-map-gap { flex: 1; }

${P} .mu-map-pad { display: inline-grid; grid-template-columns: repeat(3, 24px); grid-auto-rows: 24px; gap: 1px; }
${P} .mu-map-pad button { min-width: 24px; min-height: 24px; padding: 0; }
${P} .mu-map-pad .mu-map-pad-mid { display: flex; align-items: center; justify-content: center; color: var(--fg-faint); font-size: .6rem; }
${P} .mu-map-padcol { display: inline-flex; flex-direction: column; gap: 1px; margin-left: 6px; }

${P} .mu-map-swatches { display: flex; flex-wrap: wrap; gap: 3px; }
${P} .mu-map-swatch { width: 24px; height: 24px; min-width: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: var(--bg); border: 1px solid var(--border-bright); color: var(--fg-faint); cursor: pointer; }
${P} .mu-map-swatch i { display: block; width: 14px; height: 14px; background: var(--sw, var(--border)); }
${P} .mu-map-swatch:hover { border-color: var(--accent); }
${P} .mu-map-swatch.on { border-color: var(--accent-bright); box-shadow: inset 0 0 0 1px var(--accent-bright); }
${P} .mu-map-swatch:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: -2px; }
${P} .mu-map-swatch[data-sw="accent"] i { background: var(--accent); }
${P} .mu-map-swatch[data-sw="gold"] i { background: var(--gold); }
${P} .mu-map-swatch[data-sw="ok"] i { background: var(--ok); }
${P} .mu-map-swatch[data-sw="alert"] i { background: var(--alert); }
${P} .mu-map-swatch[data-sw="dim"] i { background: var(--fg-dim); }
${P} .mu-map-swatch[data-sw="sky"] i { background: color-mix(in srgb, var(--accent) 62%, var(--bg)); }
${P} .mu-map-swatch[data-sw="moss"] i { background: color-mix(in srgb, var(--ok) 62%, var(--bg)); }
${P} .mu-map-swatch[data-sw="plum"] i { background: color-mix(in srgb, color-mix(in srgb, var(--accent) 50%, var(--gold)) 50%, var(--bg)); }
${P} .mu-map-swatch[data-sw="rust"] i { background: color-mix(in srgb, var(--gold) 55%, var(--bg)); }

${P} .mu-map-glyphs { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
${P} .mu-map-glyphs .mu-map-sym { width: 2.6ch; max-width: 3.5em; text-align: center; }

${P} .mu-map-chips { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
${P} .mu-map-chip { display: inline-flex; align-items: center; gap: .4ch; min-height: 24px; padding: 0 .4ch 0 .8ch; border: 1px solid var(--border); color: var(--fg); font-size: .66rem; letter-spacing: .1em; text-transform: uppercase; }
${P} .mu-map-chip button { min-width: 20px; min-height: 22px; }
${P} .mu-map-chips input { width: 8em; }

${P} .mu-map-insp textarea { width: 100%; min-height: 3.2em; resize: vertical; }
${P} .mu-map-insp input[type="number"] { width: 4em; }

${P} .mu-map-exits { display: flex; flex-direction: column; gap: 1px; }
${P} .mu-map-exit { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; min-height: 24px; padding: 1px 0; border-bottom: 1px solid var(--border); font-size: .74rem; }
${P} .mu-map-exit .mu-map-key { color: var(--gold); letter-spacing: .06em; min-width: 3ch; }
${P} .mu-map-exit .mu-map-arrow { color: var(--fg-faint); }
${P} .mu-map-exit .mu-map-dest { color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14em; }
${P} .mu-map-exit .mu-map-dest.mu-map-none { color: var(--fg-faint); }
${P} .mu-map-exit .mu-map-door { color: var(--fg-dim); font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; }
${P} .mu-map-exit .mu-map-cost { width: 3.5em; min-height: 22px; }
${P} .mu-map-exit .mu-map-exit-tools { display: inline-flex; flex-wrap: wrap; gap: 0 2px; margin-left: auto; }

${P} .mu-map-status { display: flex; align-items: center; gap: 1.2ch; padding: 2px 10px; min-height: 20px; border-top: 1px solid var(--border); background: var(--bg-elev); color: var(--fg-dim); font-size: .64rem; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; overflow: hidden; }
${P} .mu-map-status .mu-map-gap { flex: 1; }
${P} .mu-map-status .mu-map-status-msg { color: var(--gold); overflow: hidden; text-overflow: ellipsis; }
${P} .mu-map-status .mu-map-status-warn { color: var(--alert); }

${P} .mu-map-areas { min-width: 16rem; max-width: 22rem; }
${P} .mu-map-areas > * { flex: none; }
${P} .mu-map-area-list { display: flex; flex-direction: column; max-height: 9rem; overflow: auto; border-bottom: 1px solid var(--border); }
${P} .mu-map-area-row { display: flex; align-items: center; gap: .8ch; }
${P} .mu-map-area-row .mu-map-area-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${P} .mu-map-area-sw { display: inline-block; width: 10px; height: 10px; flex: none; background: var(--border); }
${P} .mu-map-area-sw-none { background: transparent; border: 1px solid var(--border); }
${P} .mu-map-area-sw[data-sw="accent"] { background: var(--accent); }
${P} .mu-map-area-sw[data-sw="gold"] { background: var(--gold); }
${P} .mu-map-area-sw[data-sw="ok"] { background: var(--ok); }
${P} .mu-map-area-sw[data-sw="alert"] { background: var(--alert); }
${P} .mu-map-area-sw[data-sw="dim"] { background: var(--fg-dim); }
${P} .mu-map-area-sw[data-sw="sky"] { background: color-mix(in srgb, var(--accent) 62%, var(--bg)); }
${P} .mu-map-area-sw[data-sw="moss"] { background: color-mix(in srgb, var(--ok) 62%, var(--bg)); }
${P} .mu-map-area-sw[data-sw="plum"] { background: color-mix(in srgb, color-mix(in srgb, var(--accent) 50%, var(--gold)) 50%, var(--bg)); }
${P} .mu-map-area-sw[data-sw="rust"] { background: color-mix(in srgb, var(--gold) 55%, var(--bg)); }
${P} .mu-map-area-tools { display: flex; gap: 4px; padding: 2px .4ch; border-bottom: 1px solid var(--border); }
${P} .mu-map-area-detail { padding: 2px 1ch 6px; font-size: .78rem; }
${P} .mu-map-area-detail textarea { width: 100%; min-height: 3em; resize: vertical; }
${P} .mu-map-area-links { display: flex; flex-direction: column; gap: 1px; }
${P} .mu-map-area-link { font-size: .7rem; letter-spacing: .02em; text-transform: none; white-space: normal; text-align: left; line-height: 1.3; min-height: 24px; }
${P} .mu-map-insp .mu-map-area-btn { display: inline-flex; min-height: 20px; padding: 0 .4ch; font-size: inherit; letter-spacing: inherit; text-transform: inherit; color: var(--fg-dim); }
${P} .mu-map-insp .mu-map-area-btn:hover { color: var(--accent-bright); }

${P} .mu-map-legend { display: grid; grid-template-columns: auto 1fr; gap: 3px 1.2ch; align-items: center; }
${P} .mu-map-legend svg { color: var(--fg-dim); }

${P} .cmd, ${P} .sh-cmd, ${P} .tool, ${P} .mu-map-swatch, ${P} .mu-map-chip button { transition: color .12s ease, background-color .12s ease, border-color .12s ease; }
html[data-calm] ${P} *, ${P} .mu-map-calm * { transition: none !important; }
@media (prefers-reduced-motion: reduce) { ${P} * { transition: none !important; } }
`;
