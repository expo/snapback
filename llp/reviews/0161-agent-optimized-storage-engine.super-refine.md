# LLP 0161 super-refine loop — convergence record

**Document:** `llp/0161-agent-optimized-storage-engine.research.md` (The
agent-optimized storage engine — ideal properties and Snapback's gap)
**Loop:** LLP 0005 review loop at super-refine intensity, run 2026-08-03
under the author's explicit **two-round cap**.
**Coordinator:** the authoring Claude (Fable 5) session — per LLP 0005 it
did not count itself as a reviewer; all reviews came from fresh
non-author contexts.
**Families:** Claude (Fable 5) via fresh Claude Code subagent sessions;
OpenAI Codex via `codex exec` (codex-cli 0.146.0, gpt-5.6-sol,
`model_reasoning_effort=xhigh`, read-only sandbox). All rounds mutually
blind; every round SHA-pinned its target (hashes in the per-family
artifacts).
**Final version:** v0.3; Draft.

## Round ledger

| Round | Target | Fable | Codex | Revision applied |
|---|---|---|---|---|
| 1 | v0.1 | NOT READY (2 MAJOR, 2 MATERIAL, 3 MINOR) | NOT READY (5 MAJOR, 4 MATERIAL) | v0.2 — LLP 0097 added everywhere it belongs (Accepted, landed-unwired substrate); P8 settlement added and merges-for-keeps reconciled via 0097's promotion-by-re-execution; P2 asymptotics; P4 three-way split (checkpoint/per-record/as-of) with the fork-as-as-of claim withdrawn; P6 corrected in both directions; P3 precision; P1 repriced; conclusion narrowed to no-bespoke-on-disk-engine |
| 2 | v0.2 | **READY** (0 MAJOR; 3 MATERIAL, 3 MINOR residuals) | NOT READY (2 MAJOR, 5 MATERIAL, 1 MINOR) | v0.3 — P9 (authority-scoped admission and bounded speculation) added, the property both families independently derived from the concurrency pressure; LLP 0088's verbs quoted exactly (pursues/defers/declines); 0158 posture updated to its v0.12 in-tree state (OQ9 decided, first consumer pinned, F0a green-lit, uncommitted); P2 "resumable" narrowed to type+scan substrate (the shipped §5 proof restarts); P5 target-indexed (local verified; Cloudflare records-without-validating, fan-out without dependency precision); P8's same-lane optional-`clientMutationId` gap; P1 substrate-vs-product honesty; fsync sentence sharpened; superlatives scoped to the surveyed set; push-ledger credited as P6's per-lane precedent; today-column confidence lowered to Medium |

Loop closed at the author's two-round cap with an **asymmetric verdict**
(Fable READY round 2; Codex NOT READY both rounds, round-2 findings
narrowing to cell-precision and the P9 completeness question both
families raised). Notably, the two families' round-2 completeness
findings — Codex's authority-scoped admission and Fable's resource
governance — were two faces of one missing property; v0.3's P9 merges
them. The v0.3 repairs are **themselves unreviewed**. **The author
decides the status transition**; the round-2 Fable review judged a
diff-only spot re-review sufficient before promoting to Active.

## What the loop changed most

- Round 1's defining catch (Fable): LLP 0097 — an Accepted LLP with
  landed substrate sitting directly on P1 — was absent from the
  document entirely. The gap table's whole P1/P6 story changed.
- Round 2's defining contribution (both families): the property set was
  one short — P9 (containment: least-privilege revocable admission +
  per-principal resource bounds) now completes the concurrency
  pressure's derivation.
- A meta-lesson the record should keep: **both rounds found a real
  claimed-fixed or missed-corpus defect** (round 1 the 0097 omission;
  round 2 the still-wrong 0088 verbs and the same-tree 0158 v0.12
  staleness). In a fleet-shared worktree, companion documents move
  *during* the loop — re-read them at every revision, not once at
  drafting.

## Open after the loop (author decisions / follow-ups)

1. OQ7 — P9's boundary (read-side auditing; engine vs. deployment
   layer).
2. OQ6 — whether P5's engine-property claim requires the Cloudflare
   target and non-paved lanes.
3. Codex round-2 suggestions deliberately not fully taken under the
   cap: fully target-indexing every table cell, and a dated comparison
   matrix behind the (now survey-scoped) cross-vendor claims.
4. Sequencing remains dependency-leverage only; LLP 0155/0130 own
   commissioning, and 0158's F0a program is the live adjacent lane.
