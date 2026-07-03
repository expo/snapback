// Shared wall constants + per-tab painter identity. Plain JS so the Contract
// helpers (data.ts) and main.ts can both import it.

export const BOARD_ID = 'wall';
export const COLS = 24;
export const ROWS = 14;
export const CELL = 22;
export const BOARD_WIDTH = COLS * CELL;
export const BOARD_HEIGHT = ROWS * CELL;

// Unpainted cells render as this near-white "grout" color.
export const EMPTY_COLOR = '#f1f1f4';

// The brush palette. The last entry erases (paints the empty color back).
export const PALETTE = [
  { id: 'ink', color: '#1c1d21', label: 'Ink' },
  { id: 'red', color: '#e5484d', label: 'Red' },
  { id: 'orange', color: '#f76b15', label: 'Orange' },
  { id: 'amber', color: '#ffb224', label: 'Amber' },
  { id: 'yellow', color: '#f5d90a', label: 'Yellow' },
  { id: 'lime', color: '#99d52a', label: 'Lime' },
  { id: 'green', color: '#30a46c', label: 'Green' },
  { id: 'teal', color: '#12a594', label: 'Teal' },
  { id: 'blue', color: '#3e63dd', label: 'Blue' },
  { id: 'indigo', color: '#5e6ad2', label: 'Indigo' },
  { id: 'violet', color: '#8e4ec6', label: 'Violet' },
  { id: 'pink', color: '#e93d82', label: 'Pink' },
  { id: 'erase', color: EMPTY_COLOR, label: 'Erase' },
];

const NAMES = ['Ada', 'Grace', 'Linus', 'Hopper', 'Turing', 'Margaret', 'Dennis', 'Ken', 'Barbara', 'Katherine', 'Alan', 'Radia'];
const PAINTER_COLORS = PALETTE.filter((s) => s.id !== 'erase').map((s) => s.color);

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

// A fresh painter identity for this browser tab: a name, a brush color, and a
// distinct app user id.
export function randomPainter() {
  return {
    userId: `painter_${Math.random().toString(36).slice(2, 8)}`,
    name: pick(NAMES),
    color: pick(PAINTER_COLORS),
  };
}
