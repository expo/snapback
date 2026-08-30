# LLP 1003: Effects — JavaScript with I/O, on Ibex 2, through the outbox

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2-effects` (the host and runner), `snapback2/crates/snapback2` (the runner thread in the owner; `doctor`), `snapback2/packages/compiler` (lowering `effect()` and `emit()`), `snapback2/scripts/{hermes,publish.mjs}`
**Author:** Claude Fable 5 (orchestrator) — implementer: codex gpt-5.6-sol, lane C (compiler lowering: lane B0)
**Date:** 2026-08-29
**Revised:** 2026-08-30
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
  it may not `import` or `require` (`E_EFFECT_IMPORT`); it may use `fetch`,
  `meta`, `console`, `JSON`, `Math`, `Date`, `URL`, `TextEncoder`/`Decoder`,
  `btoa`/`atob`, `setTimeout`, `Promise`, `crypto.randomUUID()` if Ibex 2
  provides it — nothing else is in scope (§3 hardens the global object).
- `grants` is a non-empty list of `https://` or `http://127.0.0.1` origins
  (`E_EFFECT_GRANT`).
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

## 2. The outbox lifecycle

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

`Ibex2Host` per effect: `Hermes::new(DynamicCode::Closed)` → `install_stdlib`
→ `install_bindings` → `install_fetch(&Grants::parse("net.fetch <origin> …"))`
→ evaluate a prelude that builds `fetch` from Ibex 2's fetch factory bound to
those grants and freezes a `__snapback` namespace → `harden()`. A job is one
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
