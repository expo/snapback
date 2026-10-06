# Phase 2 — independent-app native pilot

**Both native handoffs are `handoff-refused-by-source-audit`.** Neither
produces an admissible native measurement. The operator-patched runs below
are diagnostics, not repaired builder submissions. Scored admission remains
Charlie's decision. M7 was excluded; native evidence grants no web verdict.

**Recommendation: rerun Phase 2 after the named changes below.** The qualified
driver reached both real apps, but neither completed online priming. Its ability
to measure their offline/restart behavior remains unestablished.

## Packet and custody

Two independent `gpt-6-astra`, medium builders ran serially on the Apartment
mini, Snapback 4 first and Convex second. Both received identical native aids
(7,475 helper bytes), the revised kit and the same native obligations. Pins:
`snapback4`/`snapback4-expo` 0.4.13, `convex` 1.45.0, Expo 57.0.22,
React Native 0.86.3. They did not see NI's reference, driver or each other's app.

The operator uses packet revision 7, seal
`0607c763791eaee6581b05d3214693b84d5cdaa84b4c881073635ac7e914d263`.
Qualified source is `958f7bf4a9cdf8732fc0b74914b2c05b9d90896b`;
native inventory is
`88aeda6949779dfa06b81a6fcf179630184621bca5384e341a584c60e71672f6`.
The driver, validator, schemas, helper, kit and runner were unchanged throughout
the pilot harness corrections. The retained source is bound separately from
the later qualification-record commit `e826ffb681`.

Round 7 uses fresh APFS scratch copies from verified custody, Convex first,
then Snapback 4. Only `scripts/native-seed.mjs` changes: its two body literals
become `input.runId+':first'` and `input.runId+':second'`. Every result retains
the exact diff, before/after hashes and all input/build identities. Preparation
regenerates the builder's project using its own unchanged commands. No hook,
oracle, origin or UI fix was made. The sealed packet and builder trees remain
separate from these copies.

Every round-7 artifact is labelled:

> diagnostic: operator-patched seed body format; audit-refused; never admissible; no pass claimed

Only eb1000 and the Apartment mini were used. The only simulator is
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B`; lanes and segments never co-tenant.
The black M5 and office M1 were not accessed. macOS 27.0.1, Xcode 27.0
(27A266a), iOS 27 simulator and Node 24.18.0 match the recorded operator
environment. The qualified Convex foreground engine is
`precompiled-2026-09-28-5c7cb5b`; the operator owns its process and persistent
store, with no hosted deployment or client-offline substitution.

## Authoring matrix

These are **builder-declared terminal green milestones**, supported by retained
authoring logs, not independent native acceptance. Seconds run from each
supervisor-observed milestone boundary to its terminal log timestamp; small
subsecond offsets are sampling differences. The separate replay clock is
excluded from Convex M6 below. Token columns use sampled phase allocation of
transcript-native **non-cached input plus output**, not scored first-green
settlement attribution. Full timestamps, raw rollout totals and boundaries are
in [authoring-matrix.json](round7/authoring-matrix.json).

| Milestone | Snapback 4 terminal / seconds / tokens | Convex terminal / seconds / tokens |
| --- | --- | --- |
| M1 | green / 477.273 / 133,339 | green / 492.285 / 113,130 |
| M2 | green / 653.432 / 64,230 | green / 997.053 / 99,445 |
| M3 | green / 1,724.810 / 42,523 | green / 386.903 / 44,520 |
| M4 | green / 1,616.838 / 77,527 | green / 490.378 / 44,824 |
| M5 | green / 910.382 / 105,567 | green / 1,491.392 / 144,594 |
| M6 | green / 878.152 / 105,985 | green / 979.733 / 234,813 |
| M8 | green / 590.317 / 61,181 | green / 881.896 / 72,525 |

| Recorded quantity | Snapback 4 | Convex |
| --- | --- | --- |
| Supervisor wall to termination/cleanup | 6,868.288 s | 7,603.413 s |
| Non-cached input | 466,951 | 565,116 |
| Output (includes reasoning) | 123,401 | 188,735 |
| Charged native-token total | **590,352** | **753,851** |
| Cache reads, uncapped | 38,087,936 | 45,056,000 |
| Cache writes | 0 | 0 |
| Reasoning, already included in output | 35,396 | 70,192 |
| Replay | Post-M8 not executed: harness defect | M6 completed 167,157 actions, 1,875.452 supervisor seconds; post-M8 not executed: harness defect |
| Final essay/report | Absent: harness termination | Absent: harness termination |
| Final authoring classification | completed-authoring-harness-defect | completed-authoring-harness-defect |

The initial voided Snapback attempt (135,613 non-cached tokens, 409.184 s)
is retained separately and excluded from these totals. Both completed builders
were killed by replay-admission defects after their M8 terminal. Their original
logs were retained and superseded by bound reclassifications; no omitted work
was synthesized. Four-hour/2M-token milestone safety ceilings were unchanged.

## Admission and source findings

| Check | Snapback 4 | Convex |
| --- | --- | --- |
| Settled native handoff | **handoff-refused-by-source-audit** | **handoff-refused-by-source-audit** |
| Passive hooks | **Refused:** observation persistence gates send; `onSend` awaits `journalChain`, whose failed storage write blocks submission and poisons subsequent journal writes | **Refused:** synchronous observer exceptions can prevent flush or enter mutation-failure cleanup; committed-screen data can retain nonrendered chat/search rows |
| Read-only oracle | **Refused:** ordinary SDK history reads accept delivery manifests and schedule reporting mutations during pagination | Accepted at source: fresh Bob login followed by ordinary paginated reads, duplicate-preserving raw output |
| Other settled audit properties | Bob auth, pagination/order, duplicate preservation, owned backend, Release target/build-only accepted | Same properties accepted |
| Original queued bodies | `Native queued first <runId>` / `Native queued second <runId>` | `First queued message <runId>` / `Second queued message <runId>` |
| Revision-7 static admission | 22/22 with fresh output; old used scratch correctly refused existing DerivedData | 22/22 |

Static checks do not test body semantics or establish hook passivity. Audit
citations include SB4 `src/Chats.tsx:38,54,64`, `scripts/native-oracle.mjs:4–5`
and the SDK's delivery path; Convex `src/outbox.ts:13,15`, `src/Chat.tsx:39`,
`src/Search.tsx:6–9` and `vendor/helper/index.ts:9`. The recorded findings
remain blockers even if raw diagnostic assertions later appear green.

## Diagnostic results and step-5 inspection

Both prepared-source audits again refused the settled blockers. They accepted
regenerated custody-bound build inputs and recorded their findings without
blocking these diagnostics. Fresh static admission passed **22/22 for each**.
Both Release artifacts installed with matching native/Hermes identities. The
operator completed M6 → M8 for Convex, cleaned up, then did M6 → M8 for SB4.
Every seed descriptor now passed the exact-body check; nothing else in either
app was patched.

| Operator clock | Convex | Snapback 4 |
| --- | --- | --- |
| Prepare | 26.017 s | 38.046 s |
| Independent prepared-source audit | 175.173 s | 185.785 s |
| Release build | 111.913 s | 79.854 s |
| M6 driver | 85.061 s | 55.686 s |
| M8 driver | 83.129 s | 55.011 s |
| Recorded operator attempt wall | 643.234 s | 494.461 s |

Attempt wall includes custody/preparation and ends before final archive hashing,
transfer and manual inspection. Operator attention was not metered. The earlier
437.850-second Convex operator-sandbox failure and interrupted pre-prepare SB4
attempt are retained separately; they are not hidden inside successful builds.

| Diagnostic segment | Raw driver observation | Independent validator | Inspected evidence |
| --- | --- | --- | --- |
| Convex M6 | null; `selector-not-hittable`; zero measured steps | exit 2, invalid, null: `schema-invalid:run:launches` | 58/58 frames of XCTest launch video; app opens black then returns home; crash PID 4220 |
| Convex M8 | null; same reason; zero measured steps | exit 2, invalid, null: same schema error | 59/59 frames of XCTest launch video; same visible startup exit; crash PID 5294 |
| SB4 M6 | null; `sign-in`; zero measured steps | exit 0, valid, null: `sign-in` | Failure screenshot and all 87 native-tree nodes: SecureStore entitlement error; auth route only |
| SB4 M8 | null; same reason; zero measured steps | exit 0, valid, null: `sign-in` | Separate failure screenshot and all 87 tree nodes show the same error; auth route only |

**Convex:** both new crash reports and the process log identify UIKit's
`NoSceneLifecycleAdoption` trap. The log explicitly says this SDK requires the
UIScene lifecycle. The built SDK-27.0 app has no scene manifest. The full
retained XCTest videos were decoded without sampling and every frame visually
inspected: M6 transitions black at approximately 3.39 s and returns home at
4.795 s; M8 transitions black at 2.11 s and returns home at 3.462 s. Times are
video presentation timestamps. No sign-in screen or conversation appears.
XCTest's exported selector descriptions contain only the failed email query,
not a live application hierarchy. No native row/receipt/recycling state exists
to inspect. NI's reference explicitly used `reference/scene-plugin.cjs`, which
was excluded from the builder view; SB4's published package documents and its
builder includes its own scene plugin. This is a platform-scaffolding gap, not
evidence comparing backend behavior.

**Snapback 4:** the visible `sm-auth-error` and both full native trees report
`KeyChainException: A required entitlement is not present` from SecureStore
`getValueWithKeyAsync`. The app remains on sign-in after the driver's real form
submission. Each helper journal has only one committed `auth` screen event,
with no `ready`. Read-only `codesign` inspection shows a linker ad-hoc signature,
no bound Info.plist/resources and no entitlements. The unchanged authored
wrapper uses `CODE_SIGNING_ALLOWED=NO`, also suggested by the shared operator
handoff example. This is a build/auth compatibility failure, not proof of bad
credentials or an observer-only false negative. No signing/storage fix was made.

**Full-video limitation:** the qualified protocol starts recording only after
prime. None of these four runs reached that point. Convex's failing XCTest
sessions retained the launch videos above. SB4's XCTest command loops succeeded
while the outer driver returned unmeasured, and both attachment exports were
empty. Therefore no SB4 full video exists to inspect; its two failure frames,
full trees, journals and command logs were inspected instead. This is a retained
instrument-quality gap, not a claim that step-5 video coverage was completed.
Conversation rows, independently accessible receipts and recycled offscreen
rows were never reached in either lane and remain unverified.

The per-assertion comparison below applies separately to the corresponding M6
or M8 run in **each** lane; all 18 assertion receipts are null/skipped. “Matches”
means withholding credit agrees with the available observations, not that the
underlying feature has passed or failed.

| Assertion | Driver judgment versus inspected evidence, per lane |
| --- | --- |
| M6-a01 — cold history/auth restoration | null matches: no authenticated prime, cold launch or history tree |
| M6-a02 — ordinary media pixels | null matches: no image was primed/viewed |
| M6-a03 — offline search destination | null matches: no search screen or destination existed |
| M6-a04 — consumed view-once refusal | null matches: no initial consumption or attempted reopen |
| M6-a05 — pending and final read receipts | null matches: no compose/send or receipt descendants |
| M6-a06 — reconnect/order/duplicate window | null matches: no queued bodies submitted or reconnect/oracle samples |
| M6-a07 — Bob receipt convergence | null matches: no Bob browser or native/server read window |
| M8-a17 — pending writes survive restart | null matches: no pending rows or measured restart |
| M8-a18 — post-restart convergence | null matches: no flush, Bob receipt or authoritative window |

No assertion false pass, false fail, or unmeasured-when-measurable case was
observed. Convex's validator does falsely reject the representation of a
legitimate unmeasured attempt; that is a schema/instrument defect, not a false
functional assertion. The driver also obscures the startup cause with a selector
error, and its launch array conflates OS launch attempts with observed helper
process nonces. SB4 demonstrates the separate, schema-valid unmeasured path.
A successful XCTest command-loop result is never a product pass.

These observations concern the qualified incomplete-prime/`wrong-fixture`
refusal boundary, but do not exercise `placeholder`, `stale-viewonce`,
`collapsed-receipt`, `volatile-outbox`, `duplicate-sends`, `reversed-sends`,
`bob-wrong-conversation` or the receipt/pixel/recycled-row controls. Nothing
suggests that an unchanged qualified control stopped separating, so none was
rerun. Their earlier qualification cannot fill this pilot's absent behavior.
See [inspection.md](round7/inspection.md) and the archive index for the exact
frames, full videos, trees, receipts, signatures and crash/log bindings.

## Harness corrections retained during the pilot

| Defect | Correction and revision |
| --- | --- |
| Token basis counted cache traffic against D7 | **Revision 2**, `ccbeed39d5`: cap normalized non-cached input plus output; retain uncapped cache counts; never add reasoning twice. Initial attempt voided. |
| Child processes outlived supervisors | **Revision 2**, `ccbeed39d5`: PID/start identity and inherited ownership tracking, group/descendant cleanup, TERM then KILL, verified cleanup before custody. |
| Sandbox denied native toolchain resources and nested SwiftPM sandbox | **Revision 3**, `50aa3ef790`: narrow tool/cache access, preserved isolation, temporary recorded/restored Xcode manifest-sandbox preference, quarantined new DerivedData; actual Release probe qualified. |
| Replay guard rejected execution after M8 | **Revision 4**, `537a52185a`: allowed replay during M6 or M8; retained/reclassified completed SB4 authoring. |
| Replay guard then rejected a second interval | **Revision 6**, `de1eb42e09`: any nonoverlapping M6/M8 intervals share one cumulative 14,400-second ceiling; retained/reclassified completed Convex authoring. |
| APFS work copies retained absolute lane-internal links | **Revision 4 correction**, `18822be2dc`: relocate only internal links in scratch; reject external escapes, preserve source/custody and the failed attempt. |
| Build-wrapper rule prescribed arguments beyond the handoff | **Revision 4** admitted SB4's two-argument wrapper; **revision 7**, `0f256b99d5`, admitted Convex's one-argument generic-simulator Release wrapper. Audit actual branches/argv, fresh output, build-only action and resulting arm64 simulator product. |
| Operator source-audit context omitted mandated environment facts | **Revision 5**, `c9a298538c`: sealed environment and fixed overrides supplied to audits. Real passive-hook/oracle findings remained blockers; diagnostics explicitly separated. |
| Diagnostic outer sandbox blocked Expo Swift macro expansion | **Round-7 setup repair:** retained the failed 437.850-second Convex attempt, stopped SB4 before preparation, then repeated from fresh custody using the normal operator build environment and unchanged authored argv. No product or instrument repair. |
| Cleanup compared binary identity to a dictionary with extra platform fields | **Round-7 overlay:** compare the same three binary/bundle fields and retain platform metadata separately; sealed packet unchanged. |

The [revision documents](../../../benchmarks/native/0.4.0-native.1/pilot/README.md)
retain exact diffs, checks and superseded attempts. None of these corrections
permits a product retry until green or upgrades an audit refusal.

## Shared contract and instrument findings

Both independent builders chose the wrong queued-body format. LLP 0201.000 §3
shows `<nonce>:first` / `<nonce>:second`, and the qualified
[`fixture_valid`](../../../benchmarks/native/0.4.0-native.1/driver/evidence.py)
requires exact equality with the run ID. But the supplied
[`CONTRACT.md`](../../../benchmarks/native/0.4.0-native.1/CONTRACT.md) seed/oracle
paragraph does not state that constraint, and
[`fixture.schema.json`](../../../benchmarks/native/0.4.0-native.1/schemas/fixture.schema.json)
only requires two nonempty distinct strings. The builder view deliberately
excludes the driver. Both original fixture descriptors pass the supplied schema unchanged; the
retained [schema reproduction](round7/fixture-schema-gap.json) then fails
`fixture_valid` with `fixture-compose-nonce` for each. The hidden semantic
check is therefore an instrument
authoring-contract gap, even though the emitted descriptors violate it.

Both builders also coupled observation work to product behavior. The contract
requires rendered/viewable rows; LLP 0201.000 §3 explicitly prohibits changing
retry, persistence or mutations. Nevertheless,
[`helper/index.ts`](../../../benchmarks/native/0.4.0-native.1/helper/index.ts)
exposes synchronous `configuration`, `hash` and `append` calls that can throw,
and `useCommittedScreen` accepts a caller-built array without reconciling a
virtualized list's currently rendered items. These APIs make compliant wiring
depend on extra caller isolation and careful row selection. They do not grant
permission for the defective hooks; the two independent mistakes are evidence
that the easy integration path fails to enforce the intended constraint.

The earlier unpatched SB4 diagnostic stopped at `fixture-compose-nonce` before
any launch. Its empty launch array is truthful, yet independent validation
exits 2 at unconditional `launches.minItems: 1`, before the unmeasured branch.
The driver's attempted failure screenshot then asks XCTest to inspect an app
that has never run, producing “Application … is not running.” This is not an
app crash. Xcode's subsequent diagnostics lose `simctl`; the sourced operator
environment resolves it, while removing `DEVELOPER_DIR` reproduces exit 72
because the machine default is CommandLineTools. The secondary diagnostic
environment must be fixed without obscuring the original failure. The
[existing instrument ticket](../../../issues/20261006-native-pilot-unmeasured-launch-schema-and-failure-snapshot.md)
retains the exact prelaunch records and reproduction.

## Recommendation to Charlie

**Rerun Phase 2 after these changes; do not admit this candidate to scored use.**
The pilot established that the driver reaches independently built apps and
withholds credit when priming fails. It did not establish correct positive or
negative offline/restart judgments against either app.

1. Make the queued-body format explicit in the shared contract and provide a
   descriptor constructor/semantic validation at handoff, including equality
   with the current run ID. Reuse both actual rejected fixtures as regressions.
2. Make observation APIs nonthrowing, with sticky diagnostic failure reporting
   isolated from application behavior. Provide a committed/rendered-row adapter
   that drops removed/recycled items and handles empty search consistently.
   Qualify journal failure/overflow and recycling cases. Clarify and demonstrate
   an ordinary Bob oracle transport that cannot emit delivery mutations.
3. Qualify the shared **runtime** baseline before authoring: a disclosed
   backend-neutral scene-lifecycle recipe for the pinned Expo/SDK combination,
   and a Release signing/entitlement path that supports SecureStore. Correct the
   unsigned build example. A compile-only scratch probe is insufficient; run a
   minimal sign-in/storage lifecycle on the dedicated simulator. Retain the
   normal operator build environment that avoids nested sandbox failures.
4. Fix the unmeasured-run schema, distinguish attempted OS launches from helper
   nonces, capture startup errors by actual app state, retain video from launch
   through failed prime, and make Xcode diagnostics resolve the pinned tools.
   Test both genuine pre-launch failures and the two observed post-launch paths.
5. Cut and disclose new candidate aid/instrument bytes, requalify affected
   controls, then run fresh independent builders and both native milestones.
   Repeat full frame/video/tree/recycled-row/receipt inspection before asking
   for scored admission and any operator-budget/version ruling. Do not retrofit
   these retained submissions into an admissible comparison.

Follow-ups: [seed contract and passive helper](../../../issues/20261006-native-pilot-seed-contract-and-passive-helper.md),
[startup/runtime evidence](../../../issues/20261006-native-pilot-expo-launch-and-startup-evidence.md),
and [unmeasured schema/snapshot](../../../issues/20261006-native-pilot-unmeasured-launch-schema-and-failure-snapshot.md).
These are recommendations; no helper, oracle, signing, scene, driver or schema
repair was applied to either diagnostic app.

## Evidence and verification

Large evidence is retained on **eb1000** at
`~/sb5-evidence-archive/20261006-p2/round7/`. The committed
[archive index](round7/ARCHIVE-INDEX.json) and hashed JSONL shards bind all archived
files, including prior rounds, exact executed operator overlays, complete logs,
custody/dependency manifests, XCTest results/videos and both built Release apps.
Compact per-attempt summaries, prepared audits and exact seed diffs/hashes are
also committed under [round7](round7/). Scratch copies and original custody remain
on the mini; they were not used as replacement builder submissions.

[Closeout](round7/closeout.json) verifies both builder lanes and custody against
the original manifests, unchanged sealed packet/qualified runner, free assigned
ports, released operator/simulator leases, removed diagnostic installations and
the restored original Xcode preference. The report's scripts parse, evidence
indexes/hashes and local links are checked, and the affected reference audit
passes. No engine or qualified instrument source changed; no broad product
suite or negative-control rerun is claimed.
