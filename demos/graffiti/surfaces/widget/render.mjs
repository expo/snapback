// Graffiti wall — widget-shaped read-mode surface (LLP 0090 D4 rollout
// step 7, ENG-25458).
//
// The socket-less Channel C consumer in its smallest honest form: the shape a
// WidgetKit timeline, watch complication, or notification extension takes —
// ONE anonymous read-mode `POST /app/bundle` against a parameterized route
// (`/board/:boardId`, the D4 deep-link case with params-v1 binding the board
// id), render the current rows, exit. No WebSocket, no subscription, no
// client kit at all — plain `fetch` is the entire transport, and freshness is
// pull-based (the next timeline tick fetches again).
//
// v1 rule (LLP 0090 D4 / LLP 0031 dated amendment): socket-less Channel C is
// limited to public (`publicInline`-class) bundles — graffiti's `listCells`
// carries the codegen-compiled public + authorityIndependent + publicInline
// triple, so the anonymous read is admitted; a route with any
// non-`publicInline` query would refuse `SNAPBACK_BUNDLE_NOT_PUBLIC`.
// Register mode is scoped to credentialed callers: if this anonymous surface
// asks for it, the server refuses `SNAPBACK_BUNDLE_REGISTER_REQUIRES_
// CREDENTIAL` explicitly and the widget retries in read mode — never a
// silent mode substitution (it must not believe registrations exist).
//
// Run: node demos/graffiti/surfaces/widget/render.mjs [apiUrl] [boardId]

import { COLS, EMPTY_COLOR, PALETTE, ROWS } from '../contract/board.mjs';

/// Mint the 22-char base64url boot key locally (LLP 0092 §0D.3's id shape) —
/// the widget deliberately carries no client-kit dependency.
function mintBootKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/// Last-writer-wins per coordinate over the append-only marks, newest
/// `_createdAt` wins (ties: later row order). Returns a ROWS×COLS color grid.
export function wallGrid(rows) {
  const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => EMPTY_COLOR));
  const newest = new Map();
  for (const mark of rows ?? []) {
    if (!Number.isInteger(mark?.x) || !Number.isInteger(mark?.y)) continue;
    if (mark.x < 0 || mark.x >= COLS || mark.y < 0 || mark.y >= ROWS) continue;
    const key = `${mark.x},${mark.y}`;
    const held = newest.get(key);
    if (!held || (mark._createdAt ?? 0) >= (held._createdAt ?? 0)) newest.set(key, mark);
  }
  for (const mark of newest.values()) grid[mark.y][mark.x] = mark.color;
  return grid;
}

const GLYPHS = new Map(PALETTE.map((swatch, index) => [
  swatch.color,
  swatch.id === 'erase' ? '·' : 'ABCDEFGHIJKLMNOPQRSTUVWX'[index] ?? '#',
]));

/// Render the grid as plain text — one glyph per cell, `·` for grout — so a
/// terminal (or a test) can see the wall without any pixel machinery.
export function renderGridText(grid) {
  return grid
    .map((row) => row.map((color) => GLYPHS.get(color) ?? '#').join(''))
    .join('\n');
}

/**
 * Fetch one read-mode bundle and render it. Exactly one HTTP request in the
 * happy path; the only second request is the explicit read-mode retry after
 * a coded anonymous-register refusal. Never opens a WebSocket.
 */
export async function renderWidgetBundle({
  apiUrl,
  boardId = 'wall',
  mode = 'read',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof apiUrl !== 'string' || apiUrl.length === 0) {
    throw new Error('renderWidgetBundle requires an apiUrl');
  }
  const request = {
    route: '/board/:boardId',
    params: { boardId },
    mode,
  };
  if (mode === 'register') request.idempotencyKey = mintBootKey();
  const response = await fetchImpl(`${apiUrl}/app/bundle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json();
  if (!response.ok) {
    const code = body?.diagnostic?.code ?? `HTTP_${response.status}`;
    if (mode === 'register' && code === 'SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL') {
      // The refusal is explicit and the retry is an explicit READ request —
      // the widget knows no registrations exist (LLP 0092 §0D.2).
      const fallback = await renderWidgetBundle({ apiUrl, boardId, mode: 'read', fetchImpl });
      return { ...fallback, refusedRegister: code };
    }
    const error = new Error(`widget bundle refused: ${code}`);
    error.code = code;
    error.diagnostic = body?.diagnostic ?? null;
    throw error;
  }
  const entry = (body.entries ?? []).find((candidate) => candidate.function === 'listCells');
  if (!entry) throw new Error('bundle carried no listCells entry');
  const grid = wallGrid(entry.rows);
  return {
    text: renderGridText(grid),
    marks: entry.rows.length,
    painted: grid.flat().filter((color) => color !== EMPTY_COLOR).length,
    commitVersion: body.commitVersion,
    generation: body.generation,
    resumeToken: entry.resume?.token ?? null,
    refusedRegister: null,
  };
}

// CLI: fetch, print, exit — the whole widget lifecycle.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const apiUrl = process.argv[2] ?? process.env.SNAPBACK_GRAFFITI_API ?? 'http://127.0.0.1:4425';
  const boardId = process.argv[3] ?? 'wall';
  const rendered = await renderWidgetBundle({ apiUrl, boardId });
  console.log(rendered.text);
  console.log(
    `\n${rendered.marks} marks, ${rendered.painted} painted cells @ commit ${rendered.commitVersion} (${rendered.generation})`,
  );
}
