# Effects

Effects run outside the data transaction. A mutation emits a durable outbox row;
Ibex 2 performs I/O and an optional Quarry `then` mutation records the result.
The provider must honor `meta.id` as its idempotency key for safe retries.

```ts
import { effect } from "snapback2";
import { recordNotified } from "./notifications";

export const notify = effect({
  grants: ["https://api.example.com"],
  run: async (payload: { to: string; body: string }, { fetch, meta }) => {
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": meta.id },
      body: JSON.stringify(payload),
    };
    const response = await fetch("https://api.example.com/send", request);
    if (!response.ok) throw new Error(`provider ${response.status}`);
    return { providerId: (await response.json()).id as string };
  },
  then: recordNotified,
});
```

`emit name { payload }` durably queues an effect in the mutation's transaction.
Bind it with `effect notify from delivery`. For previews, store and emit the same
`slice(body, 0, 80)`; truncating only inside the effect leaves stored text longer.

Authored `.ts` uses ES2020 types. The globals in `run` are exactly `Array, ArrayBuffer, BigInt, BigInt64Array, BigUint64Array, Boolean, DataView, Date, Error, EvalError, Float32Array, Float64Array, Headers, Infinity, Int16Array, Int32Array, Int8Array, Intl, JSON, Map, Math, NaN, Number, Object, Promise, Proxy, RangeError, ReferenceError, Reflect, RegExp, Set, String, Symbol, SyntaxError, TextDecoder, TextEncoder, TypeError, URIError, URL, URLSearchParams, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray, WeakMap, WeakSet, atob, btoa, console, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, fetch, isFinite, isNaN, meta, parseFloat, parseInt, setTimeout, undefined, unescape`.
Other globals, DOM types, imports inside `run`, `require`, `eval`, and `Function`
refuse. Captures must be module JSON constants, not imported helpers.
`fetch` has text/JSON/arrayBuffer readers; `Response` has no constructor.
Every redirect checks grants and strips cross-origin credentials.
Both `meta` and `tools.meta` carry `id`, `effect`, and `attempt`.

`dev` reports engine and queued count at boot (`effects` in JSON). Published
binaries carry Ibex 2 + vanilla Hermes; default repo builds have no engine.
Build one: `scripts/hermes build -p snapback2`. No engine leaves rows queued
and logs its count once per change.

`logs --effects` filters lifecycle lines: emission, claim, retry, restart
recovery, requeue, and `then` settlement, with qualified names (`delivery.notify`).
`trace <seq>` adds transition history beneath the snapshot; unreadable or
oversized history says unavailable. Status reports `log: unavailable(reason)`
if writing fails.

Journey `effects.rows({ state, after, limit })` returns `{ rows, after }`, ordered
by `(seq, id)`. Limit is 1–200; pass `after` until null. Results over 16,384 bytes
become null with `resultCapped: { bytes, limit }`.
`effects.settle({ upTo, budgetMs })` first runs one bounded background turn for
due schedules/jobs, then wakes the real runner and waits off the writer.
`upTo` defaults to the sequence after that turn; `budgetMs` defaults to 1000,
maximum 4000. It returns `{ settled, rows, remaining }`. `failed` and
`sent_unknown` are terminal; `then_pending` stays unsettled. Sent rows with
bookkeeping carry `then: { op, state: "committed", seq }` or
`{ op, state: "rejected", code }`; rejection does not undo delivery.
Remaining reasons: `backoff` (with `nextAt`), `then_pending`, `running`,
`engine:none`, `budget`. Use `tick(ms)` to advance retry eligibility.
Nothing runnable never means settled. Both routes need the dev secret, like
`tick`, and refuse in serve mode. No engine returns immediately; the
supervisor records `blocked: effects:no-engine`. See `guide testing`.

The example origin is a placeholder. Locally, return `{ providerId: meta.id }`
from `run`, retaining the required grant even without fetch. Restore a real
provider before claiming delivery.
