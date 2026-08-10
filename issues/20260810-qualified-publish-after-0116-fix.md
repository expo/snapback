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
