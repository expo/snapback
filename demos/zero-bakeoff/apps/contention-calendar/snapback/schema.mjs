// @ref LLP 0138#a3--contention-calendar — exact-one-winner authority is a
// structural constraint, not a client-side availability check.
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const resources = defineTable({
  key: v.string(),
  title: v.string(),
}).visibility({ kind: 'public-read' }).index('by_key', ['key'], { unique: true }).sync();

export const reservations = defineTable({
  idempotencyKey: v.string(),
  resourceKey: v.string(),
  slotKey: v.string(),
  resourceSlotKey: v.string(),
  ownerId: v.string(),
  title: v.string(),
  createdAt: v.integer(),
}).visibility({ kind: 'public-read' })
  .index('by_idempotency', ['idempotencyKey'], { unique: true })
  .index('by_resource_slot', ['resourceSlotKey'], { unique: true })
  .index('by_slot_owner', ['slotKey', 'ownerId'])
  .sync();

export default defineSchema({ resources, reservations });
