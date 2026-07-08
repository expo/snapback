// The All Aboard app bundle for the LLP 0049 Cloudflare proof (Phase 0:
// recorded-data — no live egress, no cron yet; those arrive with LLP 0049
// Phases 2-3).
//
// Deploy-time compiled into the handler Worker exactly like the notes fixture
// (LLP 0040 §App subset): the Workers runtime forbids dynamic code evaluation,
// so an app-code change is a redeploy. The schema shape and handler contract
// mirror demos/all-aboard/snapback/{schema.mjs,handlers.mjs}; the hashes are
// imported from that demo's generated manifests so the kit client's
// inspect-first /app/ensure attests 'matched' against the same artifacts the
// Contract surface ships with.
//
// @ref LLP 0049#phase-0-recorded-data-all-aboard-on-the-cloudflare-proof —
//   query/mutation/live subset only; recorded/fallback data stays labeled
//   (lastSource is 'seed' / 'recorded' / 'recorded-fallback', never the live
//   '511-siri-stop-monitoring' stamp, which only applyLiveFeedSnapshot writes).

import schemaManifest from '../../demos/all-aboard/snapback/generated/schema.manifest.json';
import functionsManifest from '../../demos/all-aboard/snapback/generated/functions.manifest.json';
import seedData from '../../demos/all-aboard/snapback/seed.json';
import capabilityManifest from '../generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json';

export const appMeta = {
  name: 'all-aboard',
  // The gateway's fixed logical object name for the single-app proof
  // (LLP 0014 one-way door 6: names, not idFromName puns).
  objectName: 'all-aboard-proof',
};

export { capabilityManifest };

export const schema = {
  schemaHash: schemaManifest.schemaHash,
  tables: [
    {
      name: 'stations',
      syncable: false,
      fields: [
        { name: 'stationId', type: 'string', optional: false },
        { name: 'name', type: 'string', optional: false },
        { name: 'shortName', type: 'string', optional: false },
        { name: 'orderIndex', type: 'integer', optional: false },
        { name: 'minutesFromSf', type: 'integer', optional: false },
        { name: 'zone', type: 'integer', optional: false },
        { name: 'lat', type: 'real', optional: false },
        { name: 'lng', type: 'real', optional: false },
        { name: 'photoUrl', type: 'string', optional: false },
        { name: 'photoAttribution', type: 'string', optional: false },
      ],
      indexes: [{ name: 'by_order', fields: ['orderIndex'] }],
    },
    {
      name: 'trips',
      syncable: false,
      fields: [
        { name: 'patternId', type: 'string', optional: false },
        { name: 'direction', type: 'string', optional: false },
        { name: 'service', type: 'string', optional: false },
        { name: 'trainNumberBase', type: 'integer', optional: false },
        { name: 'minuteSlots', type: 'json', optional: false },
        { name: 'speedFactor', type: 'real', optional: false },
        { name: 'originStationId', type: 'string', optional: false },
        { name: 'destinationStationId', type: 'string', optional: false },
      ],
      indexes: [{ name: 'by_direction', fields: ['direction'] }],
    },
    {
      name: 'stopTimes',
      syncable: false,
      fields: [
        { name: 'patternId', type: 'string', optional: false },
        { name: 'stationId', type: 'string', optional: false },
        { name: 'sequence', type: 'integer', optional: false },
        { name: 'offsetMinutes', type: 'integer', optional: false },
      ],
      indexes: [{ name: 'by_station', fields: ['stationId'] }],
    },
    {
      name: 'trainStatus',
      syncable: true,
      fields: [
        { name: 'patternId', type: 'string', optional: false },
        { name: 'delaySeconds', type: 'integer', optional: false },
        { name: 'status', type: 'string', optional: false },
        { name: 'observedAt', type: 'integer', optional: false },
      ],
      indexes: [{ name: 'by_pattern', fields: ['patternId'] }],
    },
    {
      name: 'feedRefreshState',
      syncable: true,
      fields: [
        { name: 'fetchedAt', type: 'integer', optional: false },
        { name: 'staleAfterMs', type: 'integer', optional: false },
        { name: 'tickIndex', type: 'integer', optional: false },
        { name: 'tickCount', type: 'integer', optional: false },
        { name: 'lastSource', type: 'string', optional: false },
        { name: 'lastError', type: 'string', optional: true },
        { name: 'lastRunTrigger', type: 'string', optional: true },
      ],
      indexes: [],
    },
    {
      name: 'feedTicks',
      syncable: false,
      fields: [
        { name: 'tickIndex', type: 'integer', optional: false },
        { name: 'delays', type: 'json', optional: false },
        { name: 'note', type: 'string', optional: false },
      ],
      indexes: [{ name: 'by_index', fields: ['tickIndex'] }],
    },
  ],
};

export const bundleHash = functionsManifest.bundleHash;

// Deterministic seed rows with explicit ids (the demo's generated seed.json):
// the coordinator inserts them host-side — patch-shaped mutations like
// applyFeedTick address rows by these stable ids.
export const seed = seedData;

export const functions = [
  { name: 'stationsQuery', kind: 'Query', export: 'stationsQuery', tables: ['stations'] },
  { name: 'tripsQuery', kind: 'Query', export: 'tripsQuery', tables: ['trips'] },
  { name: 'stopTimesByStation', kind: 'Query', export: 'stopTimesByStation', tables: ['stopTimes'] },
  { name: 'liveTrainStatus', kind: 'LiveQuery', export: 'liveTrainStatus', tables: ['trainStatus'] },
  { name: 'feedState', kind: 'LiveQuery', export: 'feedState', tables: ['feedRefreshState'] },
  { name: 'applyFeedTick', kind: 'Mutation', export: 'applyFeedTick', tables: ['trainStatus', 'feedRefreshState', 'feedTicks'] },
  {
    name: 'applyLiveFeedSnapshot',
    kind: 'Mutation',
    export: 'applyLiveFeedSnapshot',
    tables: ['trainStatus', 'feedRefreshState'],
  },
  { name: 'resetFeed', kind: 'Mutation', export: 'resetFeed', tables: ['trainStatus', 'feedRefreshState'] },
  // The ambient-power denial probe, identical in role to the notes fixture's
  // (LLP 0040 §Acceptance): the V8 denial tests must keep passing against the
  // All Aboard bundle, not only the notes regression surface.
  { name: 'probeAmbient', kind: 'Query', export: 'probeAmbient' },
];

const PATTERN_IDS = ['sb-local', 'sb-limited', 'sb-bullet', 'nb-local', 'nb-limited', 'nb-bullet'];

function nowMs(ctx) {
  return ctx.runtime && ctx.runtime.now ? ctx.runtime.now() : 0;
}

// Every db touch is awaited: the ctx host boundary is async and RPC-shaped on
// this target (LLP 0014 one-way door 3), including runtime.now.
globalThis.__snapbackHandlers = {
  async stationsQuery(ctx) {
    return await ctx.db.query('stations').order('orderIndex', 'asc').collect();
  },
  async tripsQuery(ctx) {
    return await ctx.db.query('trips').order('patternId', 'asc').collect();
  },
  async stopTimesByStation(ctx, args) {
    return await ctx.db.query('stopTimes').eq('stationId', args.stationId).order('sequence', 'asc').collect();
  },
  async liveTrainStatus(ctx) {
    return await ctx.db.query('trainStatus').order('patternId', 'asc').collect();
  },
  async feedState(ctx) {
    return await ctx.db.query('feedRefreshState').collect();
  },

  // Ported point-for-point from demos/all-aboard/snapback/handlers.mjs —
  // the recorded-feed advance, the live-snapshot commit, and the reset.
  async applyFeedTick(ctx, args) {
    const observedAt = await nowMs(ctx);
    const trigger = (args && args.trigger) || 'manual';
    const source = (args && args.source) || 'recorded';

    const state = await ctx.db.get('feedRefreshState', 'caltrain');
    const tickCount = state && state.tickCount ? state.tickCount : 1;
    const currentIndex = state && Number.isInteger(state.tickIndex) ? state.tickIndex : 0;
    const nextIndex = (currentIndex + 1) % Math.max(1, tickCount);

    const tick = await ctx.db.get('feedTicks', `tick-${nextIndex}`);
    const delays = (tick && tick.delays) || {};

    for (const patternId of PATTERN_IDS) {
      const delaySeconds = Number(delays[patternId]) || 0;
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt });
    }

    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      tickIndex: nextIndex,
      lastSource: source,
      lastRunTrigger: trigger,
      lastError: (args && args.lastError) || '',
    });

    return { tickIndex: nextIndex, note: (tick && tick.note) || '' };
  },

  async applyLiveFeedSnapshot(ctx, args) {
    const observedAt = await nowMs(ctx);
    const trigger = (args && args.trigger) || 'manual';
    const delays = (args && args.delays) || {};
    const touched = [];

    for (const patternId of PATTERN_IDS) {
      if (!Object.prototype.hasOwnProperty.call(delays, patternId)) continue;
      const delaySeconds = Math.max(-300, Math.min(3600, Math.round(Number(delays[patternId]) || 0)));
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt });
      touched.push(patternId);
    }

    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      lastSource: (args && args.source) || '511-siri-stop-monitoring',
      lastRunTrigger: trigger,
      lastError: (args && args.lastError) || '',
    });

    return {
      source: (args && args.source) || '511-siri-stop-monitoring',
      patterns: touched,
      note: (args && args.note) || '',
    };
  },

  async resetFeed(ctx) {
    const observedAt = await nowMs(ctx);
    for (const patternId of PATTERN_IDS) {
      await ctx.db.patch('trainStatus', patternId, { delaySeconds: 0, status: 'on-time', observedAt });
    }
    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      tickIndex: 0,
      lastSource: 'reset',
      lastRunTrigger: 'reset',
      lastError: '',
    });
    return { tickIndex: 0 };
  },

  // Probe both denial directions (LLP 0040 §App subset), same as the notes
  // fixture: ambient globals and host reach-through must be unreachable.
  async probeAmbient(ctx) {
    function reach(name) {
      let value;
      try {
        value = globalThis[name];
      } catch (_) {
        return { name: name, reachable: false };
      }
      if (value === undefined || value === null) return { name: name, reachable: false };
      if (typeof value === 'function') {
        try {
          value();
          return { name: name, reachable: true };
        } catch (error) {
          const message = String((error && error.message) || error);
          return {
            name: name,
            reachable: message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') !== 0,
          };
        }
      }
      return { name: name, reachable: true };
    }
    return [
      reach('fetch'),
      reach('WebSocket'),
      reach('caches'),
      reach('crypto'),
      reach('DurableObjectStorage'),
      reach('env'),
      reach('COORDINATOR'),
      reach('HANDLER'),
      reach('HOST'),
    ];
  },
};
