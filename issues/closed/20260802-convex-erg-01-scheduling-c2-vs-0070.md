# G-01: Scheduling — verify C2's landed jobs seam against LLP 0070's runAfter, then close the remainder

**Status:** Closed
**Program:** 20260802-convex-erg-00-program.md
**Systems:** Scheduling, Runtime, Storage
**Related:** LLP 0070 (owns `runAfter` per the LLP 0115 coverage audit v0.2),
LLP 0121 (scheduling research), LLP 0115 CV-9; Wave-1 lane C2 landings
(e25ab2a3, 804782a1 — jobs/enqueue seam)

## Task

Convex's `scheduler.runAfter` is its most-cited scheduling win. Snapback's
transactional one-off jobs are designed in LLP 0070/0121 but the 2026-08-02
synthesis calls them unbuilt — while Wave-1 lane C2 landed a jobs enqueue seam
the same week. These claims can't both be fully right.

**Step 1 — verify (do not skip):** read the C2 landing commits and the current
jobs surface (`src/jobs.rs`, cron machinery, the enqueue seam LLP 0131's
acceptance 14 rode). Establish precisely which of LLP 0070's contract is
shipped: transactional enqueue (job enqueued iff the mutation commits)?
delayed/one-off execution (`runAfter`-shaped)? attempt ledger/receipts?
authoring surface (`ctx.jobs`/`ctx.scheduler` spelling)? capability fact?

**Step 2 — record:** write the delta into this ticket as a dated note. If the
gap is only the authoring sugar, say so — the fix may be small.

**Step 3 — implement the remainder** under LLP 0070's design: the paved
outcome is an author scheduling a one-off function invocation from inside a
mutation, transactionally (enqueue commits with the mutation, never fires on
rollback), with a durable attempt ledger and stable diagnostics, on local +
served surfaces. Coordinate wire/receipt additions with the owners LLP 0070
names; do not invent a parallel job vocabulary if C2's seam already defines
one.

## Running log

- **2026-08-02 — verified existing C2 surface.** Re-read the Wave-1 landings
  `e25ab2a3` and `804782a1` against current `src/jobs.rs`, `src/runtime.rs`,
  `src/local.rs`, `src/server.rs`, the generated authoring tests, and LLP
  0070's normative §First slice as shipped. The surface is not an enqueue-only
  stub: `ctx.jobs.enqueue(action, args, options)` stages an admitted action in
  the mutation and inserts it in the same SQLite transaction as ordinary
  writes; rollback leaves neither job nor receipt association; `delayMs`
  derives `availableAt` from the frozen invocation clock; the worker and
  injected-clock drain execute one-off actions; claims carry attempt/fence
  facts; terminal publication is fenced; the append-only attempt ledger,
  declared job-status query, synchronous drain receipts, and experimental
  `jobs_one_off_v1` fact all ship. This is the honest action-callee
  `runAfter` class LLP 0070 owns. A `ctx.scheduler` alias would introduce a
  second spelling without adding behavior and is deliberately not added.
- **2026-08-02 — isolated remainder.** Existing acceptance proves
  transactional enqueue/rollback and delayed forced execution, while the
  jobs unit corpus proved successor fencing only in memory through one open
  connection. The unproved sentence in this ticket's exit was process-loss
  observability: whether an unfinished attempt survives a real close/reopen
  and is durably classified before its successor claim. The implementation's
  existing storage state machine already has that behavior, so production
  code is not warranted unless the new witness fails.
- **2026-08-02 — crash/reopen witness added.** The file-backed jobs fixture
  enqueues with `maxAttempts: 2`, claims attempt 1, closes the sole SQLite
  connection without finishing, reopens the database, proves the persisted
  lease still excludes an early claim, and reclaims exactly at expiry as
  attempt 2 with a strictly greater fence. It asserts attempt 1's terminal
  `lease_expired` outcome and `SNAPBACK_JOB_LEASE_EXPIRED` code, rejects the
  stale first publication, finishes attempt 2, and pins the two-row ledger,
  fence ordering, state-version progression, and final terminal projection.
  No production file changed.
- **2026-08-02 — proof.** `scripts/bootstrap-ibex-runtime` passed the exact
  link, launch, and restricted no-eval handler-VM qualification with
  `SNAPBACK_IBEX_RUNTIME_LINK_OK`. The exact new Rust test passed 1/1; the
  complete `jobs::tests` module passed 7/7; and the complete
  `packages/snapback-codegen` suite passed, including
  `jobs-authoring.test.mjs`. The first clean-worktree attempts exposed only
  ignored generated-fixture prerequisites: Rust initially reported four
  failures — missing
  `demos/competitive-checkpoint/snapback/generated/schema.manifest.json`
  plus the three inherited live-matcher failures below — and codegen passed
  through `jobs-authoring.test.mjs` before stopping on the missing ignored
  all-aboard functions manifest. After restoring the exact ignored generated
  manifests from the primary checkout (verified absent from tracked status),
  codegen passed end to end and `cargo test --lib` reached 1,641 passed, one
  ignored benchmark, and exactly the three pre-existing `src/local.rs`
  failures already recorded by closed settlement tickets 0133-02/03/04:
  `rqs_mutation_after_answer_and_register_loses_no_ops`,
  `rqs_tokens_refresh_across_delta_replace_and_current_as_of`, and
  `standard_pattern_live_is_conservative_and_recorded`. Each is outside the
  jobs code and this ticket does not change `src/local.rs` or the matcher.
  `rustfmt --check --edition 2024 src/jobs.rs`, `git diff --check`, and
  `./ref-check --verbose` passed (157 LLPs, 2,884 refs, zero errors or
  unchecked). `node scripts/check-guide.mjs` ran because the jobs guide was
  an orientation authority, but inherited missing generated snippet sources
  in `trusted-runtime-values.md` and `contract-adapter.md` plus a stale
  generated guide manifest kept it red; no guide or capability row changes in
  this ticket make a broader claim.

## Exit

- The dated verification note (step 2) — required even if step 3 turns out
  tiny.
- An acceptance test: mutation enqueues `runAfter`-style job; rollback
  enqueues nothing; the job fires once after its delay with a ledgered
  attempt; a crashed attempt is observable, not silent.
- Capability fact/guide row updated only if the whole contract ships (GAP row
  otherwise).

## Resolution — 2026-08-02

Resolved by implementation commit
`2cb96f4fecc739f5d996206ac8936aaa2536c83a`
(`test(jobs): prove crash recovery across reopen`). The landing verifies that
Wave-1 C2 already shipped LLP 0070's honest action-callee `runAfter` class and
adds only its missing file-backed crash/reopen evidence. No production code,
`ctx.scheduler` alias, guide claim, or broader capability tuple was added.

Proof on the rebased implementation commit:

- `scripts/bootstrap-ibex-runtime` — pass, including exact link/launch and
  restricted no-eval handler-VM qualification;
- exact crash/reopen witness — 1/1 pass;
- `cargo test --lib jobs::tests` — 7/7 pass;
- complete `packages/snapback-codegen` test suite — pass, including
  `jobs-authoring.test.mjs`;
- `cargo test --lib` — 1,641 pass, 1 ignored, with only the three inherited
  `src/local.rs` live-matcher failures named in the running log;
- `rustfmt --check --edition 2024 src/jobs.rs` and `git diff --check` — pass;
- `./ref-check --verbose` — 157 LLP documents, 2,884 refs, zero errors and
  zero unchecked; and
- `node scripts/check-guide.mjs` — ran with only the inherited missing
  generated snippet sources/stale guide manifest recorded above; no guide file
  changed.
