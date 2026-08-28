import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

export default defineSchema({
  links: defineTable({
    slug: v.string(),
    status: v.string(),
    expiresAt: v.integer(),
    expiredAt: v.optional(v.integer()),
  })
    .visibility({ kind: 'public-read' })
    .index('by_status_and_expires_at', ['status', 'expiresAt'])
    .index('by_expires_at', ['expiresAt'])
    .sync(),
});
