// @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact — all
// three disclosure facts are explicit and codegen-certified.

import {
  arg,
  argsRoot,
  asc,
  defineJsLiveQuery,
  defineLiveQuery,
  defineMutation,
  eq,
  field,
  insert,
  patch,
  returnBinding,
  returnChangedCount,
  results,
  v,
} from '../../_kit/define.mjs';

export const dashboardMetrics = defineLiveQuery({
  table: 'metrics',
  args: { dashboardId: v.string() },
  filter: [eq('dashboardId', arg('dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});

export const dashboardMetricsByContext = defineLiveQuery({
  table: 'metrics',
  args: {
    context: v.object({
      dashboardId: v.string(),
      cursor: v.union([v.string(), v.null()]),
      sort: v.union([v.literal('asc'), v.literal('desc')]),
      tags: v.array(v.string(), { maxItems: 4 }),
    }),
  },
  filter: [eq('dashboardId', field(argsRoot(), 'context', 'dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});

// Public-exact default-retention witness: there is deliberately no
// authorityIndependent or retainable switch. Codegen and the host derive the
// closed single-table class, and the acceptance proves it survives relaunch.
export const metricsFeed = defineLiveQuery({
  table: 'metrics',
  args: { dashboardId: v.string() },
  filter: [eq('dashboardId', arg('dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
});

// Named refusal fixture: opaque JavaScript cannot carry the exact public plan
// proof, even though the rows themselves are public and the handler is callable
// anonymously. It stays online-only in both custody modes.
export const protectedMetricsFeed = defineJsLiveQuery({
  args: { dashboardId: v.string() },
  result: results.documents('metrics'),
  reads: ['metrics'],
  auth: 'public',
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('metrics').take(1024).collect();
    return rows.filter((row) => row.dashboardId === args.dashboardId);
  },
});

// Metric ingestion (LLP 0129 Phase 0): the offline acceptance drives a warm-
// session offline create/update through the LLP 0043 M2 outbox and settles
// both exactly-once on reconnect.
export const recordMetric = defineMutation({
  args: { dashboardId: v.string(), label: v.string(), value: v.integer() },
  plan: insert(
    'metrics',
    {
      dashboardId: arg('dashboardId'),
      label: arg('label'),
      value: arg('value'),
    },
    { bindIdAs: 'metricId' },
  ),
  returns: returnBinding('metricId'),
});

export const setMetricValue = defineMutation({
  args: { id: v.string(), value: v.integer() },
  plan: patch('metrics', arg('id'), { value: arg('value') }),
  returns: returnChangedCount(),
});
