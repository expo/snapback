import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { QueryCustody } from '../../dist/query-custody.js';

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
