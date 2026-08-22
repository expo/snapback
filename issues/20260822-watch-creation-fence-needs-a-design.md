# Watch creation cannot be fenced by the split-phase pattern alone — it needs a design

Status: Open — extracted from lane/migrate9 after six review rounds; the other eight sites landed
Created: 2026-08-22
Related: issues/20260822-permits-pin-logout-on-unbounded-local-wait.md,
issues/20260822-watch-preflight-dns-holds-the-managed-writer.md,
issues/20260822-bounded-commit-capsule-spec.md, LLP 0058

## Why this is separate

Watch creation was one of nine sites migrated to the split-phase authorized-effect reservation.
The other eight reviewed clean. Watch creation took six review rounds, each finding a new defect,
and the last two are not fixable by continuing the approach. It was extracted so the eight could
land; this records everything learned so the next attempt does not rediscover it.

## The sequence, because the shape matters

1. **Original migration** held the authority permit across caller-supplied webhook DNS (blocking
   `ToSocketAddrs`, no timeout) and the initial live-query JS. Logout's drain has no deadline, so
   caller-controlled prework became an indefinite logout hang.
2. **Fix: split into preflight and commit turns**, reserving after prework. That removed the permit
   hang.
3. **But the split created a staleness gap** that did not exist before, because query and commit
   previously shared one Local turn.
4. **Fix: compare captured permission epochs** at the commit turn. Closed it only for runtimes that
   capture an ordinary `Permission` dependency.
5. **But several runtimes capture nothing** — `SnapshotBatchV2`, `SnapshotBatch`,
   `BoundedChildrenQuery` return empty `read_dependencies`; live search captures only an epoch;
   relational queries capture no storage `Query` dependency.
6. **Fix: a coarse establishment witness** — permission-epoch map, canonical data-version stream,
   storage head — compared independently of what the runtime reports.
7. **Which is still incomplete, and now also starves.**

## The two findings that ended the approach

**Clock-dependent results cannot be witnessed (codex, High).** An exposed non-protected Ibex
LiveQuery may call `ctx.runtime.now()` (`crates/snapback-engine/src/runtime/host_glue.rs:1441`,
`:2932`, `:4072`). Preflight records `ready = false` just before a deadline; the deadline passes
during the split with no permission, stream or head change; the stale `false` is persisted; a later
unrelated write reruns the query as `true`, and watch evaluation treats the `false → true` as a
firing edge (`crates/snapback-kernel/src/storage/watches.rs:765`). A query evaluated at the actual
establishment instant would have started `true`, so this is an **invented reaction** — possibly an
invented webhook delivery.

`BoundedChildrenQuery` has the same shape: it mints its query-visible continuation from
`now_millis()` and the resume keyring while reporting no dependencies
(`crates/snapback-engine/src/local/engine.rs:37299`, `:37433`, `:37474`).

**No marker can witness a clock.** Extending the comparison cannot fix this.

**The coarse witness starves under load (grok, load-bearing).** Any disjoint data commit in the
preflight→commit gap moves the head and produces a 409. Under the FIFO writer queue the commit
waiter sits behind those mutations, so under sustained write load watch creation cannot succeed.
There is no server-side retry and no `retryAfter`. A global head is a valid fence; an unbounded
client retry loop against a saturated writer is not.

## The design question

Three shapes, none free:

1. **Re-run the initial query in the final commit turn.** Removes staleness entirely — there is no
   gap left to be stale across. But it puts JS execution back inside the commit turn, which is what
   the split existed to avoid. grok notes it would be a hang only on the *retry* path, which may be
   acceptable.
2. **Refuse queries with mutable non-database inputs as watch anchors.** Correct and cheap to
   check, but a behaviour regression: watches that work today would stop being creatable. Needs a
   ruling on whether that is acceptable, and a migration story.
3. **Bound the whole thing with the deadline-aware capsule** and accept a narrower staleness
   window, documenting what remains. Weakest, but composes with work already specified in
   `issues/20260822-bounded-commit-capsule-spec.md`.

Whichever is chosen must also address starvation: a bounded server-side retry of preflight+commit
on stale only, or re-running the query inside the already-held Local turn.

## Latent trap for whoever takes this

Job lifecycle is query-visible and moves none of the three markers. `JobStatusQuery` is a HostPlan
LiveQuery. Today `create_watch` dies on `schema_table("_snapback_jobs")` before storing, so it is
fail-closed by accident. **Do not admit that reserved table in `validate_captured_read_set` without
adding job `state_version` (or a jobs high-water) to the witness.**

## Also still true after extraction

Preflight holds the managed writer across caller-controlled DNS. That is pre-existing — it did so
before the migration too — and is tracked in
`issues/20260822-watch-preflight-dns-holds-the-managed-writer.md`. It is not reintroduced by
extraction, but any future attempt should fix it in the same pass.
