// Provider-native Fleet Observatory Move-1 backend. The required route is one
// generated mixed snapshot-batch.v2 tuple; no JavaScript handler assembles or
// joins its result collections.

import {
  asc,
  defineBoundedChildrenQuery,
  defineJsMutation,
  defineJsQuery,
  defineRelationalQuery,
  defineSnapshotBatchQuery,
  owner,
  results,
  throughParent,
  v,
} from '@expo/snapback-codegen/define';
import {
  events,
  fleetRollups,
  fleetViews,
  vehicleFacts,
} from './schema.mjs';

export const latestEventsWithVehicles = defineRelationalQuery({
  root: events,
  joined: vehicleFacts,
  join: [{ root: 'deviceKey', joined: 'deviceKey' }],
  kind: 'inner',
  visibility: {
    root: { kind: 'owner', field: 'queryOwnerId' },
    joined: { kind: 'owner', field: 'fixtureOwnerId' },
    output: 'owner',
  },
  projection: {
    eventKey: { root: 'eventKey' },
    queryRank: { root: 'queryRank' },
    fleetKey: { root: 'fleetKey' },
    severity: { root: 'severity' },
    message: { root: 'message' },
    occurredAt: { root: 'occurredAt' },
    deviceKey: { root: 'deviceKey' },
    deviceName: { joined: 'deviceName' },
    deviceStatus: { joined: 'status' },
    region: { joined: 'region' },
    ownerKey: { joined: 'ownerKey' },
    ownerName: { joined: 'ownerName' },
  },
  take: 100,
  rootIndex: 'by_query_owner_rank',
  joinedIndex: 'by_device_key',
  retention: 'none',
});

export const vehicleRollupPage = defineBoundedChildrenQuery({
  parent: {
    table: fleetViews,
    idArg: 'viewId',
    visibility: owner('ownerId'),
    select: {
      fleetKey: 'fleetKey',
      filterKey: 'filterKey',
      label: 'label',
    },
  },
  children: {
    table: fleetRollups,
    foreignKey: 'viewId',
    parentIncarnation: 'viewIncarnation',
    visibility: throughParent(),
    index: 'by_view_rank',
    order: [asc('rank')],
    select: {
      id: '_id',
      eventKey: 'eventKey',
      deviceKey: 'deviceKey',
      rank: 'rank',
      ownerName: 'ownerName',
      currentMessage: 'currentMessage',
      activeMatch: 'activeMatch',
    },
  },
  take: 100,
  parentDeletion: 'hide-orphans.v1',
});

// @ref LLP 0135#relational-composite-successor-owner-ruling--2026-08-05 —
// the declaration is a static mixed tuple of already-admitted nodes.
// @ref LLP 0157#sbsb2-plaintext-and-budget — the generated composite owns one
// sbsb2 continuation across the relational root and bounded-child page.
// @ref LLP 0157#d4--capability-classification — v2 is live_replace on its
// cursor-free first page and retention:"none"; this app does not retain it.
export const fleetObservatory = defineSnapshotBatchQuery({
  nodes: [latestEventsWithVehicles, vehicleRollupPage],
});

async function ownedView(ctx, viewId) {
  const view = await ctx.db.get('fleetViews', viewId);
  if (!view || view.ownerId !== ctx.auth.userId) {
    const error = new Error('fleet view not found');
    error.code = 'SNAPBACK_ROW_NOT_FOUND';
    throw error;
  }
  return view;
}

export const createFleetView = defineJsMutation({
  auth: 'authenticated',
  args: {
    fleetKey: v.string(),
    filterKey: v.string(),
    label: v.string(),
  },
  writes: ['fleetViews'],
  result: results.value(v.id('fleetViews')),
  handler: async (ctx, args) => ctx.db.insert('fleetViews', {
    fleetKey: args.fleetKey,
    filterKey: args.filterKey,
    label: args.label,
  }),
});

const rollupInput = v.object({
  eventKey: v.string(),
  deviceKey: v.string(),
  rank: v.integer(),
  ownerName: v.string(),
  currentMessage: v.string(),
  activeMatch: v.boolean(),
});

export const seedRollupBatch = defineJsMutation({
  auth: 'authenticated',
  args: {
    viewId: v.id('fleetViews'),
    rows: v.array(rollupInput, { maxItems: 100 }),
  },
  reads: ['fleetViews'],
  writes: ['fleetRollups'],
  discloseUniqueConflicts: [{
    table: 'fleetRollups',
    writeForm: 'insert',
    constraint: 'by_event_key',
    operations: ['seedRollupBatch'],
  }],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ownedView(ctx, args.viewId);
    for (const row of args.rows) {
      await ctx.db.insert('fleetRollups', {
        viewId: args.viewId,
        eventKey: row.eventKey,
        deviceKey: row.deviceKey,
        rank: row.rank,
        ownerName: row.ownerName,
        currentMessage: row.currentMessage,
        activeMatch: row.activeMatch,
      });
    }
    return args.rows.length;
  },
});

const vehicleInput = v.object({
  deviceKey: v.string(),
  fleetKey: v.string(),
  ownerKey: v.string(),
  ownerName: v.string(),
  deviceName: v.string(),
  region: v.string(),
  status: v.string(),
});

export const ingestVehicleBatch = defineJsMutation({
  auth: 'authenticated',
  args: { rows: v.array(vehicleInput, { maxItems: 900 }) },
  writes: ['vehicleFacts'],
  discloseUniqueConflicts: [{
    table: 'vehicleFacts',
    writeForm: 'insert',
    constraint: 'by_device_key',
    operations: ['ingestVehicleBatch'],
  }],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    for (const row of args.rows) {
      await ctx.db.insert('vehicleFacts', {
        deviceKey: row.deviceKey,
        fleetKey: row.fleetKey,
        ownerKey: row.ownerKey,
        ownerName: row.ownerName,
        deviceName: row.deviceName,
        region: row.region,
        status: row.status,
      });
    }
    return args.rows.length;
  },
});

const eventInput = v.object({
  eventKey: v.string(),
  deviceKey: v.string(),
  fleetKey: v.string(),
  severity: v.string(),
  message: v.string(),
  fixtureRank: v.integer(),
  queryRank: v.integer(),
  occurredAt: v.integer(),
  activeForOwner: v.boolean(),
});

export const ingestEventBatch = defineJsMutation({
  auth: 'authenticated',
  args: { rows: v.array(eventInput, { maxItems: 900 }) },
  writes: ['events'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    for (const row of args.rows) {
      await ctx.db.insert('events', {
        fixtureOwnerId: ctx.auth.userId,
        queryOwnerId: row.activeForOwner
          ? ctx.auth.userId
          : 'fleet-observatory-nonmatching-principal',
        eventKey: row.eventKey,
        deviceKey: row.deviceKey,
        fleetKey: row.fleetKey,
        severity: row.severity,
        message: row.message,
        fixtureRank: row.fixtureRank,
        queryRank: row.queryRank,
        occurredAt: row.occurredAt,
      });
    }
    return args.rows.length;
  },
});

const burstInput = v.object({
  eventKey: v.string(),
  message: v.string(),
  activeRank: v.optional(v.integer()),
});

export const applyTelemetryBurst = defineJsMutation({
  auth: 'authenticated',
  args: {
    viewId: v.id('fleetViews'),
    updates: v.array(burstInput, { maxItems: 100 }),
  },
  reads: ['fleetViews', 'events', 'fleetRollups'],
  writes: ['events', 'fleetRollups'],
  result: results.value(v.object({
    eventsChanged: v.integer(),
    activeRollupsChanged: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ownedView(ctx, args.viewId);
    let eventsChanged = 0;
    let activeRollupsChanged = 0;
    for (const update of args.updates) {
      const event = await ctx.db.query('events')
        .withIndex('by_event_key')
        .eq('eventKey', update.eventKey)
        .first();
      if (!event || event.fixtureOwnerId !== ctx.auth.userId) continue;
      await ctx.db.patch('events', event._id, { message: update.message });
      eventsChanged += 1;
      if (update.activeRank !== null && update.activeRank !== undefined) {
        const rollup = await ctx.db.query('fleetRollups')
          .withIndex('by_event_key')
          .eq('eventKey', update.eventKey)
          .first();
        if (rollup && rollup.viewId === args.viewId) {
          await ctx.db.patch('fleetRollups', rollup._id, {
            currentMessage: update.message,
            activeMatch: true,
          });
          activeRollupsChanged += 1;
        }
      }
    }
    return { eventsChanged, activeRollupsChanged };
  },
});

// Acceptance-only refusal probe. Its omission of take is intentional: the
// 250,000-row owner partition must refuse rather than surface an incomplete
// 1,024-row prefix as a complete result.
export const implicitPrefixProbe = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['events'],
  result: results.records(v.object({
    eventKey: v.string(),
    fixtureRank: v.integer(),
  })),
  handler: async (ctx) => {
    const rows = await ctx.db.query('events')
      .withIndex('by_fixture_rank')
      .eq('fixtureOwnerId', ctx.auth.userId)
      .collect();
    return rows.map(({ eventKey, fixtureRank }) => ({ eventKey, fixtureRank }));
  },
});
