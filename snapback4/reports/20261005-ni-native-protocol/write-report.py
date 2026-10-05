#!/usr/bin/env python3
"""Render the NI closeout from retained measurements; no scores or calibration."""
import json
from pathlib import Path
import re

here = Path(__file__).resolve().parent
mini = here / 'evidence/mini'
read = lambda name: json.loads((mini / name).read_text())
identity = read('identity.json')
attempts = read('attempts.json')
names = [Path(line).name for line in (mini / 'qualification-closeout.stdout').read_text().splitlines()
         if line.startswith('/private/tmp/') and '/runs/' in line]
final = [next(a for a in attempts if a['directory'] == name) for name in names]
assert len(final) == 10
controls = read('artifact-controls-closeout/results.json')
unavailable = json.loads((here / 'evidence/unavailable-host.json').read_text())
cleanup = json.loads((here / 'evidence/cleanup.json').read_text())
assert cleanup['scratch']['absentAfter'] and cleanup['stateAfter'] == 'Booted'
assert all(c['rejected'] for c in controls) and unavailable['pass'] is None
labels = {'collapsed-receipt':'Collapsed receipt accessibility', 'none':'Known-good',
          'placeholder':'Placeholder + false load event', 'volatile-outbox':'Outbox erased on termination',
          'duplicate-sends':'Duplicate server sends', 'reversed-sends':'Reversed server sends',
          'stale-viewonce':'Stale view-once pixels + denied event', 'wrong-fixture':'Wrong fixture IDs',
          'bob-wrong-conversation':'Bob in wrong conversation'}
lines = []
for a in final:
    status, operator = a['status'], a['operator']
    control = operator['control']; cost = status['cost']
    outcome = 'PASS' if status['pass'] is True else ('REJECTED — product failure' if status['pass'] is False else 'REJECTED — setup unmeasured')
    if control == 'none': assert status['pass'] is True
    elif control == 'wrong-fixture': assert status['pass'] is None
    else: assert status['pass'] is False
    url = './evidence/mini/runs/' + a['directory'] + '/evidence/status.json'
    lines.append(f"| [{labels[control]} ({operator['segment'].upper()})]({url}) | {outcome} | `{status['reason'] or 'all assertions passed'}` | {operator['wallSeconds']:.3f} | {cost['wallSeconds']:.3f} | {cost['nativeCommands']} | {cost['enteredSteps']} |")
matrix = '\n'.join(lines)
artifact_matrix = '\n'.join(f"| {c['control']} | rejected; native null | `{c['reason']}` | {c['wallSeconds']:.3f} | 1 |" for c in controls)
prior = [a for a in attempts if a['directory'] not in names]
prior_lines = []
for a in sorted(prior, key=lambda a:a['directory'].rsplit('-',1)[-1]):
    s,o=a['status'],a['operator'];cost=s['cost'];state=json.dumps(s['pass'])
    prior_lines.append(f"| `{a['directory']}` | {state} | `{s['reason'] or 'passed'}` | {o['wallSeconds']:.3f} | {cost['nativeCommands']} | {cost.get('enteredSteps',cost.get('completedSteps'))} |")
good = [a for a in final if a['operator']['control']=='none']
build = read('build-8.json')
audit = read('source-audit.json')
total_driver = sum(a['status']['cost']['wallSeconds'] for a in final)
total_operator = sum(a['operator']['wallSeconds'] for a in final)
good_operator = sum(a['operator']['wallSeconds'] for a in good)
all_operator = sum(a['operator']['wallSeconds'] for a in attempts)
body = f'''# NI — accepted native protocol, Phase 1

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

## Qualified instrument and custody

- Instrument: `social-messenger@0.4.0-native.1`; protocol `clique-native/1`.
- Qualified source commit: `{identity['commit']}`.
- Inventory SHA-256: `{identity['inventorySha256']}` (69 files).
- Native binary: `{audit['build']['nativeSha256']}`.
- Hermes bytecode: `{audit['build']['hermesSha256']}`.
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

## Complete final qualification matrix

All rows below use the qualified source/inventory above. `Run wall` is the
measured outer command from pre-run uninstall through driver execution and
post-run uninstall; `Driver wall` includes installation, prime, measurement,
validation and process cleanup. Each live run has two operator steps: invoke
the named command and review retained evidence. `Native commands` counts bridge
requests, not individual keystrokes; two cleanup bridge commands are additional.
`Entered steps` includes a failing step and is not a completed-step claim.

| Subject | Result | Exact reason | Run wall (s) | Driver wall (s) | Native commands | Entered steps |
| --- | --- | --- | ---: | ---: | ---: | ---: |
{matrix}

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
{artifact_matrix}
| unavailable SSH host | unmeasured; exit 0 | `{unavailable['reason']}` | {unavailable['wallSeconds']:.3f} | 1 |

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
{(mini/'qualification-closeout.stdout').read_text().strip()}
```

Verbatim final artifact-control output:

```text
{(mini/'artifact-controls-closeout.log').read_text().strip()}
```

Verbatim unavailable-host receipt:

```json
{(here/'evidence/unavailable-host.json').read_text().strip()}
```

## Actual operator cost and evidence limits

The final known-good M6+M8 pair took **{good_operator:.3f} s** of measured outer
run wall, four operator steps, and 96 native bridge commands plus cleanup.
The final warm own-Release rebuild took **{build['wallSeconds']:.3f} s**. That is
a small reference with installed dependencies and existing DerivedData, not a
cold-build forecast. The first cold preparation was not timed by a whole-operation
clock; its logs are retained and no cold median is invented. The preceding warm
build took 9.485 s. Actual human/agent attention was not separately clocked.

The ten final live runs consumed {total_operator:.3f} s of outer wall
({total_driver:.3f} s inside the driver), 20 operator steps. Across all
{len(attempts)} retained live attempts, measured outer wall sums to
{all_operator:.3f} s, excluding builds, dependency setup, export/review and
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
{chr(10).join(prior_lines)}

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
'''
(here / 'REPORT.md').write_text(body)
absolute = re.sub(r'\]\((?!https?://|#)([^)]+)\)', lambda m: '](' + str((here / m.group(1)).resolve()) + ')', body)
(Path.home() / 'sb5-lanes/ni.report.md').write_text(absolute)
print(json.dumps({'report': str(here / 'REPORT.md'), 'outsideReport': str(Path.home() / 'sb5-lanes/ni.report.md'),
                  'finalRuns': len(final), 'allAttempts': len(attempts)}))
