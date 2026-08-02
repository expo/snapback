import {defineSchema, defineTable, v} from '../../../../_kit/define.mjs';

export default defineSchema({
  records: defineTable({
    assignmentId: v.string(),
    title: v.string(),
    body: v.string(),
    checklistDone: v.boolean(),
    revision: v.integer(),
  }).index('by_assignment', ['assignmentId']).sync(),
}, {auth: {mode: 'dev'}});
