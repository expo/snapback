// Sessions-mode variant of the same app, used only by the browser public
// witness's protected-retention-refusal phase. The auth mode is a SCHEMA
// declaration (see demos/file-drop/snapback/schema.mjs): under sessions mode
// every non-authorityIndependent live subscription is auth-scoped (LLP 0053's
// protected class), which is what makes the shipped client classify
// SNAPBACK_RETENTION_NOT_RETAINABLE — dev custody never mints an
// authorization scope, so the refusal is unreachable there.
import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  todos: defineTable({
    listId: v.string(),
    title: v.string(),
    done: v.boolean(),
    note: v.optional(v.string()),
  })
    .visibility({ kind: 'public-read' })
    .index('by_list_title', ['listId', 'title'])
    .sync(),
}, { auth: { mode: 'sessions' } });
