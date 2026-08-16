import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  incidents: defineTable({
    ownerId: v.principal(),
    title: v.string(),
    status: v.string(),
    eventId: v.string(),
    reportedAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_time', ['ownerId', 'reportedAt'])
    .index('by_owner_event', ['ownerId', 'eventId'], { unique: true })
    .sync(),
  auditEntries: defineTable({
    ownerId: v.principal(),
    incidentId: v.id('incidents'),
    eventId: v.string(),
    kind: v.string(),
    occurredAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_incident', ['ownerId', 'incidentId'])
    .sync(),
}, { auth: { mode: 'dev' } });
