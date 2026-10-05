# LLP 1003: Effects — JavaScript with I/O, on Ibex 2, through the outbox

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2-effects` (the host and runner), `snapback2/crates/snapback2` (the runner thread in the owner; `doctor`), `snapback2/packages/compiler` (lowering `effect()` and `emit()`), `snapback2/scripts/{hermes,publish.mjs}`
**Author:** Claude Fable 5 (orchestrator) — implementer: codex gpt-5.6-sol, lane C (compiler lowering: lane B0)
**Date:** 2026-08-29
**Revised:** 2026-10-05 (expo/ibex `c8e1941f6`: split `ibex2-runtime`, verified lean-engine acquisition, install groups and opt-in fetch-primitives handoff); 2026-09-11 (bounded Intl audit distinguishes declarations from runtime coverage; Darwin and Linux vanilla-Hermes build lookup; exact debugger/release engine-global profiles); 2026-09-10 (LLP 1018.008.003: explicit empty grants give no network authority; implementer Codex); 2026-09-05 (Clique F1: authored fetch headers are delivered and redirects obey Fetch; implementer GPT-6 Astra, L6; F2: ES2020 authored-file libraries and witnessed globals/members, L5); 2026-08-30
**Related:** LLP 1000 decision 3 (Ibex 2 embedded now, effects only), LLP 1001 §8 (the outbox), LLP 1002 §5 (the owner that hosts the runner), LLP 0329.014.004 §6 (`effect` kind: "JavaScript with I/O outside the data plane; reads only through named queries as a service principal; writes only through named mutations; transactional outbox"), LLP 0329.016 §9 decision 7, expo/ibex LLP 0057/0058/0067/0068 (the engine, its bindings, and its grant model)

## Summary

An effect is the one place application JavaScript runs in Snapback 2: an
`async` function with `fetch`, executed by Ibex 2 over vanilla Hermes, outside
the data plane, fed by rows the engine wrote to `_outbox` inside the
mutation's own commit. It cannot touch the store; it returns a value, and a
declared `then` mutation — a bounded data program like any other, run as the
`system` principal — is how that value re-enters the data plane. Grants are
carried, not inferred (ibex LLP 0067): an effect reaches only the origins it
declares. The default build links no engine and says so loudly; the published
binary carries Hermes.

Implementer and date: codex gpt-5.6-sol (xhigh), lane C, 2026-08-29. Only
what runs binds.

## 1. Authoring

```ts
import { effect, emit, mutation, t } from 'snapback2'
import { recordNotified } from './notifications'

export const notify = effect({
  grants: ['https://api.example.com'],                      // net.fetch origins; the only grant kind this wave
  run: async (payload: { to: string; body: string }, { fetch, meta }) => {
    const res = await fetch('https://api.example.com/send', { method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': meta.id },
      body: JSON.stringify(payload) })
    if (!res.ok) throw new Error(`provider ${res.status}`)
    return { providerId: (await res.json()).id }
  },
  then: recordNotified,                                    // optional; a mutation in this project
})

export const send = mutation({ conversationId: t.id(), body: t.text(4000) }, ({ db, ctx, args }) => {
  // … bounded data program …
  emit(notify, { to: recipient.email, body: args.body })   // one outbox row, in this commit
})
```

Rules the compiler enforces (family `effect`, each with a rewrite):
- `run` must be an arrow or function expression that closes over nothing but
  its parameters and module-level constants of JSON type (`E_EFFECT_CLOSURE`);
  it may not `import` (static or dynamic) or `require` (`E_EFFECT_IMPORT`). Run bodies are ES2020
  TypeScript; the data-plane subset does not apply. All authored `.ts` files,
  including helpers with no effect export, use
  TypeScript's ES5–ES2020 libraries (no DOM/Web Worker), plus the prelude's
  declarations, packaged at build time. Quarry-generated modules keep the
  subset library. Other globals refuse at `check`; the in-scope globals are
  exactly `Array, ArrayBuffer, BigInt, BigInt64Array, BigUint64Array, Boolean, DataView, Date, Error, EvalError, Float32Array, Float64Array, Headers, Infinity, Int16Array, Int32Array, Int8Array, Intl, JSON, Map, Math, NaN, Number, Object, Promise, Proxy, RangeError, ReferenceError, Reflect, RegExp, Set, String, Symbol, SyntaxError, TextDecoder, TextEncoder, TypeError, URIError, URL, URLSearchParams, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray, WeakMap, WeakSet, atob, btoa, console, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, fetch, isFinite, isNaN, meta, parseFloat, parseInt, setTimeout, undefined, unescape` (§3 hardens the global object). Every admitted name has
  a compile-and-execute Hermes witness, as does every handwritten tool method.
  This includes `URL.canParse`/`parse`, `URLSearchParams.size`/`sort`, and timer
  argument forwarding; these Ibex members do not change the ES2020 library version.
  `TextDecoder` declares no encoding or streaming options. Both `meta` and
  `tools.meta` carry `id`, `effect`, and `attempt`. `crypto` is absent from the pinned
  Ibex runtime and refuses rather than receiving an invented declaration;
  `eval`, the authored `Function` name, DOM names, and engine internals remain
  refused. The host deletes `Function` before hardening; at expo/ibex
  `c8e1941`, `harden.js` needs only `Object`. `DynamicCode::Closed` refuses
  dynamic compilation, and the compiler still refuses the authored name.
  The host also verifies its post-hardening engine surface exactly. Pinned
  debugger-enabled Hermes leaves one non-configurable `DebuggerInternal`
  global, while the release profile omits it; Snapback admits those two exact
  host surfaces and no others. That engine internal is absent from the
  authored allowlist above and no host operation calls it. Every other missing
  required global (including `Intl`, `fetch`, and `__ibex2_fire_timer`) and
  every unexpected surviving global refuses runtime construction.
  `fetch` returns the prelude's response (`status`, `ok`, `url`, `redirected`,
  `headers: Headers`, `bodyUsed`, `text()`, `json()`, `arrayBuffer()`), never
  a constructible global `Response`; `setTimeout` retains the single-use
  host delivery permit.
  **Bounded Intl audit (2026-09-11):** the ES2020 type-library selection is
  not complete ECMA-402 qualification. `Intl.PluralRules`,
  `Intl.RelativeTimeFormat`, `Intl.Locale` and `Intl.DisplayNames` are
  declared but absent on both native hosts. Mac also has inherited
  NumberFormat parts/sign/notation/unit gaps and ungrouped BigInt locale
  formatting. The [focused follow-up](../issues/shelved/20260911-snapback2-effect-intl-declarations-exceed-runtime.md)
  records the exact declaration and executable evidence. The native Linux
  Intl completion is separately qualified; it does not close these inherited
  gaps or turn the top-level `Intl` witness into proof of every member.
- `grants` is an explicit list of `https://` or `http://127.0.0.1` origins
  (`E_EFFECT_GRANT`); `[]` gives no network authority. The host checks every
  fetch, including aliases and local helpers, before transport. A no-fetch
  body needs no placeholder grant (LLP 1018.008.003 §4).
- `then`, if given, names a `mutation` in this project whose args are
  `{ outboxId: string, effect: string, result: <run's return type> }` — the
  compiler infers the return type and checks it (`E_EFFECT_THEN_ARGS`).
- `emit(effectRef, payload)` is a statement in a `mutation` only
  (`E_EMIT_IN_QUERY`, LLP 1001 §8); `payload` is any expression of JSON type.

Lowering: `run` is transpiled with `ts.transpileModule` (ES2020, no
imports) to a single function expression string; the project JSON carries
`effects[] = { name: "notifications.notify", grants, source, then:
"notifications.recordNotified" | null }`, and `schema.effects` lists the
names (LLP 1001 §9).

`fetch` delivers authored headers from a record, an iterable of name/value
pairs, or `Headers`, normalized and snapshotted before I/O. A string body
without an authored `content-type` gets `text/plain;charset=UTF-8`. Invalid
header names or values reject before any request. Redirects 301/302 rewrite
only POST to GET; 303 rewrites all methods except GET/HEAD; 307/308 preserve
method and body. Dropping the body drops `content-type`, `content-length`,
`content-encoding`, `content-language`, and `content-location`. Crossing
origins drops `authorization`, `proxy-authorization`, and `cookie`;
same-origin hops retain them. Every hop still requires its declared grant;
redirect modes other than `follow`, `manual`, or `error` reject before I/O.

## 2. The outbox lifecycle

**Amendment 2026-09-05 (LLP 1016 D1, J1a):** `then` now skips viewer rules as the store owner; constraints and atomic settlement still bind, and bookkeeping tables use `deny` (supersedes the ordinary-rules / `rule.system()` sentence below).

`_outbox` (LLP 1001 §1) rows move through:

```
queued ──(runner claims)──▶ running ──(run resolves; effect has `then`)──▶ then_pending ──(then executed)──▶ sent
                               │        └──(run resolves; no `then`)────────────────────────────────────▶ sent
                               ├─(run throws, attempts < 5)─▶ queued (next_at = failure time + 1s·2^attempts)
                               ├─(run throws, attempts = 5)─▶ failed (last_error)
                               └─(process restarts while running)─▶ sent_unknown
```

`then_pending` (review ruling 2026-08-30) makes the lifecycle restart-honest: the
effect's result is durable before `then` runs; `then` and the `then_pending →
sent` settlement are **one store transaction** (`Runtime::execute_then`), so a
restart re-runs `then` only for rows still `then_pending` and never twice; the
row binds its target (`then_op`, `generation`) at claim time, and a successor
that changed the declaration fails the row loudly (`E_EFFECT_THEN_CHANGED`)
instead of running the new mutation against the old result. A `then` that is
`Rejected` (e.g. a duplicate on a unique index) records `last_error` while the
row still moves to `sent` — the effect happened; the bookkeeping did not.
`then` is a bounded data program like any other: it runs as the `system`
principal under the ordinary table rules (no seed-style exemption — that
exists for declared data), so a bookkeeping table admits it with
`insert: rule.system()` (review ruling 2026-08-30). The runner
thread never panics on row data and never stops on one bad row; a row for an
effect the generation does not declare is settled `failed` at claim time,
never `running`.

- The runner claims with `UPDATE _outbox SET state='running', attempts=attempts+1,
  updated_at=? WHERE id=? AND state='queued'` — one row at a time, oldest
  `next_at` first, and never two jobs of the same effect concurrently (one
  Hermes runtime per effect, §3).
- `sent_unknown` is honest: the process cannot know whether the provider
  acted. `meta.id` (the outbox id) is handed to `run` so a provider
  idempotency key can make the retry safe; the runner never retries a
  `sent_unknown` row on its own — `snapback2 trace` shows it, and a human or
  an agent re-queues it (`POST /control/outbox/<id>/requeue`, this wave).
- `then` runs from `then_pending` through the purpose-specific
  `Runtime::execute_then` capability; only its durable generation/op/outbox
  binding can cause the engine-private system context to be constructed. It
  settles the row in the same transaction —
  including when the mutation is `Rejected` (`last_error` set, `state = 'sent'`:
  the effect happened; the bookkeeping did not) — so no crash window separates
  the mutation from its settlement; visible in `trace`, never silent.
- Generation change: jobs of an effect the new generation no longer declares
  become `failed` with `last_error = 'E_EFFECT_UNKNOWN'`; a changed `source`
  drops that effect's runtime so the next job builds a fresh one.

## 3. The runtime (`snapback2-effects`)

```rust
pub struct EffectJob { pub id: String, pub effect: String, pub payload: serde_json::Value }
pub enum Outcome { Sent(serde_json::Value), Failed { error: String, retry: bool }, Unavailable(&'static str) }
pub trait EffectHost { fn run(&mut self, decl: &EffectDecl, job: &EffectJob, budget: Duration) -> Outcome; fn describe(&self) -> &'static str; }
pub struct NoEngine;                     // every `run` → Outcome::Unavailable("no engine in this build")
#[cfg(feature = "hermes")] pub struct Ibex2Host { /* per-effect runtimes keyed by (name, source digest) */ }
pub struct Runner<H: EffectHost> { /* owns the host; `drain(&mut self, store, runtime) -> Drained` */ }
```

`Ibex2Host` per effect: `Hermes::new(DynamicCode::Closed)` → parse the transport
origins with `GrantSet::parse` → retain a `bindings::Context` after the runtime
in field order → one `install_with(PURE | CONSOLE | TIMERS | ABORT | FETCH,
&context, InstallOptions { fetch_primitives:
Some("__snapback_ibex2_fetch_primitives") })` → evaluate a trusted prelude that
captures the frozen fetch-primitives object and deletes its global →
`harden()`. `PURE` supplies URL, headers, text and base64; `CONSOLE` supplies
logs; `TIMERS` supplies the pump's timer hook and requires `CONSOLE`; `ABORT`
supplies fetch control and requires `PURE`; `FETCH` supplies the grant-bound
transport and requires `PURE | ABORT`. No other group is installed. A job is one
host `eval` of

```js
__snapback.run(<source>, <payload JSON>, { id: "<outbox id>", effect: "<name>", attempt: n })
```

which returns a promise; the host then `pump`s to quiescence under the
budget (30 s default; `E_EFFECT_TIMEOUT` → `Failed { retry: true }`), reads
`__snapback.result` / `__snapback.error`, and drains `console` records into
the owner's log with the outbox id. Nothing from one job survives into the
next: the prelude keeps no state, the global object is frozen, the per-job
`{ fetch, meta }` tools are fresh and frozen each job, payload and meta enter
as JSON *strings* parsed inside the prelude (never interpolated as literals),
and a job whose promise resolved but whose runtime did not reach quiescence
(a stray timer, an unawaited fetch) is `Sent` with the runtime *dropped*.
The effect's source is compiled once per runtime, not per job. Grant denials
are classified by a tag the prelude's fetch wrapper sets
(`error.code = "E_EFFECT_GRANT"`), never by message text (review rulings
2026-08-30). The
runtime is dropped after 50 jobs or on generation change, whichever first —
Hermes heaps are cheap, leaks are not.

The fetch factory follows redirects one raw request at a time so grant denial
attribution names the attempted hop. At expo/ibex revision
`c8e1941f6e7e2bf6c17a209797da8d6c0785a0f0`, Ibex publishes one frozen opt-in
object whose `fetch`, response field/read, fetch-control, UTF-8, and
headers-free members follow ibex LLP 0068 §3's handle-domain and release
protocol. Trusted bootstrap captures that object, deletes its global, and
keeps the object and every member behind closures only; `Hermes::harden()`
refuses construction if the object or a member remains reachable from the
frozen graph. The test-owner bound wrapper performs logical grant/binding
checks before the raw primitive; a refusal before raw leaves the ordinary
Headers handle unclaimed, while a call into the primitive transfers the fresh
snapshot into that object's domain and releases it exactly once after
settlement. Response handles finish by EOF, terminal read rejection, or field
8 cancellation; control tokens release once. Snapback keeps lowercase header
pairs for the next hop and applies §1's rewrite and strip rules there. Neither
the object nor a member is reachable from authored effects.

A JS exception is `Failed { retry: true }`; a grant denial (`denied:
net.fetch`) is `Failed { retry: false }` — retrying a refused origin is
pointless and the message names the denied hop's origin. A result JSON cannot
carry — `undefined` (a forgotten `return`), a function, a symbol, a BigInt, a
cycle, a non-finite number — is `Failed { retry: false, error:
"E_EFFECT_RESULT" }`: loud, never `sent` as `null`, never retried (ruling
2026-08-30). Effect source is evaluated as its own top-level script over the
hardened global — nothing in the prelude's closure is lexically visible to it —
embedded constants are deep-frozen, and the engine's timer hook accepts one
invocation per host pump.

## 4. In the owner

- The owner (LLP 1002 §5) runs one **runner thread** that wakes on every
  commit whose `emits > 0` and every 1 s otherwise, drains up to 16 jobs,
  and hands each `then` back to the writer thread.
- `/control/status.effects` = `{ engine: "ibex2 + vanilla hermes" | "none",
  queued, running, thenPending, sent, failed, sentUnknown }` from the store's
  real `_outbox` counts in every build; the runner thread runs in every build
  (`NoEngine` keeps rows `queued` with `last_error`, still marks `running` rows
  `sent_unknown` at start and replays `then_pending`, which needs no engine);
  `doctor` counts from the owner when one runs, else by opening the store
  itself; requeue resets `attempts` (an operator-authorized new budget); `doctor` prints the engine
  and, when there is none, `effects: no engine in this build — N queued` in
  red-equivalent text (never omitted).
- **Default build = seam only.** `cargo build` links no engine (LLP 1000
  decision 3; `rules/NOT-DOING.md`). `emit` still commits outbox rows; they
  stay `queued`; `test`'s `effects` check reports `blocked: no engine in
  this build`. Nothing silently succeeds.
- **The published binary carries the engine.** `scripts/publish.mjs` builds
  through `scripts/hermes` (`--features hermes`, production profile) and
  refuses to publish an engine-less binary (`SNAPBACK2_PUBLISH_WITHOUT_ENGINE=1`
  overrides, loudly, for a platform without vanilla Hermes). The size is a
  measured number in `metrics/loop.jsonl` beside the engine-less one.
  `hermes-lean-sys` downloads the platform bundle for engine pin
  `260318099.0.4` (`d412d3bd8512`), verifies its pinned SHA-256 and the bundle's
  receipt, and caches it under Cargo home. The pins came from a release whose
  Sigstore attestations were verified when pinning; acquisition does not
  re-verify Sigstore. `HERMES_LEAN_SYS_DIR` is the explicit local install
  override; no hand-built Hermes or separate `hermesc` path is a prerequisite.

## 5. What binds, and how it is checked

- `cargo test -p snapback2-effects` (seam) runs in the blocking script;
  `scripts/hermes test -p snapback2-effects` (engine) is the engine proof and
  is **never** part of the five blocking checks — a cold Hermes link takes
  minutes (review ruling 2026-08-30). Engine tests: a job that `fetch`es a loopback HTTP server
  started by the test (as ibex2's own tests do) and returns its body; a job
  to an undeclared origin fails without retry; a job that throws retries; a
  job that never resolves times out; console output is captured; two jobs of
  one effect share no state.
- Owner integration (lane C, with lane B1's owner): a mutation with `emit`
  → `_outbox` row → runner → `sent` → `then` committed → the subscription
  that reads the `then` mutation's table is delivered. `trace <seq>` shows
  the chain.
- `sent_unknown`: a `running` row at owner start is marked `sent_unknown`
  and never re-run automatically.
- Sizes: production binary with the engine, recorded.

## Deferred (not binding)

`snapback.query`/`snapback.run` from inside an effect (a loopback `fetch`
to the owner with a service token is the intended shape); hermesc bytecode
at `check` time (today Hermes compiles source at job start — a recorded
deviation from "nothing compiled at runtime that could be built ahead");
grants beyond `net.fetch` (`env.read` for provider keys is next, with
`secret`); the `schedule` and `job` kinds; effect concurrency beyond one job
per effect.

## Open author decisions

1. Whether `then` should be mandatory (every effect leaves a row) or stay
   optional (fire-and-forget with only the outbox row as the record).
2. The retry policy numbers (5 attempts, 1 s·2ⁿ) and the 30 s budget.
3. Whether the published binary must always carry the engine, or a
   `snapback2-<platform>-lite` package is worth the second artifact.

### Runtime hardening (2026-09-12)

The host channel uses 256 bits from the operating-system CSPRNG. Runtime
construction arms the job deadline before trusted setup, and reports an expired
setup budget as the same retryable timeout as authored execution. Failed host
channel calls and unwound host calls discard cached runtimes. Retryable provider
errors survive clock failures: retry scheduling falls back to the claim instant,
with the clock failure logged separately. Stop checks also guard replayed `then`
work, including initialization.

The drive loop backs off from 1 to 40 ms only while no task is delivered,
resets after delivered work, and caps the wait by the next timer and the job's
deadline. The pinned Ibex API has no public wait-only completion primitive;
the bounded backoff avoids coupling host timer permits to Ibex's multi-pump API.
