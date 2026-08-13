# LLP 0232 D-3 classifier: residual hardening notes from the landing review

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Testing, CI, Developer experience
**Date:** 2026-08-12
**Related:** LLP 0232 D-3; LLP 0175 D2.1 (2026-08-11 ruling block)

Four fail-closed-direction residuals from the adversarial review of the D-3
closed-classifier landing (none blocks; all erode either signature-match
rates or durability at the margin):

1. `normalizeFailureText` does not normalize Linux `/tmp` mkdtemp paths or
   unlabeled numbers; on Linux runners, identical failures can mismatch and
   block as signature mismatch where they should corroborate/inherit.
2. `readTicketRequests` quarantines torn (unparseable) JSONL lines but a
   parseable entry with a wrong schema version or integrity mismatch still
   fails permanently; a future schema bump must quarantine those too.
3. Ticket-request durability: fd fsync only, no parent-directory fsync —
   the request can vanish across a crash on first creation.
4. Narrow corroboration residual: a pushed submodule-pointer bump whose init
   failure normalizes identically to an unrelated baseline init failure can
   still corroborate as INFRASTRUCTURE; bounded by the two-hour backstop.
