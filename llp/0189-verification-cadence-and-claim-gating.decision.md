# LLP 0189: Verification cadence and claim gating

**Type:** Decision
**Status:** Accepted
**Systems:** Testing, CI, Packaging, Documentation, Developer experience, LLP governance
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-07
**Revised:**
**Related:** LLP 0005, LLP 0010, LLP 0061, LLP 0154, LLP 0158, LLP 0162, LLP
0175, LLP 0185,
issues/20260807-derived-fork-publication-wave-drift-requalification.md,
issues/20260803-wave3-program.md,
issues/20260806-main-red-agent-safe-leaf-set-drift.md

## Context

`main` lands continuously — the median gap between commits is about 0.1
minutes (LLP 0175's measurement), and many concurrent agent sessions push
around the clock. LLP 0175 already fixed the *CI* half of this problem: pushes
get fast/affected verdicts, and the complete canonical inventory runs on a
six-hour scheduled latest-main cadence instead of per commit.

But the *claim and publication* layer still binds exact commits, and that
layer keeps failing the same way:

- **The C27–C33 qualification loop (2026-08-05/06).** Seven successive Track B
  candidate cuts were abandoned because "the mandatory post-review fetch found
  newer main" before performance could run. The loop was broken only by an
  author ruling (recorded in
  `issues/20260803-0163-public-operation-identity-carrier.md`) that dual-READY
  reviews survive normal merges.
- **The derived-fork publication withdrawal (2026-08-07).** The
  `operating.instance-forks` claim landed at `7cada777b` after twelve review
  rounds — most of them spent hardening the publication gate rather than the
  feature — and was withdrawn about seven hours later (`a5465b4a2`) because
  wave landings changed nine proof/checker/metrology files inside its
  qualification digest. No fork runtime code changed. The claim died of
  unrelated churn.
- **The 433-commit red gate (2026-08-06).** An exact-count leaf-set assertion
  that any landing could invalidate went red and stayed red for 433 commits,
  blocking the npm promotion's "green local proof at the exact candidate SHA"
  precondition (that promotion has since closed) for every commit in the
  range.
- **Queued, overlapping verification.** Full proofs, qualification cycles, and
  review loops each take longer than the landing gap, so processes queue,
  overlap, and invalidate one another instead of converging.

The common defect: processes that gate landing, claims, or promotion on
*complete verification bound to an exact commit* are structurally incompatible
with this repository's landing cadence. Verification per commit must be cheap;
completeness must come from a schedule; claims must be snapshots that
unrelated landings cannot kill.

## Decision

Ruled by the author (Charlie Cheever), 2026-08-07. These are repo-wide
defaults; LLP 0005's honesty rules stay fully in force.

**D-1 — The scheduled complete battery is the authoritative verdict.** The
complete canonical inventory (LLP 0175 D2.3) runs on schedule — at least
twice daily; the current six-hour cadence satisfies this — and on demand.
Its red results become fix-forward filesystem tickets (one per root failure,
idempotent per still-open ticket, following the
`scripts/drift-prone-gates.mjs backstop` pattern) that the fleet fixes
promptly. A battery red does not retroactively invalidate unrelated landings
or standing claims; it names work.

**D-2 — Landing gates stay fast and affected.** Landings run the LLP 0175
D2.1/D2.2 fast/affected selection plus the same-change frozen-record drift
gates. No process, gate, or qualification loop may require a complete battery
at an exact commit as a precondition for landing. (LLP 0175 already
implements this for CI; this decision extends it to every process design —
review loops, qualification cycles, publication ceremonies.)

**D-3 — Claims are snapshots.** A capability claim, publication, or promotion
binds the qualification commit and the scoped evidence surface it names
(D-4). It remains valid until a claim-relevant change lands without
requalification. Unrelated landings — including changes to wave-shared proof
harnesses, metrology, fixtures, or documentation — never invalidate a claim.
Withdrawal is warranted only when (a) the scoped surface changed without
requalification, or (b) the claim is discovered to be factually wrong.
Requalification then happens on the next natural cycle, not as an emergency
that races the fleet.

**D-4 — Qualification digests are scoped to the claim.** A qualification
digest covers the claim-relevant surface only: the runtime/implementation of
the claimed capability plus the checkers that define that claim's semantics.
Wave-shared proof harnesses, metrology, and fixture files move out of claim
digests and are protected instead by their own frozen-record drift gates (the
LLP 0175 `driftProneGates` registry pattern; the R12-1 per-file gate in
`issues/20260807-codegen-declaration-has-no-drift-gate.md` is the model).
Coverage moves; it never vanishes: removing a file from a digest is legal
only in the same change that adds (or names the existing) drift gate covering
it.

**D-5 — Reviews bind content, not HEAD.** This generalizes the 2026-08-06
landing-discipline ruling repo-wide: mutually blind dual-READY verdicts on a
cut remain valid across normal merges of newer `main`; only genuinely new
conflict-resolution work needs fresh scrutiny. No process may require
re-review solely because `main` advanced.

**D-6 — Promotion and release preconditions reference the battery, not
per-commit proofs.** A candidate needs (a) green scoped evidence for exactly
what it claims, and (b) the most recent scheduled complete battery green on
its claim-relevant gates, with any unrelated red gates ticketed and named in
the promotion record rather than blocking it. Existing "green local proof at
the exact candidate SHA" preconditions are re-scoped to this form.

**D-7 — Stricter per-claim protocols remain available by explicit author
ruling.** Where the author has ruled that a specific claim needs exact-commit
binding (for example, LLP 0162 Track B row 13's paired performance protocol),
that protocol stands as written until separately amended. The default is this
decision; extra strictness is opt-in per claim, never ambient.

## Consequences

- The derived-fork requalification
  (`issues/20260807-derived-fork-publication-wave-drift-requalification.md`)
  proceeds under D-4: select the fresh qualification C once, re-scope the
  digest with drift gates for the departing wave-shared files, and future
  wave landings stop rotating it. That ticket's "must not exclude them"
  constraint is superseded by this ruling — exclusion is permitted exactly
  when the same change installs the replacement drift gate.
- The two deferred checker-hardening tickets
  (`issues/20260807-review-prose-history-not-frozen.md`,
  `issues/20260807-codegen-declaration-has-no-drift-gate.md`) land as part of
  that same cycle.
- The wave 3 close condition ("a green named commit") is re-scoped per D-6 to
  the battery form; recorded in `issues/20260803-wave3-program.md`. The
  first-npm-promotion precondition that hit the same wall is already closed
  (`issues/closed/20260803-first-npm-latest-promotion.md`); future promotion
  ceremonies use the D-6 form.
- The pattern-based leaf matching follow-up in
  `issues/20260806-main-red-agent-safe-leaf-set-drift.md` (match
  content-addressed leaves by pattern under registered roots, enumerate only
  non-content-addressed leaves) is endorsed: it is the same principle — exact
  enumeration only where the enumerated thing is the claim.
- Battery-red ticket filing (D-1) extends the existing backstop pattern from
  drift gates to complete-proof root failures; implementation tracked in
  `issues/20260807-llp-0189-claim-snapshot-implementation.md`.

## Non-goals and preserved honesty

- No test or assertion is deleted, and no gate is weakened without its
  replacement drift gate landing in the same change.
- Battery reds are never ignored: each becomes an open ticket the fleet is
  expected to fix forward promptly, and D-6 forces promotion records to name
  any outstanding unrelated reds.
- Claims still name their qualification commit, digest, receipts, review
  heads, and named-author acceptance exactly as before; what changes is only
  which later events can invalidate them.
- LLP 0175's fail-closed selection (unknown paths run everything) is
  untouched.
- This decision does not slow the deliberate burst cadence on `main`, and it
  does not convert any `BLOCKED`/`FAIL` state into a silent skip.

## Required updates

- `AGENTS.md` working guidance — done in this landing.
- LLP 0175 — Revised pointer to this decision (its D2 cadence design is the
  substrate D-1/D-2 stand on) — done in this landing.
- `scripts/check-agent-safe-publication.mjs` digest scoping (D-4) and
  snapshot/withdrawal semantics (D-3), plus battery-red ticket automation
  (D-1) — `issues/20260807-llp-0189-claim-snapshot-implementation.md`.
- Ticket amendments (requalification, npm promotion) — done in this landing.
