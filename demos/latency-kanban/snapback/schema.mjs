// Provider-native Move-3 exit schema: complete public card materialization is
// the bounded read world used by generated point mutations.
// @ref LLP 0155#execution-contract — local evaluation reads only admitted
// materialization rows; the authoritative server remains the settlement owner.

import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const boards = defineTable({
  name: v.string(),
}).visibility({ kind: 'public-read' }).sync();

export const cards = defineTable({
  boardId: v.id('boards'),
  title: v.string(),
  column: v.string(),
  rank: v.integer(),
  assignee: v.string(),
  archived: v.boolean(),
  locked: v.boolean(),
  revision: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_board_rank', ['boardId', 'rank'])
  .sync();

export default defineSchema({ boards, cards });
