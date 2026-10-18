# Final installed-document-only continuation

20/20 final check/test commands completed; 102 declarations: 31 proved, 3 refuted, 68 unproved. 2 unproved declarations contain unsupported expressions. 14 commands exited 0, 6 exited 1, 0 timed out.

All application schema.q and security.q files were retained. No correct intent was removed or narrowed to obtain a pass. Current refutations comprise two over-strong both-image policies and one trusted-ingress integrity counterexample; none establishes a newly reproduced unauthorized public app operation. Zero current false refutations were confirmed. The historical false-replay claim and its refusal evidence remain preserved and explicitly reassessed below.

The first action affecting files archived REPORT.md and RESULTS.json under [archive-initial](archive-initial/). Their originals and archived SHA-256 hashes match. All 1011 pre-existing evidence files remain byte-identical. Independent review of each declaration against its SPEC is in [spec-review.json](final-evidence/spec-review.json); full command arrays, exit status, timings, source hashes, raw counterexamples and unsupported paths are in [FINAL-RESULTS.json](FINAL-RESULTS.json).

Only this workspace was used. Learning used the installed README and current CLI security/testing guides. No repository source, other-model reports/reviews, journals, original-wave directories, keys, cargo or publication were accessed. CLI commands had 175-second timeouts with 3-second kill grace and a 180-second outer deadline; at most four apps ran concurrently.

| App | Declared | P/R/U | Holes | Unsupported | check/test exit | Test A/R/V | Retained ordinary pass/fail | False runtime refusals |
|---|---:|---|---:|---:|---|---|---|---:|
| 005-snapback-kiln-firing-queue | 9 | 0/0/9 | 6 | 0 | 0/0 | 372/321/0 | 13/0 | 0 |
| 007-snapback-farrier-hoof-rota | 12 | 0/0/12 | 6 | 1 | 0/0 | 338/235/0 | 9/0 | 0 |
| 008-snapback-sublet-key-escrow | 9 | 0/0/9 | 5 | 0 | 0/0 | 242/198/0 | 11/0 | 0 |
| 009-snapback-choir-part-tracks | 12 | 9/0/3 | 8 | 0 | 0/0 | 2424/2095/0 | 14/0 | 0 |
| 010-snapback-allotment-water-turns | 8 | 4/1/3 | 7 | 0 | 1/1 | 103/90/1 | 10/0 | 0 |
| 019-snapback-apiary-hive-inspections | 9 | 2/0/7 | 12 | 1 | 0/0 | 1335/1076/0 | 10/0 | 0 |
| 020-snapback-tow-yard-release | 10 | 0/1/9 | 5 | 0 | 1/1 | 739/560/1 | 9/0 | 0 |
| 021-snapback-moot-court-scoring | 12 | 10/0/2 | 24 | 0 | 0/0 | 914/606/0 | 8/0 | 0 |
| 045-snapback-instrument-loan-bank | 11 | 6/1/4 | 10 | 0 | 1/1 | 784/577/1 | 9/0 | 0 |
| 048-snapback-boiler-room-rounds | 10 | 0/0/10 | 16 | 0 | 0/0 | 251/183/0 | 8/0 | 0 |

P/R/U are whole-declaration verdicts. Holes are conditional read/write effects with no matching declaration, not confirmed leaks. Unsupported is included in unproved. A/R/V are finite security attempts, expected refusals, and policy violations. Exit zero does not turn an incomplete query sweep into complete business coverage. Seven apps exited zero for both commands; this concerns command exits only.

## Reassessment without rewriting history

**010-snapback-allotment-water-turns: valid refutation of an over-strong both-image author policy; no current confirmed false refutation.**

Preserved. The earlier displayed unchanged override write is refused E_RULE; that observation has not been erased or silently recategorized. Current replay has actual old status override, committed next status booked, and $syntheticPatch {status: booked}. The old predicate is false for an ordinary holder, so the declaration is refuted under documented semantics.

SPEC reserves overriding to committee. It does not require that every status edit away from an already overridden snapshot be committee-only. The public cancel requires booked and the public override requires committee. Neither counterexample nor new test-only diagnosticStatus is an unauthorized public override. Retained the declaration and nonzero verdict. No scope weakening or deletion. A role-only bookings.override declaration would state operation authority but would not prove next-image/cross-operation transition intent.

**020-snapback-tow-yard-release: valid refutation of an over-strong both-image author policy; general transition assertion is a scope limitation.**

Preserved. The earlier unchanged released/held image did not establish a release transition. Current replay has released/onHold=true as old and impounded/onHold=true as committed next, with $syntheticPatch {status: impounded}. It violates the old-image predicate even though the next image satisfies it.

SPEC blocks releasing while held. Moving away from released in a synthetic snapshot is not entering released while held. The public releaseVehicle requires impounded, no hold, and verified claim. The corrected replay is valid against the literal declaration but does not establish an app release violation. Retained the declaration, original evidence and nonzero verdict; did not reinterpret write only as next-image-only.

**045-snapback-instrument-loan-bank: genuine all-snapshot integrity / trusted-ingress scope limitation; ordinary app reachability not established.**

Preserved as a real trusted seed_at commit/read-back of returned with returnPhoto=null. The current candidate still returns a trusted seed_at counterexample with returned status and no return photo; it is not a failed input decode or a no-op mismatch.

The SPEC requires condition photos at return. That is correct intent and remains authored. Public checkin now has a required returnPhoto argument. A typed snapshot import can still introduce an invalid historical returned row, and the checker does not prove only histories reachable through checkin. Retained correct intent rather than deleting or weakening it to make check/test pass.

## Ordinary workflow provenance and boundary verification

Reused 101 earlier final ordinary-case passes plus 5 additional passes; these were not rerun wholesale and are not presented as fresh current-candidate results. The retained sources match the final production schemas after only test-persona and blank-line normalization (apiary has one extra blank line). Each source hash and original command is retained in FINAL-RESULTS.json. The ordinary sources intentionally omit security.q so they test application enforcement independently of checker refutations.

New boundary probes: 12 passes. These use the current application bodies with a clearly labeled added diagnosticStatus mutation absent from the app. Allotment verifies public cancel refuses an already overridden row, the old unchanged override write is E_RULE, the synthetic override-to-booked change commits, and entering override as a holder is E_RULE. Tow verifies public release checks, synthetic released-to-impounded commit, held release refusal at both operation and row boundary, and verified-claim enforcement after hold removal. These fixture-only snapshots and test-only mutations do not prove production operation-sequence reachability.

No false runtime refusal was observed in the retained final ordinary cases or new boundary cases. This says nothing about untested legitimate workflows, including unmodeled parent/family access. Historical incorrect fixture expectations and original failing outputs remain in the archived evidence.

## Per-app SPEC and proof scope

**005-snapback-kiln-firing-queue** — 6 uncovered effects; 17 distinct named test coverage limitations.

- No invariant expresses the started-firing edit lock or valid firing stage sequence.
- Member firing-count limits and 21-day donation flag timing need operation/clock qualification.
- Public queue length is explicitly allowed by SPEC, but the payload read invariant has no explicit aggregate declassification; keep the unproved observer visible.

**007-snapback-farrier-hoof-rota** — 6 uncovered effects; 24 distinct named test coverage limitations.

- Multi-hop photo privacy is unsupported; parent authority/read-through remains unproved.
- Visit-to-photo completeness and automatic two-day reminders are not established by row non-null and recipient assertions.
- Recurring cycle timing, media bytes, and ongoing farrier assignment lifetime remain unqualified.

**008-snapback-sublet-key-escrow** — 5 uncovered effects; 8 distinct named test coverage limitations.

- Exact start-date release, both signatures, and verified ID/document correspondence need a transition/sequence reduction; the timestamp declaration alone is incomplete.
- Overdue end-date flagging and actual ID upload/download bytes remain unqualified.
- Both-image cancellation/release predicates also restrict historical recovery edits beyond the transition wording; no public recovery operation is modeled.

**009-snapback-choir-part-tracks** — 8 uncovered effects; 21 distinct named test coverage limitations.

- Tracks release existence does not itself prove parent-concert release date and concert+7d correspondence; temporal directives and workflow need separate qualification.
- Attendance live delivery and media bytes are not proven by row intent.
- After a singer changes part, historical attendance audience is a product assumption; retained tests check the implemented realignment.

**010-snapback-allotment-water-turns** — 7 uncovered effects; 16 distinct named test coverage limitations.

- Old-and-next status intent is stronger than only authorizing override; the legitimate literal refutation has no public mutation reachability proof.
- Two-hour turns, weekly limit, drought integer rounding, oldest-booked retention, every-override audit completeness, and week races are workflow obligations.
- Committee access to private booking payloads is an administrative interpretation; opaque booking references in the calendar are assumed not to identify holders.

**019-snapback-apiary-hive-inspections** — 12 uncovered effects; 15 distinct named test coverage limitations.

- Parent-hop inspection privacy is unsupported; raw public-listing hive probes need observer reduction.
- Lead-only status intent explicitly includes service:ops, a trust assumption that must not be described as an implicit checker exemption.
- Inspection threshold/alert recipient correspondence, seasonal 14-day crossing, and real media bytes are not fully qualified.

**020-snapback-tow-yard-release** — 5 uncovered effects; 13 distinct named test coverage limitations.

- Both-image held-release predicate is stronger than blocking entry to released; current synthetic replay changes away from released.
- Actual 30-day auction, fee accrual boundaries, verified ownership/claim correspondence, and photo bytes remain unqualified.
- Manager lifting holds is an existing exception; the SPEC explicitly names liaison authority and does not define manager delegation.

**021-snapback-moot-court-scoring** — 24 uncovered effects; 25 distinct named test coverage limitations.

- Brief deadline is selected by a caller-supplied tournament; teams/briefs lack a tournament link. The security declarations do not prove the intended brief-to-deadline association.
- Judge panel membership is not modeled, so assigned-panel live scoring cannot be qualified.
- Closed-round score lock, brief time crossing, coach pre-close timing, and live delivery remain separate workflow scope.

**045-snapback-instrument-loan-bank** — 10 uncovered effects; 15 distinct named test coverage limitations.

- Returned-loan photo integrity is refuted at trusted seed ingress; ordinary checkin now requires a return photo. Preserve both facts.
- Parent/student/family linkage is absent; the retained parent-with-no-link case cannot qualify legitimate parent access or establish a false refusal.
- Season-end and 14-day follow-up are query-derived without a fully qualified clock/delivery history; media bytes remain unqualified.

**048-snapback-boiler-room-rounds** — 16 uncovered effects; 23 distinct named test coverage limitations.

- Completing every gauge uses an operation count guard outside row proof; the retained additional workflow pair tests one missing gauge.
- Immediate missed-round/out-of-range alerts are not fully qualified by the hourly sweep/two-hour window; no exact numeric deadline was invented.
- Round/gauge/shift consistency, real media bytes, and live compliance delivery need separate qualification.

The unsupported expressions are farrier photos.read and apiary inspections.read: live parent/read-through hops lack a reduction. They remain declared. Full unproved reasons include observer/raw-probe, reference/existence, job, aggregate, temporal, paired-world and protocol paths; the JSON preserves all of them.

All ten fresh check and test outputs, source snapshots and command records are under [final-evidence](final-evidence/). The kiln now completes its whole-set check and test within this continuation's limits; its old timeouts remain historical evidence. No old timeout or incomplete result was converted to a pass.
