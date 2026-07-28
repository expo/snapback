// @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact — all
// three disclosure facts are explicit and codegen-certified.

import {
  arg,
  asc,
  defineLiveQuery,
  eq,
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
