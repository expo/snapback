# CC-1 (build half): implement the provisioning surface + acceptance gate

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 1
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “CC-1 (build half): implement the provisioning surface + acceptance gate” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while delivery is a dependency-heavy, multi-stage program, with specific cited code, progress, or acceptance criteria.
**Progress:** Blocked
**Severity:** P2
**Systems:** Developer experience, Deployment
**Author:** Claude (Fable), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0086 CC-1, LLP 0089
**Marker:** llp-0086-execution
Implement the LLP 0089 surface (local/trusted-local target) with the
acceptance gate proving an agent with only credentials + endpoint provisions a
working app (schema+permissions+code loaded, one generated function invocation
succeeds). **Blocked:** LLP 0089 must exist and pass review first (it is being
drafted under this batch); hosted half additionally waits on LLP 0087 Phase 2
prerequisites. L-sized; needs its own docket entry when unblocked.

## Triage freshness note (2026-08-01 sweep)

Still valid; text updated: LLP 0089 now EXISTS
(llp/0089-agent-provisioning-surface.rfc.md, authored 2026-07-23) but is
still Draft with zero review artifacts, so the live blocker is narrower
than written: 0089 review + the LLP 0082 evidence gate. Also note LLP
0105 (Accepted 2026-07-28) records 0089 as contract authority with
Universe/hosted as implementation authority for hosted operations — the
hosted half's shape moved since this ticket was filed. No provisioning
surface exists in code (profile gating only, crates/snapback/src/cli.rs).
