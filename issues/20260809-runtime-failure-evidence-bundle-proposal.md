# Proposal to LLP 0156: sanitized runtime-failure evidence bundle

**Opened:** 2026-08-09
**Origin:** LLP 0207 dissolution (Withdrawn; dual-family review record
under `llp/reviews/0207-*`)
**Proposed owner:** LLP 0156 (minimal error tracking) — this ticket is a
scope proposal to that document's owner, not commissioned work.


## Triage (2026-08-26 leftover sweep)

Still open as **implementation**. Author-accepted; LLP 0156 E1.5 amendment exists. `error_evidence_bundles` does not appear in Rust/SQL product code.

## Proposal

On runtime failure, mint a sanitized, identity-bound **local evidence
bundle**: the diagnostic, closure/build IDs, redacted request shape,
principal class, readiness facts, and bounded recent logs. Purpose:
convert failure-state *reconstruction* (the expensive diagnosis mode)
into *inspection* — the agent learns what the failing state was without
re-deriving it.

## What was evaluated and rejected (do not re-propose)

The 0207 review loop evaluated and killed **deterministic replay from a
receipt** across both model families: a state digest verifies state
identity but cannot reconstruct state, and honest replay would require
the executable artifact, a data snapshot, principal, environment, time,
randomness, and external responses — a privacy/retention design far out
of proportion. If replay ever returns, it is a per-operation-class
replayability matrix under LLP 0156, gated on the bundle proving
insufficient. See `llp/reviews/0207-agent-efficiency-round-two.gpt-5.md`
round 1 concern 5 and `.claude.md` round 1 concern 3 for the full
argument.

## Open design questions for the owner

Content bounds, redaction contract, local-vs-hosted capture posture,
retention — the former LLP 0207 OQ3. Fit with 0156's exemplar/raw-tier
machinery is plausible but was not verified by the loop (its reviewers
saw only 0156's header).

## Disposition if declined

Remains a filed ticket; no mechanism lands anywhere else.

## Author ruling — 2026-08-10

Accepted in principle as a scope amendment to LLP 0156, with two fences: v1
is local-capture-only (no hosted upload — the retention/privacy design
defers with it), and the redaction contract is a tested invariant, not a
convention (a bundle that leaks a staged secret once is worse than no
bundle). First task for the amendment author: verify fit with 0156's
exemplar/raw-tier machinery before committing to the shape — the review loop
assumed that fit without verifying it.

**2026-08-10:** Amendment drafted — LLP 0156 §Amendment (2026-08-10):
runtime-failure evidence bundle (E1.5). Fit verdict: inherits the raw tier's
governance but lands as a sibling table, not an exemplar-schema extension;
both fences carried (local-capture-only v1; redaction as a tested
seeded-sentinel invariant, fail-closed); replay stays dead per the 0207
review record.
