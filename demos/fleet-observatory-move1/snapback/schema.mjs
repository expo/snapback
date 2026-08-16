// Fresh Move-1 Fleet storage. The 250,000 protected source events remain
// server-side; the required screen receives only its generated composite
// projections.
//
// @ref LLP 0157#move-1-workload-exit-llp-0155-normative-transcription —
// source ownership, bounded pages, and query-scoped custody replace the
// predecessor's application-side join over an implicit prefix.

import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const fleetViews = defineTable({
  ownerId: v.principal(),
  fleetKey: v.string(),
  filterKey: v.string(),
  label: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_owner_filter', ['ownerId', 'filterKey'], { unique: true })
  .sync();

export const fleetRollups = defineTable({
  ownerId: v.principal(),
  viewId: v.id('fleetViews'),
  viewIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'viewId',
    parentTable: 'fleetViews',
  }),
  eventKey: v.string(),
  deviceKey: v.string(),
  rank: v.integer(),
  ownerName: v.string(),
  currentMessage: v.string(),
  activeMatch: v.boolean(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_view_rank', ['viewId', 'viewIncarnation', 'rank'])
  .index('by_event_key', ['eventKey'], { unique: true })
  .sync();

export const vehicleFacts = defineTable({
  fixtureOwnerId: v.principal(),
  deviceKey: v.string(),
  fleetKey: v.string(),
  ownerKey: v.string(),
  ownerName: v.string(),
  deviceName: v.string(),
  region: v.string(),
  status: v.string(),
})
  .visibility({ kind: 'owner', field: 'fixtureOwnerId' })
  .index('by_device_key', ['deviceKey'], { unique: true })
  .sync();

export const events = defineTable({
  fixtureOwnerId: v.principal(),
  queryOwnerId: v.principal(),
  eventKey: v.string(),
  deviceKey: v.string(),
  fleetKey: v.string(),
  severity: v.string(),
  message: v.string(),
  fixtureRank: v.integer(),
  queryRank: v.integer(),
  occurredAt: v.integer(),
})
  .visibility({
    kind: 'any-of',
    arms: [
      { kind: 'owner', field: 'fixtureOwnerId' },
      { kind: 'owner', field: 'queryOwnerId' },
    ],
  })
  .index('by_event_key', ['eventKey'], { unique: true })
  .index('by_fixture_rank', ['fixtureOwnerId', 'fixtureRank'], { unique: true })
  .index('by_query_owner_rank', ['queryOwnerId', 'queryRank'], { unique: true })
  .sync();

export default defineSchema({
  fleetViews,
  fleetRollups,
  vehicleFacts,
  events,
}, { auth: { mode: 'sessions' } });
