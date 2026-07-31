// @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact — all
// three disclosure facts are explicit and codegen-certified.

import {
  arg,
  asc,
  defineLiveQuery,
  defineMutation,
  eq,
  insert,
  patch,
  returnBinding,
  returnChangedCount,
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

// Deliberately NOT declared authority-independent: the server mints no RQS
// resume token for it, so it is the demo's non-retainable subscription — the
// LLP 0129 Phase 0 offline acceptance proves the refuse-with-clarity path
// (retention refused with a named reason, never silent local-first).
export const metricsFeed = defineLiveQuery({
  table: 'metrics',
  args: { dashboardId: v.string() },
  filter: [eq('dashboardId', arg('dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
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
