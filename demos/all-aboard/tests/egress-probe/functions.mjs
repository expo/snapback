// Phase 3 egress-seam + LLP 0036 config probes: an action and a query that
// report whether the ambient `fetch` global is callable and how the granted
// `ctx.secrets` handles behave. Used only by tests/acceptance/egress.mjs to
// prove the un-deny-fetch-for-actions seam and the declared-config grant path.
import {
  arg,
  defineAction,
  defineConfig,
  defineJsQuery,
  defineMutation,
  defineQuery,
  insert,
  results,
  v,
} from '../../../_kit/define.mjs';

// @ref LLP 0036#declared-configuration-in-the-manifest — the fixture declares
// the pool the old SNAPBACK_ACTION_SECRETS blob carried; the deprecated env
// var now works only as a one-time import source for this declared entry.
export const probeConfig = defineConfig({
  feedKeys: {
    description: 'Rotating test key pool for the egress probe',
    purpose: 'Proves granted handles, rotation, redaction, and the env import',
    pool: true,
    probe: 'egressProbe',
    howToGet: 'Test-only keys; any value works.',
  },
});

export const egressProbe = defineAction({
  uses: ['feedKeys'],
  js: { source: 'handlers.mjs', exportName: 'egressProbe' },
});

export const queryProbe = defineJsQuery({
  source: 'handlers.mjs',
  exportName: 'queryProbe',
  reads: ['probe'],
});

// 0137 a4-f1 conformance witness, module form: an outbound action fetches a
// local provider and commits the response through a named mutation. The
// handler file is a CLOSED SCRIPT that registers this exportName on
// globalThis.__snapbackHandlers — ES exports are refused at generation.
export const notifyDelivery = defineAction({
  args: { url: v.string() },
  js: { source: 'handlers.mjs', exportName: 'notifyDelivery' },
  result: results.value(v.object({ delivered: v.boolean() })),
  writes: ['deliveries'],
});

export const recordDelivery = defineMutation({
  args: { url: v.string(), body: v.string() },
  plan: insert('deliveries', { url: arg('url'), body: arg('body') }),
});

export const listDeliveries = defineQuery({ table: 'deliveries', args: {} });

// 0137 a4-f1 conformance witness, inline form: the same egress seam admits a
// global fetch inside an inline `handler:` action when generation and the
// runtime both opt in with SNAPBACK_OUTBOUND_ACTIONS.
export const notifyInline = defineAction({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const response = await fetch(args.url);
    const body = await response.text();
    return { delivered: response.status === 200 && body.length > 0 };
  },
  result: results.value(v.object({ delivered: v.boolean() })),
  writes: [],
});
