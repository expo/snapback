# LLP 1021: Effects in the loop — an emitted row a builder can watch, test, and stop

**Type:** RFC
**Status:** Draft — proposal, binds nothing (`rules/RULES.md`: only implemented specs bind; implementer and date unassigned, the author's call). Written on the author's request of 2026-09-09 ("write up 3 LLPs or sub-LLPs to address 1 and 2 and 3") after the elegance assessment of 2026-09-08.
**Systems:** the effects runner and hosts (`snapback2/crates/snapback2-effects/src/{runner,host,ibex}.rs`, `prelude.js`), the owner's effects thread and control routes (`crates/snapback2/src/{effects,control,writer,writer_ledger,doctor,verbs}.rs`), the `test` verb and receipt (`crates/snapback2/src/test.rs`, `receipt.rs`), the journey runtime (`packages/snapback2/src/test.ts`), `.snapback/log.jsonl`, the assets ledger and staging (`snapback2-core/src/assets_ledger.rs`, `crates/snapback2/src/{writer_assets,blob_store}.rs`), `reset` and personas (`writer_assets.rs`, `identity.rs`), the chat template's seed, the guide (`effects.md`, `testing.md`, `operator.md`), `guide/families.source.json`, expo/ibex (a deadline API)
**Author:** Claude (Fable 5.1), for the author
**Date:** 2026-09-09
**Revised:** —
**Related:** LLP 1003 (effects on Ibex 2: the host seam, the outbox lifecycle, §4 "default build = seam only", §5 "never blocking"), LLP 1002 §1 d.4 (seed and `reset`), §7 (the derived checks; "blocked is not pass"), §8 (`trace`), LLP 0329.016 §5.6 (no silent states), §5.7 ("never mock infra"), §5.11 (the verb table), LLP 1016 (personas on first use; `--dry-run` rehearsal), LLP 1000 decision 3, `issues/20260901-snapback2-effect-timeout-cannot-interrupt-synchronous.md`, `issues/20260906-snapback2-asset-staging-quota-unrecoverable-after-abandoned-uploads.md`, `issues/20260906-snapback2-owner-asset-staging-ceiling-refuses-reseeds.md`, `issues/20260907-snapback2-reset-keeps-template-seed-rows-and-dev-reset-have-no-help.md`

## Summary

Snapback 2's loop promises no silent states: every read is `complete`,
`capped`, `partial`, or `denied`; every write is `committed`, `rejected`,
or `queued`. The one thing a program does that leaves the machine — `emit`
— is the exception. An emitted row cannot be seen by a journey, is never
exercised by `snapback2 test` even when an engine is present, writes no log
line when no engine can run it, cannot be stopped once it is running, and
is documented by a guide sentence that says the default binary will never
run it. Around it sit three smaller traps in the same family — an abandoned
upload that leaks a staging slot at commit, a `reset` that re-seeds without
saying so, and a seed handle that takes the name a builder's first signup
wants — each a state the loop does not surface.

This RFC proposes:

1. **Every outbox transition is a log line**, and `dev` says at boot what
   its engine is and how many rows are waiting. `logs --effects` and
   `trace` show the lifecycle; `doctor` already does.
2. **Journeys can see and settle the outbox.** The journey context gains
   `effects.settle()` (drain now, return when the queue is quiet or the
   budget is spent) and `effects.rows()` (the rows with state, attempt,
   error, result), over two dev-only control routes.
3. **Journeys can stand in for a provider.** `effects.provider(origin,
   handler)` starts a loopback server in the journey process and rebinds
   that origin, for this owner and this run, so the effect's own code runs
   unchanged in the real engine with the real grant check. This is not a
   test double of Snapback; it is the third party the grant names.
4. **`test`'s effects check runs the effects.** With an engine: every
   declared effect is emitted once by a derived probe, settled, and its
   `then` observed; the receipt says `pass`, `fail` (with the row's error),
   or `blocked: no engine in this build`. Without an engine the check stays
   `blocked`, exactly as today, and the receipt names the command that
   builds one.
5. **A running effect can be stopped.** expo/ibex gains a deadline around
   its three execution entrances; the runner arms it from the declared
   budget; `dev --stop` never joins an effects thread unboundedly.
6. **The three adjacent traps close**: a staged object the committing
   mutation did not attach is released at commit; `reset` prints what it
   did and `reset --empty` skips the seed; template seed handles are
   spelled so they cannot collide with a real signup.

The default `cargo build` stays engine-less and the five blocking checks
stay engine-free (LLP 1003 §5's ruling). The published binary already
carries the engine (7.3 MB with, 4.1 MB without, `metrics/loop.jsonl`), so
for the builder the gap is visibility and testability, not the build.

## Evidence

- **No engine, no line.** `runner.rs:222-228`: when the host describes
  itself as `none`, `mark_queued_unavailable("no engine in this build")`
  updates `_outbox.last_error` and returns; `drained.unavailable` is never
  forwarded to the log (`effects.rs:335-342` forwards only `drained.logs`).
  `doctor.rs:109-110` prints the count; `dev` prints nothing; `trace <seq>`
  shows `state: "queued", lastError: "no engine in this build"`
  (`writer_ledger.rs:272-303`).
- **`test` never runs an effect.** `test.rs:693-721` `check_effects` reads
  `/control/status` → `effects.engine` and returns `blocked` without one;
  with one it returns `CheckReceipt::pass` on the engine's name alone,
  `{ engine, declarations }` (LLP 1002 §7 check 6: "every effect
  declaration has a runner able to run it"). No probe is emitted; no
  effect runs.
- **Journeys cannot see the outbox.** `test.ts:40-46` gives a journey
  `as(name)`, `tick(ms)`, `url` and nothing else; `tick` is a clock offset
  (`writer.rs:817-836`), not a drain. `data _outbox` refuses
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
  accepts a deadline". `effects.rs:265-272`: `Drop` is an unbounded
  `thread.join()`.
- **There are no mocks, by principle.** LLP 0329.016 §5.7 "never mock
  infra", "not a test double"; the only stub is `#[cfg(test)] StubHost`
  (`runner.rs:703-731`); `--dry-run` is "no effects, timers, sweeps, or
  blob writes" (`AGENTS.md:27`).
- **The staging leak.** The open part of the 2026-09-06 ticket: a retried
  media send with the same client mutation id "fails on the seventh retry
  with `E_ASSET_TOO_LARGE: the owner has reached the 536870912 byte or 40
  object staging ceiling`" because the idempotent early return "never
  attaches the staged object, and nothing releases an unattached staged
  object at commit". `listUploads`/`discardUpload` landed for the
  operator; the commit-time release did not.
- **`reset` and the handle.** `reset` deletes rows and re-applies the seed
  by design (LLP 1002 §1 d.4, `engine/mod.rs:908-922`) and says nothing;
  the chat seed gives `dev:alice` the profile handle `"alice"` (`seed.ts:4,7`)
  under `unique byHandle`, so a builder's first real signup as `alice` is
  refused by their own fixture. The ticket asked for `--help` (since done)
  and namespacing.

## Design

### 1. The lifecycle is in the log

Every outbox transition writes one structured line to `.snapback/log.jsonl`:

```json
{"outbox":{"id":"…","seq":812,"effect":"notify","from":"queued","to":"running","attempt":1}}
{"outbox":{"id":"…","seq":812,"effect":"notify","from":"running","to":"then_pending","ms":143}}
{"outbox":{"id":"…","seq":812,"effect":"notify","from":"then_pending","to":"sent","then":"notifications.recordNotified"}}
{"outbox":{"id":"…","seq":813,"effect":"notify","from":"queued","to":"queued","attempt":2,"nextAt":…,"error":"provider 503"}}
{"outbox":{"engine":"none","queued":3}}
```

`logs --effects` filters to these lines; `trace <seq>` is unchanged (it
already shows the rows). `dev` prints one line at boot beside
`SNAPBACK_URL`: `effects: ibex2 + vanilla hermes` or `effects: no engine in
this build — 3 queued (build one: scripts/hermes build -p snapback2)`. The
"unavailable" path (`runner.rs:222-228`) writes the last line above once
per change in the queued count, never per pump.

### 2. Journeys see and settle the outbox

Two dev-only control routes, under the same admission as `/control/clock`:

- `GET /control/outbox[?state=…]` — the rows `trace` already assembles
  (`id, seq, effect, state, attempts, nextAt, lastError, result`), bounded
  (`limit ≤ 200`, `after` cursor).
- `POST /control/effects/settle {budgetMs}` — pump the runner now and
  return when no row is `queued` with `nextAt ≤ now` or `running`, or when
  the budget is spent; the response is `{ settled: bool, rows: [...] }`.
  With no engine it returns at once with `{ settled: false, engine: "none" }`.

The journey context gains `effects.rows()` and `effects.settle()`
(`test.ts`), typed in `types/test.d.ts`:

```ts
journey("a sent message notifies the recipient", async ({ as, effects }) => {
  const alice = as("alice");
  const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "hi" });
  const { settled, rows } = await effects.settle();
  if (!settled) throw new Error("effects did not settle");
  const row = rows.find((r) => r.seq === sent.seq && r.effect === "notify");
  if (row?.state !== "sent") throw new Error(`notify was ${row?.state}: ${row?.lastError}`);
});
```

Backoff is real time; `settle` honors `tick` (the dev clock offset) so a
journey can advance past `nextAt` without sleeping.

### 3. A provider stand-in, declared by the journey

```ts
journey("…", async ({ as, effects }) => {
  const provider = await effects.provider("https://api.example.com", async (request) => {
    return Response.json({ id: "prov-1" });
  });
  …
  provider.requests  // what the effect actually sent: method, path, headers, body
});
```

`effects.provider` starts a loopback HTTP server in the journey process
and asks the owner (`POST /control/effects/bind { origin, to }`) to resolve
that origin to the loopback address for this owner's lifetime; `unbind` on
journey exit; the binding is dev-only and never persisted. The effect's
source, grant check (`E_EFFECT_GRANT` still fires for an origin the grant
does not name), timer permit, and `then` all run unchanged in the real
engine. What is stood in for is the third party, which the loop cannot own
and the brief forbids reaching (`social-messenger.md`: "no external I/O").
This honors LLP 0329.016 §5.7 by its reason: nothing of Snapback is
doubled. The chat template's `notify` journey uses it.

### 4. `test` runs the effects

The `effects` derived check becomes, with an engine present:

1. For every declared effect, the runner is asked for a **probe**: an
   `emit` of that effect with a payload the compiler derives from the
   effect's declared payload type (LLP 1002's derived checks already derive
   arguments for `rules` and `bounds`), bound to a probe provider that
   answers `200 {}` for every origin the effect's grants name.
2. `settle` with the declared budget.
3. Each row must reach `sent` (or `failed` with `retry: false` from a
   refusal the probe expected); a `then` mutation must have run and
   committed; the receipt lists `{ effect, state, ms, then }` per effect.

The verdict is `pass`, `fail` (with the rows), or — without an engine —
`blocked: no engine in this build` with `detail.build = "scripts/hermes
build -p snapback2"` (repo) or the package's engine-bearing binary path
(published). `measure.mjs` continues to accept the blocked receipt on the
engine-less loop (LLP 1002 §7 "blocked is not pass" is unchanged: the loop
record shows it as blocked, never green). The probe writes go to the
fresh `test` store, which is discarded.

### 5. A running effect can be stopped

- **Upstream (expo/ibex):** a deadline API around the three execution
  entrances (`ibex2_hermes_eval`, `drain_microtasks`, `pump`) using Hermes's
  time-limit watcher, so a synchronous loop throws `E_EFFECT_TIMEOUT` at
  the budget. This is the ticket's named prerequisite; the pin in
  `snapback2-effects/Cargo.toml` moves when it lands.
- **Runner:** the deadline is armed before `call_host`, not after; a
  timed-out job is `failed` with `retry: false` (a program that spins will
  spin again) and its runtime is dropped, as today for a timeout that does
  fire.
- **Owner:** `Drop` of the effects thread joins for at most the budget plus
  one second, then detaches and logs `{"outbox":{"engine":"detached","running":[…]}}`;
  the rows stay `running` and become `sent_unknown` on the next boot, which
  is the state LLP 1003 §2 already defines for "restart while running".
  `dev --stop` returns.

### 6. The adjacent traps

- **Staging release at commit.** A mutation that commits (including an
  idempotent early return for a replayed client mutation id) releases every
  staged object its arguments carried that the commit did not attach. The
  ledger's per-principal and per-owner counters fall in the same
  transaction. Journey: seven identical retries of a photo send leave the
  owner at one staged object, not seven. The operator verbs stay.
- **`reset` says what it did.** `reset` prints `reset: 0 rows kept, seed
  re-applied (14 rows, 3 personas)`; `reset --empty` clears without
  re-seeding and prints `seed skipped`. The semantics of LLP 1002 §1 d.4
  are unchanged; the silence is what changes.
- **Seed handles are fixtures.** The chat template's seeded profiles use
  handles that read as fixtures — `alice-dev`, `bob-dev`, `charlie-dev` —
  so a builder's first signup as `alice` is not refused by their own seed.
  Personas stay `dev:alice`; the CLI `--as alice` is unchanged. The guide's
  personas page says in one sentence that seed handles are the template's
  and a real account picks its own.

## What this does not do

- No engine in the default `cargo build`, no engine in the five blocking
  checks, no change to LLP 1003 §5. The engine proof stays on the schedule.
- No general mock layer, no recorded/replayed HTTP, no fixture files of
  provider responses. A provider stand-in is code in the journey that
  answers a real request.
- No retry policy change, no per-effect budgets beyond the declared one, no
  parallel drains.
- No new verb. `settle`, `rows`, `provider` are journey-context calls over
  control routes; `logs --effects` is a filter on an existing verb (LLP
  0329.016 §5.11's table gains a flag, not a row).

## Acceptance

1. `scripts/test.sh` on the engine-less build: unchanged verdicts, and the
   loop record shows `effects: blocked` exactly as before.
2. `scripts/hermes test -p snapback2` (scheduled): the chat template's
   `notify` journey passes with a provider stand-in; `test` on the chat
   template reports `effects: pass` with one probe row per effect; the
   `while(true)` fixture reports `failed` at the budget and `dev --stop`
   returns within budget + 1 s.
3. `logs --effects` on a scaffolded chat app shows every transition for
   one send, in order, with no other lines; `dev` prints the engine line at
   boot.
4. The staging journey (seven retries → one staged object) and the `reset`
   output are asserted in package tests; the template's seed handles and
   the personas sentence are in the guide within budget.

## Implementation (proposed lanes; sizes are the orchestrator's estimate)

| lane | scope | size |
|---|---|---|
| F1 | log lines for every transition; `dev` boot line; `logs --effects` | small |
| F2 | `/control/outbox`, `/control/effects/settle`, journey `effects.rows/settle`, types | medium |
| F3 | provider stand-in: `/control/effects/bind`, loopback server in `test.ts`, the chat `notify` journey | medium |
| F4 | `test` probes per effect; receipt shape; measure.mjs acceptance unchanged | medium |
| F5 | expo/ibex deadline API (upstream) + runner arming + bounded `Drop` | medium, two repositories |
| F6 | staging release at commit; `reset` output and `--empty`; seed handles; guide sentences | small |

F1, F2, F6 need no engine and land first; F3 and F4 are proven by the
scheduled Hermes suite; F5 waits for the upstream pin.

## Open questions (author)

1. Should the provider stand-in be allowed in `dev` (a builder running the
   app by hand against a local stand-in), or only in journeys? Proposed:
   journeys only; a builder in `dev` can point the grant at a local URL in
   the effect source, which is one line and honest.
2. Should `test` probes be opt-out per effect (an effect whose provider
   has no idempotent no-op call)? Proposed: no opt-out; the probe provider
   answers every request, so nothing reaches a real provider.
