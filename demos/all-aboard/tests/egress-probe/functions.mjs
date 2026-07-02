// Phase 3 egress-seam + LLP 0036 config probes: an action and a query that
// report whether the ambient `fetch` global is callable and how the granted
// `ctx.secrets` handles behave. Used only by tests/acceptance/egress.mjs to
// prove the un-deny-fetch-for-actions seam and the declared-config grant path.
import { defineAction, defineConfig, defineJsQuery } from '../../../_kit/define.mjs';

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
