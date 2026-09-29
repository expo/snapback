# SR round 0 — social starter routes and offline custody

Base: `aedd35615ad54901a481a01481e5d8f6110c69b4`; branch `sb4-intent/sr-starter-routes`.
Local changes only. No push or publication. Governing design: LLP 3000.028 §8;
orientation and constraints are in [CONTEXT.md](./CONTEXT.md).

## Result

Send now enters the existing intent journal and SDK custody while membership is
loading, withheld or revalidating. Only denial or a non-revalidating absent row
disables it. The screen distinguishes a quiet checking hint from confirmed removal,
keeps the draft, and shows each failed send as **Not sent** with its text, Edit and
Dismiss. `seen` still needs current membership and visible settled messages.

Profile's Message action resolves a replicated private `(owner, peer)` key. A
complete current miss creates one proposed ID; two directional keys and the
memberships are inserted in the same server transaction. Concurrent opposite-side
opens converge. Held keys reopen offline. Creation predicts after acquisition;
missing coverage does not fabricate absence. Prediction is provisional: the
server may choose a previously committed ID.

At custody, navigation pins the proposed ID and opening write ID. The canonical
ID replaces the URL through Expo Router `setParams`, keeping composer identity,
draft, attachment and focus. A ready non-pending replicated key also resolves
receipts without historical results. Reopening a prediction recovers the opening
write from `usePendingWrites`. The proposed ID remains a navigation reference so
sends rejected against it stay editable even after canonical redirection; no send
is retargeted or automatically resubmitted. Current protected reads remain owned
by the SDK, and account/backend/ordinary-route ownership resets remain.

The schema's two small private keys avoid a public pair registry, ordered-principal
comparison or union sync audience. Keys have no horizon and survive leave; they
provide identity, never membership or protected-content access. Existing invite,
leave, send and media rules are unchanged, as are SDK semantics, typing, retention
and delivery reporting. The recipe explicitly leaves those membership semantics
in place; opening an existing DM does not silently rejoin either participant.

Guide aliases: schedule/schedules/cron → jobs; dm/direct message/chat → social;
expo/ios/react native → client. Registered multiword phrases resolve quoted or
unquoted at the CLI. Native's opening paragraph points to the Expo
client and witness cards. The calibration log's other lookups named existing
cards or diagnostics; no additional ambiguous aliases were added.

## Verification

| Check | Result / evidence |
| --- | --- |
| Affected starter + browser tests | **25 passed, 0 failed**; [affected-final.log](./affected-final.log.gz) |
| Real dev server, both process/native and wasm replicas | Concurrent opens, both-direction repeat opens, private keys, predicted offline creation, canonical settlement and held offline lookup; included above |
| Browser send lifecycle | Loading/revalidating/offline custody and later server delivery; confirmed denial/absence keep draft; queued sends after removal settle with text/Edit/Dismiss; included above |
| Browser DM lifecycle | Slow lookup does not create; Profile opens a DM; held and pending DMs reopen offline; canonical settlement keeps draft/focus and failed provisional sends; included above |
| Production Expo Router + React Native Web | Same composer DOM node, draft and focus after offline creation resolves to peer's existing ID; zero page errors; [expo-route-smoke.log](./expo-route-smoke.log.gz), [reproducible smoke](./expo-route-smoke.mjs) |
| Generated starter check | **17 tables, 29 operations, no problems, 6 notes**; [check.log](./check.log.gz), [prediction explanation](./open-direct-why.log.gz) |
| Generated web/Expo TypeScript | Workspace-generated app and five embedded guide snippets pass in affected tests; installed app also passes TypeScript 6.0.3; [typecheck-installed.log](./typecheck-installed.log.gz) |
| Production web export | Pass on final sources; [export-web-smoke.log](./export-web-smoke.log.gz) |
| iOS export | Pass, Hermes bytecode v98; [export-ios-final.log](./export-ios-final.log.gz), [hermes-format.log](./hermes-format.log.gz) |
| Whole guide | **99 passed, 0 failed**; [guide-final.log](./guide-final.log.gz) |
| README budget/self-containment | **300/300** package README lines and self-containment pass; [docs-budget.log](./docs-budget.log.gz) |
| Whole blocking suite | **1 failure: client tests**, the baseline remount assertion below; all other stages, including client models, passed. [suite.log](./suite.log.gz) |

Exact summary: **`== 1 failure(s) in 1348 s`** (exit 1). Its failure list is
`client tests`; the single failing test is the inherited remount check detailed
below. There were no SR-owned or environmental failures in this full run.
The nominal 60-second budget was exceeded; no timeout or count was relaxed.

The full suite was invoked once. Final small starter/CLI refinements made during
its long run were followed by the final affected tests and whole-guide run shown
above; the full suite was not restarted.

Exports use locally packed client/Expo packages, not an npm publication. The app
installs its declared dependencies before exports. Toolchain: Node 24.13.1,
Rust 1.97.0, wasm-bindgen 0.2.127. The web witness uses actual Expo Router and
React Native Web; the faster browser tests use DOM counterparts and controlled
navigation/read delays. Neither claims an iOS/Android native runtime witness.
The optional macOS native smoke was not run on this Linux host.

No budget changed: client card **130/130** content lines; package README
**300/300**; starter README **107** lines, unchanged from base. The social card
embeds the starter's current files. The whole guide passes; touched source files remain below 1,500 lines.
Wasm: **2,040,529 B raw; 592,975 B gzip**, cap **593,719 B**, headroom **744 B**.
Both the standalone build and blocking suite report the same size
([wasm.log](./wasm.log.gz)). Wasm SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No engine, device or SDK source changed; no wasm size reduction is claimed.

## Every observed failure and disposition

Raw logs are gzip-compressed verbatim; their contents and exact summary are preserved.
Staging initially flagged trailing spaces in raw diagnostic logs (ours, artifact
formatting); compression preserves those bytes and leaves the source diff clean.

All task failures below were corrected. One inherited timing-dependent test
failure remains in the full suite; no final affected test failure remains.

| Classification | Failure | Disposition / evidence |
| --- | --- | --- |
| Baseline — open follow-up | `online: keep remount lifetime, isolation, last subscriber and sign-out`, `keep-device.test.mjs:162` | Strict snapshot identity sees `revalidating: true`. Same failure on an independently built starting-commit server: **4/10 baseline**, **9/10 current** focused repetitions; preliminary runs were baseline pass/current fail. [Outcomes](./keep-repetition.json), [baseline stacks](./baseline-keep-repeat.log.gz), [current stacks](./current-keep-repeat.log.gz), [ticket](../../../issues/20260929-snapback4-keep-remount-snapshot-identity.md). No retention changes in SR. |
| Ours | Initial browser typing renewal timeout | New disconnect/custody test left the separately owned online typing arm offline. Explicitly recover that fixture arm before the existing cadence test; no typing implementation change. [affected-1.log](./affected-1.log.gz) |
| Ours | New Not sent assertion failed | Starter rendered only the refusal message. Add the required Not sent prefix, preserving per-intent text/Edit/Dismiss. Same log. |
| Ours | Account reset media timeout | Cascaded from the preceding failed assertion skipping membership rejoin. Passed after the assertion's underlying UI fix. The parent browser test failed because of these three children. Same log. |
| Ours | Native and web DM tests expected a recovered result | Recovered receipts can lack a historical result. Assert sent, then the authoritative replicated key/canonical ID; keep the UI fallback. [affected-1.log](./affected-1.log.gz), repeated in [dm-1.log](./dm-1.log.gz). |
| Ours | Initial browser DM test saw the peer's null lookup | The test checked server visibility immediately after custody. Wait for the independent server publication; no product workaround. [dm-1.log](./dm-1.log.gz). |
| Ours | Whole-guide published-path guard rejected three new app paths | Register exactly the three scaffolded app inputs in the existing app-file list; do not widen it to an arbitrary directory. [guide.log](./guide.log.gz). |
| Ours — setup | First web export lacked react-native-web | Workspace dependencies do not replace the generated app's npm install. Install its declared dependencies, then export successfully. [export-web.log](./export-web.log.gz), [install-export.log](./install-export.log.gz). |
| Ours — smoke setup | First production smoke timed out before Profile | Metro reused the earlier default-URL transform after configuration changed. Export with --clear for the dynamically allocated backend URL. [expo-route-smoke-initial.log](./expo-route-smoke-initial.log.gz). |
| Baseline — corrected here | Unquoted `guide direct message` used only the first positional word | Recognize an entire registered card/alias phrase before the existing first-word fallback. Quoted and split-word CLI calls now have regression coverage. |
| Ours — smoke setup | Second production smoke stayed signed out | Preloading only localStorage did not establish the session store's authority. Use normal guest sign-in through the app. [expo-route-smoke-session-seed.log](./expo-route-smoke-session-seed.log.gz). |

Initial exploration also made a few wrong-working-directory/path calls (log
redirection, a probe binary, one test-edit script, baseline archive extraction
and a TypeScript version query).
These were ours, occurred before the intended command ran, and were corrected.
A blanket rm-style cleanup command was rejected by automatic approval review;
no files were removed by it. Only the two identified empty scratch files were
later unlinked after checking they were empty. No permission escalation was needed.
Those setup mistakes are independent of the inherited remount-test failure above.
No environmental product/test failure is claimed.
The first prediction explanation was corrected after measuring the real pending
footprint: both hosts predict all five rows; [dm-prediction.log](./dm-prediction.log.gz).

The baseline reproduction archives the starting commit's Snapback 4 subtree and
builds its server into a separate target directory ([baseline-build.log](./baseline-build.log.gz)).
Its original test runs against that binary. It reuses the source-matched compiled
SDK/wasm only after `git diff --exit-code` verifies no changes to SDK/core/device
or the test ([baseline-inputs.diff](./baseline-inputs.diff), empty). All ten
outcomes per arm are retained; the baseline failure was not inferred from timing
or from an unrelated prior report.

## Scope and remaining limits

No score improvement is claimed without a new cold-builder/scorer run. Offline
opening requires acquired key coverage; an unacquired device honestly waits.
Expo Go remains the online tier. A send admitted against a losing proposed ID
can be refused; it stays editable instead of being silently rewritten.
Native smoke is optional for this commission and remains unqualified here.
