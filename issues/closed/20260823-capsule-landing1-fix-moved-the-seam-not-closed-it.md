# Capsule landing 1: the fix moved the seam instead of closing it

Status: Closed
Date: 2026-08-23
Systems: snapback-server, snapback-engine
Related: issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md,
  issues/20260823-origin-bound-commit-capsule-design.md,
  issues/20260823-two-landed-fences-do-not-correlate-the-authority-axes.md

## Verdict: do not land branch `lane/capsule-landing1` (e720ac3c3)

Third attempt at this landing; third time the strong composition survives. It is now clear the
iteration itself is the mistake — see "Recommendation".

## The violating path, verified directly

The fix removed the four-part `CommitCapsuleRuntimeBinding::new` and introduced a new **public**
engine carrier. The same `{state B, graph B, origin B, admission A, authority A}` commit is
reachable through it, and `CommitCapsuleDestination::bind` is never called:

1. `EngineAppStateBindings::into_runtime_parts_for_app_state` is `pub`
   (`crates/snapback-engine/src/local/engine.rs:3490`) and yields
   `EngineCommitCapsuleRuntimeBinding`.
2. `pub struct EngineCommitCapsuleRuntimeBinding` (`engine.rs:3173`) exposes public
   `commit_watch_management` and `accept_watch_management_reconciliation` (`engine.rs:3196`+).
3. `pub fn stage_watch_management(&mut self, authority: &PreparedAuthority, ...)`
   (`engine.rs:25073`) validates only `authority.validate_admission(...)` and
   `authority.source() != InvocationSource::WatchManagement`, then derives the management
   principal from that same authority. **It never compares the authority against the carrier's
   admission controller.**
4. The kernel check then sees origin B with pending/database B — internally consistent — and
   commits (`crates/snapback-kernel/src/storage/watches.rs:360`, `:376`).

Stage under authority A against Local B, commit through carrier B: authority A, database B.

The carrier's own doc comment guards the state/claim axis — "no caller can validate against
Local A while packaging shared state B" — while leaving the authority axis unguarded. That is
the same single-axis blindness the landing was written to remove, reproduced inside the fix for it.

## The new test is not evidence

`origin_bound_watch_rejects_state_b_graph_b_origin_b_admission_a_authority_a` exercises only
`bind` after splicing `AppState.auth_admission`. The violating path never calls `bind`. The
shortest production mutation that keeps the test green while the violation stands is **zero
lines** — the path already exists alongside it. The rewritten compile-fail fixture likewise
attacks the removed external constructor, not the public carrier-operation path.

Confirmed also false: "route code cannot obtain an `ExactCommitRows` witness."
`AppState.snapback` is public, `LocalSnapback::reconcile_watch_management` is public and returns
the witness (`engine.rs:25106`), and the carrier publicly accepts it (`engine.rs:3200`).

## What the fix did achieve

Real narrowings, verified: graph identity `pub`->private; `CommitCapsuleAuthority`
`pub`->`pub(crate)`; pending commits private; production generic recovery handles removed;
`WatchManagementRecoveryOwner` genuinely module-private with a private generic key. The
`auth_admission` field splice is genuinely inert at `bind`. None of that closes the public
carrier seam.

## Reviewer reliability, recorded

Both revisions of this landing were reviewed by codex and grok independently. Both times grok
returned **Land** and codex returned **do not land** with the correct mechanism; both times I
verified codex's finding directly and it held. On revision 2 grok examined the very surface at
fault and cleared it by assuming a carrier holder must be correlated with its authority — the
assumption the code does not enforce. grok's clean verdicts on this code are not load-bearing;
its specific *observations* were useful (its base-visibility diff was accurate and it
independently flagged the witness residual).

## Recommendation: stop iterating on landing 1

Three rounds have each closed one door and opened another, because
`stage_watch_management` accepting an uncorrelated authority **is an instance of the 153-site
class**, not a bug local to this landing. A fourth bespoke round should be expected to fail the
same way: the primitives cannot express the correlation this landing keeps trying to assert.

Fold landing 1 into the mandatory-correlation design now in flight
(`issues/20260823-mandatory-authority-correlation-design.md`, lane
`lane/correlation-design`). Once a guard cannot be obtained without producing the subject
authority, the watch capsule becomes an application of the general mechanism rather than a
bespoke fence — and `stage_watch_management` is forced to produce its correlation at the type
level like every other site.

Preserve on the branch: the private typestate, the kernel seals, the recovery owner, the real
narrowings above, and the `{B,B,B,A,A}` reproduction machinery (a working two-fixture recipe
that reaches a real durable assertion — that took three runs to get right and must not be lost).

## Resolution

Closed 2026-08-28. Verdict was "do not land branch `lane/capsule-landing1` (`e720ac3c3`)". That branch is dead and the commit is not on `origin/main`. The underlying two-axis defect remains tracked by the later correlation/chokepoint tickets, not this rejected landing.
