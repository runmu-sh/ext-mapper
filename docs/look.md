# Look: matching the host

How the Mapper's chrome lines up with the μClient host, what was off, what changed, and what is left to decide.
Host paths are under `clients/web/src` of the muClient repo.

## What the host does

- **Bars.** `theme/controls.css` `.bar`: flex, wrap, gap 5px, padding 4px 8px, `--bg-elev`, 1px `--border` bottom.
  The Terminal's "Output filters and tools" bar (`features/terminal/TerminalPanel.vue` `.bar.logbar`) tightens that to
  gap 6px, padding 3px 8px; its filter chips wrap in a `.chips` group with gap `2px 4px`.
- **Commands and toggles.** `.sh-cmd` (`[ TIMES ]`): `.68rem`, `.14em`, uppercase by CSS, min-height 24px, padding
  `0 .5ch`, `--fg-dim`, brackets in `--fg-faint`; `.on`/`aria-pressed=true` → `--accent-bright`; hover → `--accent`
  fill with `--bg-deep` text; `.sq` drops the brackets for a 24px glyph. `.sh-toggle` (`■SPEECH`): same metrics, a
  `.6em` lamp, `.off` hollow and faint.
- **Macro bar** (`features/input/Hotbar.vue`): gap 8px, padding 4px 10px, `.macro` `.68rem .12em` uppercase with a
  `--border-bright` underline and a `.6rem` gold key; `[ MACROS ]` is a plain `.sh-cmd`.
- **Menus.** `.drop` (`--bg-elev`, 1px `--accent`, `--menu-shadow`) holding `.mi` rows (`.68rem .1em` uppercase
  `--fg-dim`, padding 6px 10px, hover accent fill). The context menu (`features/surfaces/ContextMenu.vue`) adds a
  `.gh` group head (`.6rem .2em` faint) and a right-aligned `.k` key hint.
- **Type ramp** (skill `muclient/style`): body `.82–.9rem`, control `.72–.78rem`, label `.66–.72rem` tracked, micro
  `.58–.62rem`; the Scene panel title is `.9rem .16em` uppercase `--accent-bright` over a `--border-bright` rule.
- **Layers.** `theme/base.css` declares `@layer mu, ext;` — an extension's sheet beats `controls.css`, so any
  `font`/`font-size` an extension sets on a `.sh-cmd` wins over the host's `.68rem`.

## What the mapper did differently

- `css.ts` set `button, input, select, textarea { font: inherit }` inside the panel. In the `ext` layer that beat
  `.sh-cmd`'s `.68rem`, so every toolbar button rendered at the 15px shell size with `.14em` tracking — the "big"
  toolbar in the screenshot (85–91px tall, wrapping to three rows at 373px).
- The bar used gap `2px 5px`, padding `4px 8px`; the area `<select>` was a boxed control with `--border-bright`.
- Popover menu rows were bracketed `.sh-cmd`s left-aligned in a column, not host `.mi` rows.
- The inspector sat on `.78rem` with a `.82rem .1em` title that was neither the body nor the Scene title style; the
  inspector's top rule was `--border-bright` (reserved for control outlines).
- Tag chips were `--border` boxes at `.66rem`; the status line was 20px tall at `.1em`.
- Rooms were `0.27` of a cell per half (a 54% square, a 46% gap), so the link between neighbours was almost as long as
  a room; names sat 3px under the square, into the next room at the names threshold.

## What changed

- `src/panel/css.ts`: dropped the `font: inherit` reset (the host's `base.css` already does it in the `mu` layer).
  Bar gap/padding now `6px` / `3px 8px` with groups at `2px 4px`, as `.logbar`. The area select is an `.sh-field`
  underline at the bar's type size. Popovers take `--menu-shadow`; menu rows are `.mi` with a `.k` key hint and a
  `.gh`-style title. Inspector body `.82rem`, title `.85rem .16em` uppercase `--accent-bright` over a `--border-bright`
  rule (glow under `html[data-glow]`), top rule `--border`. Tag chips are `.sh-plate.dim`-shaped (`--border-bright`
  hairline, `.6rem .14em`). Status bar `3px 8px`, min-height 24px, `.14em`.
- `src/panel/toolbar.ts`: the area select carries `css.field`.
- `src/panel/menus.ts`: menu rows are `.mi` with a label span and a `.k` hint span (host context-menu shape).
- `src/panel/render.ts`: `ROOM_HALF` 0.27 → **0.36** (a 72% square, a 28% gap: a link one third the room's width);
  a `STUB_LEN` constant (0.11 cell) so unexplored-exit stubs and dots stay in the gap; `NAMES_MIN_SCALE` 40 → 44 so
  a name fits the gap when it first appears; names alternate above and below along a row (and go above a room that
  has a neighbour under it) so they no longer collide; name width is capped at two cells in a row.
- `src/panel/view.ts`: `DEFAULT_SCALE` 34 → 40 (a 29px room, an 11px link); `hitsRoom` defaults to `ROOM_HALF`.
  `canvas.ts` keeps `HIT_HALF` 0.4 (the square plus a hair).

Measured after (DPR 1, 15px shell): Terminal and Mapper `.sh-cmd`/`.sh-toggle` both `10.2px / 1.428px / 0 3.06px /
24px`, both bars `3px 8px` gap `6px`. At 373px wide the Mapper bar still wraps to three rows (91px) because it
holds 13 controls, a readout and a select; the Terminal's wraps too below ~560px.

## Not done — for the person to decide

- **Shorten the bar.** Move Z▾/▴, Areas, Undo and the select into the ☰ menu (keys already exist for all of them) or
  into a second row under the stage, so the bar is one line at the panel's usual width.
- **Area select as a `.sh-cmd` dropdown** (`MIDGAARD ▾` opening a `.drop` of `.mi` rows) instead of a native
  `<select>`, which cannot take the host's option styling.
- **Z readout as `.sh-label`** (`.64rem .18em` gold) rather than the custom `.mu-map-z` span.
- **Inspector as host rows**: `.sh-row`/`.sh-label` pairs for coords, floor, area, vnum, with `.sec-head` sections
  (already used for Move/Colour/Symbol) and a `.framed` box, matching the Session Info panel.
- **Status bar as `.sh-plate`s** (`EDIT` `Z0` `8 ROOMS`) with the room name as plain text, as the main menu's
  connection readout does.
- **Legend/Controls as a modal** (`mu.ui.dialog`, if the SDK offers it) rather than an anchored popover, since they are
  reference text, not a menu.
- **Room size setting**: expose `ROOM_HALF` as a user setting (compact 0.3 / normal 0.36 / dense 0.42) in the
  extension's settings tab.
- **Unicode glyphs only**: the Legend uses inline SVG for link samples; the style guide allows SVG only for the
  volume icon and close ×, so these could become box-drawing glyphs (`─ ┄ ⇄ ▲ ▼`).
