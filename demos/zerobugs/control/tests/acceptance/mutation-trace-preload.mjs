import {writeFileSync} from 'node:fs';

import {SnapbackClient} from '@expo/snapback-client';

// Runtime-only, secret-free timing instrumentation for ZB3. The landed Lane 4
// harness remains unchanged; this preload observes its public client calls.
const traceFile = process.env.ZBUGS_MUTATION_TRACE_FILE;
const events = [];
const originalMutate = SnapbackClient.prototype.mutate;

if (traceFile) {
  Object.defineProperty(SnapbackClient.prototype, 'mutate', {
    configurable: true,
    writable: true,
    value: async function tracedMutation(reference, options = {}) {
      const startedAtMs = performance.timeOrigin + performance.now();
      const event = {
        operation: typeof reference?.name === 'string' ? reference.name : 'unknown',
        clientMutationId: typeof options.clientMutationId === 'string'
          ? options.clientMutationId
          : null,
        submittedAt: new Date(startedAtMs).toISOString(),
        settledAt: null,
        durationMs: null,
        outcome: 'pending',
      };
      events.push(event);
      try {
        const result = await originalMutate.call(this, reference, options);
        event.outcome = 'fulfilled';
        return result;
      } catch (error) {
        event.outcome = 'refused';
        throw error;
      } finally {
        const settledAtMs = performance.timeOrigin + performance.now();
        event.settledAt = new Date(settledAtMs).toISOString();
        event.durationMs = Math.max(0, settledAtMs - startedAtMs);
      }
    },
  });

  process.on('exit', () => {
    writeFileSync(traceFile, `${JSON.stringify({
      schemaVersion: 'zerobugs-mutation-trace.v1',
      events,
    })}\n`, {mode: 0o600});
  });
}
