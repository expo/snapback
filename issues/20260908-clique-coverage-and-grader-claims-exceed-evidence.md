# Clique coverage and grader claims exceed observed evidence

**Status:** Open
**Date:** 2026-09-08
**Area:** Clique benchmark acceptance and independent grading

The published 0.0.19 cold app's acceptance entrypoint maps every required
assertion to one named test per milestone. Independent source inspection
confirms several mapped clauses are absent: visible auth errors, link clicks,
Following pagination and gap checks, quote navigation, grouped search results,
and real unequal-ranking/aged-post cases. The M8 zero-day and age checks use
locally constructed values instead of exercising the corresponding application
behavior. Passing commands and valid mapping JSON therefore overstate coverage.

The fresh Grok assessment found those gaps, but some of its own passes also
exceed their observations: an API cursor query is not a scroll proof; six
integer tiles with one reconciled total do not verify all six seeded totals;
a wrong-mode handle-error attempt does not prove a visible duplicate-handle
error. Supplemental offline scripts injected synthetic cache and failed on
controls or a fully offline reload, so they provide no warm-offline or
post-expiry search proof. The missing Erin fixture also prevents attributing
the group-receipt failure to the application; its existing ticket remains the
owner of that instrument defect.

Preserve the original report and distinguish its literal frozen `dishonest`
coverage verdict from intent. The root adjudication narrows claims without
rewriting attempts or manufacturing missing passes. No calibrated score or
comparison is supported by this run.

## Follow-up

In the next instrument/assessment revision, require assertion mappings to name
the actual exercised clause, distinguish API and rendered-UI methods, and keep
incomplete assessor checks separate from application failures. A normal null
DOM attribute must fall through to the alternate semantic attribute, not only
a rejected promise. Recheck every affected claimed pass against its retained
observation. Use the existing audit/review mechanism; this ticket authorizes no
new blocking gate, registry, or benchmark rerun. Keep frozen historical bytes
and results intact.

Evidence: [run record](../benchmarks/runs/2026-09-08-release-cold-headroom/README.md),
original application archive and assessment under
`/Users/ccheever/projects/snapback-artifacts/clique-cold-019-20260908/`,
read-only `/root/invalidation_audit` source/evidence review. Related:
[M3 actor mismatch](20260906-clique-m3-group-receipt-missing-seeded-actor.md),
[report-schema M8 gap](20260908-social-messenger-grader-schema-rejects-m8-assertions.md).

## M7 postcheck — 2026-09-08

The [fresh M7 assessment](../benchmarks/runs/2026-09-08-release-cold-headroom/assessment-m7/README.md)
records nine passing assertions and an `honest` mapping verdict. Its concrete
observations support a bounded positive diagnostic, but the mapped pre-existing
count test uses a floor and the mapped a07 test has no settings UI check.
Supplemental API equality and browser display observations do not make those
mapped tests complete.

Retain the assessor's precise method limits: the late `offlineHistory` probe
recovers 15 IDs and 13 message fields through Alice, not every late receipt or
persona view; the offline browser probe observes pending and remote convergence,
not pending clearance; exact count populations contain no tombstones or expired
rows. The earlier frozen author choreography supplies stronger pending-clear
evidence. Preserve the failed settings navigation and successful fresh-page
retry. These scope corrections do not themselves demonstrate a new app failure.
