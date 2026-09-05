# Effects

Effects are outside the data transaction. A mutation durably emits an outbox
row; the optional Ibex 2 runner performs I/O and may invoke a named Quarry
`then` mutation. The TypeScript module exports effects only:

```ts
import { effect } from "snapback2";
import { recordNotified } from "./notifications";
import { notifications } from "./schema";

const baseHeaders = { accept: "application/json" };
const requestDefaults = {
  method: "POST",
  headers: { ...baseHeaders, "content-type": "application/json" },
};

export const notify = effect({
  grants: ["https://api.example.com"],
  run: async (payload: { to: string; body: string }, { fetch, meta }) => {
    function identity(value: string) { return value; }
    const formatter = { format(value: string) { return identity(value); } };
    const body = [payload.body].map(function keep(value) { return formatter.format(value); })[0];
    try {
      const response = await fetch("https://api.example.com/send", {
        method: requestDefaults.method,
        headers: { ...requestDefaults.headers, "idempotency-key": meta.id },
        body: JSON.stringify({ ...payload, body }),
      });
      if (!response.ok) throw new Error(`provider ${response.status}`);
      return { providerId: (await response.json()).id as string };
    } catch (error) {
      throw error;
    }
  },
  then: recordNotified,
});
```

`emit name { payload }` durably queues an effect in the mutation's transaction.
Declare the effect's module, then emit its payload:

```q
effect notify from delivery
```

```q
  emit notify { to: recipient.principal, body }
```

Run bodies are ES2020 TypeScript; the data-plane subset does not apply.
The globals in scope are exactly `Array, ArrayBuffer, BigInt, BigInt64Array, BigUint64Array, Boolean, DataView, Date, Error, EvalError, Float32Array, Float64Array, Headers, Infinity, Int16Array, Int32Array, Int8Array, Intl, JSON, Map, Math, NaN, Number, Object, Promise, Proxy, RangeError, ReferenceError, Reflect, RegExp, Set, String, Symbol, SyntaxError, TextDecoder, TextEncoder, TypeError, URIError, URL, URLSearchParams, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray, WeakMap, WeakSet, atob, btoa, console, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, fetch, isFinite, isNaN, meta, parseFloat, parseInt, setTimeout, unescape, undefined`.
Other globals (including `crypto`, which this Ibex revision lacks), DOM names,
`import`/`require`, `eval`, and `Function` refuse at `check`; captures must be
module JSON constants. The packaged ES2020 types include no DOM or Web Worker
library. `fetch` returns `status`, `ok`, `url`, `redirected`, `headers: Headers`,
`bodyUsed`, and `text()`/`json()`/`arrayBuffer()`; `Response` has no constructor.
Timer delivery consumes one host permit per pump.

The default development binary has no engine. `snapback2 test` records the
derived effects check as `blocked: no engine in this build`; it never claims
the queued row was sent. Use `snapback2 trace <seq>` to see the outbox row.
