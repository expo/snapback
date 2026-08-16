// All Aboard (Caltrain next-train) demo schema — source of truth for the durable
// tables. Seeded deterministically from demos/all-aboard/snapback/shared/model.mjs.
//
// @ref LLP 0027#data-model-durable — the static schedule (stations/trips/stopTimes)
//   is committed seed data; trainStatus is the refresh-written delay overlay,
//   liveDepartures is the 511-written departure board, and feedRefreshState is
//   the read-through freshness marker. feedTicks is the committed "recorded
//   feed" the refresh advances one tick at a time.
// @ref LLP 0027#realtime-model — trainStatus + feedRefreshState are the only
//   original syncable-live tables. liveDepartures is the LLP 0049 correction:
//   a live 511 snapshot must carry real predicted departure times, not just a
//   delay overlay on the demo clock-face schedule.

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
  }).visibility({ kind: 'public-read' }).index('by_order', ['orderIndex']),

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
  }).visibility({ kind: 'public-read' }).index('by_direction', ['direction']),

  // Static stop pattern, indexed by station to back the per-station board.
  stopTimes: defineTable({
    patternId: v.string(),
    stationId: v.string(),
    sequence: v.integer(),
    offsetMinutes: v.integer(),
  }).visibility({ kind: 'public-read' }).index('by_station', ['stationId']),

  // Live, refresh-written. One row per service pattern; the delay the world adds
  // on top of the static schedule. This is the table that makes the screen live.
  trainStatus: defineTable({
    patternId: v.string(),
    delaySeconds: v.integer(),
    status: v.string(),
    observedAt: v.integer(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_pattern', ['patternId'])
    .sync(),

  // Live, refresh-written. One row per mappable 511 StopMonitoring visit.
  // This table is what prevents a 3am board from inventing clock-face trains:
  // when feedRefreshState.lastSource is live, the surface prefers these real
  // predicted departure rows and shows "no trains" if 511 has none.
  liveDepartures: defineTable({
    departureId: v.string(),
    stationId: v.string(),
    stopName: v.string(),
    direction: v.string(),
    service: v.string(),
    patternId: v.string(),
    trainNumber: v.string(),
    headsign: v.string(),
    scheduledDepartureMs: v.integer(),
    predictedDepartureMs: v.integer(),
    delaySeconds: v.integer(),
    status: v.string(),
    observedAt: v.integer(),
    source: v.string(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_time', ['predictedDepartureMs'])
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
    // When the last upstream 511 poll was *claimed* (attempted), not just when
    // one succeeded. claimFeedPoll stamps it transactionally before refreshFeed
    // is allowed to touch 511, so cron + manual refresh together can never
    // exceed one upstream poll per budget window (ENG-23642: 180s cadence).
    lastUpstreamPollAt: v.optional(v.integer()),
  }).visibility({ kind: 'public-read' }).sync(),

  // The committed "recorded feed" — a cycle of delay profiles the refresh applies
  // one tick at a time (frozen-clock deterministic). delays: { patternId: seconds }.
  feedTicks: defineTable({
    tickIndex: v.integer(),
    delays: v.json(),
    note: v.string(),
  }).visibility({ kind: 'public-read' }).index('by_index', ['tickIndex']),
});
