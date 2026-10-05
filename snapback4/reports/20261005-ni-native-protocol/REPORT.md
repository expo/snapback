# NI — accepted native protocol, Phase 1

**Current qualification — Round 4:** source `958f7bf4a9cdf8732fc0b74914b2c05b9d90896b`;
inventory `88aeda6949779dfa06b81a6fcf179630184621bca5384e341a584c60e71672f6` (**86 files**).
`QUALIFIED.json` and `INSTRUMENT_COMMIT` agree. This round qualifies the
Python instrument changes through regressions, diagnostic artifact controls
and archive verdict continuity; the unchanged native runner and reference app
retain their Round-3 live qualification. See [Round 4](#round-4--sticky-disclosure-scaled-pixels-and-report-freshness).
Earlier qualification matrices below retain their historical source pins.

Phase 1 is implemented and qualified on the Apartment mini. The conforming
reference passed all eight M6 steps (seven assertions) and the separate M8
termination/relaunch sequence (two assertions). Every requested negative control
was rejected for its intended behavior or invalid evidence. Bad fixtures and an
unavailable host remain unmeasured. **No calibration ran and no score was produced.**
The independent Snapback 4/Convex pilot is [planned, not run](./PHASE-2.md);
scored use remains disabled pending that pilot and the owner's admission ruling.

The subject is a small, newly built Expo/Node reference, an allowed alternative
to adapting `snapback4/apps/chat-expo`. It uses the revised kit, real normal
email/password sign-in, SQLite history/cache/outbox, actual HTTP requests and a
persistent server, native images, FlatList offscreen rows, and a real browser Bob.
This isolates instrument faults and permits explicit negative variants without
attributing a result to either backend that Phase 2 must still test. It is a
diagnostic protocol reference, not a complete Clique implementation or a Snapback
4/Convex capability claim. The generic driver and helper have no reference-fault
or backend-specific success branch. The reference's fault switches are source-auditable.

## Initial qualification: instrument and custody (historical)

- Instrument: `social-messenger@0.4.0-native.1`; protocol `clique-native/1`.
- Qualified source commit: `99a9b2c9ba7d1b7c2cb02fdc7fd587404f64538a`.
- Inventory SHA-256: `5cba78fe9313ce300c9f72fa5b8a51b373d50f5ba723ecad21e67263ee0e9b44` (69 files).
- Native binary: `44ffc0742c50bc9c9440a8e8e1dee86f16023b2b344c934c9473b47dff3117d9`.
- Hermes bytecode: `7cf13415eac9fdfd4d78eddd50a9b34a64f60a7250659b6b741403eba6d34f48`.
- Host: Apartment mini, SSH `ccheever@100.64.36.16`; Xcode 27.0 (27A266a),
  iOS 27; only simulator `3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B`.
- Toolchain: Node 24.18.0, Expo 57.0.22, React Native 0.86.3, React 19.2.3,
  Playwright 1.62.1; Python/Pillow/jsonschema and dependency lock hashes are in
  the [source audit](./evidence/mini/source-audit.json). Forty-two copied build
  inputs match their frozen sources. Source/native/helper custody is checked,
  not inferred from a successful export.

The [new component](../../../benchmarks/native/0.4.0-native.1/README.md) freezes
the accessibility/fixture contracts, revised kit and passive Expo helper,
generic external XCTest/macOS driver, schemas, artifact validator, builder
prompt delta and O4 applicability/grader policy. The helper's five source/config
files total 6,122 bytes of symmetric supplied aid; integration and oracle mapping
remain charged builder work in Phase 2. The driver uses exact kit IDs
and opaque row values, real taps/typing, owned backend stop/restart, repeated
negative origin probes, actual pixels, fresh Bob server reads and a five-second
duplicate observation window. M6 and M8 preserve installation, native/Hermes
identity and backend store identity across their measured phases.

The manifest and [RFC](../../../llp/0201.000-cross-lane-native-app-protocol.rfc.md)
declare the 0.3.8-m8 → 0.4.0-native.1 series break. Existing calibration packets,
the current manifest, old kit, prompt, choreography and protocol are unchanged.
The packet materializer carries the historical web component separately with
its original receipt version. The old manifest's source tree had later
self-contained harness edits without refreshed hashes; the new materializer
recovers the exact old manifest commit rather than modifying those old hashes.
Native operator config uses the native component's `INSTRUMENT_COMMIT` and
inventory. A materialized packet's top-level commit records its assembly HEAD;
its separate native and historical web components retain their own source pins.

Native results stay supplemental, `requiredForGreen:false`. Invalid or absent
native evidence yields null O4 applicability, never a manufactured low score or
a renormalized comparable total. M7 and M8 web convergence remain separate.

## Initial qualification matrix (historical)

All rows below use the qualified source/inventory above. `Run wall` is the
measured outer command from pre-run uninstall through driver execution and
post-run uninstall; `Driver wall` includes installation, prime, measurement,
validation and process cleanup. Each live run has two operator steps: invoke
the named command and review retained evidence. `Native commands` counts bridge
requests, not individual keystrokes; two cleanup bridge commands are additional.
`Entered steps` includes a failing step and is not a completed-step claim.

| Subject | Result | Exact reason | Run wall (s) | Driver wall (s) | Native commands | Entered steps |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| [Collapsed receipt accessibility (M6)](./evidence/mini/runs/collapsed-receipt-m6-235204/evidence/status.json) | REJECTED — product failure | `receipt-accessibility:pending` | 77.967 | 77.663 | 64 | 6 |
| [Known-good (M6)](./evidence/mini/runs/none-m6-235322/evidence/status.json) | PASS | `all assertions passed` | 91.674 | 91.011 | 43 | 8 |
| [Known-good (M8)](./evidence/mini/runs/none-m8-235453/evidence/status.json) | PASS | `all assertions passed` | 94.544 | 94.098 | 53 | 5 |
| [Placeholder + false load event (M6)](./evidence/mini/runs/placeholder-m6-235628/evidence/status.json) | REJECTED — product failure | `placeholder-or-wrong-media-pixels` | 43.207 | 42.888 | 29 | 3 |
| [Outbox erased on termination (M8)](./evidence/mini/runs/volatile-outbox-m8-235711/evidence/status.json) | REJECTED — product failure | `fixture-row-not-found:local-muuweoxe-amwotbn99k` | 98.216 | 97.902 | 69 | 3 |
| [Duplicate server sends (M6)](./evidence/mini/runs/duplicate-sends-m6-235850/evidence/status.json) | REJECTED — product failure | `server-occurrence-count:2` | 144.824 | 144.528 | 43 | 7 |
| [Reversed server sends (M6)](./evidence/mini/runs/reversed-sends-m6-000114/evidence/status.json) | REJECTED — product failure | `server-send-order` | 144.859 | 144.553 | 43 | 7 |
| [Stale view-once pixels + denied event (M6)](./evidence/mini/runs/stale-viewonce-m6-000339/evidence/status.json) | REJECTED — product failure | `stale-viewonce-pixels` | 46.562 | 46.272 | 34 | 4 |
| [Wrong fixture IDs (M6)](./evidence/mini/runs/wrong-fixture-m6-000426/evidence/status.json) | REJECTED — setup unmeasured | `fixture-row-not-found:5076b9b6-6a2c-4d24-b0b7-c372e2cb7664` | 49.023 | 48.707 | 48 | 0 |
| [Bob in wrong conversation (M6)](./evidence/mini/runs/bob-wrong-conversation-m6-000515/evidence/status.json) | REJECTED — product failure | `bob-wrong-conversation-or-principal` | 91.967 | 91.674 | 43 | 7 |

Wrong fixture IDs are rejected during online priming: no native assertion has
been measured and no measured video exists. Its status is null and all native
assertions remain skipped. This fulfills fixture rejection without inventing an
application failure. Every live behavioral failure has a retained native failure
tree/screenshot and a normally completed XCTest command loop; none qualifies by
crashing the app. The [raw control observations](./evidence/control-observations.json)
show the false load plus pixel mismatch; two pending IDs disappearing after
termination; duplicate raw rows; reversed authoritative order keys; denial plus
stale image pixels; one identified body with zero accessible receipt children;
the mismatched fixture identity; and Bob's actual wrong conversation.

| Artifact/transport control | Result | Exact reason | Wall (s) | Operator invocations |
| --- | --- | --- | ---: | ---: |
| stale-nonce | rejected; native null | `stale-or-unsupported-observation` | 0.072 | 1 |
| replayed-events | rejected; native null | `observation-sequence-gap-or-replay` | 0.027 | 1 |
| missing-video | rejected; native null | `evidence-missing:m6-ios-screen.mp4` | 0.016 | 1 |
| hash-mismatched-video | rejected; native null | `evidence-hash-mismatch:m6-ios-screen.mp4` | 0.015 | 1 |
| truncated-video-rebound | rejected; native null | `truncated-video-box` | 0.016 | 1 |
| unavailable SSH host | unmeasured; exit 0 | `unavailable-host:ssh` | 0.006 | 1 |

Artifact controls start from the actual final known-good M6 directory. Event
mutations rebind the event hash, exercising nonce/sequence validation. The extra
truncated-video control also rebinds the video hash, exercising container
validation beyond hash mismatch. The unavailable-host test uses refused loopback
SSH, not another fleet machine. These invalid-evidence controls reject the
artifact; they do not issue product failures. Their compact retained directories
contain the changed manifest/events and `SOURCE.json`; reconstruct other bytes
from the named known-good directory, applying the documented mutation in
`reference/artifact-controls.py`.

Verbatim final live-run output (status JSON and original scratch paths):

```text
{"id": "ios-simulator-m6", "pass": false, "receipt": "m6-ios-run.json", "reason": "receipt-accessibility:pending", "requiredForGreen": false, "cost": {"wallSeconds": 77.663, "nativeCommands": 64, "enteredSteps": 6, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/collapsed-receipt-m6-235204
{"id": "ios-simulator-m6", "pass": true, "receipt": "m6-ios-run.json", "reason": null, "requiredForGreen": false, "cost": {"wallSeconds": 91.011, "nativeCommands": 43, "enteredSteps": 8, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/none-m6-235322
{"id": "ios-simulator-m8", "pass": true, "receipt": "m8-ios-run.json", "reason": null, "requiredForGreen": false, "cost": {"wallSeconds": 94.098, "nativeCommands": 53, "enteredSteps": 5, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/none-m8-235453
{"id": "ios-simulator-m6", "pass": false, "receipt": "m6-ios-run.json", "reason": "placeholder-or-wrong-media-pixels", "requiredForGreen": false, "cost": {"wallSeconds": 42.888, "nativeCommands": 29, "enteredSteps": 3, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/placeholder-m6-235628
{"id": "ios-simulator-m8", "pass": false, "receipt": "m8-ios-run.json", "reason": "fixture-row-not-found:local-muuweoxe-amwotbn99k", "requiredForGreen": false, "cost": {"wallSeconds": 97.902, "nativeCommands": 69, "enteredSteps": 3, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/volatile-outbox-m8-235711
{"id": "ios-simulator-m6", "pass": false, "receipt": "m6-ios-run.json", "reason": "server-occurrence-count:2", "requiredForGreen": false, "cost": {"wallSeconds": 144.528, "nativeCommands": 43, "enteredSteps": 7, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/duplicate-sends-m6-235850
{"id": "ios-simulator-m6", "pass": false, "receipt": "m6-ios-run.json", "reason": "server-send-order", "requiredForGreen": false, "cost": {"wallSeconds": 144.553, "nativeCommands": 43, "enteredSteps": 7, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/reversed-sends-m6-000114
{"id": "ios-simulator-m6", "pass": false, "receipt": "m6-ios-run.json", "reason": "stale-viewonce-pixels", "requiredForGreen": false, "cost": {"wallSeconds": 46.272, "nativeCommands": 34, "enteredSteps": 4, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/stale-viewonce-m6-000339
{"id": "ios-simulator-m6", "pass": null, "receipt": "m6-ios-run.json", "reason": "fixture-row-not-found:5076b9b6-6a2c-4d24-b0b7-c372e2cb7664", "requiredForGreen": false, "cost": {"wallSeconds": 48.707, "nativeCommands": 48, "enteredSteps": 0, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/wrong-fixture-m6-000426
{"id": "ios-simulator-m6", "pass": false, "receipt": "m6-ios-run.json", "reason": "bob-wrong-conversation-or-principal", "requiredForGreen": false, "cost": {"wallSeconds": 91.674, "nativeCommands": 43, "enteredSteps": 7, "operatorInvocations": 1}}
/private/tmp/ni-native-20261005/runs/bob-wrong-conversation-m6-000515
```

Verbatim final artifact-control output:

```text
{"control": "stale-nonce", "rejected": true, "nativePass": null, "reason": "stale-or-unsupported-observation", "wallSeconds": 0.072, "operatorSteps": 1}
{"control": "replayed-events", "rejected": true, "nativePass": null, "reason": "observation-sequence-gap-or-replay", "wallSeconds": 0.027, "operatorSteps": 1}
{"control": "missing-video", "rejected": true, "nativePass": null, "reason": "evidence-missing:m6-ios-screen.mp4", "wallSeconds": 0.016, "operatorSteps": 1}
{"control": "hash-mismatched-video", "rejected": true, "nativePass": null, "reason": "evidence-hash-mismatch:m6-ios-screen.mp4", "wallSeconds": 0.015, "operatorSteps": 1}
{"control": "truncated-video-rebound", "rejected": true, "nativePass": null, "reason": "truncated-video-box", "wallSeconds": 0.016, "operatorSteps": 1}
```

Verbatim unavailable-host receipt:

```json
{
  "pass": null,
  "reason": "unavailable-host:ssh",
  "requiredForGreen": false,
  "wallSeconds": 0.006,
  "operatorSteps": 1
}
```

## Actual operator cost and evidence limits

The final known-good M6+M8 pair took **186.218 s** of measured outer
run wall, four operator steps, and 96 native bridge commands plus cleanup.
The final warm own-Release rebuild took **8.103 s**. That is
a small reference with installed dependencies and existing DerivedData, not a
cold-build forecast. The first cold preparation was not timed by a whole-operation
clock; its logs are retained and no cold median is invented. The preceding warm
build took 9.485 s. Actual human/agent attention was not separately clocked.

The ten final live runs consumed 882.843 s of outer wall
(879.296 s inside the driver), 20 operator steps. Across all
33 retained live attempts, measured outer wall sums to
2753.648 s, excluding builds, dependency setup, export/review and
implementation/debugging. Earlier outer clocks excluded the initial uninstall;
their definitions and original values remain visible. These costs include
failures rather than selecting only the successful pair. The matrix reports
one attempt per control at the final inventory, not a success-rate estimate.

Pixel checks use the actual ordinary fixture and an aspect-fit crop; view-once
refusal uses the previously opened prime frame. Screenshots/native trees and
the H.264 recordings are retained for review. Extracted recording frames at
7.725, 9.265 and 55.690 seconds were visually inspected: actual ordinary-image
colors, the consumed view-once affordance without its viewer, and two ordered
messages with blue double read ticks. The [frame extraction record](./evidence/mini/video-review/results.json)
binds requested and actual times; it supplements the full recordings.
Observations corroborate UI/server
evidence; they are not adversarial attestation. Five seconds bounds the delayed
duplicate check, not all future retries. View-once proof is visible refusal,
not forensic erasure of all stored bytes. The independent-app pilot is necessary
to find assumptions shared by this reference and driver.

## Every earlier attempt

These are development/inventory iterations, not additional calibrations. Exact
statuses, costs and artifacts are retained in [attempts.json](./evidence/mini/attempts.json),
the earlier inventory batch's loose directories, and per-run compressed
development archives. Early source candidates are not retrospectively relabeled
as the qualified source. The old `completedSteps` field counted entered steps;
the current source names it accurately.

| Attempt directory | Raw pass | Raw reason | Outer wall (s) | Native commands | Entered steps |
| --- | --- | --- | ---: | ---: | ---: |
| `none-m6-225820` | false | `sign-in` | 47.158 | 5 | 0 |
| `none-m6-230101` | null | `origin-port-occupied` | 0.284 | 0 | 0 |
| `none-m6-230302` | false | `sign-in` | 54.079 | 6 | 0 |
| `none-m6-230538` | false | `sign-in` | 55.846 | 6 | 0 |
| `none-m6-230740` | null | `backend-reachable-during-offline` | 180.474 | 25 | 2 |
| `none-m6-231209` | false | `selector-not-hittable` | 67.990 | 39 | 6 |
| `none-m6-231504` | false | `selector-not-hittable` | 69.709 | 39 | 6 |
| `none-m6-231744` | true | `passed` | 94.830 | 43 | 8 |
| `none-m8-232108` | true | `passed` | 94.903 | 53 | 5 |
| `none-m6-232609` | true | `passed` | 93.305 | 43 | 8 |
| `none-m8-232743` | true | `passed` | 93.758 | 53 | 5 |
| `placeholder-m6-232917` | false | `placeholder-or-wrong-media-pixels` | 43.466 | 29 | 3 |
| `volatile-outbox-m8-233000` | false | `fixture-row-not-found:local-cc7b80f8-3c49-4099-98cd-a1cdd5e79fb1-2` | 95.181 | 69 | 3 |
| `none-m6-233507` | true | `passed` | 91.356 | 43 | 8 |
| `none-m8-233639` | true | `passed` | 94.032 | 53 | 5 |
| `placeholder-m6-233813` | false | `placeholder-or-wrong-media-pixels` | 43.486 | 29 | 3 |
| `volatile-outbox-m8-233857` | false | `fixture-row-not-found:local-muuvr6dg-qqzqjnp6iad` | 95.722 | 69 | 3 |
| `duplicate-sends-m6-234033` | false | `server-occurrence-count:2` | 145.249 | 43 | 7 |
| `reversed-sends-m6-234258` | false | `server-send-order` | 145.611 | 43 | 7 |
| `stale-viewonce-m6-234524` | false | `stale-viewonce-pixels` | 46.240 | 34 | 4 |
| `collapsed-receipt-m6-234610` | false | `visible-body-count:bc13d374-9491-4dc0-bdf2-0e5ca67d2ee5:first` | 78.341 | 64 | 6 |
| `wrong-fixture-m6-234729` | false | `fixture-row-not-found:b4e10832-442f-4d7a-b0ef-5621e7e88d76` | 48.066 | 48 | 0 |
| `bob-wrong-conversation-m6-234817` | false | `bob-wrong-conversation-or-principal` | 91.719 | 43 | 7 |

Development findings and corrections:

1. Bulk XCTest typing dropped characters in controlled React Native inputs;
   the driver now types paced ordinary keystrokes. A Volta launcher exited while
   its owned backend child survived; the reference resolves the actual Node
   executable, and the recorded owned group was stopped. The occupied-port
   attempt remains unmeasured.
2. XCTest's first launch relocated the app container; collection follows that
   relocation only before prime. Any relocation after prime is rejected.
   A Darwin TCP self-connection looked like backend reachability; the negative
   probe now rejects that source/destination self-connection.
3. The keyboard obscured the reference Send button. A KeyboardAvoidingView
   attempt still failed; placing the composer above the list made the ordinary
   action reachable. Both failed attempts remain visible.
4. A passivity audit made the helper inert outside protocol launches and on
   web without its native module. Reference operation/message IDs no longer
   derive from observer configuration. A normal launch without protocol arguments
   stayed alive and created no observation directory (4.866 s, retained screenshot).
   Remaining cases of that earlier batch were held until new bytes were frozen.
5. The first collapsed-receipt variant detached its body from the identified row.
   That is a real accessibility failure but does not qualify the intended receipt
   control. The corrected variant preserves the body and collapses/hides only
   receipt descendants, failing specifically `receipt-accessibility:pending`.
   A wrong fixture's pre-prime exception was initially mislabeled false; the final
   driver retains the rejection with null native status. The complete matrix was
   rerun after both fixes.
6. Copied UI tests initially lacked a Playwright package link, then needed the
   UI working directory and a correctly named video fixture. Corrected tests
   passed. Python's first Pillow pin was unavailable for the mini's Python 3.9;
   the supported frozen pin is 11.3.0. Build/test attempt logs are retained.
   The build-input audit initially found three stale noncompiled copies
   (README, lockfile, test); those were synchronized before the final build and
   the 42-file audit passed. No runtime source discrepancy was hidden.

## Checks, retention and handoff

Instrument unit tests: 12/12. Revised UI kit tests: 3/3; UI TypeScript check
passed. Affected Snapback 4 witness/Expo-scene tests: 9/9. Freeze checks and
packet materialization passed, including the separate historical web component.
Independent artifact validation is retained in
[validation-final.json](./evidence/mini/validation-final.json); good runs validate
true, behavioral failures validate false, and the unprimed wrong-fixture packet
is invalid/unmeasured. [ref-check](./evidence/ref-check.log) was run after the
closing documentation. No Snapback engine change required a Rust build.

The additional repository inventory check is **inherited red**, with its full
[log](./evidence/inventories.log) and [unchanged input blobs](./evidence/inherited-inventory-inputs.json):
an unregistered root script test, legacy guide size/profile drift, missing
generated demo artifacts and stale Snapback-1 diagnostics registries. These
inputs are unchanged from the lane base. NI did not repair unrelated frozen
records or run a full engine battery.

All simulator operations used the one dedicated mini simulator. Project, backend,
build and recording scratch used `/tmp/ni-native-20261005`. One early XCTest
invocation omitted `-derivedDataPath` and created a task-specific directory under
the user's global Xcode DerivedData: a setup deviation from the requested scratch
boundary. Subsequent invocations specify scratch DerivedData and result bundles;
the accidental directory was identified by the task's XCTest result-log path
and deleted too.
Neither the black M5 nor office M1 was used. The reference and runner were
removed, task scratch was deleted, and the simulator's original Booted state
was preserved; see [cleanup](./evidence/cleanup.json). Private backend stores,
dependencies and xcresult bundles are excluded. XCTest typing lines are redacted;
the [retention record](./evidence/mini/retention.json) records any transformed
development log digests. The conservative typing-line pattern also removed
incidental matching type lines from some compiler/system logs; original and
retained digests are recorded, and result JSON is preserved verbatim.
Final bound evidence is revalidated after export. An initial local unpack began
before SCP finished and failed EOF/missing-file checks; the complete archive
was then verified before any evidence was accepted or remote scratch deleted,
as recorded in [export verification](./evidence/export-verification.json).
The evidence inventory records every retained file hash.

The [Phase-2 plan](./PHASE-2.md) commissions no execution here. It calls for two
independent fresh builds under the same prompt/aid, Snapback 4 and Convex,
then M6/M8 driver runs on each. Budget 11–24 min native operator elapsed per
app, 22–48 min total, plus authoring, cold setup/download/queue time and retained
failure triage; 3–6 min attention per app is still a planning estimate. Reserve
two pilot days and record actual authoring cost under the published safety caps.
The owner must review pilot failures and integration costs before scored admission.

Local commits only, with the requested GPT-6 Astra trailer. Nothing was pushed
or published. The instrument remains a qualification candidate until Phase 2.

## Round 1 — review corrections and requalification

This round supersedes the round-0 driver qualification above. Both reviews were
read in full; every listed reproduction has an instrument regression. The corrected
reference passes M6/M8, and the full live and artifact control matrices below
reject at their intended boundaries. Phase 2 remains unrun and scored use remains
disabled. No calibration, push or publication occurred.

Qualified source: `ece785d94f2ab7c34a581ca6cba231eb6eca663f`. Inventory:
`feb50d3967667a6583f5d09c297b66fab9353728f6da2992ce02c0292472e77c` (74 files).
Python driver: `1a12e18e991590b93ee17f366ca4a3ff9bc763a86bc7770d564cd49ec1192109`.
XCTest runner: `4c2186d0143ad7d3c4679a905fed8104b3ab98a67d1be53914abc42a0c3c36da`.
Native app: `a2cdb1946e32ec6342ea95c58fb0083fd7bb341e58559a5f0e230f3e8b7cc146`.
Hermes: `50e9221db591e8d62e5b97270b22a324b4c72beb4f68f97207b31507fda6d252`.
The post-build [qualification identity](../../../benchmarks/native/0.4.0-native.1/QUALIFIED.json)
is a trusted instrument input, outside its own source inventory. The
[source audit](./round1/source-audit.json) binds every copied kit/helper/app input.
The supplied helper now comprises six files and 7,475 bytes of symmetric aid.

### Corrections

- Receipts: `m6-a05` stays pending until both native ticks and both authoritative
  server rows say `read` within the 60-second receipt window. M8 uses the same
  check. Export validation recomputes rows and deadline; one wrong receipt also rejects.
- Navigation: after the result tap, require native conversation identity, the
  history message ID/body and a fresh committed screen from that process.
  Empty/sign-in trees and a claim without the screen reject even after hash rebinding.
- Provenance: exports must match the trusted commit, source inventory, Python
  driver and qualified XCTest binary. No trust anchor comes from the evidence packet.
- Wrong-conversation reports are application failures at `m6-a01`/`m6-a03`;
  protocol/schema/nonce violations remain instrument errors. Partial valid
  assertions survive a later app failure. Contradictory passing artifact claims reject.
- Finalization validates candidate receipts in memory before writing success.
  Validation failure makes receipts, manifest and status consistently unmeasured.
  Never-recorded video is null, and validation retains the original setup reason.
- Cold launch polls the journal every time and requires readiness from a process
  first recorded after that launch timestamp. Stale prime readiness cannot satisfy it.
- Bob reads `sm-convo-body`, excluding timestamps; the kit browser test and live
  reference both include timestamps. Settled intent events bind resulting server
  IDs, so replacing a pending ID on flush is supported and tested.
- Every process needs explicit protocol arguments. The actual Swift journal
  caps a run at 10,000 events / 4 MiB, with sticky overflow reported as unmeasured.
  The same-installation protocol-then-ordinary simulator launch leaves the journal unchanged.
- The diagnostic `/send` lookup is scoped to the authorized conversation and
  sender. A real HTTP regression covers cross-conversation and cross-sender collisions.
  SSH exit 255 means unavailable only with a recognized connection diagnostic;
  remote command failures preserve their exit status and output.

### Simulator matrix

All final rows used the Apartment mini, `source ~/.snapback-env.sh`, scratch
`/tmp/ni-round1-20261005`, and only simulator
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B`. Each row is one invocation,
including pre/post uninstall. [Small verdicts](./round1/verdicts.json) preserve
per-assertion results, reasons, identity membership and costs.

| Control | Segment | Pass | Failed assertion / reason | Outer wall (s) |
| --- | --- | --- | --- | ---: |
| bob-wrong-conversation | m6 | false | m6-a07 `bob-wrong-conversation-or-principal` | 94.601 |
| collapsed-receipt | m6 | false | m6-a05 `receipt-accessibility:pending` | 78.908 |
| duplicate-sends | m6 | false | m6-a06 `server-occurrence-count:2` | 146.137 |
| navigation-claim | m6 | false | m6-a03 `screen-conversation` | 63.359 |
| none | m6 | true |  `all assertions passed` | 96.229 |
| none | m8 | true |  `all assertions passed` | 97.452 |
| placeholder | m6 | false | m6-a02 `placeholder-or-wrong-media-pixels` | 43.487 |
| reversed-sends | m6 | false | m6-a06 `server-send-order` | 145.357 |
| stale-viewonce | m6 | false | m6-a04 `stale-viewonce-pixels` | 46.785 |
| volatile-outbox | m8 | false | m8-a17 `fixture-row-not-found:local-muuzghei-ut6ekfjsepg` | 98.908 |
| wrong-conversation | m6 | false | m6-a01 `screen-conversation` | 44.131 |
| wrong-fixture | m6 | null |  `fixture-row-not-found:fffb783b-2b85-490c-9003-388721397b59` | 48.953 |
| wrong-receipts | m6 | false | m6-a05 `server-receipt-state:read` | 155.675 |
| wrong-receipts | m8 | false | m8-a18 `server-receipt-state:read` | 157.851 |

Unavailable SSH remains null with exit zero. All final live packets revalidate
after export, including wrong-fixture setup evidence with null video and its
original reason. See [validation](./round1/validation.json).

### Artifact and regression checks

All 17 M6 and three M8 [artifact controls](./round1/artifact-controls.json) reject
for the expected reason. They mutate actual retained known-good evidence and
rebind changed hashes: wrong/partly-wrong final receipts, expired receipt window,
empty/sign-in/wrong-body search trees, navigation claim without a fresh screen,
wrong conversation, all four provenance identities, stale/replayed observations,
and missing/mismatched/truncated video. Both original good packets are validated
before mutation; the complete mutated directories are archived.

Checks: **35 Python tests**, **three kit tests plus TypeScript**, compiled Swift
journal lifetime/overflow tests, native freeze and packet materialization, and
`./ref-check` pass. The root inventory check remains inherited red (unregistered
root test, guide size/profile/generated-artifact/diagnostics drift); its tracked
inputs are unchanged from round 0 and its full log is archived. No unrelated
Snapback-1 generator or engine code was changed.

### Attempts, costs and custody

The final 14 runs total 1317.833 seconds
of outer wall; the good M6+M8 pair totals 193.681 seconds.
The last warm Release build took 9.443 seconds.
These exclude authoring/triage/export attention, which was not separately clocked.

One earlier known-good attempt failed because XCTest flattens the non-accessible
conversation container into a sibling marker. The validator now requires the
unique conversation marker, visible history row and matching screen in the same
native tree, without assuming JSX ancestry. A dedicated regression covers that
layout. Its original verdict and bytes remain archived under their original
source identity; they are not relabeled as a final-inventory run.

The development-check record also retains setup mistakes: a missing test fixture
argument, an incorrect video-fixture path, a source-pin change during a test read
and an M8 artifact-control invocation missing its segment argument. Corrected
checks passed; none is silently counted as a qualified pass. The inspected
known-good search and final-read screenshots show the expected history and the
two ordered nonce bodies with timestamps and blue read ticks; full video and
automated endpoint/pixel evidence are retained.

Raw evidence is on **eb1000** under
`~/sb5-evidence-archive/20261005-ni/round1/`. The committed
[index](./round1/evidence-index.json) records absolute path, bytes, SHA-256 and
a one-line purpose for every retained file. Only the index and small JSON verdicts
are added to the report; no new committed file exceeds 1 MB and no tarball is
committed. Private backend stores, installed apps, dependencies and XCTest
result bundles are excluded; driver logs redact fixture credentials.

The [cleanup record](./round1/cleanup.json) confirms export hash verification,
owned process groups gone, backend/controller ports free, both task apps removed,
task scratch deleted and the dedicated simulator still Booted. Neither the black
M5 nor the office M1 was used. The inherited frozen instrument is unchanged.

The [Round-1 journal entry](./round1/JOURNAL.md) is a small companion journal.
The existing root `snapback4/JOURNAL.md` is 5.5 MB, so it remains byte-identical
to the lane base to honor the 1-MB commit limit. The unpublished delivery commits
were consolidated without changing any inventoried instrument byte or rebinding
measurement identities. The actual qualified source checkpoint remains locally
reachable as `refs/ni/round1-qualified-source`; qualification binds that source
inventory, rather than the later report commit.

## Round 2 — remaining false passes and false failures

The final **19-cell live matrix** has every expected verdict. Known-good M6 and M8,
the 1.5-second delayed Bob render, and newest-first navigation pass. Asynchronous
view-once reloads fail `m6-a04`; an undecodable video is unmeasured, even when the
configured recorder checker claims a successful decode. No calibration or score
was produced, no push was made, and Phase 2 remains unexecuted.

### Corrections and regressions

- View-once crops derive from the prime native viewer frame. The prime matches
  the hashed opened fixture; the cold crop differs and its pixel record carries
  the same frame. Refusal binds to the reopen attempt. The driver monitors later
  loads through backend readiness, and exported validation checks both sequence
  and timestamp boundaries, including buffered cache loads.
- Exported validation independently checks H.264 track, codec, duration and
  decoded samples using AVFoundation on the mini and FFmpeg on Linux.
  Sample timing, sample-size count and decoded frame count must agree; movie/edit
  endpoints must be covered by actual sample intervals. Missing
  decoding remains unmeasured. The synthetic good packet now contains a real,
  independently decoded 30-second H.264 video.
- Every receipt assertion independently requires final native read ticks, the
  latest committed screen rows and authoritative server read states. The native
  snapshot and server sample must lie in the 60-second window. A committed
  screen may predate the window when those current observations corroborate it.
- Search retains only a validated destination with its capture timestamp,
  locates a scrolled-off target and requires a post-scroll screen. Bob polls
  expected identity and bodies for up to 10 seconds. Reference consumption is
  per asset; ordering counters are per conversation. Actual duplicate samples
  span five seconds. Darwin SSH timeouts remain unmeasured.
- Each supplied reproduction is covered by a rebound retained-evidence control
  or a driver/backend/browser regression. A no-op `Driver.reconnect` produces
  two failures in the dedicated reconnect test.

The [continuation audit](./round2/continuation-audit.md) records all eight brief
items before resuming. That audit found the implementation complete but the final
qualification unfinished. Continuation M8 exposed another video false failure:
presentation-order AVFoundation output coalesced seven repeated timestamps,
returning 1,337 images for 1,344 encoded samples. The Mac checker now reads
compressed samples and synchronously decodes each through VideoToolbox. The
strict encoded/decoded count still applies. A 3,106-byte regression fixture has
ten samples with one repeated timestamp; the old checker returns nine images,
the corrected checker returns ten. The original failed M8 packet remains
unmeasured in the archive.

Apple documents [compressed samples in decode order](https://developer.apple.com/documentation/avfoundation/avassetreadertrackoutput/outputsettings)
and [synchronous decoding when both processing flags are clear](https://developer.apple.com/documentation/videotoolbox/vtdecompressionsessiondecodeframe%28_%3Asamplebuffer%3Aflags%3Ainfoflagsout%3Aoutputhandler%3A%29). The retained fixture and M8 recording independently verify that choice.

### Qualified source and final matrix

Source checkpoint: `66763bd85845c35664d983b4e3a52de4e5355c09`. Inventory SHA-256:
`1449c6c38d5f1338831501f17b10666c57f27f79e64ce3e089d9504688a04012` (83 files). Qualified XCTest binary:
`879a0d4cdc4141b2f503862db3530e9896f430645222ef12c916c853d8d144d8`. All 43 copied build inputs match
the frozen source. The source-audit record retains native and Hermes hashes.

Host: Apartment mini; only simulator
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B`. Commands sourced
`~/.snapback-env.sh`; build and execution used disposable `/tmp` scratch.
The black M5 and office M1 were not used.

| Control | Segment | Native pass | Failure assertion / reason | Driver wall (s) |
| --- | --- | --- | --- | ---: |
| async-viewonce | m6 | false | `m6-a04 viewonce-reloaded-before-reconnect` | 52.467 |
| bob-wrong-conversation | m6 | false | `m6-a07 bob-wrong-conversation-or-principal` | 105.196 |
| collapsed-receipt | m6 | false | `m6-a05 receipt-accessibility:pending` | 80.844 |
| delayed-bob | m6 | true | `all assertions passed` | 98.525 |
| duplicate-sends | m6 | false | `m6-a06 server-occurrence-count:2` | 151.198 |
| late-bob | m6 | false | `m6-a07 bob-wrong-conversation-or-principal` | 105.051 |
| navigation-claim | m6 | false | `m6-a03 native-conversation-identity` | 63.342 |
| newest-first | m6 | true | `all assertions passed` | 101.241 |
| none | m6 | true | `all assertions passed` | 96.332 |
| none | m8 | true | `all assertions passed` | 100.089 |
| placeholder | m6 | false | `m6-a02 placeholder-or-wrong-media-pixels` | 44.043 |
| reversed-sends | m6 | false | `m6-a06 server-send-order` | 148.834 |
| stale-viewonce | m6 | false | `m6-a04 stale-viewonce-pixels` | 47.230 |
| undecodable-video | m6 | null | `artifact-validation:invalid-video-timing` | 94.754 |
| volatile-outbox | m8 | false | `m8-a17 fixture-row-not-found:local-muv7ifkh-84zwviq6apu` | 102.213 |
| wrong-conversation | m6 | false | `m6-a01 screen-conversation` | 42.244 |
| wrong-fixture | m6 | null | `fixture-row-not-found:bd755d67-1ac8-4039-be59-3a562e3d2baa` | 50.765 |
| wrong-receipts | m6 | false | `m6-a05 server-receipt-state:read` | 155.723 |
| wrong-receipts | m8 | false | `m8-a18 server-receipt-state:read` | 160.258 |

Unavailable SSH is separately null. [Verdicts](./round2/verdicts.json) retain
every attempt and outer invocation cost; [exported validation](./round2/validation.json)
validates the final runs with the current trusted source distribution. Earlier
results retain their original trusted validator identity and qualified-host
validation; they are superseded qualification attempts.

### Qualification evidence and attempts

All **47 Python tests** pass on Linux and the mini. Both Bob browser tests, all
three kit tests plus TypeScript, the compiled Swift journal tests, an ordinary launch after protocol activation, freeze, packet
materialization and `./ref-check` pass. The root inventory check remains inherited
red on the same Snapback-1 registry/guide/generated-artifact inputs as round 1;
[the baseline comparison](./round2/inherited-inventory-inputs.json) and full archived
log distinguish it from this change.

All **37 final retained-evidence controls** have their expected outcome: 35
contradictory packets reject, successful search retries pass, and an earlier
committed read screen passes when current native/server evidence corroborates it.
Changed files have rebound hashes. The controls include stale pixels with a
retargeted crop, asynchronous and buffered loads, empty MP4 boxes, native/screen
receipt contradictions, a late native snapshot, and shortened duplicate windows.
See [reproduction coverage](./round2/reproduction-coverage.md),
[controls](./round2/artifact-controls.json),
[retained read control](./round2/additional-controls.json) and
[live observations](./round2/control-observations.json).

All 38 earlier attempts are retained under their original source identities. Independent review found a buffered-load
boundary gap, which was fixed and given a regression. The initial receipt
controls then exposed an over-strict requirement for a new read-screen event
inside the receipt window. The final correction preserves current native/server
corroboration and accepts earlier committed state; a newer `sent` screen still
rejects. A 19-cell matrix was rerun after that correction. Export verification then
exposed an AVFoundation endpoint request that returned a much earlier frame.
The final verifier decodes actual samples and binds timing/counts to the retained
bytes; coordinated duration-header edits and invented sample counts reject.
The driver records a terminal app shutdown after assertion snapshots, closing
static recording tails. The full 19-cell matrix was rerun under the final source. Earlier
artifacts are not relabeled or rebound to the final inventory.

[Independent review](./round2/review.md) records reviews through checkpoint
`48a5a5fba9`; it does not cover the subsequent terminal-transition or repeated-PTS
corrections. Those corrections have the final tests and live qualification recorded
here. The [development log](./round2/development-check-attempts.json) retains
test-fixture and export setup errors and their resolutions.

Final matrix outer wall totals **1863.703 s**;
the final good M6/M8 pair totals **206.257 s**.
The 38 earlier live attempts add **3458.758 s**.
Build, authoring, triage and export attention were not separately clocked; raw
build/test logs remain in the archive. These are instrument costs, not backend
performance claims.

### Archive and cleanup

Raw evidence is at `/home/ccheever/sb5-evidence-archive/20261005-ni/round2` on expose-builder-pixel (Linux). The committed
[index](./round2/evidence-index.json) binds 12955 files
(2,470,083,420 bytes) by absolute path, size, SHA-256 and purpose.
Only small records and index shards are committed; no new file exceeds 1 MB
and no tarball is committed. Private stores, installed apps, dependencies and
XCTest result bundles are excluded.

[Export verification](./round2/export-verification.json) precedes the
[cleanup record](./round2/cleanup.json): all retained source files were hash-checked,
owned processes stopped, ports freed, both task apps removed and scratch deleted.
The designated simulator remains Booted. The large root journal remains unchanged;
the [Round-2 companion journal](./round2/JOURNAL.md) records this work.

[Local scratch cleanup](./round2/local-cleanup.json) also removed the 58
round-2 temporary files/directories on the Linux control host after retention.

## Round 3 — the remaining validator gaps

Both round-2 reviews were read and their reproductions were run against
`fb830d2c2e`'s production code. The [coverage record](./round3/reproduction-coverage.md)
links every finding to a regression or control and records the original false
passes/false failures. All eight requested gaps are addressed.

- View-once loads are forbidden across the entire cold process, before reopening
  and after reconnection included. The driver drains the journal after process
  termination as well; a regression writes a decoded load during termination and
  confirms that `m6-a04` loses its pass. That test fails on round 2.
- Stale pixels are searched over the whole screenshot at the opened crop size,
  using channel-centered correlation >=0.95. The archived honest screenshot is
  absent (0.395068); relocation, +30/+60 brightness and contrast controls all reject.
  Prime matching keeps its strict mean absolute error <20/255.
- Refusal and native state are polled within ten seconds. The +1.5-second delayed
  denial passes live; the recorded denial arrives 2.857 seconds after the host
  attempt. Search accepts the hittable post-scroll tree without another screen
  event, while retaining the required post-tap committed screen.
- M8 binds restart capture to verified absence, relaunch and the reconnect
  boundary, corroborated by the restarted process's committed pending screen.
  Removing the entire exported `m8-a17` verification block fails its new test.
- The diagnostic backend rejects foreign/missing asset references on send and
  scopes history's asset lookup to the authorized conversation. HTTP tests cover
  both new sends and malformed legacy rows.

### Qualified source and live evidence

Final source: `2eccfb33a679e72d35dda591368ce7b29800d7e1`. Inventory SHA-256:
`862a65fe6f347fa4ccf2a362aece4184e20b8692e68b3db494fcd0f630e4a2fa` (85 files). XCTest binary:
`ab31fc90aa1265e49d1c14b6f7bb0aaa6555fc07c031d4e68d8be38ad0fab7f9`. `QUALIFIED.json` and
`INSTRUMENT_COMMIT` name this source. All 43 copied build inputs match.

Host: Apartment mini, with `source ~/.snapback-env.sh`, dedicated simulator
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B`, and disposable `/tmp` scratch.
The black M5 and office M1 were not used.

The full 25-cell matrix below ran at `eb2ac6d642`. The final source also fixes the
retained refusal mutation, adds the post-termination journal drain and its test,
and adds a policy annotation. The validator's executable code and the built
reference app are unchanged. The final-source good pair and all corrected
retained controls were then rerun. Earlier packets retain their source identities;
[the source comparison](./round3/qualification-continuity.json) records the delta.

| Control | Segment | Native pass | Reason | Driver wall (s) |
| --- | --- | --- | --- | ---: |
| none | m6 | true | `all assertions passed` | 96.016 |
| none | m8 | true | `all assertions passed` | 99.340 |
| pre-reopen-viewonce | m6 | false | `viewonce-reloaded-in-cold-process` | 39.558 |
| elsewhere-viewonce | m6 | false | `stale-viewonce-pixels` | 55.724 |
| bright-viewonce | m6 | false | `stale-viewonce-pixels` | 55.911 |
| delayed-refusal | m6 | true | `all assertions passed` | 98.178 |
| scroll-no-screen | m6 | true | `all assertions passed` | 100.354 |
| stale-restart-capture | m8 | null | `artifact-validation:restart-capture-before-relaunch` | 100.114 |
| async-viewonce | m6 | false | `viewonce-reloaded-in-cold-process` | 53.013 |
| newest-first | m6 | true | `all assertions passed` | 101.294 |
| stale-viewonce | m6 | false | `viewonce-reloaded-in-cold-process` | 46.955 |
| placeholder | m6 | false | `placeholder-or-wrong-media-pixels` | 43.916 |
| volatile-outbox | m8 | false | `fixture-row-not-found:local-muvaybbf-t34k4xgz5eq` | 102.350 |
| duplicate-sends | m6 | false | `server-occurrence-count:2` | 149.749 |
| reversed-sends | m6 | false | `server-send-order` | 149.304 |
| wrong-conversation | m6 | false | `screen-conversation` | 42.058 |
| navigation-claim | m6 | false | `native-conversation-identity` | 63.106 |
| collapsed-receipt | m6 | false | `receipt-accessibility:pending` | 82.301 |
| bob-wrong-conversation | m6 | false | `bob-wrong-conversation-or-principal` | 105.702 |
| delayed-bob | m6 | true | `all assertions passed` | 98.465 |
| late-bob | m6 | false | `bob-wrong-conversation-or-principal` | 104.645 |
| wrong-receipts | m6 | false | `server-receipt-state:read` | 156.141 |
| wrong-receipts | m8 | false | `server-receipt-state:read` | 159.195 |
| undecodable-video | m6 | null | `artifact-validation:invalid-video-timing` | 92.500 |
| wrong-fixture | m6 | null | `fixture-row-not-found:b2a7286c-66bc-4804-b391-9ef895a3ef02` | 48.536 |

Final-source confirmation:

| Segment | Native pass | Driver wall (s) |
| --- | --- | ---: |
| m6 | true | 97.167 |
| m8 | true | 100.441 |

[Live witnesses](./round3/control-observations.json) confirm that the pre-reopen
load occurs before any reopen attempt, both pixel controls have no cold load
observation, and the positive scroll has one post-tap screen and zero post-scroll
screens. The live M8 replay retains the real restart capture separately and is
rejected as `artifact-validation:restart-capture-before-relaunch`.

### Checks, attempts and costs

All **58 Python tests** pass on Linux and the mini. Both Bob browser tests, all
three copied-kit tests and TypeScript, compiled Swift journal tests, frozen-source
checking, packet materialization and `./ref-check` pass. The root inventory check
retains its inherited Snapback-1 registry/guide/generated-artifact reds;
[the unchanged input blobs](./round3/inherited-inventory-inputs.json) and archived
output distinguish them from this change.

All **43 final retained controls** match: 41 contradictory packets reject and
both positive search controls pass. The earlier refusal mutation had left the
successful snapshot's disabled/opened control intact, so it still proved refusal;
the corrected mutation removes that native evidence as well as fresh events.
The final source includes that correction and a dedicated regression.

The mini exposed a test-only process-custody problem: terminating Volta's shim
left its Node child alive. Tests now launch `process.execPath` directly. All six
identified task children were removed and verified absent. Initial test-fixture,
freeze and auxiliary-check setup errors are retained in the
[development record](./round3/development-check-attempts.json) and archive.

All **28 live attempts** are retained: the 25-cell matrix, the final
M6/M8 pair and one superseded source-checkpoint attempt. Every exported attempt
validates independently on Linux; see [validation](./round3/validation.json) and
[verdicts](./round3/verdicts.json). The matrix's outer wall totals
**2328.593 s**; the final pair totals
**207.398 s**. All live operator invocations
total **2635.050 s**. Build, authoring
and triage attention were not separately clocked. These are instrument costs.

### Archive and cleanup

Raw evidence is archived at
`/home/ccheever/sb5-evidence-archive/20261005-ni/round3` on expose-builder-pixel.
The [index](./round3/evidence-index.json) binds **7878 files**
(**1,663,056,048 bytes**) by path, size, SHA-256 and purpose.
No new Git file exceeds 1 MB, and no tarball is committed. Private stores,
installed applications, dependencies and XCTest result bundles are excluded.
[Export verification](./round3/export-verification.json) precedes
[mini cleanup](./round3/cleanup.json): owned processes stopped, ports freed,
both task apps removed, scratch deleted, dedicated simulator left Booted.
[Local scratch cleanup](./round3/local-cleanup.json) records control-host cleanup.

The [affected corpus audit](./round3/context-and-audit.md) and
[companion journal](./round3/JOURNAL.md) record the design reconciliation.
Phase 2 and scored admission remain unchanged. No push or publication.

## Round 4 — sticky disclosure, scaled pixels and report freshness

Astra's transient-stale reproduction now fails at the first poll with
`stale-viewonce-pixels`, records `m6-a04: false`, and retains that screenshot,
native tree and pixel record. The clean second poll never executes. A later
wait also refuses before invoking its callback. Only `viewonce-refusal-missing`
is retryable; delayed refusal still passes. A visible viewer is likewise terminal
and now retains its pixel comparison before failing.

The detector searches image content across **0.25×–1.25×** in 0.01 steps over
the whole cold screenshot. It removes the prime's aspect-fit letterbox, reduces
the screen to at most 480 pixels wide, and refines the best dimensions for
rounding and modest aspect changes introduced by a mat. The stale cutoff is
**0.90 channel-centered correlation**. Prime matching remains <20/255 mean
absolute channel error. The constant-crop fallback remains RMS <20. Brightness
and contrast controls remain covered. Arbitrary distortion, rotation and heavy
occlusion are outside the automated check; video review remains required.

### Final source and custody

Qualified source: `958f7bf4a9cdf8732fc0b74914b2c05b9d90896b`. Inventory SHA-256:
`88aeda6949779dfa06b81a6fcf179630184621bca5384e341a584c60e71672f6` (**86 files**).
Driver source SHA-256: `d87a505830d02b5ba07a566dce77c37e13ce6649b39d0d17fc011853443773e5`.
The unchanged XCTest binary is `ab31fc90aa1265e49d1c14b6f7bb0aaa6555fc07c031d4e68d8be38ad0fab7f9`.
`QUALIFIED.json` and `INSTRUMENT_COMMIT` agree. The source commit contains the
instrument bytes; the following evidence/report commit records their qualification.

[Source continuity](./round4/qualification-continuity.json) binds the unchanged
native runner, helper, kit and reference inputs to Round 3. No native build or
simulator segment ran this round. All **65 archived cold captures** were compared
with both Round-3 and Round-4 detectors; **zero verdicts changed**. All 61 retained
pixel records also agree; four early stale-viewer failures predate pixel-record
creation. Therefore the requested condition for live mini requalification did not
trigger. Earlier live packets retain their original identities.

Artifact controls use diagnostic copies of the final Round-3 good M6/M8 pair.
Each copy explicitly records the original identity, manifest digest, current
verifier and inherited file hashes in `SOURCE.json`. Its manifest names the
current verifier for exported validation; this is **diagnostic replay, not a new
live execution**. No source archive was edited. The brief-path report at
`/home/ccheever/sb5-lanes/ni.report.md` is synchronized with this report and names
the same final source and inventory.

### Score distributions and threshold margin

| Population | n | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Archived honest cold captures | 59 | 0.748322 | 0.748323 | 0.748324 |
| Archived stale captures | 6 | 0.999907 | 0.999912 | 1.000000 |
| Planted stale artifact controls | 13 | 0.949670 | 0.999872 | 0.999989 |

The 0.90 cutoff sits **0.151676 above the highest honest score** and
**0.049670 below the weakest planted stale score**. These margins describe the
retained corpus; they are not a claim about every possible photograph.
[Every archived pair and input digest](./round4/archived-pixels.json) is retained.

| Stale mutation | Score | Exported result |
| --- | ---: | --- |
| 0.98× | 0.999809 | `stale-viewonce-pixels` |
| 0.9× | 0.999872 | `stale-viewonce-pixels` |
| 0.5× | 0.999989 | `stale-viewonce-pixels` |
| 0.25× | 0.995184 | `stale-viewonce-pixels` |
| 1.25× | 0.999925 | `stale-viewonce-pixels` |
| 0.733× (between base scales) | 0.999927 | `stale-viewonce-pixels` |
| 8 px white mat in original slot | 0.999913 | `stale-viewonce-pixels` |
| Image fitted inside a different frame | 0.999835 | `stale-viewonce-pixels` |
| Brightness +120 with clipping | 0.949670 | `stale-viewonce-pixels` |
| Brightness +30 | 0.997945 | `stale-viewonce-pixels` |
| Contrast 0.6× +45 | 0.999913 | `stale-viewonce-pixels` |

The detailed synthetic fixture adds asymmetric shapes, prime letterboxing,
intermediate 0.333× and 0.733× scales, both endpoints and mat/frame changes.
Restoring Round 3's detector produces ten failing subcases. Restoring its
polling produces the transient-stale regression failure. Neither mutation
qualifies by a test error.

### Re-run checks and full artifact matrix

All **62 Python tests**, **two Bob browser tests**, **three copied-kit tests**,
TypeScript, compiled Swift journal tests, freeze checking, packet materialization
and `./ref-check --verbose` pass. The Swift test ran in disposable scratch on the
Apartment mini; [cleanup](./round4/mini-cleanup.json) confirms deletion and no
simulator use. Linux ran Python 3.12 with the pinned Pillow/OpenCV/jsonschema
versions and Node 24.13.1; the archived dependency receipts record exact versions.
The root inventory check retains its inherited Snapback-1 scripts inventory,
guide and generated-artifact failures. [Input blobs](./round4/inherited-inventory-inputs.json)
are unchanged. No affected instrument check is failing.

All **52 artifact controls** match: **50 contradictory packets reject**, while
both positive search controls pass. The two baseline packets also pass, for
**54 diagnostic evaluations**. The full [verbatim result records](./round4/artifact-controls.json)
include exact expected/actual reasons and timing. Per-case wall time covers
copying, mutation and validation through its verdict, excluding the extra score
query and archive compaction; the sum is **205.230 seconds**. There were no new
live-run operator costs. Authoring, setup, review and attention were not separately
clocked.

| Segment | Control | Exact result |
| --- | --- | --- |
| m6 | baseline | `accepted` |
| m6 | scaled-098-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | scaled-090-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | scaled-050-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | scaled-025-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | scaled-125-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | scaled-0733-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | matted-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | framed-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | clipped-bright-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | pre-reopen-viewonce-load | `viewonce-reloaded-in-cold-process` |
| m6 | online-viewonce-load | `viewonce-reloaded-in-cold-process` |
| m6 | elsewhere-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | bright-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | contrast-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | invented-video-sample | `video-sample-count-mismatch` |
| m6 | extended-video-endpoint | `video-endpoint-uncovered` |
| m6 | undecodable-video | `invalid-video-timing` |
| m6 | retargeted-viewonce | `viewonce-frame-mismatch` |
| m6 | stale-viewonce-pixels | `stale-viewonce-pixels` |
| m6 | wrong-prime-pixels | `prime-viewonce-pixel-mismatch` |
| m6 | buffered-viewonce-load | `viewonce-reloaded-in-cold-process` |
| m6 | async-viewonce-load | `viewonce-reloaded-in-cold-process` |
| m6 | old-viewonce-refusal | `viewonce-refusal-missing` |
| m6 | sent-native-a05 | `receipt-accessibility:read` |
| m6 | sent-screen-receipts | `read-render-event` |
| m6 | late-native-snapshot | `receipt-native-outside-window` |
| m6 | short-duplicate-window | `duplicate-window-too-short` |
| m6 | short-duplicate-samples | `duplicate-sample-span-too-short` |
| m6 | stale-nonce | `stale-or-unsupported-observation` |
| m6 | replayed-events | `observation-sequence-gap-or-replay` |
| m6 | missing-video | `evidence-missing:m6-ios-screen.mp4` |
| m6 | hash-mismatched-video | `evidence-hash-mismatch:m6-ios-screen.mp4` |
| m6 | truncated-video-rebound | `truncated-video-box` |
| m6 | wrong-receipts | `server-receipt-state:read` |
| m6 | one-wrong-receipt | `server-receipt-state:read` |
| m6 | empty-search | `native-conversation-identity` |
| m6 | signin-search | `native-conversation-identity` |
| m6 | wrong-search-body | `conversation-history-body` |
| m6 | search-claim-only | `conversation-screen-missing` |
| m6 | wrong-conversation | `screen-conversation` |
| m6 | instrument-commit | `instrument-identity-mismatch` |
| m6 | instrument-inventory | `instrument-identity-mismatch` |
| m6 | driver-source | `driver-source-mismatch` |
| m6 | driver-binary | `driver-binary-mismatch` |
| m6 | late-read | `receipt-deadline-exceeded` |
| m6 | search-retry | `accepted` |
| m6 | missing-post-scroll-screen | `accepted` |
| m8 | baseline | `accepted` |
| m8 | wrong-receipts | `server-receipt-state:read` |
| m8 | one-wrong-receipt | `server-receipt-state:read` |
| m8 | late-read | `receipt-deadline-exceeded` |
| m8 | stale-restart-capture | `restart-capture-before-relaunch` |
| m8 | missing-restart-screen | `restart-pending-screen-missing` |

The initial expanded test run exposed two subcase failures (scale rounding and
mat aspect distortion), fixed by bounded refinement. The initial kit invocation
used an upload fixture with the wrong basename; correcting it to `vid-01.mp4`
passed the unchanged test. Both attempts remain in the archive. [Check summary](./round4/checks.json)
and [affected corpus audit](./round4/context-and-audit.md) record disposition.

### Evidence and cleanup

Archive: `/home/ccheever/sb5-evidence-archive/20261005-ni/round4`.
The [index](./round4/evidence-index.json) binds **280 files**
(**36,686,331 bytes**) by path, size, SHA-256 and purpose. It contains
compact controls and their reconstruction metadata, frozen instrument, logs,
dependency receipts and earlier development attempts. [Export verification](./round4/export-verification.json)
confirms all retained control copies and **3,321 inherited file hashes**.
No new Git file exceeds 1 MB. [Local cleanup](./round4/local-cleanup.json) records
removal of owned scratch after export. The mini's Swift scratch was also removed.
The existing source archives, review environments and other lanes were left intact.

Phase 2 and scored admission remain disabled. No calibration, publication or push.
