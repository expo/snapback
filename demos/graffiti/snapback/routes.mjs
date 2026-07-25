// Graffiti wall — route→query manifest (LLP 0090 D1.4 / LLP 0092 §0C.1).
//
// Channel A's declarative statement of what the wall needs before app JS
// runs: the root route paints the shared wall, so it preloads `listCells`
// for the one shared board. `/board/:boardId` demonstrates the `params-v1`
// param-reference form for a future multi-board wall — same query, the
// board id bound from the path instead of a literal.
//
// Codegen compiles this to `generated/routes.manifest.json`; the served
// instance admits it beside the functions manifest at ensure, and its
// canonical hash becomes the `routeManifestHash` generation component
// (LLP 0091 §0A.6). Selection only: whether these rows may be inlined into
// tokenless HTML is `listCells`'s own `publicInline` fact (functions.mjs),
// never something this file can widen.

import { defineRoutes, routeParam } from '../../_kit/define.mjs';

// The one shared wall (surfaces/contract/board.mjs pins the same id).
const BOARD_ID = 'wall';

export default defineRoutes([
  {
    route: '/',
    queries: [{ function: 'listCells', args: { boardId: BOARD_ID } }],
  },
  {
    route: '/board/:boardId',
    queries: [{ function: 'listCells', args: { boardId: routeParam('boardId') } }],
  },
]);
