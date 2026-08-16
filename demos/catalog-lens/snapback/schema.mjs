// @ref LLP 0080#1-closed-relational-plan — the joined publisher key is
// uniquely indexed and the owner-scoped root has an index-served order.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export const books = defineTable({
  ownerId: v.principal(),
  isbn: v.string(),
  title: v.string(),
  publisherSlug: v.string(),
  createdAt: v.integer(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .index('by_owner_isbn', ['ownerId', 'isbn'], { unique: true })
  .sync();

export const publishers = defineTable({
  slug: v.string(),
  name: v.string(),
  country: v.string(),
})
  .visibility({ kind: 'public-read' })
  .index('by_slug', ['slug'], { unique: true })
  .sync();

export default defineSchema({ books, publishers }, { auth: { mode: 'dev' } });
