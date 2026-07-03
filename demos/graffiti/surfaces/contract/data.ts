// Pure Contract helpers for the graffiti wall. The .contract owns structure and
// reactive behavior; everything here is deterministic math/formatting so the
// Contract expressions stay free of Math calls (matching the Exact lab demos).

import { CELL, COLS, EMPTY_COLOR, PALETTE, ROWS } from './board.mjs';

export interface Swatch {
  readonly id: string;
  readonly color: string;
  readonly label: string;
}

// One durable mark from the generated listCells binding (append-only rows).
export interface MarkLike {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly _createdAt?: number;
}

// One rendered grid cell after last-writer-wins resolution.
export interface WallCell {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

// One ephemeral presence entry, as the generated boardCursors binding shapes
// it: connection key + the decoded cursor value + the self axis.
export interface PresenceEntry {
  readonly key: string;
  readonly value: PresenceValue;
  readonly updatedAt: number;
  readonly expiresAt?: number;
  readonly sourceClientId: string;
  readonly self: boolean;
}

export interface PresenceValue {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly name?: string;
}

/** The brush palette rendered as the toolbar swatches. */
export function palette(): Swatch[] {
  return PALETTE as Swatch[];
}

/**
 * The full wall grid from append-only marks, last-writer-wins per coordinate.
 * The durable rows arrive oldest-first (listCells orders by _createdAt), so a
 * plain forward pass leaves the newest mark on each cell — the r/place trick
 * for "one pixel, many writers" without a durable upsert.
 */
export function wallCells(rows: MarkLike[]): WallCell[] {
  const latest = new Map<string, string>();
  for (const mark of rows ?? []) {
    if (mark.x < 0 || mark.y < 0 || mark.x >= COLS || mark.y >= ROWS) continue;
    latest.set(`${mark.x},${mark.y}`, mark.color);
  }
  const cells: WallCell[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      cells.push({ id: `${x}-${y}`, x, y, color: latest.get(`${x},${y}`) ?? EMPTY_COLOR });
    }
  }
  return cells;
}

/** An unpainted wall — keeps an unseeded board paintable in the empty state. */
export function blankWall(): WallCell[] {
  return wallCells([]);
}

/** Everyone else's cursors — your own pointer is already on your screen. */
export function remoteCursors(entries: PresenceEntry[]): PresenceEntry[] {
  return (entries ?? []).filter((entry) => !entry.self);
}

// A presence cursor carries board-local pixel coordinates; these center the
// 16px dot on that exact point so it tracks the remote painter's pointer.
const DOT = 16;

/** Pixel left/top of a presence dot for a cursor at board-local (x, y). */
export function cursorLeft(p: PresenceEntry): number {
  return Math.round(p.value.x - DOT / 2);
}
export function cursorTop(p: PresenceEntry): number {
  return Math.round(p.value.y - DOT / 2);
}

/** Ring color for a palette swatch — dark when it is the selected brush. */
export function swatchRing(swatchColor: string, selected: string): string {
  return swatchColor === selected ? '#1c1d21' : '#0000001f';
}

/** First initial shown inside a remote painter's presence dot. */
export function initial(p: PresenceEntry): string {
  const name = p.value.name ?? '';
  return name.length > 0 ? name.slice(0, 1).toUpperCase() : '?';
}

/** Live heading for the presence badge. */
export function presenceHeading(entries: PresenceEntry[]): string {
  const n = remoteCursors(entries).length;
  if (n === 0) return 'just you on the wall';
  if (n === 1) return '1 other painter here';
  return `${n} other painters here`;
}

// Board geometry re-exported as helpers so the .contract's literals live in one
// place (board.mjs) rather than drifting between the view and the math.
export function boardWidth(): number {
  return COLS * CELL;
}
export function boardHeight(): number {
  return ROWS * CELL;
}
