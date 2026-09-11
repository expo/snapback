# Effects

Effects run outside the data transaction. A mutation emits a durable outbox row.
The default repo build has no engine, so rows stay queued; published binaries
carry Ibex 2, which does the I/O, then an optional Quarry `then` mutation
records the result. Providers must honor `meta.id` as the idempotency key.

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
`grants` is an explicit origin list; `[]` grants no network access. Every fetch,
including aliases and local helpers, checks grants before transport. Every
redirect checks grants and strips cross-origin credentials.
Both `meta` and `tools.meta` carry `id`, `effect`, and `attempt`.

ES2020 selects the type library, not complete Intl conformance. Known runtime
gaps: `Intl.PluralRules`, `RelativeTimeFormat`, `Locale`, and `DisplayNames`
are absent. On Mac, NumberFormat parts and some sign/notation/unit options
are incomplete; BigInt locale formatting remains ungrouped.

`dev` reports engine and queued count at boot (`effects` in JSON). Build an
engine: `scripts/hermes build -p snapback2`. No engine leaves rows queued and
logs its count once per change.

`logs --effects` keeps lifecycle lines: emission, claim, retry, restart
recovery, requeue, `then` settlement, qualified names (`delivery.notify`);
`--since seq` bounds transitions, count lines always pass. `trace <seq>` adds
transition history beneath the snapshot; unreadable or oversized history says
unavailable. Status reports `log: unavailable(reason)` if writes fail.

Journey `effects.rows({ state, after, limit })` returns `{ rows, after }` ordered
by `(seq, id)`; limit 1–200; pass `after` until null. Results over 16,384 bytes
become null with `resultCapped: { bytes, limit }`.
`effects.settle({ upTo, budgetMs })` runs one bounded background turn for due
schedules/jobs, then wakes the runner and waits off the writer. `upTo` defaults
to the seq after that turn; `budgetMs` to 1000, at most 4000. It returns
`{ settled, rows, remaining }`; `failed` and `sent_unknown` are terminal,
`then_pending` stays unsettled. Sent rows with bookkeeping carry
`then: { op, state: "committed", seq }` or `{ op, state: "rejected", code }`;
rejection undoes no delivery. Remaining reasons: `backoff` (with `nextAt`; not
yet due, any build), `then_pending`, `running`, `engine:none` (due, no engine),
`budget`. `tick(ms)` advances retry eligibility; a backoff ending inside the
budget is waited for. No runnable work still reports `remaining` and
`settled: false`. Both routes need the dev secret, like `tick`, and refuse in
serve mode. Without an engine `settle` still pumps a pending `then`, then
returns; the supervisor records `blocked: effects:no-engine`. See `guide testing`.

In `snapback2 test` nothing else answers: every effect fetch must match a
provider the journey bound with `effects.provider(origin, handler)`. The grant
admits the logical origin first, on every request and redirect hop
(`E_EFFECT_GRANT` exactly as in production); only then does the loopback stand
in. An origin with no live binding fails `E_EFFECT_UNBOUND`: terminal, no
transport reached — derived-check rows, earlier journeys' leftovers, and their
retries included. Bind before emitting: a claim between emit and bind is
`E_EFFECT_UNBOUND`. Bindings belong to one journey; the supervisor revokes them
when it ends, however it ends, and waits for its in-flight claims to settle
before the next journey. Close waits at most the effect budget + 1 s; any
remaining running rows fail the journey. The effect's `response.url` stays
logical, including after redirects; the provider sees the logical URL and
`Host`. Manual `dev` has no binding route; `--test-owner` requires `--owner-child`.

The example origin is a placeholder. For a no-network body, use `grants: []`
and return `{ providerId: meta.id }` from `run`. That proves local execution,
not delivery; restore a real provider and its origin grant before claiming it.
