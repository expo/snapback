// All Aboard (Caltrain next-train) demo schema — source of truth for the durable
// tables. Seeded deterministically from demos/all-aboard/snapback/shared/model.mjs.
//
// @ref LLP 0027#data-model-durable — the static schedule (stations/trips/stopTimes)
//   is committed seed data; trainStatus is the refresh-written live table and
//   feedRefreshState is the read-through freshness marker. feedTicks is the
//   committed "recorded feed" the refresh advances one tick at a time.
// @ref LLP 0027#realtime-model — trainStatus + feedRefreshState are the only
//   syncable-live tables; a refresh write to them produces the live-query delta
//   that makes the board update without a manual refresh.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  // Static corridor geometry (north->south). orderIndex is the navigation spine.
  stations: defineTable({
    stationId: v.string(),
    name: v.string(),
    shortName: v.string(),
    orderIndex: v.integer(),
    minutesFromSf: v.integer(),
    zone: v.integer(),
    lat: v.real(),
    lng: v.real(),
    photoUrl: v.string(),
    photoAttribution: v.string(),
  }).index('by_order', ['orderIndex']),

  // Static service patterns (one row per scheduled service class + direction).
  trips: defineTable({
    patternId: v.string(),
    direction: v.string(),
    service: v.string(),
    trainNumberBase: v.integer(),
    minuteSlots: v.json(),
    speedFactor: v.real(),
    originStationId: v.string(),
    destinationStationId: v.string(),
  }).index('by_direction', ['direction']),

  // Static stop pattern, indexed by station to back the per-station board.
  stopTimes: defineTable({
    patternId: v.string(),
    stationId: v.string(),
    sequence: v.integer(),
    offsetMinutes: v.integer(),
  }).index('by_station', ['stationId']),

  // Live, refresh-written. One row per service pattern; the delay the world adds
  // on top of the static schedule. This is the table that makes the screen live.
  trainStatus: defineTable({
    patternId: v.string(),
    delaySeconds: v.integer(),
    status: v.string(),
    observedAt: v.integer(),
  })
    .index('by_pattern', ['patternId'])
    .sync(),

  // Singleton read-through freshness marker (see LLP 0027#feed-refresh-and-cron).
  feedRefreshState: defineTable({
    fetchedAt: v.integer(),
    staleAfterMs: v.integer(),
    tickIndex: v.integer(),
    tickCount: v.integer(),
    lastSource: v.string(),
    lastError: v.optional(v.string()),
    lastRunTrigger: v.optional(v.string()),
  }).sync(),

  // The committed "recorded feed" — a cycle of delay profiles the refresh applies
  // one tick at a time (frozen-clock deterministic). delays: { patternId: seconds }.
  feedTicks: defineTable({
    tickIndex: v.integer(),
    delays: v.json(),
    note: v.string(),
  }).index('by_index', ['tickIndex']),
});
