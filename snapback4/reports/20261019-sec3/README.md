# SEC3 qualification evidence

Implementation source checkpoint `bb512f19f4` (0.4.33 bytes; guide changes target 0.4.34, version unchanged). Final sources/design have independent Muse contributor-high and fresh Codex 6.1-sol-high READY verdicts in `llp/reviews/sec3/final-readiness.json`. Reviews assert scoped source/design readiness; execution evidence is recorded separately here.

## Calibrated findings

The day-two ground truth distinguishes eight real high roots from the stricter/miscalibrated declarations used to probe ten lanes. The reviewed production checkpoint 53d480551a catches all eight; each matching witness is `authored-fixture-trace`. Ten lanes each execute 1,024 histories with no campaign timeout. `measurement-reviewed-53` retains the actual check/test outputs, original source hashes, separately hashed field-intent additions for015/027, fixture hashes, production binary hash, and grading criteria. The final-source production repeat at bb512f19f4 also catches all8/8 (0partial,0notcaught); all ten lanes again run1024 histories with no timeout. Complete outputs and source/binary/fixture hashes are in `measurement-final19/`.

| Ground-truth root | Result | Responsible operation |
| --- | --- | --- |
| 013 F1 | caught | visibleSubmissions |
| 019 F1 | caught | inspectionsOf |
| 021 F1 | caught | opponentBrief |
| 021 F2 | caught | createTournament |
| 027 F1 | caught | grantRole |
| 027 F2 | caught | episodesOfShow |
| 045 F1 | caught | notesFor |
| 048 F2 | caught | gaugeHistory |

019 includes both the read and write half. 021's deadline leak is additionally reproduced on a copy repairing the independent self-director defect; that repair does not suppress opponentBrief disclosure. 048's witness creates a real image-backed reading, changes the actor's role, and reads gaugeHistory. These are finite witnesses, not whole-program safety proofs.

## Noise and compatibility

All 150 earlier schemas have zero false refusals, unchanged input hashes, and located security notes. Neither noisy code fires without independent intent. Seven escalation advisories identify actual global-authority gains: register(002), registerProfile(015), bootstrapProducer(027), joinAs/promote(036), bootstrapHead(040), joinAs(048). These are advice to review delegation, not assertions that intentional open enrollment is forbidden. The four requested wave17 schemas002/036/043/048 are all flagged in the50-schema survey. Scoped enrollment and independently guarded delegation regressions remain quiet. The survey establishes zero false refusals; it does not label every advisory a ground-truth exploitable flaw.

## Boundaries

Only authored traces from the recorded validated starting state fail acceptance. Seed-only/synthetic observations remain visible with --all; no-fixture check uses isolated empty memory and explicitly excludes populated production-state coverage. Unsupported observer identities, opaque dependencies, unstable repeats, finite argument/history budgets, device/wire/activity paths and full-history induction remain named coverage gaps. The original proof-gap issue remains open. REL5 owns release-transition text and MIG owns staging clocks/backfill recipes.

Tests and consumer qualification are indexed in the final WORKSTREAM-REPORT.md and receipt files. Consumer-only qualify-linux cannot authorize publication. Earlier failed/racy cohorts are retained distinctly from successful affected reruns. Verbatim review whitespace is preserved intentionally.

Final verification: all 417 client files pass (7,713 subtests, 56 expected skips); both full-count models pass 81/81 with all 13,000 primary generated sequences and no model skips. See client-final.json and compressed logs. Historical controller timing includes a deliberate parent pause and is not a throughput measurement; use the final cohort durations. The full affected Rust rerun passes 3,638 tests across 236 targets. Local/Mac build outputs and installed-consumer scratch were removed after their final consumers. Qualified artifact custody is indexed in consumer/retained-artifacts.json.
