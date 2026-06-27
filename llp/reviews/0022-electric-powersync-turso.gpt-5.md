# Review: LLP 0022 - ElectricSQL, PowerSync, and Turso/libSQL

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-06-27
**Redacted:** No - reviewed local repository files and public primary sources; no separate external reviewer was invoked.
**Method:** Same-session critical review requested as `$llp-review 0022 revise if you can improve it`. Read the full LLP 0022 draft, LLP 0000, LLP 0001's coverage-gap summary, the upstream LLP 0005 review guide, targeted sections of LLP 0007, LLP 0008, LLP 0011, LLP 0014, and spot-checked high-risk current-product claims against primary vendor docs and repositories.

> **Independence note.** LLP 0022's author line names Claude, not Codex/GPT-5, so this is a real GPT-family review artifact for LLP 0005 purposes. This pass also applied revisions, so future readers should treat it as the review that produced the current GPT-5 edits, not as an independent review of the final revised text.

## Overall assessment

LLP 0022 is high-value research. It closes a real gap in LLP 0001 by checking the three peers that most directly pressure Snapback's local SQLite, Postgres graduation, partial sync, scale-to-zero, and openness story. The best parts are the system-by-system distinction between architecture, licensing, and operational model, and the synthesis mapping each lesson back to the owning Snapback LLP.

The main problem in the draft was over-compression of the headline finding. Electric's CRDT reversal is strong evidence against generic semantic merge in the core, and PowerSync's write-boundary design corroborates Snapback's server-authoritative model. Turso, however, now has newer Sync docs covering local writes, last-push-wins conflicts, atomic rollback-and-replay, and page-level partial sync. The original "two of three retreated" and "partial sync is roadmap, not shipped" claims were too broad. I revised the document to make the narrower, more accurate claim: none of the three validates generic CRDT/semantic conflict resolution as the ordinary core abstraction, and Turso's partial sync is database-page/working-set hydration rather than authorization-aware row/subscription sync.

## Strengths

- **Good peer selection.** Electric, PowerSync, and Turso/libSQL are the right primary-source pass after LLP 0001 because each tests a different part of Snapback's hard combination.
- **The Electric pivot is load-bearing evidence.** The document correctly treats Electric's 2024 rewrite as more important than a feature checklist because it records a team with unusually strong CRDT credentials choosing a smaller sync core.
- **PowerSync is used as an implementation benchmark, not just a comparator.** The sync-rules-to-streams evolution, trusted JWT boundary, op-log/checkpoint model, and write queue protocol all translate into concrete pressure on LLP 0008 and LLP 0011.
- **The Turso section captures the strategic divergence.** Turso validates the SQLite/object-storage/database-per-tenant side of the world while deliberately not validating Snapback's SQLite-to-Postgres graduation.
- **The synthesis is actionable.** The cacheable HTTP read path, gatekeeper token pattern, operation-log semantics, simulator/MCP bar, and local-store question are all useful inputs for follow-on LLPs.

## Concerns

- **C1 - The original headline overstated the write/conflict convergence. [High] [Applied]** It said two of three peers built or could have built generic bidirectional writes and deliberately retreated, and that PowerSync and Turso both keep generic write/conflict logic out of core. That was too strong for Turso now that Turso Sync owns local writes and a conflict policy. Resolved by reframing the lesson around automatic semantic conflict resolution: Electric retreated from CRDT merge, PowerSync externalizes writes, and Turso uses last-push-wins plus rollback-and-replay rather than semantic merge.

- **C2 - Turso's newer Sync and partial-sync docs made part of the draft stale. [High] [Applied]** The draft treated Turso partial sync as roadmap-only. Current docs describe Turso Sync, explicit push/pull, last-push-wins conflicts, and partial sync via prefix/query bootstrap and lazy database-page fetches. Resolved by splitting embedded replicas from Turso Sync and distinguishing page/working-set hydration from Snapback-style authorization-aware row/subscription sync.

- **C3 - The synthesis needed to preserve the useful lesson after narrowing the claim. [Medium] [Applied]** If the headline was merely weakened, the document would lose its design force. Resolved by keeping the stronger valid lesson: none of the peers provides generic CRDT/semantic merge as the ordinary row-sync core, so LLP 0008's server-authoritative default remains externally corroborated.

- **C4 - LLP 0001's dependent summary would have contradicted the revised LLP 0022. [Medium] [Applied]** LLP 0001 repeated the older "two of three retreated" language. Resolved with a narrow one-sentence consistency edit in LLP 0001.

## Suggestions

- Keep the "re-verify before hardening into a decision" warning prominent. This field is moving quickly enough that exact GA/beta/version claims should be treated as snapshots.
- When LLP 0008 is revised, import the Turso rollback-and-replay idea as a comparison point for offline UX, but do not confuse it with Snapback's authorization-aware result-set sync.
- If this research becomes the basis for implementation, run a second-family review or a fresh fact-check pass focused only on current vendor docs, especially PowerSync Sync Streams and Turso Sync.

## Open questions

- Does Snapback want any Turso-style lazy page/working-set hydration for desktop or large local stores, separate from row-level authorization-aware sync?
- Should LLP 0008 explicitly distinguish "automatic semantic merge" from simpler last-write/last-push conflict policies so future readers do not treat every bidirectional write path as a CRDT-style trap?
- Should the cacheable HTTP read path become a first-class Cloudflare design candidate in LLP 0014, or remain an option until the local matcher/fan-out numbers are measured?

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0022 in `Draft`. The revised document is stronger and more accurate, but because it is a fact-heavy research snapshot over fast-moving products, it should stay Draft until the author is satisfied with the current-source pass or gets an additional family review.
