# Effects

Effects are outside the data transaction. A mutation durably emits an outbox
row; the optional Ibex 2 runner performs I/O and may invoke a named Quarry
`then` mutation. Declare an effect in a TypeScript module:

```ts
// The grant names your notification provider; replace this example origin.
// The provider must honor meta.id as the idempotency key to make retries safe.
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
Chat sends first deliver the message, then notify every other current member.
The effect returns `{ providerId }`; `then: recordNotified` records it.

```q
effect notify from delivery
```

```q
  for member in conversationMembers(conversationId):
    if member.principal != viewer:
      emit notify { to: member.principal, body }
```

Authored `.ts` files, including helpers without effect exports, are checked with
ES2020 types; Quarry-generated modules retain the data-plane subset.
Inside `run`, the globals in scope are exactly `Array, ArrayBuffer, BigInt, BigInt64Array, BigUint64Array, Boolean, DataView, Date, Error, EvalError, Float32Array, Float64Array, Headers, Infinity, Int16Array, Int32Array, Int8Array, Intl, JSON, Map, Math, NaN, Number, Object, Promise, Proxy, RangeError, ReferenceError, Reflect, RegExp, Set, String, Symbol, SyntaxError, TextDecoder, TextEncoder, TypeError, URIError, URL, URLSearchParams, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray, WeakMap, WeakSet, atob, btoa, console, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, fetch, isFinite, isNaN, meta, parseFloat, parseInt, setTimeout, undefined, unescape`.
Other globals (including `crypto`, which this Ibex revision lacks), DOM names,
`import`/`require` inside `run` (static or dynamic), `eval`, and `Function`
refuse at `check`; captures must be module JSON constants, so imported helper
functions cannot be captured. No DOM or Web Worker types are packaged. `fetch` returns `status`, `ok`, `url`, `redirected`, `headers: Headers`,
`bodyUsed`, and `text()`/`json()`/`arrayBuffer()`; `Response` has no constructor.
`URL.canParse`/`parse` and `URLSearchParams.size`/`sort` are witnessed Ibex members.
`TextDecoder` accepts no encoding or streaming options. `setTimeout` forwards
extra arguments to its callback; delivery consumes one host permit per pump.
Both global `meta` and `tools.meta` carry `id`, `effect`, and `attempt`.

`fetch` snapshots headers from records, pair iterables, or `Headers` and sends
them; invalid names/values reject before I/O. String bodies default to
`text/plain;charset=UTF-8` unless `content-type` is authored. Redirects 301/302
rewrite only POST to GET; 303 rewrites all except GET/HEAD; 307/308 preserve
method/body. A dropped body drops `content-type`, `content-length`,
`content-encoding`, `content-language`, and `content-location`. Cross-origin
hops drop `authorization`, `proxy-authorization`, and `cookie`; every hop
requires its declared grant. Invalid redirect modes reject before I/O.

The default development binary has no engine. `snapback2 test` records the
derived effects check as `blocked: no engine in this build`; it never claims
the queued row was sent. Use `snapback2 trace <seq>` to see the outbox row.

## Development without a provider

Use the template's declared effect and inspect the queued outbox row with
`trace`; an engine-less development build reports delivery as blocked.
The example `https://api.example.com` grant is a placeholder, not a working
notification service. Do not interpret successful message insertion as delivery.
When testing an engine-enabled build without a provider, replace the effect's
`run` with an async function returning `{ providerId: meta.id }`; `then` can
record that deterministic local result. Keep the example URL grant: current
effect declarations require at least one grant, even when the body never calls
`fetch`. A grant alone sends no network request. Restore your provider origin and idempotent fetch before
claiming external delivery; `guide testing` explains effect verification.
