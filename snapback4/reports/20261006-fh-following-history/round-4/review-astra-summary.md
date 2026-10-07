**NOT READY** at `200eda60b6`, reviewed against `2a5fc454aa`.

The round-1 panic and follow-churn findings are resolved. Four findings remain:

1. **P1: Valid wider cards stop history traversal.** At 32 mounted cards, refresh refuses its authorization batch and the hook hides everything. The same witnesses succeed in smaller batches.
2. **P1: Live prepend loses events.** An already displayed event disappears after 20 newer arrivals. Backdated post-B events below the inbox’s first page never appear, even after history is exhausted.
3. **P2: Cancellation ignores operation binding.** Cancelling through `/following/home` invalidates a valid `/following/cards` opening.
4. **P2: Refused refreshes report zero work.** A final output refusal erases the returned meter despite completed reads.

Verification passed: 27 native history tests including scale, 113 guide tests, supplied Following/React journeys, read-only checks, RX checks, compatibility and client typecheck. Five initial serve setup failures passed after building the required executable. Published-package cases retain documented skips. Independent probes reproduced all four findings.

[Full review, source locations, reproductions and measurements](/home/ccheever/sb4-intent/reviews/fh-r3.astra.evidence/REVIEW.md).

eb1000 only; no tracked changes or pushes. One Cargo target, approximately 1.5 GB.