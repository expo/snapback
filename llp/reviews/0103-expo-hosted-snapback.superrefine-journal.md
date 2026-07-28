# /llp-super-refine — final report / journal: LLP 0103 / 0104 / 0105 cluster

**Loop:** `/llp-super-refine` on the tightly-coupled cluster LLP 0103 (RFC) / 0104 (Spec) / 0105 (Plan) — "Expo-hosted Snapback."
**Topology:** lockstep cluster (reviewed together each round; verbatim cluster reviews in `0103-…gpt-5.md` and `0103-…fable.md`, per-target pointer stubs for 0104/0105).
**Families:** GPT (OpenAI Codex CLI 0.145.0 / GPT-5 `gpt-5.6-sol`, `--sandbox read-only`) and Fable (via isolated subagent). Orchestrator / reviser: Claude (never a review family). Author: Charlie Cheever.
**Date:** 2026-07-28. **Rounds run:** 6 (3 default + 3 author-authorized extension). **Status transition applied:** Draft → Review at loop start. **This loop never sets Accepted.**

## OUTCOME: CONVERGED — dual-READY on revision 6

Both families independently rate revision 6 **SET READY** with no MATERIAL concern. The final verdicts bind to the **revision-6 hashes** below; **no unreviewed revision exists after r6** (no edits were made after the round-6 reviews landed). Remaining items from both families are detail-altitude, Gate-0/implementation-owned, and non-blocking.

## Revision lineage (hashes final verdicts bind to)

| Revision | 0103 | 0104 | 0105 | Instruction |
|---|---|---|---|---|
| r1 (entry, Draft→Review) | `cfe177f4` | `e3788e7d` | `81300b18` | `0ec10b35` |
| r2 (after round-1 revision) | `dd7d7aa5` | `8bc8ec21` | `d29521e6` | `04164b23` |
| r3 (after round-2 revision) | `ad022d13` | `01290602` | `016dac73` | `2714de89` |
| r4 (after round-3 revision) | `12624eb4` | `efef254e` | `fd52455b` | `a1da1700` |
| r5 (after round-4 revision) | `ec05fc83` | `3d3751b6` | `b1d87cc3` | `af973354` |
| **r6 (after round-5 revision — CONVERGED)** | **`0bb0859b`** | **`f1b4a06d`** | **`f0e7c43d`** | `57dfbe28` |

## Verdicts by round

| Round | Rev | GPT (Codex/GPT-5) | Fable |
|---|---|---|---|
| 1 | r1 | SET NOT READY — 7 MATERIAL | SET NOT READY — 4 MATERIAL (all on 0104) |
| 2 (delta) | r2 | SET NOT READY — 5 MATERIAL {IN-DELTA} | **SET READY** (details) |
| 3 (delta) | r3 | SET NOT READY — 5 MATERIAL {IN-DELTA} | **SET READY** (details) |
| 4 (delta) | r4 | SET NOT READY — 4 {IN-DELTA} + 1 {PRE-EXISTING} MATERIAL | **SET READY** (details) |
| 5 (delta) | r5 | SET NOT READY — 4 MATERIAL {IN-DELTA} | **SET READY** (details) |
| **6 (delta)** | r6 | **SET READY** — 0 MATERIAL, 3 detail | **SET READY** — 0 MATERIAL, 4 detail |

Each round the revision resolved that round's MATERIAL concerns (verified), and through r5 the GPT family surfaced a fresh, **narrowing** set of {IN-DELTA} concerns in the newly-written text — the "the loop's own revisions are a defect source" pattern. Scope shrank monotonically: r1 structural bugs (identity/transfer/activation) → r2–r3 correctness refinements → r4 the multi-coordinator transfer gap + a latent meter/ceiling contradiction → r5 transfer state-machine precision → r6 clean. Convergence is **dual-READY on r6**, not a detail-horizon cutoff.

## What the six rounds produced (headline design improvements)

- **Owner-independent durable identity** `(expoAppId, snapbackEnvironmentId)`; `expoAccountId` is time-versioned ownership attribution; transfer rekeys nothing. (r1)
- **Coordinator-issued release-epoch cutover fence**: drain-and-revoke default; compatibility window admissible only for machine-checkable strictly-additive schema changes (replay supplemental, never proof); enforced max socket lifetime; non-alias/preview/custom-domain traffic pinned on the registry. (r2–r4)
- **Bill-grade storage meter**: allocated non-freelist page bytes via named PRAGMAs (`page_count`/`freelist_count`/`page_size`); `databaseSize` cross-check only; missing PRAGMA is a Gate-0 failure; honest upper-bound framing + customer-favorable missing-sample estimator as a Gate-0 experiment. (r2–r5)
- **Meter/ceiling storage basis reconciled**: index/system-table pages in-band; reserved headroom = PITR + compaction/allocation slack + safety margin only. (r4–r5)
- **App-wide two-phase multi-coordinator transfer**: global transfer epoch, durable participant-set snapshot + lifecycle serialization, all-coordinator-ack publication with re-validation, and a durable prepare(freeze)/commit(revoke)/abort(restore) lease state machine; "no partial ownership attribution" invariant. (r4–r5)
- **Account-budget transfer fence**, admission-bound attribution carried through commit, `min(account aggregate, per-env)` storage bound. (r2–r5)
- **LLP 0089 authority mapping**: 0089 = contract authority (create/push/activate incl. rollback), Universe = hosted implementation authority; `environment.create`/`environment.inspect` distinct stable ids; required-0089-amendment flags. (r2–r4)
- **0105 delivery**: write-amp/margin, logical-storage, account-budget-protocol, transfer, and PRAGMA proofs made blocking Phase-0 outputs; minimum private-beta config/secrets slice pulled into Phase 1; Gate-0 action-isolation mechanism criterion. (r1–r5)

## Remaining detail items (non-blocking; Gate-0 / implementation-phase)

Both families rate the set READY *with these open* (altitude rule). Recorded for the implementation phase or an optional pre-Accept touch-up:
- **Post-publication COMMIT recovery** (GPT r6-1): make durable redelivery/reconciliation of `commit` explicit for a coordinator that acks `PREPARED` then dies before commit (fail-closed until it records the committed epoch + gets a new-owner lease); inject in 0105 P0.4, converge in Gate 1.
- **Gate 0 PRAGMA checklist bullet** (GPT r6-2): add an explicit "all three PRAGMAs verified or DO-SQLite billing basis fails the gate" line to the consolidated Gate 0 checklist.
- **Missing-sample credit-detection evidence** (GPT r6-3 / Fable): state in the Gate-0 receipt exactly what evidence establishes an overcharge and how unknowable intervals are conservatively settled.
- **Serialization enforcement point** (Fable r6-1): name Universe (control-plane owner-of-record) as the authority that gates `environment.create/delete/restore` against the active transfer epoch.
- 20:1 WebSocket margin-gate modeling and the customer-favorable fallback quantity remain gate-owned (both intentionally deferred).

## Growth note

The cluster grew 976 → 1680 lines (~+72%) across five revisions. All additions were reviewer-demanded normative content resolving identified defects; none is padding. The author may wish to weigh a future consolidation pass, but it is out of loop scope.

## Resolution — post-convergence touch-up + ACCEPTED

The loop **converged (dual-READY on r6)**. The author (Charlie Cheever) chose to fold the round-6 detail items in before accepting. A **post-convergence touch-up (r7)** applied exactly those reviewer-identified, non-blocking detail items — no new design decisions:
- Post-publication `commit` recovery made explicit (durable redelivery + fail-closed until committed epoch recorded and new-owner lease obtained) in 0103/0104/0105 P0.4/Gate 1.
- Universe (control-plane owner-of-record) named as the serialization enforcement point for `environment.create/delete/restore` against the active transfer epoch, with the admitted-but-coordinator-absent case caught by publication re-validation.
- Explicit Gate 0 checklist bullet: all three SQLite PRAGMAs verified, else the DO-SQLite billing basis fails the gate.
- Missing-sample overcharge evidence and customer-favorable settlement of unknowable intervals spelled out in the estimator receipt (0105 P0.4) and 0104.

The author then set **LLP 0103, 0104, 0105 → Accepted**. The r7 change is confined to the r6 detail items; the dual-READY review binds to r6, and r7 adds only the non-blocking refinements both families requested.

**Accepted-revision hashes (r7):** 0103 `f3adfa91` · 0104 `328d66d9` · 0105 `e7de7567`.

Status: **Accepted** on all three. Committed and pushed to `main` (`ccheever/snapback`).
