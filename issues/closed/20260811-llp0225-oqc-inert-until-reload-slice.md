# LLP 0225 slice: implement the pinned OQ-C inert-until-reload state machine

**Opened:** 2026-08-11 · **Status:** Closed (2026-08-15) · **Area:**
generation activation coordinator / storage kernel (LLP 0225 §3.3, OQ-C)

## Claim

This ticket claims the OQ-C boundary. First-claim-wins; other agents push to
`main` around the clock. It closes in the same commit that lands the work, and
discharges finding **2** of
`issues/closed/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`.
Finding **1** (the transcript-catalog split cut) is **not** in this slice and
stays open on that ticket.

## What is pinned

LLP 0225 OQ-C, ruled 2026-08-10 by Charlie Cheever:

> the first artifact load after reopen verifies against the persisted record's
> digests and refuses on mismatch with a named diagnostic; recovery reload is
> distinguished from intentional successor deployment by that digest match;
> rehydration never advances the durable high-water; serving stays fenced until
> a verified reload or committed successor; full-`LocalSnapback`
> reopen/reload/retry tests are the slice's acceptance.

## Today's state

`LocalSnapback::from_database` (`src/local.rs`) initializes
`functions: FunctionManifest::default()` and `functions_loaded: false` and
never consults `FunctionGenerationRecord`. The record accessor
(`src/storage/generation_commit.rs`
`LocalDatabase::function_generation_record`) is `#[allow(dead_code)]`, and the
only reopen proof (`src/storage/tests.rs`
`oq3_raw_dev_crash_cuts_use_durable_function_generation_record`) operates on
`LocalDatabase` directly — never on a reopened `LocalSnapback`.

So the process is *already* inert after reopen, but inertness is an accident of
an empty in-memory manifest rather than a contract: nothing verifies a reload
against the record, nothing distinguishes recovery from deployment, and every
reload advances the durable high-water as if it were a new generation.

## The state machine this slice implements

One instance-level recovery state, established at reopen and resolved by the
first artifact load:

```
from_database():
    match db.function_generation_record()? {
        None    => NoCommittedGeneration   // fresh store; today's behavior exactly
        Some(r) => AwaitingReload(r)       // fenced
    }
```

**Classification at the first artifact load** (in the activation coordinator,
`src/generation_activation.rs`). The candidate's digests are computed with the
same primitives the commit uses — `crate::manifest::canonical_content_identity`
over the `FunctionManifest` and over
`sequence_declarations_from_function_manifest(&manifest)`:

- **Recovery rehydration** — state is `AwaitingReload(r)`, both candidate
  digests equal `r`'s, **and** projection materialization produced no pending
  publication (nothing durable needs to change). Then: **no kernel
  transaction, no `commit_function_generation` call**, so
  `generation_high_water` stays exactly `r.generation_high_water`. Only the
  process-local successor installs — compose, install committed sequence
  declarations, publish ephemeral collections, process generation marker,
  post-install effects.
- **Successor deployment** — anything else: today's path, unchanged. The
  commit advances the high-water.

The "no pending publication" conjunct is what keeps §3.2 intact: if any
projection *would* need republishing, its pin must join a real generation
record in one kernel transaction, so that case is a deployment, never a
rehydration.

**Named refusals.** Two, both new:

- `SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD` — the fence. While the state
  is `AwaitingReload`, a function invocation refuses by name instead of
  failing as an ordinary unknown-function lookup against an empty manifest.
  A committed generation exists; the process just has not reloaded it.
- `SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH` — an explicit recovery
  reload (`rehydrate_committed_generation`) whose artifact digests do not match
  the persisted record. Details name which digest diverged and both values.
  This is the entry point a caller uses to say "resume the committed
  generation"; it never silently degrades into a deployment.

## A property worth noting

*(Superseded 2026-08-15 by the split-cut fold, LLP 0225 revision (u).)* The
split-cut window of finding 1 no longer exists: transcript-catalog activation
now commits inside `commit_function_generation`'s transaction, so no
generation can be durable without its catalog. For a *legacy* database that
still carries a pre-fold split (record durable, catalog missing), explicit
`rehydrate_committed_generation` refuses with
`SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH` — rehydration requires a
matching transcript catalog as a third condition — and repair flows through
the automatic load path's composite successor commit.

## Acceptance (this is what ends the recorded §3 exception)

Full-`LocalSnapback` tests, not kernel-level ones:

1. Reopen with no committed record → `NoCommittedGeneration`; behavior
   identical to today.
2. Commit a generation, drop, reopen → serving refuses with
   `SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD`.
3. Reload the **same** artifacts → serving resumes and
   `function_generation_record().generation_high_water` is **unchanged**.
4. Reload **different** artifacts → serving resumes and the high-water
   advances by exactly one.
5. `rehydrate_committed_generation` with mismatched artifacts → refuses
   `SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH`, the high-water is
   unchanged, and the instance stays fenced.
6. Retry after a refused reload → a subsequent correct reload still succeeds
   (a refusal leaves no wedged state).
7. Rehydrate, then deploy a successor → the high-water advances exactly once.

Plus the existing envelope: `cargo test --lib {storage,server,auth}` failing
**name sets** byte-identical to the merge-base, with `RUST_MIN_STACK=33554432`.

## LLP 0225 amendment

This slice adds the recovery contract to §3.3's recorded set and retires the
OQ-C exception, so it lands with a `Revised` entry and a §4 migration-sequence
entry in `llp/0225-core-modularization.decision.md`.

## Resolution — 2026-08-15 (backlog sweep)

The OQ-C inert-until-reload machine is implemented in
`src/generation_activation.rs` and `LocalSnapback`. Reopen fences serving
until a digest-matching reload (`SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD`);
matching rehydration does not advance `generation_high_water`; mismatched
explicit rehydration refuses `SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH`
and stays fenced. LLP 0225 revision (p) retired the OQ-C exception and records
the slice as executed.
## Resolution addendum — 2026-08-15 (split-cut fold, supersedes the note above)

The recovery slice landed earlier (`884894a58`, LLP 0225 revisions p/o: the
seven full-`LocalSnapback` acceptance tests and the fenced `AwaitingReload`
recovery contract). The residual link to finding 1 is discharged by the
split-cut fold (LLP 0225 revision (u)): transcript-catalog activation now
commits inside `commit_function_generation`'s transaction, so the split
window this slice made observable no longer exists on new writes; legacy
pre-fold splits refuse explicit rehydration
(`SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH`) and converge through
the automatic composite successor path.
