# LLP 0159 super-refine loop — convergence record

**Document:** `llp/0159-universal-table-storage-layout.research.md`
(Universal-table storage layout — Convex's engine-owned tables vs
Snapback's per-table mapping)
**Loop:** LLP 0005 review loop at super-refine intensity, run 2026-08-03
under the author's explicit **two-round cap**.
**Coordinator:** the authoring Claude (Fable 5) session — per LLP 0005 it
did not count itself as a reviewer; all reviews came from fresh
non-author contexts.
**Families:** Claude (Fable 5) via fresh Claude Code subagent sessions;
OpenAI Codex via `codex exec` (codex-cli 0.146.0, gpt-5.6-sol,
`model_reasoning_effort=xhigh`, read-only sandbox). All rounds mutually
blind (no reviewer read `llp/reviews/` for 0159); every round SHA-pinned
its target (hashes in the per-family artifacts).
**Final version:** v0.3, SHA-256 recorded at loop close in this record's
companion commit; Draft.

## Round ledger

| Round | Target | Fable | Codex | Revision applied |
|---|---|---|---|---|
| 1 | v0.1 | NOT READY (1 MAJOR, 5 MATERIAL, 3 MINOR) | NOT READY (1 BLOCKING, 6 MAJOR, 2 MATERIAL, 1 MINOR) | v0.2 — authorization coupling restated per LLP 0011's actual text; brownfield re-homed to 0007; invented 0046 quote removed; graduation counter-benefit added; Convex names de-backticked; F5 → hypothesis; Confidence statuses fixed; F6 (fork/time-travel benefit) added |
| 2 | v0.2 | **READY** (0 MAJOR; 3 MATERIAL, 3 MINOR residuals) | NOT READY (1 BLOCKING, 4 MAJOR, 4 MATERIAL, 1 MINOR) | v0.3 — §Axes decomposition added (layout vs. executor vs. retention vs. migration protocol, with the SQL-lowered counterfactual); headline narrowed to "do not remake now" with the "ever" claim relabeled author prior; incidents split; matcher claim narrowed (membership → authoritative resnapshot); 0087 restated Draft/gated; MVCC retention cost added; F6 restated against build state; unique-index physical precision; OQ4-as-candidate |

Loop closed at the author's two-round cap with an **asymmetric verdict**
(Fable READY round 2; Codex NOT READY both rounds, round-2 findings
centering on the layout-variable isolation the v0.3 §Axes section now
supplies). The v0.3 repairs adopt Codex's round-2 prescribed
resolutions and Fable's round-2 residuals but are **themselves
unreviewed**. **The author decides the status transition**; the
round-2 Fable review recommends Active as this document's terminal
research status, with graduation to a Decision deferred to the recorded
triggers.

## What the loop changed most

- Round 1 (both families convergently): the authorization-pushdown
  "single deepest coupling" claim did not survive contact with
  LLP 0011's engine-agnostic requirement text; corpus statuses were
  wrong in the Confidence section; the benefit ledger was incomplete
  (graduation shim, fork/time-travel).
- Round 2 (Codex): the analysis conflated the layout with Convex's
  other architecture choices — v0.3's §Axes and the SQL-lowered
  counterfactual are the structural repair, and the headline
  recommendation was narrowed to what the evidence carries.
- Surviving thesis, unchallenged by any reviewer: "the universal layout
  buys always-on indirection; Snapback bought migration-time
  indirection," and the do-not-remake-now recommendation with
  falsifiable reopen triggers.

## Open after the loop (author decisions / follow-ups)

1. OQ4 — pin the Convex physical-table names, scope, and persistence
   abstraction to convex-backend file + commit before any competitive
   reuse.
2. OQ5 — whether application-shaped Postgres DDL is an identity
   requirement, and which LLP owns that claim.
3. OQ6 — whether Active is this document's terminal status.
4. Codex round-2 items deliberately not taken: a full workload/cost
   decision matrix and per-finding confidence lines (recorded here as
   declined-for-now under the two-round cap; revisit if the document is
   ever promoted beyond research posture).
