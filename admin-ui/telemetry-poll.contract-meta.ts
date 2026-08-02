// Contract descriptor for the fixed telemetry poll lifecycle capability.

import { capability, defineContractModule } from '@exact/contract/exports';

export default defineContractModule('./telemetry-poll.ts', {
  watchTelemetryPoll: capability({
    params: {
      refresh: { type: 'function' },
      intervalMs: { type: 'number', optional: true },
    },
    effects: ['telemetry.poll.subscribe'],
  }),
});
