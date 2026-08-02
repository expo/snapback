// @ref LLP 0138#a2--latency-kanban — the paired fixture is four columns and
// 500 cards; server authority owns lock rejection and revision conflicts.
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const columns = defineTable({
  key: v.string(),
  title: v.string(),
  rank: v.integer(),
}).index('by_key', ['key'], { unique: true }).index('by_rank', ['rank']).sync();

export const cards = defineTable({
  key: v.string(),
  title: v.string(),
  columnKey: v.string(),
  rank: v.integer(),
  assigneeId: v.string(),
  archived: v.boolean(),
  locked: v.boolean(),
  revision: v.integer(),
}).index('by_key', ['key'], { unique: true })
  .index('by_column_rank', ['columnKey', 'rank'])
  .sync();

export default defineSchema({ columns, cards });
