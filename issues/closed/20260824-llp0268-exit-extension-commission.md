# Commission the LLP 0268 exit extension — the broadcast prover

**Opened:** 2026-08-24 · **Ruling:** author (Charlie Cheever, 2026-08-24
session): commission now, in parallel with G2 · **Owner seam:** LLP 0209
§3.3 (the nine 0268 §7 carriers) + LLP 0268 §0 (the re-record rule) ·
**Prerequisite:** the G0 exit (LLP 0209 v0.6/v0.7)

## Charter

The G0 exit satisfied only `G0-BCAST-IDENTITY` of LLP 0268 §7's nine
inputs. This lane builds the **broadcast prover** so the exit can be
extended and re-recorded, unblocking 0268 B1: host-recomputed
certificates for a class-1 base with establishment-only membership —
never authored claims (B1's counterfeit refusals stay).

## Deliverables

1. **Compiler proofs (codegen)**: separation (data-flow proof that the
   establishment predicate reaches only allow/deny), scope identity +
   resource-equality binding, strict-audience evaluator identity, and
   the complete admission-input → authority-event invalidation map —
   emitted per LLP 0209 §3.3's `GraphBroadcastAdmissionV1` on a
   class-1-base graph.
2. **Host acceptance (B1 extension)**: `validate_graph_query_plan_v1`
   accepts an authored `classification:"broadcast"` exactly when its
   host recomputation reproduces every §3.3 proof; all counterfeit
   refusal rows (23–27) keep their tests.
3. **Corpus**: a class-1 broadcast-shaped fixture graph (the Zerobugs
   corpus has none — its graphs are class-2/3; a new corpus-local
   fixture is expected); `audienceParity` and `scopeMismatch` move from
   the G2-pending sidecar to executable; exact-audience paired cases per
   §3.4.
4. **Exit re-record**: LLP 0209 v0.8 dated note re-recording the exit
   with all nine §7 labels dispositioned; per 0268 §0 that is what
   unblocks 0268 B1. The `G0-BCAST-BOUNDS` observations ride G2's
   measurement work — coordinate, do not duplicate.

## Lane plan

sbs-orchestrate roster; single lane (prover + acceptance + corpus land
together, review-gated), coordinating with G2's worktree on shared files
(`graph.rs`, `graph-query.mjs`, the corpus runner) — G2 lands first on
conflicts; this lane rebases.

## Status

- 2026-08-24 — commissioned; packet landed.
- 2026-08-24 — **LANDED** `a11054ca4` (ported onto the landed G2-A evaluator after a real-conflict rebase was redone as a port; fidelity-reviewed READY; records `llp/reviews/0268-exit-extension.*`). Exit re-recorded in LLP 0209 v0.8: six labels SATISFIED, three PARTIAL pending G2-C — 0268 B1 stays gated on exactly those. This ticket stays open until the G2-C re-record completes it.

- 2026-08-25 — **COMPLETE to its input-carrier boundary** (LLP 0209 v0.9):
  eight §7 labels SATISFIED; `G0-BCAST-BOUNDS` PARTIAL solely on
  `issues/20260824-g0-bcast-bounds-large-hot-observations.md`, which now
  carries the 0268 B1 gate. Moving to `issues/closed/`.
