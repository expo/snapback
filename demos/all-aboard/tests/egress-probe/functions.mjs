// Phase 3 egress-seam probes: an action and a query that report whether the
// ambient `fetch` global is callable and what `ctx.secrets` holds. Used only by
// tests/acceptance/egress.mjs to prove the un-deny-fetch-for-actions seam.
import { defineAction, defineJsQuery } from '../../../_kit/define.mjs';

export const egressProbe = defineAction({
  js: { source: 'handlers.mjs', exportName: 'egressProbe' },
});

export const queryProbe = defineJsQuery({
  source: 'handlers.mjs',
  exportName: 'queryProbe',
  reads: ['probe'],
});
