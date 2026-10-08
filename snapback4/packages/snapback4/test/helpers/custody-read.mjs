import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { QueryCustody } from '../../dist/query-custody.js';

// Check at the actual gate opening, not just at wait entry. An event-loop
// checkpoint lets queued publication/settlement continuations finish while
// custody is still held. Check every sibling and release synchronously in the
// same continuation so no publication can slip between the check and release.
// Call again before apply, including both original and newly started reads.
export async function releaseCustody(reads, release) {
  await new Promise(resolve => setImmediate(resolve));
  for (const read of reads) read.pending();
  release();
}

// @ref LLP 3000.023#11 — observe entry into the real event wait without
// replacing its predicate, promise, wakeup or 30-second deadline.
export function custodyReads(t) {
  const calls = new AsyncLocalStorage(), wait = QueryCustody.prototype.wait;
  t.mock.method(QueryCustody.prototype, 'wait', function (...args) {
    const waiting = wait.apply(this, args);
    calls.getStore()?.();
    return waiting;
  });
  return (client, op, args) => {
    let entered, settled = false;
    const waiting = new Promise(resolve => { entered = resolve; });
    const promise = calls.run(entered, () => client.query(op, args)).then(
      read => { settled = true; return read; },
      error => { settled = true; throw error; },
    );
    const pending = (label = op.name) => assert.equal(settled, false, `${label}: settled while custody was held`);
    return {
      promise, pending,
      async withheld(label = op.name) {
        // A broken fence must fail on early settlement, not hang waiting for
        // a custody callback it will never reach. Context binds the callback
        // to this invocation, even with concurrent reads of the same query.
        await Promise.race([waiting, promise]);
        pending(label);
      },
    };
  };
}
