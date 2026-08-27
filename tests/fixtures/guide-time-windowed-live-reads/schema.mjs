import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

export default defineSchema({
  events: defineTable({
    ownerId: v.principal(),
    label: v.string(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .sync(),
  typingLeases: defineTable({
    ownerId: v.principal(),
    typerLabel: v.string(),
    expiresAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_and_typer', ['ownerId', 'typerLabel'], { unique: true })
    .sync(),
});
