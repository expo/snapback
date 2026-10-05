# NP2 — native calibration protocol feasibility

Date: 2026-10-04. Branch: `sb5/np2-native-protocol`. Base:
`1c18847b79abcffeb74ce04ec87b813caa46f53e`. Author: GPT-6 Astra.

## Recommendation for Charlie

**Adopt the full protocol in the next instrument version, after an unscored
two-app/two-backend pilot.** Partial adoption ranks second; keeping native
unmeasured ranks third. [LLP 0201.000](../../../llp/0201.000-cross-lane-native-app-protocol.rfc.md)
is **Review** and contains the contract, eight-step driver, proposed prompt,
grader policy, cost estimates, alternatives and explicit series break.
It is under LLP 0201, which owns the instrument. LLP 3000.013 owns Quarry
authoring forms and explicitly preserves the frozen instrument.

The existing kit provides much of the selector vocabulary, but not the
fixture/observation protocol or proof that those selectors work in native
trees. This probe also found a launch failure that Hermes export could not
reveal. Nothing here changes a calibration's historical score.

## What was inspected and run

Subject: **Grok cal30, Snapback 4 0.4.12**, from
`~/clique-sb4-20261003-grok-cal30/attempts/builder-completed` on the Apartment
M5 Pro mini (`100.64.36.16`). An existing read-only eb1000 copy supplied the
initial source audit. All 67 audited app/kit source files were then hash-matched
against both the mini custody clone and the scratch app. The dependency lock
also matched. See [source integrity](./evidence/source-integrity.json).

Every Mac command ran over SSH on the mini. All working files were under
`/tmp/np2-native-protocol-20261004`; only simulator
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B` was targeted. It was already booted and
was left booted. Neither the black M5 nor the office M1 was contacted.
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` selected Xcode 27
per command; the machine's global developer-directory setting was not changed.

The app's existing dependencies were copied with APFS clone copies; there was
no link back to custody for writes. Its kit dependency points relatively to
the scratch `ui/`. `expo prebuild` and CocoaPods created native output in scratch.
The app's TS/TSX and UI kit were **not edited**. Experimental differences were:

- Native bundle ID `dev.snapback.np2.cal30` to avoid overwriting another app.
- `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49481` at Release bundling.
- External `NP2Driver` XCTest target in the generated Xcode project.
- Fresh scratch backend data and a small synthetic Alice/Bob fixture; this is
  **not** the original calibration database or a calibrated seed.
- A seed helper in the copy, generated native project/dependencies and the
  ordinary prebuild script changes to scratch `package.json`.

The backend was the copied published Darwin binary. The fixture used ordinary
lane signup/profile/DM/send/media operations. It created a searchable message,
ordinary image and view-once image in one DM. No auth session, replica, queue,
asset-cache state or success result was injected into the app.

## How much of the protocol already exists

[Source census](./evidence/source-audit.json): **16/16 selected existing IDs
occur in the mounted-screen/kit source closure**. This number means source
presence, not sixteen working native controls. It does not include the RFC's
three new navigation IDs or observation hook.

| Surface | Existing support | Remaining uncertainty or gap |
| --- | --- | --- |
| Sign-in (3 IDs) | Root mounts kit `AuthForm`. | Not reached successfully in native runtime. |
| Chat list (1 ID) | `ChatListRow` carries `dm:<handle>` accessible value. | Dynamic chat value and tree exposure unverified. |
| Composer (2 IDs) | Kit message variant supplies input/send. | UI input and queue behavior unverified. |
| Bubble/receipt (2 IDs) | Shell bubble wraps kit bubble; receipt value is `pending/sent/delivered/read`. | No stable message-ID value; nested accessibility may hide children. |
| Media/view-once/error/viewer/close (5 IDs) | Shell and kit expose all five spellings. | Ordinary viewer branch renders `<Text>image</Text>`, not an Image; no load hook. View-once opened state is transient component state. |
| Search (3 IDs) | Input/results/offline marker mounted. | `onPressResult` only handles `person:`; `msg:` tap does not open its conversation. |

The numeric split is 3 + 1 + 2 + 2 + 5 + 3 = 16. Source locations and hashes
are in the census. Relevant app details:

- `src/Conversation.tsx:198–203` implements the ordinary viewer placeholder;
  `:292–295` wraps/renames the kit bubble, making native hierarchy qualification
  necessary. This is a static finding, not an executed media assertion.
- `src/SearchScreen.tsx:39–43` has only the people-result navigation branch.
- `src/useOnceMedia.ts` closes/revokes a handle and clears component state;
  persistence/refusal must be observed, not inferred from its presence.
- `src/client.ts` selects the native replica when available and requests
  viewed-asset retention. Those declarations are not runtime proof.
- There is **no cross-lane fixture descriptor or passive receipt hook**.
  `src/native-smoke.ts` is a no-op effect for this app. Its scripts explicitly
  disable native smoke, consistent with the old optional-native prompt.

## Runtime result and the eight steps

**Zero of eight steps completed as a qualifying `simulator.md` proof.** Online
priming failed before sign-in, so the frozen prerequisites never held.
The raw lifecycle mechanics of step 1 did execute in a diagnostic run; this
does not turn the unprimed run into a passing native artifact.

The Release app and driver built successfully. XCTest's first native tree had
**zero `sm-*` nodes**; `sm-auth-email` never appeared. The simulator log shows:

```text
Unsupported top level event type "topContentSizeChange" dispatched
RCTFatalException: Unhandled JS Exception
```

The exception occurred with the backend online during prime (app PID 7357).
A separate online `simctl launch` (PID 9701), without XCTest, also exited and
logged the same failure. A recorded backend-stopped launch (PID 10764) repeated
it. This bounds the observation to this copied app/build/toolchain; it does
not identify the responsible RN, Expo, app, or platform component, and does
not establish the historical cal30 app's behavior on other native toolchains.
No runtime fix or dependency substitution was attempted.

| Frozen step | What this probe completed | What blocks a qualifying result |
| --- | --- | --- |
| 1 | Started video; recorded app absence and stopped/unreachable owned backend before direct launch. | Alice had never completed online prime. |
| 2 | Installed Release app launched cold; crash retained. | No restored session/history; same crash already observed online. |
| 3 | Not run. | Priming/launch failure; source also exposes ordinary viewer placeholder. |
| 4 | Not run. | Alice never opened the seeded view-once image; cannot assert consumption/refusal. |
| 5 | Not run. | Launch failure; source also lacks message-result navigation. |
| 6 | Not run. | No conversation UI or queued-state observations. |
| 7 | Not run. | No queued sends, server count/order or Bob/read observations. |
| 8 | Diagnostic video/logs/manifest exported and hash-bound. | No passing assertion receipts or successful flush/read sequence; not the frozen artifact. |

M8 was not attempted because its native session prerequisite also failed.
The prototype deliberately does **not** emit `ios-simulator-m6 pass:true`,
schema-shaped fake receipts, or an O4 score. Its files use `prototype-*` names.
The proposed full driver and helper remain design, not implemented qualification.

## Measured preparation and operator cost

| Observation | Measured result |
| --- | --- |
| First test-target build attempt | 5.13 s; failed because prototype target lacked `PRODUCT_NAME`. |
| Corrected Release app + driver build | **128.95 s**, exit 0; six build jobs, empty task DerivedData, existing npm/system/download caches. |
| First seed | Failed: the prototype supplied an empty profile URL, rejected by the app. |
| Corrected seed | Passed with valid fixture URLs on a fresh scratch store; no timed claim. |
| XCTest prime attempt | **36.28 s** command wall; test failed on absent auth field after app exception. |
| Full eight-step / M8 cost | **Not measured**, blocked before prime. |

Toolchain: Xcode 27.0 build 27A266a, iOS 27.0 simulator, Node 24.18.0,
Expo 57.0.22, React Native 0.86.3, Snapback/Snapback Expo 0.4.12.
The first load sample was 8.53/15.63/34.98; this was a shared mini, not a quiet
benchmark. The initial global `xcrun` probe failed under CommandLineTools;
per-command `DEVELOPER_DIR` solved invocation. Xcode's diagnostic collector
still logged its own `simctl` lookup failure; direct tool invocations worked.

The RFC budgets **11–24 minutes elapsed / 3–6 minutes attention per successful
calibration**, including build, M6, M8, validation and cleanup. These are
planning estimates awaiting pilots; the 129-second build is not an end-to-end
native proof time. One instrument implementation week plus pilot/review is also
an estimate. Keeping native unmeasured adds no native operator time.

## Assertion accounting and scoring

The reported **16 unscorable M6/M7 assertions per run** split into seven native
M6 assertions and nine unrun M7 day-two assertions. The source manifest labels
none of M7 as simulator. Two further native assertions live in M8. This proposal
could make **nine native assertions** measurable; M7 needs its own session.
The ticket's old title/body is preserved with a dated count correction.

Old prompts and results stay frozen. The new prompt/helper changes builder
work as well as native measurement, so the RFC requires a new version and an
honest series break, not merely new O4 labels on one continuous score line.

## Retained evidence, reproduction and cleanup

- [Prototype manifest](./evidence/prototype-run.json): host, runtime, build and
  Hermes hashes, app file inventory and per-step status.
- [XCTest log](./evidence/prime.log), [online direct crash](./evidence/direct-online-crash.txt),
  [offline crash](./evidence/cold-crash.txt), [host lifecycle](./evidence/host-events.jsonl).
- [Diagnostic video](./evidence/prototype-screen.mp4); it records the unprimed
  offline launch failure, not native behavior passing the eight-step spec.
- [Evidence digests](./evidence/SHA256SUMS), [cleanup receipt](./evidence/cleanup.json).
- `build*.log.gz`, `pods.log.gz`, `prebuild.log.gz`: preparation evidence,
  including the first failed target setup. Failed seed retained separately.
- [Reproduction](./REPRODUCE.md): scratch-only setup and bounded commands.
  `NativeProbe.swift`, `add-driver.rb`, `seed-probe.mjs`, `host.py` and
  `audit-source.py` are feasibility code, not installed instrument tools.

The task's backend and video processes exited. Both unique probe app bundles
were uninstalled from the dedicated simulator. Scratch was deleted after the
evidence was copied and hashed; the cleanup receipt confirms absence. The
simulator stayed booted and was neither erased nor deleted. The custody clone
was never built in or modified. Frozen files and calibration packets have no
git diff. No push or publication.

Cleanup completed at **17:42:41 UTC**, after 19 transferred evidence files were
hash-verified against the mini originals. The initial setup's two failed
attempts remain in the evidence; they were not discarded from the record.

Validation: the Swift runner compiled in Release and executed (one
runtime-blocked test failure, not a green test); Ruby project generation and
host lifecycle operations executed; Python and seed JS syntax checked;
`./ref-check --verbose` **passes: 0 errors, 0 unchecked** (528 LLP documents).
No full product suite was
needed for this design/report-only lane.
