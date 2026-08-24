# R2/R3 revalidation after stream R1 landed

Status: Open — R2 landed; R3 still needs the API amendment specified here
Created: 2026-08-23
Related: issues/20260822-stream-attempt-refactor-design.md (the staged design),
issues/20260822-landed-fence-tests-do-not-prove-non-substitutability.md

## Why this ran

The R2 and R3 rows of the staged design were written **before** R1 landed. R1 added HMAC-authenticated
persistence, storage-issued witnesses, and a one-use startup-recovery capability, so the later stages
were re-checked against the code rather than assumed to survive.

## Verdict

- **R2 landed with its stated outcome.** Its later evidence gaps are tracked in
  `issues/20260823-r2-evidence-gaps.md`.
- **R3 remains implementable but its API/type specification now needs amendment.**

The R2 implementation plan below is retained as the pre-landing design
record. Current execution should use it only as historical rationale; R3's
amendment and its acceptance work remain live.

The correct R2 ordering is the load-bearing detail: **authentication must complete entirely before
`BEGIN IMMEDIATE`**, then the authenticated rows enter one transaction, followed by one `FnOnce`
callback and `COMMIT`.

## R3's amendment, and why it matters

Two shapes R1 introduced that the old R3 text did not account for:

1. `HostSettlement<'a>` is **borrowed and module-private**, so it cannot itself be the owned queued
   receipt the design sketched.
2. The authenticated `StreamAttemptPersistenceBatch` is an **untyped storage carrier**. R3 must seal
   it inside a typed flush/acknowledgement carrier or parameterize it — because
   **"merely deleting `dirty_snapshots` while leaving a raw authenticated batch adapter would not
   establish non-substitutability."**

That last sentence is the endemic defect class arriving one stage early: deleting the untyped path
while leaving an equivalent untyped path beside it would look like progress and prove nothing. Worth
fixing in the spec now rather than discovering it in R3's review.

## A correction to my own reporting

My brief described R1 as landing an owner-free `DurableRecoveredStreamAttempt` for startup recovery,
and I had verified that type myself mid-lane. **It no longer exists on main** — a later round removed
it. Startup recovery now commits directly inside storage under a private one-use
`StreamAttemptStartupRecoveryCapability` consumed during `ServingDatabase` adoption, returning plain
terminal snapshots only for transcript repair (`crates/snapback-kernel/src/storage.rs:1614-1680`,
`crates/snapback-kernel/src/storage/settlement.rs:900-940`).

The lesson is narrow and worth keeping: a fact verified at one commit of a six-round lane is not a
fact about the landed result. Re-derive against `main`, not against memory of a review round.

## Constraint carried forward

No part of this plan adds a stream authority fence. The first such fence remains forbidden until
after R4.

## 1. R1’s landed shape and its effect on R2/R3

### Provenance and witnesses

Provenance now correctly examines the actual `FencedPublication` and `ServiceAuthorityPublication` fields retained by `PreparedAuthority`, rather than inferring from mode or resolved authority (`crates/snapback-sync/src/auth/invocation.rs:1185-1203`, `:1548-1559`; `crates/snapback-sync/src/stream_attempt.rs:77-97`).

`StreamRunnerHost::new` is private and only `PreparedAuthority::stream_runner_host` mints it (`crates/snapback-sync/src/stream_attempt.rs:99-104`, `:389-426`). Its borrowed `HostSettlement<'a>` origin is module-private (`:428-438`). Terminal adoption consumes `DurableStreamAttempt<StreamRunnerHost>`, whose fields and constructor are unavailable to callers (`crates/snapback-kernel/src/storage/settlement.rs:3-58`; `crates/snapback-sync/src/stream_attempt.rs:1257-1296`).

Startup recovery is materially different from terminal adoption:

- `ServingDatabase` constructs a private `StreamAttemptStartupRecoveryCapability` and consumes it during adoption, before exposing the serving handle (`crates/snapback-kernel/src/storage.rs:1614-1669`).
- Storage reads raw durable rows, terminalizes orphans, and writes the results itself (`crates/snapback-kernel/src/storage/settlement.rs:906-940`).
- The returned summary can be taken once, but it cannot perform another recovery (`crates/snapback-kernel/src/storage.rs:1674-1680`).

### HMAC and R2

The registry authenticates an immutable vector of serialized rows before storage sees it (`crates/snapback-sync/src/stream_attempt.rs:525-541`). HMAC framing includes the domain, row count, and a big-endian length before every token, client key, and JSON field (`crates/snapback-types/src/stream_attempt.rs:283-317`). Storage then checks both the registered issuer and the tag before calling the current row loop (`crates/snapback-kernel/src/storage/settlement.rs:862-888`).

The correct R2 order is therefore:

```text
materialize rows
→ authenticate exact row vector
→ verify issuer and HMAC
→ BEGIN IMMEDIATE
→ execute every UPSERT
→ before_commit() exactly once
→ COMMIT while returned guard remains live
```

This preserves the write-path-only property. Verification must not move into `decode_stream_attempt`, `stream_attempt_by_client_key`, or startup recovery. Reads currently only decode and cross-check token/client-key identity (`crates/snapback-kernel/src/storage/settlement.rs:78-104`, `:1030-1042`).

Rows do not store either a MAC or issuer—the durable table has only token, client key, JSON, and timestamp (`crates/snapback-kernel/src/storage.rs:7286-7296`). Startup recovery necessarily bypasses the new process’s verifier and uses the private raw storage path (`crates/snapback-kernel/src/storage/settlement.rs:911-936`). R2 must preserve that exception.

The one-use recovery capability is consumed before this batch write and has no callback or authority object to install. Wrapping its `updates` vector in the same low-level transaction makes recovery atomic without widening the capability.

### HMAC, witnesses, and R3

The journal and MAC do not conflict semantically:

- Journal provenance, owners, runner gates, revisions, and deltas remain process-local.
- The selected materialized snapshots remain the durable payload.
- HMAC can continue authenticating the exact selected row sequence; no provenance or journal metadata should be added to `record_json`.

Two R3 details must nevertheless be respecified.

1. **Owned host receipts.** `HostSettlement<'a>` cannot be placed in a queued journal or returned as `PendingAttemptWrite<HostSettlement>`. R3 needs a distinct owned, opaque host receipt—minted only while handling the module-private origin and carrying the exact cloned runner/gate identity. `HostSettlement` itself should remain private.

2. **Seal the authenticated batch with its acknowledgement metadata.** Today `persistence_batch(namespace)` returns separate snapshots plus an untyped `StreamAttemptPersistenceBatch` (`crates/snapback-sync/src/stream_attempt.rs:525-541`). R3 must replace that with one private-field carrier containing:
   - typed lane/provenance;
   - exact owner and runner-gate identity;
   - flush ID and exact revisions;
   - authenticated storage batch.

   There must be no public operation that extracts a raw batch and later accepts independently supplied acknowledgement revisions. That would recreate the substitutable-argument defect described in `issues/20260822-landed-fence-tests-do-not-prove-non-substitutability.md:43-52`.

The R3 phrase “delete every untyped adapter” also needs narrowing: delete every **live registry/server/engine** untyped adapter. Do not delete the storage-internal startup reconciliation path or its test-support raw helper (`crates/snapback-kernel/src/storage/settlement.rs:891-897`, `:900-940`).

## 2. Concrete R2 implementation plan

### Transaction boundary

Refactor `LocalDatabase::upsert_stream_attempts` at `crates/snapback-kernel/src/storage/settlement.rs:106-128` into a private guarded primitive:

```rust
fn upsert_stream_attempts_guarded<G, F>(
    &mut self,
    rows: &[(String, String, String)],
    now_ms: u64,
    before_commit: F,
) -> SnapbackResult<()>
where
    F: FnOnce() -> SnapbackResult<G>,
{
    if rows.is_empty() {
        return Ok(());
    }

    let tx = self
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)?;

    for (token, client_key, record_json) in rows {
        tx.execute(UPSERT_SQL, params![token, client_key, record_json, now_ms as i64])?;
    }

    let _commit_guard = before_commit()?;
    tx.commit()?;
    Ok(())
}
```

Keep the current `upsert_stream_attempts` name as a no-op-forwarding compatibility wrapper. This lets authenticated persistence, startup recovery, and the test-support path all receive the same atomicity without changing higher-level call signatures.

The established kernel pattern is exactly this shape: start `Immediate`, complete fallible staging, obtain a generic guard, then commit with that guard in scope (`crates/snapback-kernel/src/storage/asset_attempts.rs:337-367`; another example is `crates/snapback-kernel/src/storage/settlement.rs:329-488`).

Empty batches should remain no-ops and should not invoke `before_commit`; there is no durable cut to guard. Authentication should still happen before that no-op decision at the public authenticated boundary, so an invalid empty batch does not become an unauthorized “success.”

### Verification placement

Leave issuer and HMAC verification at `SettlementKernel::upsert_stream_attempts`, before it calls the low-level guarded helper (`crates/snapback-kernel/src/storage/settlement.rs:862-888`). Do not recompute the tag inside the transaction and do not authenticate rows separately.

Startup recovery continues to call the raw low-level wrapper at `settlement.rs:936`; it passes only the no-op callback. Its private capability, classification, and one-use result handling remain unchanged.

### Who may install `before_commit`

For R2:

- **No production caller may install a non-noop callback.**
- The nonnoop seam should remain private or `pub(super)` to the storage module and available to direct kernel tests.
- `SettlementKernel::upsert_stream_attempts`, startup recovery, and the raw test-support wrapper all pass `|| Ok(())`.
- Do not import or accept `PreparedAuthority`, `AuthorizedEffectReservation`, `InvocationCommitGate`, an admission guard, or any publication carrier.

R1 explicitly says stream-attempt persistence does not acquire the shared invocation gate (`crates/snapback-sync/src/stream_attempt.rs:332-358`). R2 must preserve that statement.

After R4, the guarded facade may be widened only for the typed R3 flush coordinator. The old mixed-batch callers must never be allowed to supply a guard independently of the exact typed receipt.

### Existing call sites

No production call-site edits are necessary if the compatibility wrapper is retained. These paths all acquire `LocalSnapback` and converge through `LocalSnapback::persist_stream_attempts` (`crates/snapback-engine/src/local/engine.rs:7470-7477`):

- detached-action required flush: `crates/snapback-server/src/server.rs:991-1002`;
- trusted best-effort flush: `server.rs:1010-1041`;
- Ask stream start: `server.rs:25201-25237`;
- Ask terminal persistence before transcript insertion: `server.rs:25241-25273`;
- direct stream cancellation before transcript insertion: `server.rs:28463-28499`.

Ask settlement and cancellation deliberately perform transcript insertion as a later storage call. R2 must not absorb transcripts into the stream-attempt transaction (`server.rs:25267-25270`, `:28482-28497`).

### Legacy partially applied batches

R2 is prospective; it cannot reconstruct absent rows from a pre-R2 crash.

- If the old row loop partially committed and returned an error while the process remains alive, no `clear_flushed` call occurred. The registry still marks every affected token dirty (`crates/snapback-server/src/server.rs:999-1002`, `:1030-1033`; `crates/snapback-sync/src/stream_attempt.rs:740-776`). The next R2 retry upserts the already-written row and missing/current rows together, atomically healing the batch to the registry’s current snapshots.
- If the process crashed before retry, startup sees only the committed subset. It terminalizes any surviving nonterminal rows but cannot recreate missing attempts; no durable journal exists from which to do so (`crates/snapback-kernel/src/storage/settlement.rs:911-940`). Existing terminal winners remain unchanged.
- Do not add a schema migration or synthetic repair scan. The staged design explicitly keeps provenance and pending deltas process-local (`issues/20260822-stream-attempt-refactor-design.md:37-40`).

### Mechanical versus judgment work

Mechanical:

- introduce the guarded low-level helper;
- replace per-row autocommits with one `Immediate` transaction;
- forward all existing low-level paths with a no-op callback;
- preserve row order, SQL, timestamp, and error propagation;
- add targeted tests.

Judgment:

- keep the guarded seam non-public in R2;
- define empty-batch behavior as no transaction/no callback;
- keep authentication before transaction acquisition;
- preserve startup recovery as the one raw storage exception;
- ensure no operation occurs after `before_commit` except `tx.commit()`;
- refuse any proposal to attach a stream authority fence before R4 is complete.

Because changing Rust line locations alters the diagnostics-site inventory, implementation must regenerate diagnostics and then the guide manifest before `node scripts/check-inventories.mjs`. The generator outputs are declared at `scripts/generate-diagnostics-registry.mjs:20-28`, and the chained guide generation is at `scripts/generate-guide-manifest.mjs:24-55`.

## 3. R2 concurrency and watchdog risks

### Primary writer and SQLite contention

Normal serving writes are serialized by the single `SharedSnapback = Arc<Mutex<LocalSnapback>>` (`crates/snapback-server/src/server.rs:177-185`). The writer gate asynchronously queues for that mutex and executes only the owned critical section on a blocking thread (`crates/snapback-server/src/server/writer_gate.rs:65-98`).

Therefore, `BEGIN IMMEDIATE` does not introduce competition between ordinary serving writes on the primary connection: only one holds `&mut LocalSnapback`.

It can contend with independent registered system-writer connections, which open the same SQLite file with a five-second busy timeout (`crates/snapback-kernel/src/storage/connections.rs:377-415`). The primary connection also has a five-second busy timeout and uses WAL for file-backed databases (`crates/snapback-kernel/src/storage.rs:7261-7274`).

Compared with the current loop:

- current code acquires and releases SQLite write ownership once per row;
- R2 acquires it once and retains it through the whole batch;
- external writers can no longer interleave between rows;
- the maximum individual lock hold grows to the whole accumulated batch.

There is no explicit bound on the dirty set: it is a namespace-wide `BTreeSet`, and `persistence_batch` scans all of it (`crates/snapback-sync/src/stream_attempt.rs:225-238`, `:525-541`). A long series of failed best-effort flushes can therefore produce a large transaction. R2 must not split it—that would defeat all-or-nothing—but this is a real latency risk until R3 selective flushes land.

WAL readers remain independent and do not queue behind the writer (`crates/snapback-kernel/src/storage.rs:1548-1551`; `crates/snapback-kernel/src/storage/connections.rs:499-604`).

### Deadlock

With a no-op callback, R2 adds no lock cycle:

- provider settlement drops `InvocationCommitGate` before requesting the required durable flush (`crates/snapback-server/src/server.rs:835-844`);
- watchdog abandonment takes the commit gate and cancellation state, not Local or SQLite (`server.rs:2617-2642`);
- stream persistence continues to acquire neither the commit gate nor an authority fence (`crates/snapback-sync/src/stream_attempt.rs:332-358`).

The main hazard would be widening `before_commit` prematurely. A callback that waits for Local, a stream/session mutex, another SQLite writer, or the watchdog would introduce a new edge while an `Immediate` transaction is live. Keeping the seam private/no-op eliminates that risk in R2.

### Starvation and the watchdog

The terminalizer itself cannot starve R2: it does not wait for or hold Local. Its **trusted durable flush** is different—it polls `try_lock_owned` for only 250 ms and then gives up (`crates/snapback-server/src/server.rs:1010-1041`). It is explicitly best-effort and is not a FIFO waiter.

Consequences:

- A normal queued R2 write uses the FIFO managed writer and is not displaced by the watchdog flush.
- A long R2 transaction, or an R2 `BEGIN IMMEDIATE` blocked behind an independent SQLite writer for up to five seconds, can cause the trusted flush to miss its 250 ms window.
- That leaves the terminal dirty for a later flush or startup recovery. This is existing behavior, not a new R2 correctness regression; it is also why R4 owns crash-durable watchdog settlement.
- R2 likely improves normal cases by replacing several commits with one, but accumulated dirty batches can make the worst case longer.

## 4. Tests and false-green audit

### T1 — authenticated batch is atomic at every failure position

Use a legitimate authenticated three-row batch. On a fresh database for each row, install a `BEFORE INSERT` trigger that aborts on that token. Assert the call fails and all three rows retain their exact preimage.

**Mandatory watched failure:** first add the row-2 case and run it against current main before changing production. It must fail because row 1 remains durable under the present autocommit loop (`crates/snapback-kernel/src/storage/settlement.rs:114-127`). Record that red result.

False-green mutation against a naïve single-target test: reverse the production iteration order so the chosen failing row executes first. Improve the final test by failing each of the three tokens in separate fresh databases. Under any total execution order, at least the middle and last failures expose partial durability. No non-test-aware atomicity violation was found that leaves the strengthened matrix green.

### T2 — `IMMEDIATE` is acquired before the first row is prepared

Use a file-backed database and a second connection with zero busy timeout. Install an authorizer observation on the primary connection that fires when the first stream-table `INSERT` is prepared. From that observation, attempt `BEGIN IMMEDIATE` on the second connection and immediately roll it back if it succeeds.

Required result: the second connection reports busy/locked because the primary transaction already owns the writer reservation.

False-green mutation against T1 alone: change `TransactionBehavior::Immediate` to `Deferred`; all rollback/atomicity tests remain green. The authorizer probe makes that mutation red because the secondary writer can acquire before the first primary write.

Uncertainty: if rusqlite disallows the second-connection probe from an authorizer callback on this platform, use a `#[cfg(test)]` observation immediately after transaction creation. Do not replace this with a source-text assertion.

### T3 — callback failure occurs after staging and rolls back everything

Install a trigger calling a test scalar function that increments an out-of-transaction atomic counter for every staged row. The callback must observe the full row count, increment its own invocation count once, and return a sentinel error. Assert the exact error, callback count one, and unchanged durable table.

False-green mutation against a rollback-only test: invoke `before_commit` before the row loop; its error still leaves the table empty. The staged-row counter closes that hole. Removing the transaction makes rows remain despite the callback error and also fails.

### T4 — returned guard remains live through the actual COMMIT

The callback returns a `Drop` guard backed by an atomic `guard_live` flag. Install a SQLite commit hook that records whether that flag is true at the real commit. Assert:

- callback invoked once;
- commit hook invoked once and observed the guard live;
- guard dropped after the method returns;
- rows are durable.

False-green mutation against a callback-count-only test: explicitly drop `_commit_guard` before `tx.commit()`. The commit-hook oracle makes that mutation red. Skipping the callback or moving it after commit also fails.

### T5 — whole-batch authentication precedes every row write

Extend the current single-row tamper test (`crates/snapback-sync/src/stream_attempt.rs:1927-2081`) with a multirow authenticated batch. Replace only the final row without recomputing the tag. Assert the exact unauthorized diagnostic and zero durable rows, then submit the original batch and assert all rows commit.

False-green mutation against the current single-row case: verify and write rows incrementally; a preceding valid row can commit before the tampered row is rejected. The multirow last-row tamper closes that gap. Keep the existing unsigned, wrong-issuer, record-JSON, fabricated-row, and foreign-registry cases; each covers a distinct bypass.

### T6 — startup recovery’s raw batch is also atomic and one-use

Seed three nonterminal rows directly, then repeat T1’s trigger-at-each-position matrix around `ServingDatabase::adopt`. After each failed adoption, inspect through a fresh raw connection and require all three rows to remain byte-identical and nonterminal. Remove the trigger, adopt successfully, require `recovered_count() == 3`, and require the startup result to be takeable only once.

False-green mutation against a success-only recovery test: make only authenticated writes transactional while leaving `reconcile_orphaned_stream_attempts` on the autocommit wrapper. A later successful retry hides the first partial recovery. Inspecting the database immediately after failed adoption closes that hole.

### T7 — a fresh verifier can read and recover rows from a prior issuer

Process-life A writes one terminal and one nonterminal row to a file using persistence key A. Drop it, reopen with independently generated key B, and assert the two issuers differ. Adoption under B must recover the orphan and both rows must remain readable.

False-green mutation against the existing reopen test at `crates/snapback-server/src/server/tests.rs:27463-27525`: reuse the process-global registry and therefore the same MAC key. The distinct-issuer assertion closes that hole and directly proves verification remains write-only.

### Required mutation checks

Before R2 acceptance, explicitly run these mutants and require the named test to fail:

- remove the containing transaction: T1 and T6;
- change `Immediate` to `Deferred`: T2;
- invoke `before_commit` before the row loop: T3;
- drop the returned guard before commit: T4;
- authenticate/write per row instead of authenticating the complete batch: T5;
- verify durable rows using the new process key: T7.

## 5. Sequencing against detached-action nested-mutation fencing

R2 can land independently.

The detached-action design changes action authority reservation, action-gate ordering, bounded Local acquisition, and application-mutation commits. Its inventory names `server.rs`, `writer_gate.rs`, `commit_capsule.rs`, `engine.rs`, `invocation.rs`, session/service fence modules, and `storage.rs` (`issues/20260823-detached-action-nested-mutation-fence-design.md:297-317`). It does not name `storage/settlement.rs`.

Under the plan above, R2 source changes are limited to:

- `crates/snapback-kernel/src/storage/settlement.rs`;
- `crates/snapback-kernel/src/storage/tests.rs`.

Thus there is **no necessary Rust source-file overlap**. In particular, preserving the existing `LocalSnapback::persist_stream_attempts` signature avoids touching the detached-action work’s `engine.rs` and `server.rs`.

Both landings will probably regenerate the same derived files because both move Rust diagnostic sites:

- `guide/reference/diagnostics-registry.json`;
- `guide/reference/diagnostics.md`;
- `guide/guide-manifest.generated.json`;
- `guide/guide-flat.generated.md`;
- `guide/guide-flat.reference.generated.md`.

Those are mechanical rebase/regeneration conflicts, not semantic dependencies.

R2 must not reuse the detached-action `AuthorizedEffectReservation`, action `commit_gate`, or planned final-guard choreography. That would add a stream fence before R4 and create unnecessary coupling.
