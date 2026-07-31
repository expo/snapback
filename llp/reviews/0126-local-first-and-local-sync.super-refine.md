# LLP 0126 super-refine journal

## Authorization

Charlie Cheever directed this document and its loop on 2026-07-30, in
the same message that promoted the Convex-parity series (LLP 0116–0125)
to Active:

> Then let's synthesize another document about how to do local-first
> stuff and local sync really well since I think it might affect this.
> It should also be a document that dives deep on every plausible
> approach more than planning out the specific details of 1 approach.
> Do an /llp-super-refine on that …

The READY bar is the same one that governed the series program:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as
> much as "there are no flaws in this."

Loop mechanics as in `0116-0125-convex-parity-series.super-refine.md`:
dual-family rounds (fresh non-author Fable subagent contexts; Codex via
codex-cli `codex exec`, read-only sandbox), mutually blind, SHA-pinned
targets and instructions, verify-then-fix passes between rounds,
delta-scoped later rounds. The document entered Review at loop start.
The loop cannot advance the target beyond Review; adjudication is the
author's.

## Round 1 — 2026-07-30

Instruction capsule SHA-256 (0126-adapted variant of the series round-1
capsule):
`f4582d729ac4602b7ae5d3fe80e85edfaeeeb639dc7658f63fb3365ce698fc24`

Target SHA-256 (v0.1, post-Review-status content):
`c9bcf8155a3602867c50a41f34f7ce703ec5d59fd3e24192c9f4cbec6d93e60c`

Verdicts and dispositions are appended as reviews are actually received;
no review is recorded by intent.

### Round 1 results

Both families NOT READY. Codex: four BLOCKING (content-hash overstated
as execution equivalence; lease is server-MACed not signed; embedded
lane conflated three hosting shapes; option board missed credible
middle lanes) plus three MATERIAL, one DETAIL. Fable: three MATERIAL
(InstantDB misplaced against the document's own sources; the LLP 0053
gate misattributed to the shrinkage obligation instead of the
retainability invariant; three quotations that do not exist as printed)
plus seven DETAIL — with the ~20 code-path claims and 9 of 10 diary
quotes verified exact. The v0.2 fix pass verified and applied every
concern (none refuted): the five-element execution-identity tuple
replaced hash-as-equivalence, the option board went from cliff to
ladder (new Replicache-class Option C, B1/B2 split, sidecar/in-process
split), and all quotes were restored to their real hedged wording.

## Round 2 — 2026-07-30 (delta)

Target v0.2:
`4814e5b3eb3781c43b3bfe9e2545099e1d7c7e9f6a831873d92ca33b4cc931d5`

**Fable READY** (all ten round-1 concerns verified resolved; one
foldable DETAIL — the option-C sizing phrase). **Codex NOT READY** on
four narrow items (a new schema-era-from-hash claim; residual
recommendation-shaped wording; a false browser→desktop staging
dependency; missing verification dates, with the dated Linear source
supplied by the reviewer). v0.3 applied all five merged items —
including live-fetching the Linear source (Artman, 2023-06-29,
verified; the page is a talk pointer, so architecture details stay
labeled unverified).

## Rounds 3–4 — 2026-07-30 (Codex tail)

Target v0.3:
`0cb8a9a6423fc894537b3ddfa55a9235f525196ab48a7b26fb0fafcc17b77664`

Codex R3: NOT READY on exactly two wording edits (option C's
total-surface comparison; B1's empty conditions, with the reviewer
drafting the public/read-only condition), all else resolved. v0.4
applied both. Codex R4 (mechanical two-hunk check, target
`64df5aebfc63283bb5c701f940bdb1e2c33ba5daa0723bf0e1d9be5a6c946a1d`):
**READY — LLP 0126 CONVERGED dual-family READY** (Fable R2, Codex R4).

## Program conclusion

| Doc | Final version | Fable | Codex | Rounds |
| --- | --- | --- | --- | --- |
| 0126 | v0.4 | READY (R2) | READY (R4) | 4 |

No reviewer finding was refuted by verification in any round; one
upstream defect was noted for separate handling (LLP 0022's internally
truncated Electric quote at its lines 36–37). Per LLP 0005 the loop
proposes Review → Active; adjudication is the author's. The document
now feeds the synthesis the author directed (coherent implementation
direction across LLP 0116–0126).
