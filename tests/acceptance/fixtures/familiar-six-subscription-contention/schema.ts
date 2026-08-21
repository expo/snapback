import { defineSchema, defineTable, v } from './generated/server';

function stateTable() {
  return defineTable({
    ownerId: v.principal(),
    revision: v.integer(),
    enabled: v.boolean(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_owner', ['ownerId'], { unique: true })
    .sync();
}

export default defineSchema({
  profiles: stateTable(),
  posts: stateTable(),
  follows: stateTable(),
  likes: stateTable(),
  reposts: stateTable(),
  replies: stateTable(),
}, { auth: { mode: 'sessions' } });
