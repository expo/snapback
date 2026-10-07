# NI2: native.2 instrument requalification

Status: Round-2 repairs are implemented and affected qualification is complete.
The fresh Round-2 Phase-2 packet is sealed and dry-run ready. No rerun has been
launched, no push was made, and `scoredUse` remains `false`. Native.1 is byte-frozen.
The previous qualification and packet records below remain historical.

The new instrument is [`benchmarks/native/0.4.0-native.2`](../../../benchmarks/native/0.4.0-native.2/README.md).
It implements the four changes accepted after the
[Phase-2 findings](../20261005-ni-native-protocol/PHASE-2-RESULTS.md).
The retained independent applications remain diagnostic regressions; they are
not repaired or admitted as submissions.

1. The contract states the exact `<runId>:first` / `<runId>:second` bodies.
   A shared descriptor constructor and semantic validator run at handoff,
   before custody compilation or simulator work. The two actual rejected
   builder formats and another valid run ID are negative fixtures.
2. Observation calls return immediately and cannot throw journal failures
   into product code. Sticky diagnostics remain visible to the driver. The
   list wrapper reconciles committed data and visible keys; M6 independently
   compares them with native hittable rows. The ordinary Bob oracle uses a
   separate authenticated read transport with no delivery mutation path.
3. Both builders receive the same Expo 57.0.22 / RN 0.86.3 / iOS SDK 27 scene
   recipe and app-target simulator signing recipe. Packet readiness requires
   an executed Release SecureStore write/read/terminate/relaunch/restore
   proof, anchored to the retained native and Hermes bytes, source inventory,
   helper events, UI trees, process transition and decoded video.
4. Null prelaunch/unavailable records have a legitimate schema. Attempted OS
   launches and helper process nonces are separate. Failure capture checks
   actual app state and retains launch-through-prime video; XCTest diagnostics
   receive the pinned Xcode tool environment.

All device work is restricted to Apartment mini `100.64.36.16` and simulator
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B`. The durable runner lives at
`/Users/ccheever/native-runner-0.4.0-native.2-round2/`. Round-2 evidence is archived
on eb1000 under `/home/ccheever/sb5-evidence-archive/20261006-ni2/round2/`.

The fresh packet is `/Users/ccheever/clique-native-pilot2-20261006-round2/`.
It keeps the same builders, pins and caps and stops at sealed dry-run readiness.

The pilot port includes revisions 2–7 and the Round-7 overlays: non-cached token
accounting; owned descendant cleanup; native toolchain sandbox access and
restored Xcode preferences; shared cumulative M6/M8 replay budget; confined
APFS link relocation; the authored build-wrapper argv and resulting simulator
product checks; sealed source-audit environment; normal operator build
environment for Swift macros; and comparison of like-for-like binary identity
fields. Historical continuation receipts and attempts are not imported into the
fresh packet.

The qualified signing path uses Xcode's simulator build with
`CODE_SIGNING_ALLOWED=YES`, identity `-`, no development team, and the keychain
entitlement file applied to application targets only. The simulator carries
these entitlements in the Mach-O `__TEXT,__entitlements` section; the empty
`codesign -d` entitlement dictionary alone is not the simulator's effective
entitlement result. The executed proof independently parses that section and
performs the SecureStore lifecycle. Global entitlement flags on Pod targets and
a separate post-build re-sign were unsuccessful experiments; their logs are
retained, and neither is the distributed recipe.

## Previous qualification ledger

| Requalification scope | Source | Verdict |
| --- | --- | --- |
| Carried live reference/control cells | `ca4a9e11b8` | 25/25 match expected native.2 outcomes; 24 native.1 verdicts unchanged, one deliberate tightening below |
| New journal failure, overflow and recycling controls | `ca4a9e11b8` | 3/3 control checks pass |
| Inherited artifact controls | `ca4a9e11b8` | 52/52 match: M6 45 negative + 2 positive, M8 5 negative |
| Final known-good reference | `090929f7e7` | M6 passes; M8 repeat passes; first M8 remains unmeasured |
| Final carried null controls | `090929f7e7` | 3/3 retain expected null outcomes: stale restart capture, undecodable video, wrong fixture |
| Unchanged independent Convex app, M6/M8 | `090929f7e7` | 2/2 regression checks pass; application verdicts remain setup-null, `app-exited-during-startup` |
| Unchanged independent Snapback 4 app, M6/M8 | `090929f7e7` | 2/2 regression checks pass; application verdicts remain setup-null, `sign-in` (SecureStore entitlement error) |
| Unavailable simulator | `090929f7e7` | Expected unmeasured `unavailable-simulator`; no OS launch or helper nonce |
| Executed Release runtime baseline | `090929f7e7` | 8/8 lifecycle checks pass; 840 decoded frames / 45.62 seconds |
| Final Python suite | `090929f7e7` | 87/87 pass |
| Fresh packet readiness | packet cut at `28905325f0` | 69/69 macOS harness selftests, no skips; retained cold/readiness receipt passes |

These are retained qualification outcomes, not executions repeated during crash
recovery. A passing regression/control check does not turn a null application
verdict into a benchmark pass.

The base requalification is bound to source
`ca4a9e11b8eb51ce1ba85abdeb1e52a99f9a71b5`, inventory
`22fa7e8f7151b5a322a6e8b24356405d23ff9b7ef15c4fcf6774ed2606959455`.
All 25 carried-over live cells and three new passive controls matched their
expected outcomes; all 52 inherited artifact controls also matched.
[Live results](LIVE-CONTROLS.json) and [artifact results](ARTIFACT-CONTROLS.json)
retain individual verdicts. The passive-control `pass` fields mean the control
proved isolation/rejection, not that a benchmark assertion passed with a broken
journal.

The sole deliberate change to a carried-over live verdict is
`scroll-no-screen`: native.1 accepted it; native.2 rejects it with
`screen-row-detached`. Exact committed/native row parity catches the deliberately
suppressed post-scroll observation. All other carried-over verdicts match.

The retained Convex regression then exposed a diagnostic-video edge case:
`simctl` retained launch-through-crash recording, but its static SpringBoard tail
had no terminal encoded sample. The independent validator rejected that null
record. Final source `090929f7e75d68fef01f61f35696e1f3f56e85d2`, inventory
`0b94d74234df1e8c60caf61da6d9db85eecea547b0ee0fcf90eaecc7912358f3`, allows
this only in the setup/instrument-null branch. It still checks container and
edit-table structure, H.264 decoding, sample count, duration and evidence hashes.
Measured and application-verdict paths keep strict endpoint coverage. A new
three-way regression accepts the diagnostic null, rejects the same measured
video and rejects a truncated null capture. The collection driver, native runner,
helper, reference application and measured assertions did not change.

The final source passes all 87 Python tests. The complete base matrix is retained
under its original pin; final affected runs exercise the known-good M6/M8 pair,
the three inherited null controls, both real independent apps in both segments,
and an unavailable simulator. Historical records are not relabeled with a newer
source identity. A fresh SecureStore proof binds all final driver source bytes:
[executed runtime baseline](RUNTIME-BASELINE.json), eight checks, 840 decoded
frames over 45.62 seconds, two process nonces, successful write/read and restored
principal after termination/relaunch.

Additional verification: six Node helper tests, two public TypeScript API tests,
four backend/oracle tests, actual Swift journal tests on the mini, UI typecheck
and focused UI contract tests. The inherited full browser test has the same
incorrect relative fixture path in both native.1 and native.2 and did not pass;
its failure is retained in `ui-tests.log`. This is not represented as a passing
browser suite. The final packet's macOS harness selftest and readiness receipts
are recorded separately.

Both model families approved the source fixes; see [review dispositions](REVIEWS.md).
Earlier failed experiments and orchestration attempts remain in the archive:
Pod-wide entitlements, post-build re-signing, intermediate runtime proofs,
missing Python dependencies caused by resolving a venv symlink, and the
pre-fix static-tail validator rejection. They are not qualification passes.

The [independent-app regression ledger](INDEPENDENT-REGRESSIONS.json) records all
four actual executions as valid, unmeasured setup outcomes. Convex M6/M8 preserve
`app-exited-during-startup`, one attempted OS launch, zero helper process nonces,
the UIScene crash report and startup video, with no failure snapshot of the
stopped app. SB4 M6/M8 preserve `sign-in`, foreground app state, startup video
and a failure tree/image showing the SecureStore missing-entitlement error.
The unavailable-simulator control has no OS attempt, no helper nonce and no
startup video. Both retained application trees and their native/Hermes identities
are unchanged.

One final-source M8 reference attempt became unmeasured under the prior rule
with `artifact-validation:video-endpoint-uncovered`: its terminal encoded sample
is present, but the movie end is 3/600 seconds (5 ms) beyond its end. Its startup
video remained valid. This attempt is retained under `qualification-0909/` and
is not counted as a passing reference. The operator repeated M8 with identical
source and settings; no decoder threshold or measured-video requirement changed.

The unmeasured capture is retained at archive-relative path
`qualification-0909/reference-runs/none-m8-20261006-012520/`; the passing repeat
is `qualification-0909-repeat/reference-runs/none-m8-20261006-012828/`.

Final [affected-control results](FINAL-AFFECTED-CONTROLS.json) confirm the
known-good M6/M8 pair and all three carried null controls. The final M8 repeat
passed; the earlier endpoint-check rejection remains unmeasured and retained.

## Previous packet readiness

[`PACKET-READINESS.json`](PACKET-READINESS.json) binds the fresh packet at
`/Users/ccheever/clique-native-pilot2-20261006/`: 633 sealed files, seal digest
`bdcdc5ead202ec15b4282164fe2eda78450a2882dc473fccbaacb4fe2dbd04e0`.
All 69 macOS harness selftests passed, with no skips. Runtime-proof import,
Convex ownership preflight, the expected unmeasured no-app preflight and
`verify.py --cold --ready` passed. Both lanes contain only their instrument
links; attempts and results are empty. No historical continuation state was
imported and no builder or pilot was launched.

The two builders remain GPT-6 Astra at medium, with four hours and two million
non-cached tokens per milestone, uncapped cache reads/writes, the shared
four-hour replay budget, one setup rerun and zero product retries. Version pins
are unchanged. `scoredUse` stays false pending the fresh Phase-2 rerun and owner
review. This packet does not grant scored admission.

Historical start command for the previous packet (superseded by the Round-2
packet below; never executed during NI2 preparation or crash recovery):

```sh
ssh ccheever@100.64.36.16 'cd /Users/ccheever/clique-native-pilot2-20261006 && ./pilot-chain.sh'
```

The wrapper sources the pinned environment and runs the serial Snapback 4 →
Convex chain under `caffeinate`. This is a fresh start with no continuation flags.

## Archive closeout after the eb1000 crash

The archive transfer is complete at
`/home/ccheever/sb5-evidence-archive/20261006-ni2/`.
[`INDEX-RECEIPT.json`](INDEX-RECEIPT.json) binds the full external
`EVIDENCE-INDEX.json`: 9,921 files / 2,200,649,648 bytes, SHA-256
`c06590d21a762a6f66fc8eb3451d6783cd8f1c0e5d336460dc225f03761ddfe2`.
Every indexed file was independently rehashed with zero missing or mismatched
files. [`LARGE-FILES.json`](LARGE-FILES.json) commits the individual hashes for
all 255 evidence files over 1 MiB; the large evidence remains outside git.
The index declares its dependency/source-cache exclusions.

Recovery found 3,820 of 3,821 remote archive files already present and matching.
Only `fresh-phase2-packet.tgz` was partial (39,321,600 of 76,362,383 bytes).
Its resumed transfer matches the mini's pre-existing SHA-256:
`7807caf9780c24ac8035e8e24e936b879b725eacd115ceea81c86c3e7368eb62`.
All 3,821 remote archive files now match local copies; their original-to-local
path mapping is retained in `closeout/remote-archive-local-map.json`.
The full archive index was finalized at closeout, after these source comparisons.

Read-only checks on the mini verified all 633 sealed packet files and 86
prelaunch evidence files, the empty attempts/results and cold builder lanes,
and the durable runner. The transferred packet independently matches those same
719 indexed entries. All 1,645 runner product files in the retained final
tarball match the mini; runner binary SHA-256 is
`47618499c3d75dadc2bc7543144e1f604163ee3c15dcf3af1c4f80e9d9c29b67`,
and XCTest configuration SHA-256 is
`4bda6ffd507f7543304b8c40d126a4d00e0f9389302e00ef1b1e294331147e5f`.
All 140 captured native.1 tracked hashes still match. The checks and transfer
receipts are retained under archive `closeout/`.

No qualification was repeated, no rerun was launched, and no push was made.
The source and historical verdict pins above remain unchanged. Closeout changed
only documentation and custody records. `ref-check --verbose` passed with zero
errors (528 LLP documents / 10,435 references).

## Round 2

The supplied Astra and Grok findings are implemented. Affected qualification is
complete against source `8db637eb5929c7b58f76b34664256cd2bd3c9b3d`, inventory
`7502936bea8367523b0f2ede4b6a0a49045cf75595c3129a6f2f9e40237a7659` (164 files).
`INSTRUMENT_COMMIT` and `QUALIFIED.json` identify this source. Application
observation calls remain non-awaitable; driver termination requires a bounded
native-writer acknowledgment. Missing acknowledgments make provisional results
unmeasured. Every measured or application-verdict packet requires the terminal
acknowledgment; a stopped-process claim never excuses a missing acknowledgment.

The wrapper uses a stable separate zero-threshold observer callback pair and
composes application pairs without supplying both FlatList APIs. Inverted lists
project observations in native visual order. JS and Swift reserve event/byte
capacity before enqueueing, latch overflow, and refuse later observation work.
The stalled-writer schedule and both rendered/native parity directions are
permanent tests. Mounted tests exercise React lifecycle and the pinned RN 0.86.3
FlatList prop invariant. Mutation checks fail when `setRenderedKeys` is deleted
or the empty-search `data: []` behavior is removed. Admission rejects the two
unsigned Round-6 wrappers before execution, and its selftest runs the real
handoff validator on both gap fixtures and a foreign run ID before build stages.

The final immutable Python suite passes **114/114**. The executed runtime
baseline passes **8/8** lifecycle checks with both writer acknowledgments,
837 decoded frames over 43.065 seconds, and mandatory endpoint coverage.
Proof SHA-256: `d67f694c38d104831ad94ea55af1d81843e048b83d30d1ee21e15342079ff54d`.
Both blind final-source reviews are READY. The early view-once control now
records the foreground app and retains its failure screenshot after resolving
the current container at census time; XCTest relocates its test host on first
launch. The completed ledger and fresh packet receipts follow below.
The new mini runner is `/Users/ccheever/native-runner-0.4.0-native.2-round2/`;
the new packet target is `/Users/ccheever/clique-native-pilot2-20261006-round2/`.
All Round-2 evidence belongs under
`/home/ccheever/sb5-evidence-archive/20261006-ni2/round2/`.

The retained first M8 movie was revalidated without rerunning the app: all
1,336 frames decode and the corrected mandatory endpoint check passes. Its
terminal sample exists; the movie end exceeds the last sample end by 5 ms,
less than one terminal frame. The endpoint verdict is now **covered**.
The capture predates writer-flush acknowledgments and cannot be promoted to a
measured Round-2 pass; its original null receipts and source identity remain
unchanged. See [the retained-capture revalidation](ROUND2-RETAINED-M8.json).
The only endpoint tolerance change is this strictly sub-frame end allowance;
the start must still land inside a sample, and every measured pass uses
`require_endpoints=True`. `decodedEndpoints` comes only from that check.


### Round-2 qualification ledger

| Scope | Result |
| --- | --- |
| Known-good M6/M8 and all affected live controls | 30/30 expected outcomes matched: 25 carried cases, four passive fault/recycling controls, and additional inverted M8 |
| Exported artifact controls | 52/52 matched: M6 45 negative + two positive; M8 five negative |
| Final Python suite | 114/114 passed; helper pure 7/7; mounted 5/5 with 36 assertions; Swift journal tests passed |
| Mounted-test mutation checks | Deleting rendered-key updates or the empty-search data wipe fails the mounted tests |
| Runtime baseline | 8/8 lifecycle checks; 837 decoded frames / 43.065 seconds; exact final proof inputs verified |
| Retained Convex application | M6/M8 regression checks passed; both application verdicts remain setup-null, `app-exited-during-startup` |
| Retained Snapback 4 application | M6/M8 regression checks passed; both application verdicts remain setup-null, `sign-in`, with foreground SecureStore entitlement failure |
| Unavailable simulator | Expected unmeasured outcome; no OS launch or helper process nonce |
| Blind final-source reviews | Codex 5.6-sol and Grok 4.6: READY |
| Fresh packet | 72/72 macOS harness selftests, no skips; cold/readiness verification passed |

[Live controls](ROUND2-LIVE-CONTROLS.json),
[artifact controls](ROUND2-ARTIFACT-CONTROLS.json),
[independent-app regressions](ROUND2-INDEPENDENT-REGRESSIONS.json),
[runtime baseline](ROUND2-RUNTIME-BASELINE.json), and
[reviews](ROUND2-REVIEWS.json) retain the individual results and identities.
Passing a passive-control or startup regression check does not turn its
unmeasured application into a benchmark pass. Neither independent app was
repaired; both retained app trees and native/Hermes identities are unchanged.

The measurement driver, helper, native module, reference app, validator and
runtime inputs measured at `9ac890d3006f88f6fbe61b7e8214eece54bd68a2`
are byte-identical in the final freeze. The passive-control changes afterward
were confined to
`reference/passive-controls.py` and `tests/test_round6.py`. Two live fault
controls exposed
stale harness expectations: an unwritable journal correctly refuses the drain
with `native-writer-flush-ack-unpersisted`; the deliberately saturated journal
cannot record its restarted nonce and refuses with
`native-writer-flush-process-mismatch`. The repaired controls independently
prove the fault marker, require the exact refusal, and then prove the sticky
collection diagnostic and product persistence. Both were rerun and passed on
`f1495908ba0c2c41255ba3a907e211ea80ae49ce`. Healthy drain checks and all
production thresholds are unchanged. Earlier 28 successful live cells and 52 artifact controls retain
their original source identity; the qualification record carries them forward
only after verifying the production inputs. The final source also repairs
fixture and validator path resolution in `pilot/scripts/selftest.py`; its
assembled-layout regression runs the actual handoff validator with both gap
fixtures and a foreign run ID and fails under the old path. The final packet
also binds all three launch wrappers and the documented selftest to the pinned
Python runtime, with an actual wrapper regression against a hostile PATH. The
final packet runs the full macOS suite for these pilot changes. The runtime
proof's complete input map matches the final source exactly, so its executed proof is retained.

The first unsealed packet selftest failed because it used repository-relative
fixture paths; its full packet and failed log are retained as
`first-packet-attempt.tgz` and `prepare-first-packet.log`. A second preparation
then exposed missing `jsonschema` under system Python; its evidence remains in
`second-packet-attempt.tgz` and `prepare-second-packet.log`, with explicit
references to already-archived identical runtime/backend bytes. The launch
wrappers now use the prepared pinned Python. Neither failed packet was sealed
or launched. A third preparation exposed the macOS temporary-path alias in
the nested regression; `third-packet-attempt.tgz` and its log retain that
failure. Canonicalizing the synthetic root fixed it, and the actual mini smoke
then passed before the final cut. [All three attempts](ROUND2-PACKET-ATTEMPTS.json)
remain separate from the sealed result.
The initial failed fault-control attempts, prior integration attempts, a Python
invocation without the required venv, and two incomplete review invocations
remain in the archive; none is represented as a qualification pass.
The root inventory command still reports inherited, out-of-scope inventory and
generated-guide drift (`inventories.log`); those paths were not changed here.
Affected checks pass, `ref-check --verbose` reports zero errors, the final
164-file freeze validates, and all 140 native.1 tracked hashes still match.

### Round-2 packet and archive closeout

[Packet readiness](ROUND2-PACKET-READINESS.json) binds
`/Users/ccheever/clique-native-pilot2-20261006-round2` on the mini: **636 sealed files**,
seal SHA-256 `49d5c69fe131256b34da9dcd07bff065359adc05b17cd7c30ec301b2dfef9e45`.
Runtime-proof import, Convex ownership preflight, the expected unmeasured
no-app preflight, all macOS selftests and `verify.py --cold --ready` passed.
Both builder lanes contain only their instrument links; attempts/results are
empty. Builders, version pins, caps and symmetric aids are preserved.
No historical continuation state was imported and no builder or pilot launched.

The transferred packet independently matches all 716 sealed/prelaunch
entries. Its archive SHA-256 is `f8aa10d28b0061cb30e12365722caa3a2cedc2aa8a360942a66af9978aac0abd`.
The [archive index receipt](ROUND2-INDEX-RECEIPT.json) binds **16,746 files /
3,205,760,351 bytes**, independently rehashed with zero missing or mismatched
files. The [large-file ledger](ROUND2-LARGE-FILES.json) records all
346 evidence files over 1,000,000 bytes under
`/home/ccheever/sb5-evidence-archive/20261006-ni2/round2/`.
All 4,002 remote archive files match their eb1000 copies.
No push was made. The Phase-2 rerun and scored admission remain pending.
