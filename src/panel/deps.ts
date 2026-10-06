/**
 * What the panel is handed by `src/index.ts` and what its own modules share. Nothing here touches the DOM.
 */
import type { Dispose, Mu, ThemeTokens } from '@muclient/sdk';
import type { MapRoom, MapStore, SessionTrack, Tracker, Walker } from '../types';
import type { PickState, View } from './view';

/** The extension's settings, as the integrator exposes them (per world with the all-worlds fallback). */
export interface PanelSettings {
  get<T>(key: string): T;
  watch(key: string, fn: () => void): Dispose;
}

/** A row of one of the panel's own menus. `sep` draws a rule; `on` marks a checked toggle. */
export interface MenuItem {
  label: string;
  run?: () => void;
  hint?: string;
  warn?: boolean;
  disabled?: boolean;
  on?: boolean;
  sep?: boolean;
}

/** `mountPanel`'s dependencies. */
export interface PanelDeps {
  mu: Mu;
  store(worldId: string): MapStore | null;
  tracker: Tracker;
  walker: Walker;
  settings: PanelSettings;
  /** Other extensions' entries for a room's menu: push into `items` before the menu opens. */
  onRoomMenu?(roomId: string, items: MenuItem[]): void;
}

export type Tokens = ThemeTokens;

/** A drag of selected rooms in progress: the cells they would land on. */
export interface DragPreview { cells: Array<{ x: number; y: number }> }
/** A rubber band in CSS px of the canvas. */
export interface BoxSelect { x0: number; y0: number; x1: number; y1: number }

/** The actions every module may call; `index.ts` implements them once. */
export interface PanelActions {
  zoom(factor: number, at?: { px: number; py: number }): void;
  fit(): void;
  /** Centre on the player's room; false when the position is unknown. */
  centreOnMe(): boolean;
  setFloor(dz: number): void;
  setMode(mode: 'walk' | 'edit'): void;
  walkTo(id: string): void;
  imHere(id: string): void;
  deleteRooms(ids: string[]): Promise<void>;
  moveSelection(dx: number, dy: number, dz?: number): void;
  selectConnected(id: string): void;
  startPick(p: PickState): void;
  cancelPick(): void;
  undo(): void;
  redo(): void;
  togglePaused(): void;
  toggleNames(): void;
  toggleFollow(): void;
  toggleDetails(): void;
  /** The Areas dialog, anchored under the toolbar. */
  openAreas(area?: string): void;
}

/** The live context of one mounted panel, shared by toolbar, canvas, inspector and menus. */
export interface PanelCtx {
  readonly mu: Mu;
  readonly sid: string;
  readonly worldId: string;
  readonly store: MapStore;
  readonly tracker: Tracker;
  readonly walker: Walker;
  readonly settings: PanelSettings;
  readonly deps: PanelDeps;
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly view: View;
  actions: PanelActions;
  hover: string | null;
  drag: DragPreview | null;
  box: BoxSelect | null;
  tokens(): Tokens;
  calm(): boolean;
  here(): MapRoom | null;
  track(): SessionTrack | undefined;
  /** Ask for a redraw: `canvas` only, or everything (toolbar, inspector, status too). Coalesced per frame. */
  invalidate(what?: 'canvas' | 'all'): void;
  /** A transient message in the status line (null clears it). */
  status(msg: string | null): void;
  toast(title: string, body?: string): void;
}
