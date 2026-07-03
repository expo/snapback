// Collaborative graffiti wall — durable queries + mutations as HostPlans.
//
// The wall is intentionally append-only: painting a pixel inserts a new mark
// rather than upserting one, because (a) HostPlan has insert/patch/delete by id
// but no upsert-by-coordinate, and (b) append-only marks map cleanly onto the
// live-replace lane — rows only grow, and the client renders last-writer-wins
// per (x, y). This is the same shape r/place-style walls use without a unique
// pixel row.
//
// @ref LLP 0004#handler-api — queries are read-oriented, mutations write-oriented;
//   server-owned _createdAt/_updatedAt mean handlers never set timestamps, and
//   last-writer-wins is just "newest _createdAt for a coordinate".
// @ref LLP 0012#function-manifest — paintCell and listCells are the wall's whole
//   generated function surface; clients (headless and Contract alike) call them
//   by generated reference, never by route or table name.

import {
  arg,
  asc,
  authUserId,
  defineLiveQuery,
  defineMutation,
  eq,
  insert,
  returnBinding,
  v,
} from '../../_kit/define.mjs';

// Syncable-live query: every mark on a shared board, oldest first, via by_board.
// Unlike the todo demos this is NOT user-scoped — a graffiti wall is shared, so
// the filter is the board id (an arg), not authUserId().
export const listCells = defineLiveQuery({
  table: 'cells',
  args: { boardId: v.string() },
  filter: [eq('boardId', arg('boardId'))],
  order: [asc('_createdAt')],
  index: 'by_board',
});

// Paint one pixel: append a mark owned by the authenticated painter. The client
// publishes its ephemeral cursor separately; this is the durable half only.
export const paintCell = defineMutation({
  args: {
    boardId: v.string(),
    x: v.integer(),
    y: v.integer(),
    color: v.string(),
  },
  plan: insert(
    'cells',
    {
      boardId: arg('boardId'),
      x: arg('x'),
      y: arg('y'),
      color: arg('color'),
      authorId: authUserId(),
    },
    { bindIdAs: 'cellId' },
  ),
  returns: returnBinding('cellId'),
});
