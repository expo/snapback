# Effects

Effects are outside the data transaction. A mutation durably emits an outbox
row; the optional Ibex 2 runner performs I/O and may invoke a named Quarry
`then` mutation. Declare an effect in a TypeScript module:

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

Quarry declares the effect's module and emits the payload:

```q
effect notify from delivery
```

```q
  emit notify { to: recipient.principal, body }
```

Authored `.ts` files, including helpers without effect exports, are checked with
ES2020 types; Quarry-generated modules retain the data-plane subset.
Inside `run`, the globals in scope are exactly `Array, ArrayBuffer, BigInt, BigInt64Array, BigUint64Array, Boolean, DataView, Date, Error, EvalError, Float32Array, Float64Array, Headers, Infinity, Int16Array, Int32Array, Int8Array, Intl, JSON, Map, Math, NaN, Number, Object, Promise, Proxy, RangeError, ReferenceError, Reflect, RegExp, Set, String, Symbol, SyntaxError, TextDecoder, TextEncoder, TypeError, URIError, URL, URLSearchParams, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray, WeakMap, WeakSet, atob, btoa, console, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, fetch, isFinite, isNaN, meta, parseFloat, parseInt, setTimeout, undefined, unescape`.
Other globals (including `crypto`, which this Ibex revision lacks), DOM names,
`import`/`require` inside `run` (static or dynamic), `eval`, and `Function`
refuse at `check`; captures must be module JSON constants, so imported helper
functions cannot be captured. The packaged ES2020 types include no DOM or Web Worker
library. `fetch` returns `status`, `ok`, `url`, `redirected`, `headers: Headers`,
`bodyUsed`, and `text()`/`json()`/`arrayBuffer()`; `Response` has no constructor.
The Ibex tools also provide `URL.canParse`/`parse` and `URLSearchParams.size`/`sort`;
these are witnessed runtime members, independent of the ES2020 library version.
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
