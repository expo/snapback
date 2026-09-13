# LLP 0271: Decision — D-4 promotion stays exact-pin; range relaxation shelved

**Type:** Decision
**Status:** Accepted
**Systems:** Capability maturity, Capability publication, Claim snapshots,
Code generation, Testing, CI
**Author:** Claude Fable 5 (orchestrated)
**Date:** 2026-08-16
**Revised:** 2026-08-16 (converted from a range-relaxation Spec to a shelving
Decision after two dual-family super-refine rounds concluded the sound form is
disproportionately hard for near-zero value; renumbered 0269 → 0271
same-day — 0269 was already claimed by llp/0269-storage-graduation.plan.md,
which landed first)
**Related:** LLP 0134, LLP 0189, LLP 0130,
`issues/20260816-llp0134-d4-range-relaxation-needs-sound-derivation.md`,
`issues/shelved/20260816-capability-maturity-a5-merge-bypass.md`

## Summary — the decision

LLP 0134 §4 requires a maturity promotion to land on the exact commit its
candidate evidence was witnessed at:
`candidateSourceSha == candidateParentSha == the promotion commit's actual sole
parent`, enforced by `MATURITY_CANDIDATE_PIN_MISMATCH`. When `main` advances
after qualification, the candidate must be re-declared and its evidence
re-emitted at the new parent.

**Exact-pin is retained as the sound, sufficient promotion rule.** A commit-range
relaxation — letting a promotion advance across a `candidateSourceSha..candidateParentSha`
range when the claim's D-4 surface provably did not change — was designed in
full (the prior Spec revisions of this document) and **shelved**. Its only sound
form requires three preconditions this repository cannot cleanly meet, and even
if they were met the feature would qualify a range so rarely on a fast-moving
`main` that it buys almost nothing over exact-pin's already-sound
requalification. Two independent review families (grok-4.6 and codex
gpt-5.6-sol), across two dual-family super-refine rounds, converged on that
conclusion.

This Decision affirms LLP 0134 §4's exact-pin rule and declines the relaxation.
It discharges the deferral recorded in LLP 0134's 2026-08-16 revision line and
in `issues/20260816-llp0134-d4-range-relaxation-needs-sound-derivation.md`: the
answer is that the exact-pin rule stands.

## Context — what was explored

The relaxation went through five prior review defeats before this shelving. Each
defeat had the same shape: the property that decided whether a range was clean
was ultimately **read from a self-declaration** — a receipt field, an earlier
receipt, an author-written descriptor row, or the promotion commit's own mutable
derivation code. The final Spec revision tried to remove every such lever by
deriving a conservative surface `Σ` from code and git (the whole of `crates/snapback/src/`, the
codegen package, all capability manifests, and the conformance roots), executing
the derivation from the trusted base revision, and requiring the candidate
evidence to cover `Σ`. Two more reviews (round 2) found that even that revision
was not sound in this repository. Their citations are recorded below; the full
design and its fixture matrix are preserved in this file's git history for anyone
who revisits.

## Why range relaxation is shelved

### 1. Three soundness preconditions, none cleanly achievable here

A sound range relaxation must establish all three of the following. In this
repository each is either unattainable or disproportionately expensive.

**(a) A complete input closure of the capability's D-4 surface.** The clean-range
check is only sound if the compared surface `Σ` is a true superset of every
input whose change could alter the claim's semantics. In this repository it is
not. `scripts/runtime-build-inputs.txt` enumerates real runtime/build inputs
that sit **outside** any tractable curated surface: `build.rs`, `Cargo.toml` /
`Cargo.lock`, `rust-toolchain.toml`, `vendor/ibex`, `guide/`, `brand/`,
`packages/snapback-harness/`, `packages/snapback-admin-client/`,
`tests/conformance/`, plus the `crates/snapback/src/*.rs` `include_str!` embeds of those trees.
Concretely: `crates/snapback/src/runtime.rs` embeds files from `packages/snapback-harness/`,
`crates/snapback/src/admin.rs` embeds `packages/snapback-admin-client/index.mjs`, `crates/snapback/src/manifest.rs`
embeds conformance receipts outside `tests/acceptance/`, and `build.rs` consumes
the guide, schemas, packages, tests, vendored Ibex, environment, and git
metadata. A promotion could change `packages/snapback-harness/allowlist.json`,
`Cargo.lock`, `vendor/ibex`, or a `tests/conformance/` input across the range,
leave the proposed `Σ` roots untouched, and pass a green clean-range check while
the implementation or checker semantics changed. A conservative
over-approximation that closed this seam is therefore either incomplete (unsound)
or the whole repository (useless). The optional additive registry proposed to
patch the gap reintroduces the standing-under-breadth (cycle 5a) defeat: an
authored, optional descriptor cannot carry safety authority, because an omission
landed at or before the candidate commit is never inside any later checked range
(REVIEW-R2-CODEX §MATERIAL 1; REVIEW-R2-GROK §MATERIAL 1 — "Σ is a chosen floor,
not a conservative over-approximation").

**(b) A trusted-execution root.** The code that decides whether to run the range
check, and whether to run its own drift test, executes from the candidate
checkout (`H`/`HEAD`) — it can tamper with the check. Deriving `Σ` from the base
revision `P`'s bytes narrows this but does not close it: the top-level entrypoint
(`scripts/check-capability-maturity.mjs`) still runs from the candidate revision
and is not even in the derivation closure, and CI executes the actual pushed
`HEAD`, which the design's drift test (pinned `P..H`, not `P..HEAD`) does not
examine — the round-1 push-`HEAD`-after-`H` attack survives. Closing this needs a
hermetic base-revision runner plus a protected-CI wrapper that verifies candidate
code before loading it and compares the protected closure through the actually
executing revision — machinery not otherwise justified in this repository
(REVIEW-R2-CODEX §MATERIAL 2; REVIEW-R2-GROK §MATERIAL 2).

**(c) Evidence witnessing, not merely naming.** The proposed floor
`resolved(claimScope) ⊇ Σ` proves the receipt *named* a path set covering `Σ`;
it does not prove the candidate evidence *exercised* that surface.
`validateOwnCorpusEvidence` binds ids, profile, `status: green`, and a
`claimScope` digest — not which paths ran; E2 is selected by capability id, not
by walking `claimScope.roots`. A receipt can inflate its roots to cover `Σ` while
its corpus record is behaviorally vacuous, and the coverage check still passes.
Binding witnessed coverage (a producer-bound manifest of the exact tree entries
the evidence consumed, plus a non-vacuous command/result contract) is a further
contract that was never built (REVIEW-R2-CODEX §MATERIAL 4; REVIEW-R2-GROK §3 —
"Coverage ≠ witnessing").

### 2. Low value even in the sound form

Even the conservative-surface sound form admits a range only when **no entry** of
`Σ` changed across the range — i.e. when the range touched none of `crates/snapback/src/`, the
codegen package, the capability manifests, the conformance roots, or (to be
sound) the build inputs of (a). On a repository whose `main` moves continuously
for days, that window is nearly never open. The feature would therefore deliver
almost no requalification-cost saving over exact-pin, which is already sound and
already cheap enough. As REVIEW-R2-GROK put it: "If that makes the clean range
empty, do not relax the pin. That is an acceptable, sound conclusion."

### 3. Independent review convergence

Both review families reached these conclusions independently, across two rounds.
Both round-2 reviews returned **VERDICT: NOT READY** and identified the same two
irreducible obstacles — an incomplete `Σ` (precondition a) and an unclosed
execution root (precondition b) — plus the naming-vs-witnessing gap (precondition
c). Neither family found a proportionate way to close them for this repository.
The design was refined until two mutually-blind families agreed it was not worth
carrying to implementation.

## What is retained and decided

- **Exact-pin stays, unchanged and sound.** Every promotion lands on the exact
  commit its candidate evidence was witnessed at. LLP 0134 §4's
  `MATURITY_CANDIDATE_PIN_MISMATCH` rule is affirmed as the promotion rule, and
  demotion/introduction keep their `candidateSourceSha == candidateParentSha`
  equality. No new `rangeRelaxation` schema member, no `Σ` derivation, no
  clean-range check, and no new diagnostic codes are added.
- **Requalification after `main` advances** remains: re-declare the candidate at
  the new parent and re-emit candidate evidence. Both reviews agree this is
  already sound; the shelved relaxation was only ever an optimization on top of
  it.

## Genuine sub-fixes the exploration surfaced

Two real weaknesses in the *existing* exact-pin gate were found while designing
the relaxation. They are worth fixing **independently** of range relaxation,
because they harden exact-pin itself. They are filed as a small follow-up ticket,
`issues/shelved/20260816-capability-maturity-a5-merge-bypass.md`:

- **A5 sole-parent merge bypass (a real exact-pin hole).**
  `validateTransitionRange` skips every commit with ≠1 parent unconditionally
  (`scripts/capability-maturity.mjs` line 1033: `if (parents.length !== 1)
  continue;`). A two-parent (merge) commit can therefore change the maturity
  projection with **no** transition classified, no receipt required, and neither
  exact-pin nor any validation run — a maturity transition rides a merge commit
  unchecked. Both review families rate the merge repair itself as sound: compare
  the merge commit's maturity/registry projection against **every** parent's and
  refuse if it differs from any (`MATURITY_MERGE_TRANSITION_UNSUPPORTED`), so a
  transition may not ride a merge. Missing/unparseable projections must refuse
  rather than compare as null (REVIEW-R2-GROK §4; REVIEW-R2-CODEX "A5 merge bypass
  — substantively repaired"). This fix stands on its own and does not depend on
  any range machinery.
- **Transition-record accuracy points.** The orphan/voided-receipt handling and
  the transition-key uniqueness (`candidateSourceSha + ids`) noted in review are
  accuracy hardening for the existing record model, independent of range
  relaxation. The follow-up ticket records them for consideration.

## Amendment record

This Decision governs **LLP 0134 §4's promotion rule**: it **affirms** the
exact-pin rule and **declines** the range relaxation that LLP 0134's 2026-08-16
revision line and its triggering issue deferred to this document. LLP 0134 §4 is
unchanged — no schema member, checker branch, or diagnostic is added by this
Decision. The A5 merge-bypass hardening above is scoped to its own follow-up
ticket, not to this Decision.

The shelved design's findings — the five-defeat history, the conservative-surface
model, the base-revision runner, the tree-entry comparison, and the F1–F14
adversarial fixture matrix — are preserved in this file's git history should
anyone revisit range relaxation. A revisit must first solve the three
preconditions above (complete input closure, trusted-execution root, witnessed
evidence) before any relaxation can be sound.

## Open questions

None blocking. This Decision closes the deferral. A future revisit is gated on
solving the three soundness preconditions; absent a proportionate way to close
them, exact-pin remains the rule.

## Status

**Draft** — authored 2026-08-16 as a shelving Decision after two dual-family
super-refine rounds (round-2 reviews `REVIEW-R2-CODEX.md`, `REVIEW-R2-GROK.md`,
both NOT READY) concluded the sound range-relaxation form is disproportionately
hard for near-zero value. Intended for one light confirmation review, then
**Accepted**. This document decides an authority rule; it promotes no capability
and ships no code.
