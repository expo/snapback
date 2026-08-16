# Queue a qualified npm publish once the 0.1.16 receipt regression is fixed

- **Status:** Open
- **Date:** 2026-08-10
- **Systems:** publication
- **Author ruling:** 2026-08-10 sitting (recorded in LLP 0204's header)

The LLP 0204 external-surfaces program (S0–S5, ~19 landings ending
da720b591) is the largest agent-facing surface addition to date and is
landed but unpublished — the exact liability LLP 0041's rapid-publication
posture names. Publication is deliberately queued behind the active 0.1.16
receipt-regression rollback (npm `latest` currently 0.1.15 across all
eleven names; owned by the session that rolled it back).

**Action for whoever resolves 0.1.16:** run the qualified publication
ceremony (first-qualified-ceremony recipe) immediately after, so the
external-surfaces program ships to npm. Do not publish ahead of the fix;
do not hold after it.

## Resolution — 2026-08-15 (backlog sweep)

The 0.1.16 receipt regression was withdrawn from `latest` and succeeded by
0.1.17, which restored a bootable published closure. Subsequent qualified
cuts continued; `guide/published-closure.json` now records `newestPublished`
0.1.22 (2026-08-15) and `newestQualified` 0.1.21. The action this ticket
queued — run the qualified ceremony immediately after the 0.1.16 fix so
landed 0204-era surface is not stuck unpublished — has been performed.
