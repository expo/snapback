# Pre-push gate battery vs fleet landing cadence: heavyweight landings livelock

**Status:** Closed
**Date:** 2026-08-10
**Systems:** Proof/gates, fleet workflow

## The problem, measured

Code landings touching the Rust core select a pre-push gate battery
taking ~10 minutes (dominated by `auth-invalidation-report`, which
bootstraps its own runtime from scratch). Fleet landing cadence on
main measured 2026-08-10 evening: 11 landings in 90 minutes (~8 min
median gap; docs-only pushes ride the 27 ms fast path). A push must
be an exact fast-forward, so every fleet landing that occurs during
the battery invalidates the attempt: rebase → regenerate → re-gate →
race again. The LLP 0224 Phase-1 landing burned 6+ full cycles this
way (its battery green every time; it lost only the tip race), and
one recovery rebase nearly baked in reverts of concurrent lanes'
work (caught by a file-level delta audit — that audit should be
considered part of the retry recipe). Slowest-lander starvation is
structural: the heavier your change, the more likely you lose.

## Remedies proposed

1. **Content-keyed gate receipts (primary).** LLP 0189's doctrine is
   that verification binds content, not HEAD. Extend
   `scripts/drift-prone-gates.mjs` pre-push: record a green battery
   receipt keyed by (committed content digest, gate registry
   version, selected-gate set). On a retry after a remote-moved
   rejection, if the rebased commits' tree blobs for all
   gate-selected paths are unchanged AND the intervening upstream
   commits touch no path selecting any of the same gates, honor the
   receipt instead of re-running the battery. Disjointness is the
   common case (core-code landings racing docs/LLP churn). This is
   the merge-queue invariant without the queue.
2. **Prepared-runtime reuse in the slow gate.** The worktree already
   holds a qualified binary with a digest-bound readiness receipt
   (LLP 0010 discipline); `auth-invalidation-report` should accept
   it instead of bootstrapping cold, cutting the battery to ~2 min
   and changing the race odds for everyone.
3. **(Scale endgame) a landing serializer** — bors-style queue — if
   fleet density keeps rising. Not proposed now.

Tactical mitigation in use meanwhile: lull-timed attempts (start the
battery only after main has been quiet ≥5 min; observed gaps reach
29 min).

## Resolution — 2026-08-13

Closed by the optimistic-landing author ruling in LLP 0232. Ordinary pushes
still select and report all affected frozen-record gates but defer their
commands to the scheduled two-hour backstop; the default hook path therefore
has negligible latency and cannot lose a landing race to its own gate battery.
`SNAPBACK_DRIFT_GATES_STRICT=1 git push ...` retains the complete synchronous
classifier for explicit use, and adding `SNAPBACK_DRIFT_GATES_FULL=1` runs the
complete registry.

The content-receipt and prepared-runtime work proposed above remains useful for
strict runs, backstop economics, diagnosis, and release qualification, and is
still tracked by LLP 0232 plus the open record-inventory tickets. It is no
longer a prerequisite for ordinary landing, so this livelock ticket itself is
resolved. Quiet-main timing is no longer a mitigation or recommended recipe.
