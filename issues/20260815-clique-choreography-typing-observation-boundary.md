# Clique frozen choreography reports typing-action duration as first-delivery latency; correct the observation boundary and rerun the simplified lane

**Filed:** 2026-08-15 · **Source:** resolution of
`issues/closed/20260815-ephemeral-typing-first-visibility-misses-2s.md`
(landed in 3ec6b1782) · **Systems:** Clique benchmark harness (LLP 0201),
Ephemeral state (LLP 0013)

## Problem

The Clique frozen choreography's required M3 typing check starts its clock,
then awaits a roughly 45-character `pressSequentially(..., { delay: 25 })`
action, and only after that entire multi-key action completes begins waiting
for the second browser's typing indicator. Its reported `visibleMs` therefore
includes ≥1.1 s of synthetic typing plus browser input/render overhead, not
first-delivery latency. The instrumented pipeline shows actual delivery is
eager: the eight-sample two-client regression measured at most 1 ms per
segment and 1.68 ms caller-publish-start → overlay-apply (LLP 0013
§First-delivery latency budget).

Consequence: the only failed milestone boundary across the three Snapback
0.1.21 sweep lanes — Simplified's typing indicator at 2,045–2,126 ms against
the 2,000 ms ceiling (Diary 0081 §M3) — is a measurement artifact of the
check, not a product latency. The same artifact inflates every lane's number;
the Convex lane's "close enough to the ceiling to feel load-sensitive"
durable-row typing reading is equally contaminated, so correcting the
boundary may also change competitor margins, in either direction.

## Why this is a governance change, not a quiet edit

The choreography is frozen benchmark infrastructure under LLP 0201; changing
a frozen check's measurement semantics breaks comparability with prior
recorded runs. The sweep kit also lives outside this repository (the 0.1.21
run used `~/clique-0121-20260814` on LA Durand), so the fix lands in the
benchmark harness, with LLP 0201's record noting the boundary version.

## Suggested fix

1. Amend the choreography so observation starts before the single state
   transition being measured — start the clock at the final keystroke (or the
   publish call), per LLP 0013's observation-honesty rule: a harness must not
   start its clock, await a long synthetic action, and only then begin
   checking the observer.
2. Version the check in the LLP 0201 record so pre- and post-correction runs
   are not compared as like-for-like; note which sweeps (0.1.21 and earlier)
   used the old boundary.
3. Rerun the simplified lane's M3 frozen boundary under the corrected check
   and record the new receipt, replacing the sweep's one red boundary with a
   measured result.

Graduate to Linear (Exact project, Snapback label) if the LLP 0201 P3 ruling
queue absorbs this instead; record the pointer here and close.
