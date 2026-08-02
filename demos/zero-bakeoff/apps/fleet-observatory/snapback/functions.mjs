import {defineJsLiveQuery, defineJsMutation, results, v} from '../../../../_kit/define.mjs';

export const latestEvents = defineJsLiveQuery({
  args: {fleetKey: v.string(), severity: v.optional(v.string()), region: v.optional(v.string()), deviceStatus: v.optional(v.string())},
  reads: ['fleetMemberships', 'events', 'devices', 'owners'],
  result: results.records(v.object({
    eventKey: v.string(), deviceKey: v.string(), fleetKey: v.string(), severity: v.string(), message: v.string(),
    pageKey: v.string(), occurredAt: v.integer(), deviceName: v.string(), deviceStatus: v.string(),
    region: v.string(), ownerKey: v.string(), ownerName: v.string(),
  })),
  handler: async (ctx, args) => {
    const memberships = await ctx.db.query('fleetMemberships').withIndex('by_fleet_user').eq('fleetKey', args.fleetKey).eq('userKey', ctx.auth.userId).take(1).collect();
    if (memberships.length === 0) return [];
    // @ref LLP 0004#ctxdb-contract — the global page is ordered and bounded
    // in the query builder; application-side sorting of a prefix is incomplete.
    let eventQuery;
    if (args.severity && args.region && args.deviceStatus) {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_severity_region_status_page').eq('fleetKey', args.fleetKey).eq('severity', args.severity).eq('region', args.region).eq('deviceStatus', args.deviceStatus);
    } else if (args.severity && args.region) {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_severity_region_page').eq('fleetKey', args.fleetKey).eq('severity', args.severity).eq('region', args.region);
    } else if (args.severity && args.deviceStatus) {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_severity_status_page').eq('fleetKey', args.fleetKey).eq('severity', args.severity).eq('deviceStatus', args.deviceStatus);
    } else if (args.region && args.deviceStatus) {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_region_status_page').eq('fleetKey', args.fleetKey).eq('region', args.region).eq('deviceStatus', args.deviceStatus);
    } else if (args.severity) {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_severity_page').eq('fleetKey', args.fleetKey).eq('severity', args.severity);
    } else if (args.region) {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_region_page').eq('fleetKey', args.fleetKey).eq('region', args.region);
    } else if (args.deviceStatus) {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_status_page').eq('fleetKey', args.fleetKey).eq('deviceStatus', args.deviceStatus);
    } else {
      eventQuery = ctx.db.query('events').withIndex('by_fleet_page').eq('fleetKey', args.fleetKey);
    }
    const events = await eventQuery.order('pageKey', 'desc').take(100).collect();
    const output = [];
    for (const event of events) {
      const devices = await ctx.db.query('devices').withIndex('by_device_key').eq('deviceKey', event.deviceKey).take(1).collect();
      const owners = await ctx.db.query('owners').withIndex('by_owner_key').eq('ownerKey', event.ownerKey).take(1).collect();
      output.push({
        eventKey: event.eventKey, deviceKey: event.deviceKey, fleetKey: event.fleetKey,
        severity: event.severity, message: event.message, pageKey: event.pageKey, occurredAt: event.occurredAt,
        deviceName: devices[0]?.name ?? '', deviceStatus: event.deviceStatus, region: event.region,
        ownerKey: event.ownerKey, ownerName: owners[0]?.name ?? '',
      });
    }
    return output;
  },
});

export const applyTelemetryBurst = defineJsMutation({
  args: {updates: v.json()}, reads: ['events'], writes: ['events'], result: results.value(v.integer()),
  handler: async (ctx, args) => {
    if (!Array.isArray(args.updates) || args.updates.length > 1000) throw new Error('burst must contain at most 1000 updates');
    let changed = 0;
    for (const update of args.updates) {
      const rows = await ctx.db.query('events').withIndex('by_event_key').eq('eventKey', update.eventKey).take(1).collect();
      if (rows[0]) {
        await ctx.db.patch('events', rows[0]._id, {message: update.message});
        changed += 1;
      }
    }
    return changed;
  },
});

export const ingestFixtureBatch = defineJsMutation({
  args: {kind: v.string(), rows: v.json()}, writes: ['fleets', 'fleetMemberships', 'owners', 'devices', 'events'], result: results.value(v.integer()),
  handler: async (ctx, args) => {
    if (!Array.isArray(args.rows) || args.rows.length > 900) throw new Error('fixture batch must contain at most 900 rows');
    if (!['fleets', 'fleetMemberships', 'owners', 'devices', 'events'].includes(args.kind)) throw new Error('unknown fixture table');
    for (const row of args.rows) await ctx.db.insert(args.kind, row);
    return args.rows.length;
  },
});
