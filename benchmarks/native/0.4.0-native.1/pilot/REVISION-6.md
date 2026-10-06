# Revision 6 — cumulative replay ceiling and retained Convex measurement

P2A Round 5 owner ruling, 2026-10-06. Revision 5's single replay interval was
incorrect: the inherited brief explicitly requires a rerun after M8's scale-log
regeneration. Any number of non-overlapping intervals after the M6 boundary
now share one cumulative 14,400-second ceiling. Closing an interval or crossing
into M8 never resets that ceiling. Replay pauses the active milestone wall
clock only for the time spent in replay; authoring and token ceilings remain
unchanged. Nested intervals, unmatched ends, pre-M6 replay and milestone changes
inside replay still refuse. Tests use both lanes' real boundary sequences,
multiple intervals, an M6→M8 transition and cumulative exhaustion.

Convex reached M8 terminal green at **1791242650**. Its M6 replay completed:
the supervisor charged **1875.452301979065 seconds** and the original receipt
retains 167,157 actions. At **1791242650.875353**, it requested the post-M8
rerun and was killed by `invalid-replay-boundary`. The original logs and lane
tree remain unchanged. A separate sealed reclassification admits completed
authoring to the ordinary custody, amended initial source audit, preparation,
amended prepared-source audit, Release build, M6/M8 driver and independent
validation path. Both audits remain gating. There is no authoring restart or
setup rerun. The post-M8 replay is **not-executed (harness defect)**; `essay.md`
and `final-report.md` are **absent (harness defect)**.

The post-M8 replay/report asymmetry is **resolved**: both lanes have M8 green
and both were prevented from running the post-M8 replay and writing reports
by the harness. Convex's completed M6 replay remains a real difference in
the retained evidence; no equivalence of total replay evidence is implied.
Revision 4's SB4 record remains historical and unchanged.

## Snapback 4 diagnosis

Both diagnostic segments failed **before app launch**, at fixture validation.
The builder's `scripts/native-seed.mjs` emits `Native queued first <runId>`
and `Native queued second <runId>`. Qualified `driver/evidence.py` requires
`<runId>:first` and `<runId>:second`. Qualified `driver/run.py` calls
`fixture_valid` before `prime_app`, the first app launch. Its exception path
then asks XCTest for a failure tree; taking a snapshot of the never-launched
app produces “Application dev.clique.pilot.snapback4 is not running”.

Evidence under `preparation/round5/diagnosis/` includes both original run
records, XCTest/host logs, install cleanup receipts, the exact seed source,
a crash-report census, simulator process logs and environment probes. The
run records have empty launches/steps, incomplete prime and null native
assertions. Both installed hashes matched the built Release app before and
after the attempt. Simulator logs record successful installs and XCTest
monitoring PID 0 in both segments, with no Clique process rows. Twelve
historical Clique crash reports among 639 reports predate these attempts;
none corresponds to either diagnostic. The driver never reached its
process-log capture stage. The app was uninstalled by recorded cleanup and
is absent now; this is not evidence of an install failure.

The missing `simctl` error occurs during xcodebuild's **failure diagnostic
collection**, after the XCTest snapshot error. A sourced environment finds
the Xcode tool; removing `DEVELOPER_DIR` reproduces exit 72 because the
machine's default developer directory is CommandLineTools. This establishes
an auxiliary diagnostic-environment problem, not the cause of the pre-launch
fixture rejection. The operator wrapper already sources the sealed script;
its successful install/container/uninstall calls also require `simctl`.

**Finding: builder fixture handoff defect, not a product crash at launch.**
There is no fixable harness launch cause that would make a rerun meaningful
without changing builder source or qualified fixture validation. Therefore
the conditional SB4 diagnostic rerun is omitted. Original diagnostics remain
**diagnostic: audit-refused, never admissible, no pass claimed**. The original
source-audit refusal remains its native outcome.

## Qualified instrument finding for Phase 2

Independent validation exits 2 with `schema-invalid:run:launches`. Both
original records have exactly one JSON-schema error: `launches` has
`minItems: 1`, even for legitimately unmeasured pre-launch setup failures.
The validator checks that schema before reaching its unmeasured-result branch.
This is an instrument schema/validator defect. A second triage item is the
unconditional failure snapshot of an app that was never launched, which adds
a misleading XCTest failure and a 35-second bridge wait. See the linked
[Phase-2 ticket](../../../../issues/20261006-native-pilot-unmeasured-launch-schema-and-failure-snapshot.md).
No validator, driver, schema, qualified binary, helper or UI-kit bytes change
in this revision. No native pass or score is inferred.

## Continuation and custody

```sh
./pilot-chain.sh --continue-round5
```

The one-use revision-6 continuation runs **Convex after-builder only**. It
verifies the sealed reclassification, original lane/log/quarantine content
and inode/time inventories, ended prior chains and retained diagnostic
evidence before starting. No termination-time manifest existed; as for SB4,
mtime/ctime must precede the original termination, then captured complete
hashes are rechecked before custody. Chain and authoring/operator locks
prevent co-tenancy. A gating failure remains a finding; no retry is automatic.
The operator stops its interactive turn after confirming this step started.

The reboot interrupted revision-6 preparation after the harness copy, before
reclassification and sealing. The empty interrupted binding output is retained.
Two default DerivedData directories created by the completed SB4 XCTest
diagnostics were identified by creation time and CliqueDriver test metadata,
then atomically retained under `preparation/round5/diagnostic-derived-data/`.
Before/after inventories preserve their identities and content; the exact
pre-existing builder baseline and Xcode preference are restored and verified.
This cleanup does not change the fixture diagnosis or justify a diagnostic rerun.

PACKET.v1–v5 are preserved; revision 6 binds the v5→v6 harness diff,
reclassification and diagnosis. Builder prompts and all authoring inputs
remain byte-for-byte identical. Only eb1000 and the Apartment mini are used.
The commit stays local with the requested Astra coauthor trailer.
