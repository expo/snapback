# Revision 4 — completed Snapback 4 authoring retained for measurement

Round 3 owner ruling, 2026-10-05. The revision-3 chain started at 18:31Z.
Snapback 4 reached M8 green at **1791231956**, including a Release artifact;
its native execution was operator-pending. It requested replay-start at
**1791231965.8406022**. The supervisor rejected the boundary at
1791231966.363043 and finished termination/cleanup at 1791231969.0148532.
The original end remains setup-failure / invalid-replay-boundary, exit -15.
After-builder refused before creating a measurement attempt.

The inherited social-messenger instrument budgets replay adapter authoring
inside M6 but records execution on a separate clock. Revision 2's M6-only
execution guard was a harness defect. The guard now permits **one interval**
during M6 or M8, with the unchanged four-hour wall cap; earlier, repeated,
nested, reset and unmatched intervals still refuse. The regression replays the
actual Snapback 4 boundary timestamps through the supervisor and checks both
permitted phases, repeat/reset refusal, ordering and the four-hour ceiling.

This completed build is **not voided**. The immutable reclassification under
attempts/snapback4-replay-boundary-reclassified binds the original logs, stopped
lane, filesystem identities/times, DerivedData quarantine, prior chains and
revision-3 seal. No termination-time content manifest existed: the historical
custody check uses unchanged filesystem ctime/mtime through the recorded end,
then captures full content hashes and rechecks both before ordinary custody.
Cleanup is rechecked without modifying original logs. No setup rerun is consumed.
The original builder tree is never edited. M1–M6 and M8 green are authoring
terminals, not operator native verdicts.

**Disclosed asymmetry:** Snapback 4 O5 is `not-executed (harness defect)`;
essay.md and final-report.md are absent for that same reason. Product evidence
is retained for ordinary native measurement. Convex keeps its exact original
prompt and sealed authoring inputs, and runs under the fixed replay rule.
Native measurement and its driver/validator/runner/helper/kit are unaffected.
No missing replay/report is synthesized and no native pass is inferred.

The existing handoff accepts command argv arrays and build scripts. SB4 authored
`bash scripts/native-build.sh @DERIVED@ @UDID@`, which invokes Release xcodebuild.
The operator's direct-xcodebuild-only check would reject that valid wrapper.
Both lanes may now use an in-custody bash wrapper with exactly those two bound
arguments. Both independent source audits must establish its actual Release,
fresh DerivedData and dedicated simulator invocation. The harness executes the
original authored argv unchanged, checks fresh output containment and Hermes/
bundle identity, and retains a process start receipt. This does not allow an
operator replacement of builder commands or substitution of a prebuilt product.
Direct xcodebuild handoffs retain their argv checks.

Resume is explicit: `pilot-chain.sh --resume-reclassification
attempts/snapback4-replay-boundary-reclassified/RECLASSIFICATION.json`.
Admission requires the revision-4 sealed record, unchanged retained custody,
ended prior chains, no prior SB4 measurement, and a cold Convex lane. It writes
a bound resume receipt before executing SB4 after-builder → Convex builder →
Convex after-builder. A second resume refuses; failures still stop the chain.
Normal custody clone, source audits, fresh operator Release build, M6/M8 on
simulator 3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B, independent validation and
retained product failures remain mandatory. Frame/negative-control review stays
pending until actually performed. No O4/overall score or scored admission.

PACKET.v1, v2 and v3 seals are retained. metadata/revision-4.json binds the
v3→v4 harness diff and reclassification. Source manifests, tests, readiness,
custody observations and the resumed chain identity are in preparation/round3
and the lane's external Round 3 report. Only eb1000 and the Apartment mini are
used. No black M5 or office M1. The source commit is local and not pushed.

## Pre-measurement custody correction retained within revision 4

The first Round 3 resume (chain-241ca857-22dc-4232-b547-cba06e1f4e90,
PID 8875) verified both 86,288-entry copies, then refused an absolute
`evidence/native-adapter-store/node_modules` link. It was internal to the
original lane, but APFS preserves an absolute link verbatim. No source audit,
preparation, build, driver, backend or native product execution had started.
Four such lane-internal links are now relocated only in the work copy to their
corresponding copied targets; other external links still refuse. The source
lane and exact custody snapshot remain unchanged, and every relocation is
recorded before source audits.

The complete refused result, custody clone, scratch and chain are retained.
A narrowly bound pre-measurement custody-recovery record permits one continuation
without charging a setup rerun: it requires this exact internal-link refusal,
empty segments, no product failure or downstream execution, verified original
custody and an ended bound chain. It cannot admit a failed build or native run.
The initial revision-4 packet (seal
3a5dce008e79d4475e11474310b5a803986971ac29fd4c52af5c6eca20090607)
is retained in preparation/round3/packet-v4-before-custody-fix. The final
revision-4 seal binds this correction and recovery, retaining v1–v3 unchanged.
