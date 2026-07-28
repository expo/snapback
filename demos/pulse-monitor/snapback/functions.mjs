// @ref LLP 0028#cron-job-definition — cron targets an action; durable effects cross
// the ordinary mutation boundary and therefore reuse live delivery.

import {
  asc,
  defineAction,
  defineCron,
  defineJsMutation,
  defineLiveQuery,
  v,
} from '../../_kit/define.mjs';

export const liveServices = defineLiveQuery({
  table: 'serviceState',
  args: {},
  order: [asc('serviceId')],
  index: 'by_service',
});

export const applyProbe = defineJsMutation({
  args: { serviceId: v.string() },
  source: 'handlers.mjs',
  exportName: 'applyProbe',
  reads: ['serviceState'],
  writes: ['serviceState'],
});

export const probeServices = defineAction({
  args: {},
  js: { source: 'handlers.mjs', exportName: 'probeServices' },
  writes: ['serviceState'],
});

export const pulseCron = defineCron({
  monitorWhileViewed: {
    schedule: { everyMs: 60_000, jitter: false },
    action: 'probeServices',
    activation: { kind: 'WhileLive', whileLive: ['liveServices'] },
  },
});
