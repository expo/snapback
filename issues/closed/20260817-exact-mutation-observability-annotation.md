# Exact: annotation for intentional cross-route mutation writes

**Opened:** 2026-08-17
**Source:** Coterie round-1 and M2 entries (Diary 0086); LLP 0279 item 11

## Symptom

Contract's mutation-observability checker warns on profile-route mutations
whose additional denormalized writes are observed on other routes. The
warnings are accurate about locality, but broad writes that intentionally
maintain cross-screen projections make them noisy, and noisy-but-accurate
warnings train authors to ignore the checker.

## Ask

Add an intentional-cross-route-write annotation (per write, naming the
consuming projection/route) that suppresses the warning while keeping
unannotated locality violations loud. Acceptance: Coterie's known
projection-maintenance writes are annotated and its build emits zero
observability warnings, with a seeded violation still caught. External
(Exact repo) fix; graduate to Linear (Exact project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-mutation-observability-annotation.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
