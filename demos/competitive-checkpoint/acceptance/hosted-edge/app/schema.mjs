// Minimal sessions-mode application for the LLP 0098 hosted-edge matrix.
//
// Deliberately tiny and separate from the checkpoint demo app: the matrix needs
// `auth: { mode: 'sessions' }` (the checkpoint app is `dev`, and several landed
// receipts depend on it staying that way). One owned table is enough to give
// the LLP 0077 grant matrix a real authenticated route to exercise.

import { defineSchema, defineTable, v } from '@snapback/codegen/define';

export const notes = defineTable({
  ownerId: v.principal(),
  body: v.string(),
  createdAt: v.integer(),
})
  .index('notes_by_owner', ['ownerId'])
  .sync();

export default defineSchema({ notes }, { auth: { mode: 'sessions' } });
