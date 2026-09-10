# LLP 1021: Effects in the loop — an emitted row a builder can watch, test, and stop

**Type:** RFC
**Status:** Accepted (author, 2026-09-10: "ok commit those then implement all of the RFCs"; implementer: codex gpt-6-astra lanes under the orchestrator, program directory `~/projects/snapback-ri-20260910`, plan and briefs there; date 2026-09-10; per `rules/RULES.md` it binds lane by lane as each lane's code lands, and the implementation record below names each landing. Lane F5 (the expo/ibex deadline) is the one upstream dependency.) Written on the author's request of 2026-09-09 ("write up 3 LLPs or sub-LLPs to address 1 and 2 and 3") after the elegance assessment of 2026-09-08.
**Systems:** the effects runner and hosts (`snapback2/crates/snapback2-effects/src/{runner,runner_settlement,host,ibex}.rs`, `prelude.js`, `prelude/fetch.js`), the owner's effects thread and control routes (`snapback2/crates/snapback2/src/{effects,control,owner,writer,writer_ledger,doctor,verbs,watch}.rs`), the `test` verb, supervisor, and receipt (`snapback2/crates/snapback2/src/{test,test_invalidation,receipt}.rs`), the journey runtime (`snapback2/packages/snapback2/src/test.ts`, `types/test.d.ts`), the compiler's effect identity (`snapback2/packages/compiler/src/test-effects.ts`), `.snapback/log.jsonl`, the assets ledger, transaction, and staging (`snapback2/crates/snapback2-core/src/{assets_ledger.rs,engine/mod.rs}`, `snapback2/crates/snapback2/src/{writer_assets,blob_store}.rs`), `reset` and personas (`writer_assets.rs`, `identity.rs`), the chat template's seed and effect, the guide (`effects.md`, `testing.md`, `operator.md`, `personas.md`), `guide/families.source.json`, expo/ibex (a deadline API)
**Author:** Claude (Fable 5.1), for the author
**Date:** 2026-09-09
**Revised:** 2026-09-10 (Accepted; implementer and date assigned); 2026-09-09 (revision (a): a blind gpt-6-astra review at maximum reasoning, `llp/reviews/1021-effects-in-the-loop.r1-astra.md`, returned NOT READY with seven blocking findings; every finding is folded below — authored witnesses replace synthetic probes, `settle` covers `then_pending` and reports `then` outcomes, provider bindings are supervisor-owned with no external fallback anywhere in the test owner, timeouts keep LLP 1003's retry contract, staging uses discard semantics under LLP 1006, seed handles obey `format handle`, three evidence sentences are narrowed; both open questions are resolved by that review's rulings)
**Related:** LLP 1003 (effects on Ibex 2: the host seam, the outbox lifecycle §2, `then` settlement §2, timeouts §3, §4 "default build = seam only", §5 "never blocking"), LLP 1002 §1 d.4 (seed and `reset`), §7 (the derived checks; "blocked is not pass"; asset arguments need an upload journey), §8 (`trace`), LLP 0329.016 §5.6 (no silent states), §5.7 ("never mock infra"), §5.11 (the verb table), LLP 1016 (personas on first use; background turns for schedules and jobs; `--dry-run`), LLP 1006 (assets: release, grace, the ledger's usage from rows), LLP 1012 (the twin replays a mutation without executing its effect), LLP 1000 decision 3, LLP 1019 and LLP 1020 (sibling RFCs of the same day), `rules/NOT-DOING.md` (the capability bar: "no external I/O"; no registries), `issues/20260901-snapback2-effect-timeout-cannot-interrupt-synchronous.md`, `issues/20260906-snapback2-asset-staging-quota-unrecoverable-after-abandoned-uploads.md`, `issues/20260906-snapback2-owner-asset-staging-ceiling-refuses-reseeds.md`, `issues/20260907-snapback2-reset-keeps-template-seed-rows-and-dev-reset-have-no-help.md`

## Summary

Snapback 2's loop promises no silent states: every read is `complete`,
`capped`, `partial`, or `denied`; every write is `committed`, `rejected`,
or `queued`. The one thing a program does that leaves the machine — `emit`
— is the exception. A journey cannot see an emitted row or wait for it;
`snapback2 test`'s `effects` check passes on the engine's name alone and
never asks whether any effect ran; an engine-less runner writes no log
line; a running effect cannot be stopped; and the guide's sentence about
it says the default binary will never run one. Around it sit three smaller
traps of the same family — an abandoned upload that keeps its staging
charge at commit, a `reset` whose output omits that it re-seeded, and a
seed handle that takes the name a builder's first signup wants.

This RFC proposes:

1. **Every outbox transition is a log line**, written at the site that
   makes the transition, and `dev` says at boot what its engine is and how
   many rows wait. `logs --effects` filters; `trace` shows a row's history.
2. **Journeys can see and settle the outbox.** The journey context gains
   `effects.settle({ upTo })` — run the due background turn, drain, and
   return when every row emitted at or before `upTo` is terminal or
   `then`-settled, or say why not — and `effects.rows()`, over two dev-only
   control routes. `then_pending` counts as unsettled; a `sent` row reports
   its `then` outcome.
3. **Journeys stand in for a provider, and nothing else answers.** In the
   test owner every effect fetch must match a binding a journey declared
   with `effects.provider(origin, handler)`; the supervisor owns the
   binding's lifetime; an unmatched fetch is an explicit `E_EFFECT_UNBOUND`
   outcome and never reaches external transport. The grant admits the
   logical origin on every request and redirect before transport
   substitutes the loopback. The effect's code runs unchanged in the real
   engine. This is not a double of Snapback; it is the third party the
   grant names.
4. **`test`'s effects check counts witnesses, not probes.** Every declared
   effect needs one successful authored witness in the selected journeys —
   a real emission, executed against a journey provider, with its declared
   `then` committed. Missing evidence is `blocked`, naming the effect and
   the journey needed. Without an engine the check stays `blocked` and
   engine-dependent journeys are `blocked: effects:no-engine`, never
   failed.
5. **A running effect can be stopped.** expo/ibex gains one monotonic
   deadline across its three execution entrances and cleanup; the runner
   arms it from the declared budget before the first call; shutdown admits
   no new claims; the owner's join is bounded and its detachment is logged
   as what it is. Timeouts keep LLP 1003's `retry: true`.
6. **The three adjacent traps close under their governing LLPs**: a
   validated asset argument the committing mutation did not attach is
   discarded in that commit (LLP 1006 amendment); `reset` reports its seed
   accounting and `reset --empty` is specified, not implied; template seed
   handles are `alice_dev`, `bob_dev`, freeing the example names.

The default `cargo build` stays engine-less and the five blocking checks
stay engine-free (LLP 1003 §5's ruling). The published binary already
carries the engine — 7,312,592 bytes with it, 4,078,496 without
(`snapback2/metrics/loop.jsonl:241`) — so for the builder the gap is
visibility and testability, not the build.

## Evidence

- **No engine, no line.** `runner.rs:222-228`: when the host describes
  itself as `none`, `mark_queued_unavailable("no engine in this build")`
  updates `_outbox.last_error` and returns; `drained.unavailable` is never
  forwarded to the log (`effects.rs:335-342` forwards only `drained.logs`,
  and only after a drain). `doctor.rs:109-110` prints the count; `dev`
  prints nothing; `trace <seq>` shows a row snapshot with `state:
  "queued", lastError: "no engine in this build"`
  (`writer_ledger.rs:272-303`), not its transitions.
- **The `effects` check asks nothing of the effects.** `test.rs:693-721`
  `check_effects` reads `/control/status` → `effects.engine`; without an
  engine it returns `blocked`; with one it returns `CheckReceipt::pass` on
  the engine's name alone, `{ engine, declarations }`. The test owner does
  start the real runner before the derived checks and journeys
  (`owner.rs:216`, `test.rs:185`), and a journey's `send` does emit
  `delivery.notify` (`templates/chat/snapback/messages.q:32`) — so effects
  *run* in `test` when an engine is present; nothing observes whether they
  succeeded, and the receipt cannot say.
- **Journeys cannot see the outbox.** `test.ts:40-46` gives a journey
  `as(name)`, `tick(ms)`, `url` and nothing else; `tick` is a clock offset
  (`writer.rs:817-836`), not a drain, and due schedules and jobs fire on
  later bounded background turns (LLP 1016 §D5). `data _outbox` refuses
  `E_SCHEMA_TABLE_UNKNOWN` (`writer_data.rs:20-35`). The control routes
  (`control.rs:94-266`) list no outbox; `POST /control/outbox/<id>/requeue`
  accepts only `sent_unknown` or `failed` rows. The chat template's
  `outbox` in its tests is the client's local-first outbox
  (`guide/offline.md:54`), a different thing with the same name.
- **The guide says so.** `guide/effects.md:65-67`: "The default development
  binary has no engine. `snapback2 test` records the derived effects check
  as `blocked: no engine in this build`; it never claims the queued row was
  sent."
- **Nothing stops a running effect.** The ticket of 2026-09-01: `while(true){}`
  "never fires" the 30-second budget, "the outbox row remains running, and
  dev --stop/SIGTERM hangs joining the effects thread"; the cause is that
  the timer starts only after `call_host` returns and none of
  `ibex2_hermes_eval` / `drain_microtasks` / `pump` "arms an async break or
  accepts a deadline"; the ticket also records that detachment is not
  evidence the execution stopped. `effects.rs:265-272`: the owner's `Drop`
  is an unbounded `thread.join()`; the CLI returns `E_OWNER_STOP_TIMEOUT`
  after two seconds (`verbs.rs:297`) while the owner process stays alive.
  The runner can claim up to sixteen jobs per drain before it checks its
  stop flag (`runner.rs:15`, `:229`), and its default job budget is thirty
  seconds — the whole `test` budget (`rules/RULES.md`).
- **There are no mocks, by principle.** LLP 0329.016 §5.7 "never mock
  infra", "not a test double"; the only stub is `#[cfg(test)] StubHost`
  (`runner.rs:703-731`); `--dry-run` is "no effects, timers, sweeps, or
  blob writes" (`AGENTS.md:27`). The capability bar excludes external I/O
  (`rules/NOT-DOING.md:20`); the brief's push item asks for a logged seam,
  not real APNs/FCM (`benchmarks/briefs/social-messenger.md:625`).
- **The staging charge survives commit.** The open ticket of 2026-09-06: a
  retried media send with the same client mutation id eventually fails with
  `E_ASSET_TOO_LARGE: the owner has reached the 536870912 byte or 40
  object staging ceiling` because the idempotent early return "never
  attaches the staged object, and nothing releases an unattached staged
  object at commit". Ordinary release frees the pending object slot but
  deliberately keeps the original-byte charge through LLP 1006's grace
  period (`assets_ledger.rs:249`, LLP 1006 §"release"), and usage is
  recomputed from ledger rows (`assets_ledger.rs:562`), so "release at
  commit" would not repair the ceiling. `listUploads`/`discardUpload`
  landed for the operator; nothing acts at commit.
- **`reset` and the handle.** `reset` deletes rows and re-applies the seed
  by design (LLP 1002 §1 d.4, `engine/mod.rs:908-922`); it prints a JSON
  result and `--help` mentions re-seeding (`verbs.rs:25`), but the result
  carries no seed accounting, so the ticket's builder could not tell what
  came back. The chat seed gives `dev:alice` the profile handle `"alice"`
  (`seed.ts:4,7`) under `unique byHandle` (`schema.q:12`), so a builder's
  first real signup as `alice` is refused by their own fixture; `charlie`
  deliberately has no profile (`guide/testing.md:18`). `format handle`
  admits lowercase ASCII letters, digits, and underscores (`schema.rs:404`).

## Design

### 1. The lifecycle is in the log

Every outbox transition writes one structured line to `.snapback/log.jsonl`
**at the site that commits the transition** — the emitting commit, the
runner's claim, a retry decision, restart recovery (`running` →
`sent_unknown`), an operator requeue, and the `then` settlement in both its
outcomes — not forwarded after a drain:

```json
{"outbox":{"id":"…","seq":812,"effect":"delivery.notify","from":null,"to":"queued","by":"messages.send"}}
{"outbox":{"id":"…","seq":812,"effect":"delivery.notify","from":"queued","to":"running","attempt":1}}
{"outbox":{"id":"…","seq":812,"effect":"delivery.notify","from":"running","to":"then_pending","ms":143}}
{"outbox":{"id":"…","seq":812,"effect":"delivery.notify","from":"then_pending","to":"sent","then":{"op":"notifications.recordNotified","state":"committed","seq":815}}}
{"outbox":{"id":"…","seq":813,"effect":"delivery.notify","from":"running","to":"queued","attempt":2,"nextAt":…,"error":"provider 503"}}
{"outbox":{"engine":"none","queued":3}}
```

Effect names are the compiler's qualified identity (`delivery.notify`,
`packages/compiler/src/test-effects.ts:51`). A `then` that was rejected
still moves the row to `sent` (LLP 1003 §2) and the line says
`"then":{"state":"rejected","code":…}`. If the log file cannot be written,
the owner's status reports `log: unavailable(reason)` (LLP 0329.016 §5.6:
no silent states) instead of dropping lines. `logs --effects` filters to
these lines; `trace <seq>` adds the row's transition history from the log
beneath the snapshot it already returns. `dev` prints one line at boot
beside `SNAPBACK_URL`, inside the existing machine-readable startup
envelope (`owner.rs:658`): `effects: ibex2 + vanilla hermes` or `effects:
no engine in this build — 3 queued (build one: scripts/hermes build -p
snapback2)`. The "unavailable" path writes the last line above once per
change in the queued count, never per pump.

### 2. Journeys see and settle the outbox

Two dev-only control routes, under the same admission as `/control/clock`:

- `GET /control/outbox[?state=…&after=…&limit=…]` — the rows `trace`
  already assembles (`id, seq, effect, state, attempts, nextAt, lastError,
  result`) plus `then: { op, state, seq?, code? }` when settled; stable
  pagination by `(seq, id)`, `limit ≤ 200`, a byte cap on `result`.
- `POST /control/effects/settle { upTo, budgetMs }` — first run one bounded
  background turn so schedules and jobs due at the (possibly `tick`-advanced)
  clock produce their emissions, then pump the runner until every row with
  `seq ≤ upTo` is `sent` with its `then` settled, `failed`, or
  `sent_unknown`, or the budget is spent. The wait happens off the writer.
  The response is `{ settled: bool, rows: [...], remaining: [{ id, reason }] }`
  with `reason ∈ backoff(nextAt) | then_pending | running | engine:none |
  budget`. "Nothing runnable now" is reported as `remaining`, never as
  `settled`.

The journey context gains `effects.rows()` and `effects.settle()`
(`test.ts`), typed in `types/test.d.ts`:

```ts
journey("a sent message notifies the recipient", async ({ as, effects }) => {
  const provider = await effects.provider("https://api.example.com",
    async () => Response.json({ id: "prov-1" }));
  const alice = as("alice");
  const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "hi" });
  if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  const { settled, rows, remaining } = await effects.settle({ upTo: sent.seq });
  if (!settled) throw new Error(`unsettled: ${JSON.stringify(remaining)}`);
  const row = rows.find((r) => r.seq === sent.seq && r.effect === "delivery.notify");
  if (row?.state !== "sent" || row.then?.state !== "committed") throw new Error(`notify: ${JSON.stringify(row)}`);
  if (provider.requests.length !== 1) throw new Error("exactly one provider call");
});
```

Backoff is real time; `settle` honors `tick` so a journey can advance past
`nextAt` without sleeping. Without an engine `settle` returns at once with
`remaining: [{ reason: "engine:none" }]`, and the journey is recorded
`blocked: effects:no-engine` by the supervisor (§4), not failed.

### 3. A provider stand-in, and nothing else answers

`effects.provider(origin, handler)` starts a loopback HTTP server owned by
the journey process and registers a **binding** with the test owner
(`POST /control/effects/bind { origin, to, epoch }`):

- **Lifetime.** A binding belongs to one journey epoch, not the owner's
  lifetime. The supervisor (`test_journey_runner.rs`) revokes every binding of a
  journey on completion, failure, timeout, or process death; revocation
  never depends on journey cleanup code. `POST /control/effects/epoch
  { epoch: null }` revokes future claims atomically, then waits off the writer
  for every claim from that epoch to settle (including its `then`). The wait
  is bounded by the effect budget + 1 s. The close response lists any claims
  still running at the bound and the supervisor fails the journey; another
  epoch cannot open while they remain. There is no live per-hop epoch check:
  an in-flight attempt finishes against its original binding. On normal
  completion the runner keeps its providers alive until the supervisor
  acknowledges this close; death/timeout still closes through the supervisor.
  An empty close returns immediately; a journey with no bound provider needs
  no cleanup acknowledgment. The acknowledgment ends stdin so the runner can
  exit naturally and its nonzero exit cannot be hidden by grace cleanup.
- **No fallback, anywhere in the test owner.** Every effect fetch in a
  `test` owner — including rows emitted by the derived checks, rows left
  over from an earlier journey, and rows retried after backoff — must match
  a live binding for its logical origin. An unmatched fetch is a terminal
  `failed` outcome with `E_EFFECT_UNBOUND` (family `effect`, site the
  effect's `fetch` call, rewrite "declare `effects.provider('<origin>', …)`
  in the journey that emits `<effect>`", page `guide effects`) and never
  reaches external transport. A row from an earlier epoch cannot acquire a
  later journey's binding. Epoch membership is keyed by commit seq: only
  `row.seq > epoch.since` claims the epoch's table. A journey binds **before
  it emits**: a row claimed between emit and bind fails `E_EFFECT_UNBOUND`.
- **Grants first.** In bound mode a separate logical admission check in
  `prelude/bound.js` sits in front of Ibex's raw loopback-only grant check.
  It admits the **logical** origin on every
  request and on every redirect, and the credential-stripping rule keys on
  logical origins as today; only after admission does transport resolve
  the origin to the bound loopback address. `E_EFFECT_GRANT` fires exactly
  as in production. The effect's source, timer permit, `meta.id`, and
  `then` run unchanged in the real engine. `response.url` stays logical,
  including after redirects; the stand-in's `Request` carries the logical
  URL and `Host` (and `:authority` if present).
- **Capture.** `provider.requests` records method, path, headers, and body
  up to a cap: 200 requests and 16,384 UTF-8 bytes per retained body at a
  character boundary. `bodyBytes` reports original bytes, `bodyCapped` the
  truncation and limit, and `dropped` the requests beyond the cap.
- **Journeys only.** Manual `dev` has no binding route (question 1). A
  builder who wants a local provider in `dev` changes the effect's request
  URL and its grant, which is one line and honest.

This honors LLP 0329.016 §5.7 by its reason: nothing of Snapback is
doubled; what the journey supplies is the third party the loop cannot own
and the capability bar forbids reaching.

### 4. `test` counts witnesses

The `effects` derived check no longer manufactures anything. It aggregates
the execution evidence the framework recorded while the selected journeys
ran:

1. For every declared effect, at least one **successful witness**: a real
   mutation, job, or schedule committed an emission; the real engine
   executed it against a journey-owned provider; its declared `then`
   committed (an effect without `then` records that explicitly). A granted
   effect requires at least one substituted request, counted per attempt and
   every hop by the bound transport and reported by the prelude. The runner
   records `provider: { origins, requests, refused }` on the settlement line;
   any recorded refusal disqualifies that attempt, even when it catches the
   denial after a substituted hop and returns JSON. Production jobs record none.
   A grant-less effect requires `sent` alone
   (plus any declared `then`) and records `provider: { declared: false }`.
2. The receipt lists, per effect: the journey, the outbox id, the emission
   `seq`, attempts, terminal state, elapsed time, and the `then` outcome
   with its commit `seq`, and the provider evidence. Time matches the outbox
   id and attempt; missing timing is `ms: null, timing: "unavailable"`.
   `notWitnessed[effect]: { rows, dropped }` reports the 20-row negative-evidence cap.
3. An expected-refusal journey (an ungranted origin, an unbound origin) is
   negative evidence and does not substitute for a witness.
4. Missing evidence is `blocked: effects:no-witness` naming the effect and
   the journey it needs. A selected run (`test <journey>`) states its
   coverage scope and cannot claim execution coverage it did not obtain.
   `--derived-only` also skips the effects witness check and records
   `scope.derivedOnly: true`. Failed control requests are a `fail` verdict,
   never inferred engine absence.
   Unavailable trace history retains its reason in `detail.history`; if it
   prevents coverage, `effects:history-unavailable` reports that reason instead
   of requesting another authored witness. A malformed history reply fails.

Without an engine the check stays `blocked: no engine in this build` with
`detail.build` naming the command (repo: `scripts/hermes build -p
snapback2`; package: the engine-bearing binary path), and engine-dependent
journeys are `blocked: effects:no-engine`. `measure.mjs` accepts exactly
these engine-absence blocks when every unrelated check passes (this amends
LLP 1002 §7's acceptance sentence, which today admits only the single
`effects` block); publication requires complete passing coverage. Journeys
keep their five-second budget and `test` its thirty (`rules/RULES.md`);
longer engine conformance stays on the schedule (LLP 1003 §5).

This replaces revision 0's synthetic probe, which would have broken the
template's own effect: `delivery.notify` returns `{ providerId:
(await response.json()).id }` (`delivery.ts:16`), and a `200 {}` answer
yields an undefined property the prelude rejects (`prelude.js:251,304`).
An input type cannot know a provider's successful response or the
database state a `then` needs; LLP 1002 §7 already makes the same
concession for asset arguments, which need an upload journey.

### 5. A running effect can be stopped

- **Upstream (expo/ibex):** one **monotonic deadline** carried across the
  three execution entrances (`ibex2_hermes_eval`, `drain_microtasks`,
  `pump`) and cleanup, using Hermes's time-limit watcher, with the checked
  interruption and `end_drive` requirements the ticket names. The remaining
  time is not reset at an entrance or a drain iteration. The pin in
  `snapback2-effects/Cargo.toml` moves when it lands.
- **Runner:** the deadline is armed from the declared budget before the
  runtime's top-level evaluation of the authored module and before the
  first `call_host`, so a spin at a module's top level is stopped by the
  same budget; a timed-out job reports `E_EFFECT_TIMEOUT` with
  **`retry: true`** exactly as LLP 1003 §3 and `ibex.rs:695` specify today
  (a timeout can be transient; an effect that reached its provider before
  timing out is retried under `meta.id` idempotency), so a program that
  spins exhausts its five attempts across the backoff schedule and then
  reads `failed` in the log. The drain loop checks the stop flag before
  each claim, and shutdown admits no new claims.
- **Owner:** `Drop` joins for at most the budget plus one second, then
  detaches and logs `{"outbox":{"engine":"detached","running":[…]}}`; the
  rows stay `running` and become `sent_unknown` on the next boot (LLP 1003
  §2). Detachment is a reported state, not a claim that execution stopped;
  the deadline is what stops it. `dev --stop` returns, and the acceptance
  observes the **owner process exiting**, not the CLI's two-second
  `E_OWNER_STOP_TIMEOUT`.

"What this does not do" below no longer claims "no retry policy change"
for timeouts; there is none.

### 6. The adjacent traps

- **Discard at commit (LLP 1006 amendment).** A validated typed asset
  argument that the committing mutation — including the idempotent early
  return for a replayed client mutation id, and offline-replay settlement —
  did not attach is **discarded** in that commit: the staged object is
  tombstoned, and both its object slot and its byte charge leave the
  ledger in the same transaction. This is distinct from ordinary release
  and its grace period, which stay as LLP 1006 specifies. Bounds: only
  arguments of the committing call, only objects the caller owns, at most
  the call's argument count; rollback restores nothing because nothing was
  attached; fork-aware deletion and receiving-byte custody are untouched.
  Correct end state for one attached original plus six discarded retries:
  zero pending staging objects, one attached asset. The operator verbs stay.
- **`reset` says what it did, and `--empty` is specified.** `reset`'s JSON
  result gains `seed: { rows, personas }` and the human line prints it;
  `reset --empty` clears rows, `_commits`, `_outbox`, `_jobs`, and
  `_timers` without re-seeding, keeps `_principals` and `_sessions` as
  ordinary `reset` does (`engine/mod.rs:908-922`), re-arms no schedule
  until a row exists to arm one, and survives restart as an empty store
  (the seed is applied only by `reset` or a fresh store). Both forms print
  `seed: skipped` or the counts.
- **Seed handles are fixtures.** The chat template's seeded profiles use
  `alice_dev` and `bob_dev` (`format handle`: lowercase, digits,
  underscore); `charlie` keeps no profile, as the testing guide relies on.
  This frees the example names for a real signup; it does not reserve a
  namespace, and the personas page says so in one sentence.

## What this does not do

- No engine in the default `cargo build`, no engine in the five blocking
  checks, no change to LLP 1003 §5. The engine proof stays on the schedule.
- No general mock layer, no recorded or replayed HTTP, no fixture files of
  provider responses, no synthetic payloads. A provider stand-in is code in
  the journey that answers a real request.
- No change to the retry policy, the backoff schedule, per-effect budgets,
  or the number of parallel drains.
- No new verb. `settle`, `rows`, `provider` are journey-context calls over
  control routes; `logs --effects` is a flag on an existing verb (LLP
  0329.016 §5.11's table gains a flag, not a row).
- No change to what the twin does on replay: it consumes the emission's id
  and executes no effect (`packages/evaluator/src/runner.ts:199`).

## Acceptance

1. `scripts/test.sh` on the engine-less build: unchanged verdicts; the loop
   record shows the `effects` block and the engine-dependent journeys as
   `blocked: effects:no-engine`, nothing red, nothing green that did not run.
2. `scripts/hermes test -p snapback2` (scheduled), on a scaffolded chat app:
   `test` reports `effects: pass` with one witness for `delivery.notify`;
   the receipt's `then` is `committed` with a `seq`.
3. Lifecycle journeys: a provider that answers after a restart of the owner
   between provider completion and `then` (row → `sent_unknown` → requeue →
   one committed `then`); a `then` that rejects (row `sent`, `then.state ===
   "rejected"`); a `then` whose generation changed (`E_EFFECT_THEN_CHANGED`);
   a provider 503 with `tick` past `nextAt` (attempt 2 in the log); more
   than 200 rows paged by `after`.
4. Isolation journeys: a journey is killed after its provider accepted a
   request but before settlement, then a second journey binds the same
   logical origin — the first row fails `E_EFFECT_UNBOUND`, the second
   journey's provider receives exactly its own request, and no socket left
   the loopback (asserted by a bound-only transport in the test owner). An
   ungranted redirect refuses `E_EFFECT_GRANT`; an unbound granted origin
   refuses `E_EFFECT_UNBOUND`.
5. Stopping: the `while(true)` fixture reports `E_EFFECT_TIMEOUT` at the
   budget with `retry: true`, then `failed` after five attempts; a
   recursive-microtask fixture and a provider that never answers hit the
   same deadline; `dev --stop` returns and the owner process is observed to
   exit within budget + 1 s.
6. Offline and schedules: a send queued offline whose authoritative
   response is lost is replayed and yields exactly one server emission and
   one provider request; a schedule advanced with every client disconnected
   emits on the background turn and settles.
7. Assets: seven identical retries of a photo send end with zero pending
   staging objects and bytes and one attached asset, across rollback of the
   seventh, a restart, and eventual physical cleanup; `reset` and
   `reset --empty` are asserted across a restart with a schedule installed.
8. A real account signs up as `alice` on the seeded chat template; `charlie`
   still exercises profile creation.
9. `logs --effects` on one send shows every transition in order with no
   other lines; `dev` prints the engine line inside the startup envelope.

## Implementation (proposed lanes; sizes are the orchestrator's estimate)

| lane | scope | size |
|---|---|---|
| F1 | transition log lines at their sites; `dev` boot line; `logs --effects`; `trace` history; log-unavailable status | small–medium |
| F2 | `/control/outbox`, `/control/effects/settle` (background turn + drain off the writer), journey `effects.rows/settle`, types, `remaining` reasons | medium |
| F3 | bindings: `/control/effects/bind`, supervisor-owned epochs, the bound-only transport in the test owner, logical-origin admission before substitution, `E_EFFECT_UNBOUND` family, loopback server and capture in `test.ts`, the chat `notify` journey | medium–large |
| F4 | witness aggregation in `check_effects`, receipt shape, `blocked: effects:no-witness` / `effects:no-engine`, `measure.mjs` acceptance amendment, LLP 1002 §7 sentence | medium |
| F5 | expo/ibex monotonic deadline (upstream) + runner arming + stop-flag per claim + bounded `Drop` | medium, two repositories |
| F6a | discard-at-commit in the transaction and ledger, offline-replay parity, LLP 1006 amendment | medium |
| F6b | `reset` accounting and `--empty` semantics; seed handles; guide sentences (`effects.md`, `testing.md`, `personas.md`, within budget) | small |

F1, F2, F6b need no engine and land first; F3 and F4 are proven by the
scheduled Hermes suite; F5 waits for the upstream pin; F6a lands with its
LLP 1006 amendment. Two blind reviews per lane under LLP 1002's loop.

**Sequencing against the siblings and the bar** (from the r1 review's
closing paragraph, adopted): publish the five-lane program, run the reduced
loop bar and the Clique cold rerun, land F1/F2/F5 as focused visibility and
stopping fixes, then LLP 1020's pricing repairs before broader effect
automation; this RFC's F3/F4 and LLP 1019 are sequenced on the cold rerun's
evidence, never as a prerequisite for obtaining it.

## Open questions (author) — resolved

1. *Should the provider stand-in be allowed in `dev`, or only in journeys?*
   **Resolved 2026-09-09 (r1 review, confidence 96):** journeys only, with
   supervisor-owned lifetime, per-journey isolation, and no external
   fallback anywhere in the test owner. Owner-lifetime bindings had the
   wrong lifetime (a killed journey cannot unbind), and a manual override
   surface is not required by the loop bar or the brief.
2. *Should `test` witnesses be opt-out per effect?* **Resolved 2026-09-09
   (r1 review, confidence 98):** no silent opt-out; authored witnesses
   replace synthetic probes, and missing evidence is `blocked`, naming what
   is missing. An expected refusal is negative evidence only.

## Implementation record

- 2026-09-10 — commissioned; lanes and landings are appended here as each lands (the orchestrator, program `~/projects/snapback-ri-20260910/plan.md`).

- 2026-09-10 — vis (`s2/ri-vis`): §1/F1 and §2/F2 implemented — transition lines written at their commit sites (emit, claim, retry, `sent_unknown` recovery, requeue, `then` committed/rejected), `{"outbox":{"engine":"none","queued":N}}` once per change, `log: unavailable(reason)` in status, `logs --effects`, `trace` history, the `dev` boot line in both envelopes, `GET /control/outbox` (`(seq,id)` pages, `limit ≤ 200`, 16 KiB `result` cap, `then` receipts), `POST /control/effects/settle` (one background turn, then a wait off the writer; `remaining` reasons), journey `effects.rows/settle` and types, `blocked: effects:no-engine`; tests: `writer_effects`/`control` unit tests, `outbox/lifecycle.rs`, `owner_cases/effects.rs` (405-row paging, serve refusal, both `then` outcomes), `owner_cases/timers.rs` (tick-advanced settle), `tests/effects-visibility.test.ts` (scaffolded chat, no engine); acceptance 1, 9, and the engine-free parts of 3 (a rejecting `then` is exercised by replaying a seeded `then_pending` row; provider execution waits for the engine suite); deviations: serve-mode refusal of both routes is the existing operator family (`E_OPERATOR_REQUIRED`, HTTP 400) where `/control/clock` says `E_OWNER_CLOCK_NOT_DEV` — same admission, no new diagnostic; the `then` commit seq is durable (`_outbox.then_seq`, bound at the settlement site); rejected `then` receipts carry `op`; a not-yet-due row is `backoff` in every build and `engine:none` names a due row nothing can run, so `settle` pumps a pending `then` beside engine-less queued rows and returns at once only when nothing ≤ `upTo` can move inside the budget; the boot line carries the queued count in both engine arms). Fix round r1 (blind reviews `vis-r1-grok`, `vis-r1-muse`): the settle loop, engine gating, serve-refusal assertions, panic-free settle path, package-test budget, `{ file, error }` journey failure detail, claim-transaction reporting of failed declarations, the GET helper, and the uncovered tests (backoff, `logs --effects` order, unavailable history, `E_EFFECT_UNKNOWN`, defaulted `settle`). Fix round r2 (blind reviews `vis-r2-grok`, `vis-r2-muse`): the ungated paging fixture seeds `failed` rows no engine can claim; the mixed-`then` owner test seeds more pending `then`s than an unwoken runner drains and asserts `settle` pumped past that ceiling; `testing.md` now says what `effects.md` says — an engine-less `settle` still pumps a pending `then` and waits out a backoff landing inside its budget, so §2's "returns at once" holds only when nothing ≤ `upTo` can move (a near-term backoff is waited for in every build, since `tick` can make it due).
- 2026-09-10 — traps: §6 F6a/F6b (transactional unused-argument discard, reset accounting/`--empty`, fixture handles) and §5 runner/owner shutdown (per-claim stop fence, budget + 1 s bounded join and detach log); tests: quota/replay/grace, seven-photo rollback/restart/cleanup, seeded/empty reset with schedules and sessions, real `alice` signup/`charlie` onboarding, stop-during-drain/detach, and Hermes `dev --stop` owner-process exit.
- 2026-09-10 — deadline (the snapback half of F5, §5): `ibex2` pinned at `90229cbe0` — the upstream deadline, and with it the streaming-body fetch ABI (`prelude/fetch.js` reads bodies through `__ibex2_response_read` under a control token and counts the reads as the job's pending I/O); `Ibex2Host` arms one deadline from the budget before the first `call_host` and holds it across every entrance, and the engine's `JsError::Deadline` is `E_EFFECT_TIMEOUT` with `retry: true`; tests: `ibex_deadline_tests.rs` (synchronous loop, recursive microtask chain, never-answering provider, well-behaved control, one deadline not renewed per entrance, five attempts across the backoff schedule to `failed`) and the Hermes `dev --stop` spinning-effect owner-exit journey in `tests/effects.rs`.

- 2026-09-10 — deadline, fix round r1 (§5): `ibex2` re-pinned at `9cbf9e62d` (the reviewed upstream fix round); the deadline is armed before the runtime's top-level evaluation of the authored module, so a spin at a module's top level is the same timeout (`a_spin_at_the_module_top_level_is_stopped_at_the_budget`); a job the host observed settled before the deadline keeps its settlement when the deadline ends its leftover I/O — the failure classification is made at settlement and carried by the snapshot, so a grant denial at the budget edge stays `retry: false` (`a_job_settled_before_the_deadline_keeps_its_settlement_when_leftover_io_reaches_it`); `prelude/fetch.js` releases a bodiless redirect hop once and settles the pending-I/O count when a body read throws (`ibex_fetch_tests.rs`); `E_EFFECT_ENGINE` has its families entry; the deadline tests warm the runtime before the clock, the `dev --stop` journey observes the first attempt's `running → queued` / `E_EFFECT_TIMEOUT` transition in the owner before stopping during the second attempt's spin (the settlement of the attempt spinning at the stop is lost to the writer's exit — `issues/20260910-snapback2-dev-stop-drops-the-settlement-of-a-job-the-deadline-ended.md`), and the holding provider closes its listener.
- 2026-09-10 — witness (`s2/ri-witness`): §3/F3 and §4/F4 implemented — `effects.provider(origin, handler)` starts a loopback stand-in in the journey process and binds it through `POST /control/effects/bind { origin, to, epoch }`; epochs are supervisor-owned (`POST /control/effects/epoch { epoch | null }` around every journey run, closed whatever the runner did, so revocation never waits on journey cleanup) and exist only on the owner `snapback2 test` starts (`dev --test-owner`; a `dev` owner refuses both routes, `E_INPUT`); a claimed row carries its epoch's binding table (rows emitted at or before the epoch's opening seq — derived checks, earlier journeys, their retries — carry an empty one); in the runtime the host installs a bound transport in front of Ibex's raw binding (`prelude/bound.js`: the grant on the logical origin first, with the engine's own denial text so `E_EFFECT_GRANT` is unchanged, then the binding, then substitution) and installs the raw binding with the bound loopback origins as its only grants, so no socket leaves the loopback; `E_EFFECT_UNBOUND` (family `effect`, page `effects`, tagged terminal in the prelude like a grant denial, message carries the rewrite) reaches no transport; `check_effects` runs after the journeys and counts one successful witness per declared effect inside a journey's seq window (`{ journey, id, seq, attempts, state, ms, then }`, `then: { declared: false }` for an effect without one, `notWitnessed` as negative evidence), `blocked: effects:no-witness` names the effect and the journey it needs, `blocked: no engine in this build` carries `detail.build`; `receiptVerdict` (measure/consumer smoke) accepts exactly the engine-absence blocks; the chat template gains the `a sent message notifies the recipient` journey; guide sentences on `effects.md`/`testing.md`; LLP 1002 §7 item 6 and the acceptance sentence revised. Tests: `ibex_bound_tests.rs` (substitution, unbound, grant-before-binding, rerouted and refused redirect hops, per-binding runtimes), `writer_bindings` (origin rule, dev refusal, epochs), `test_effects` (witness selection, negative evidence), `effects-visibility.test.ts` (dev refusal, `guide E_EFFECT_UNBOUND`, the engine-less receipt's `build` and the blocked provider journey), and the Hermes owner suite `tests/effects.rs` (chat template `effects: pass` with a committed `then` seq; isolation across a killed journey; provider 503 with `tick` past `nextAt`; `E_EFFECT_THEN_CHANGED`; offline replay after a lost response; a schedule with every client disconnected; `then` receipts across the restart-requeue path). Facts the RFC should state: a `then_pending` row after a restart is drained by `initialize` without a requeue, so the `sent_unknown → requeue` path is the row still `running` at death; epochs are keyed by the owner's commit seq, not stamped on rows; journeys bind before emitting.

- 2026-09-10 — witness fix round r1 (§3/F3, §4/F4): framework-owned per-attempt provider request/refusal counts on settlement transitions; granted witnesses require substituted contact, grant-less witnesses explicitly declare no provider; epoch close revokes future claims and waits off the writer for its claims (budget + 1 s, running identities fail the supervisor), with provider cleanup acknowledged only after close; logical response URLs and provider Host, UTF-8 capture bounds/original bytes, derived-only scope, owner-child-only test-owner flag, id/attempt timing and reported refusal truncation, and E_OWNER_TEST_IO sites/card. Tests: Hermes effects crate 73/0; Hermes owner effects suite 16/0; affected units 37/0; package effects-visibility 7/0, diagnostic-card follow-up 1/0. Restart under a test owner refuses the explicitly requeued old row without a second provider hit; the post-provider/pre-durable-settlement crash seam is still absent and tracked in issues/20260910-snapback2-crash-after-provider-before-settlement-witness-seam.md (item 10, no new apparatus).

- 2026-09-10 — witness fix round r2 (§3/F3, §4/F4): caught refusals remain negative evidence even after substituted contact; corrected the default chat engine-absence assertion; drained-close acknowledgment ends stdin and provider-free journeys skip the handshake, restoring natural nonzero exits and the loop budget; trace-history unavailability retains its reason while malformed replies fail; epoch/bind refusals carry route sites; supervisor location and emitted HTTP-refusal assertions corrected. Tests: Hermes effects crate 73/0, real-owner effects 18/0 (both caught redirect destinations), init 1/0, test_verb 34/0, test_effects 10/0, writer_bindings 7/0, control 7/0, runner 1/0, package effects-visibility 8/0; final consumer smoke 20.08 s ≤ 30 s, chat test 13.918 → 10.195 s locally. Inherited package-size/caps reds unchanged; no full suite or crash-boundary claim (r1 item-10 ticket remains).

- 2026-09-10 — witness fix round r3 (§3/F3, §4/F4): bind-after-claim and Hermes chat derived-only coverage; terminal non-witness receipts renamed `notWitnessed` with error/provider evidence and consumer verdict coverage; HTTPS Host-built owner redirects and production engine response URLs pinned; epoch open keeps the five-second client bound while close retains budget + 2 s; HTTP-500 control fixture answers a complete request and asserts the emitted refusal site. Tests: Hermes effects crate 74/0, real-owner effects 20/0, test_effects 11/0, writer_bindings 7/0, client 4/0, package effects-visibility 9/0; node build.mjs passes, no budget raised, no full suite or crash-boundary claim.
- 2026-09-10 — witness fix round r4 (orchestrator; review `witness-r3-codex.md`): a row without provider evidence (history unavailable) never witnesses, grants or not — zero refusals is evidence the row carries, not an absence of it.
