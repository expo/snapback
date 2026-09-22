# Application evidence increment, 2026-09-22

Implements [LLP 3000.011.005.000](../../llp/3000.011.005.000-qualify-the-built-application.rfc.md).
The operational probes below passed on the isolated M5 integration checkout.
Native reference qualification and the actual calibration-16 application are
separate cells. Neither native cell has passed at this checkpoint.

## Operational results

Run on `ccheever@100.88.75.121`, checkout
`/Users/ccheever/projects/snapback-3011-20260922`, using its built CLI and client
dist, Node 24.18.0. The supervising root ran the commands serially. These are
source-checkout tests, not receipts from a published package.

| Boundary | Result | Evidence and limit |
|---|---|---|
| Stopped deployment backup/restore | Pass, 1.512 s | Password signup before backup, copied verifier, original session read, fresh password login, token rotation and old-token refusal; same asset bytes; fresh process device; original post-backup writes absent; parked job and queued effects preserved |
| Schema adoption and source rollback | Pass in the same test | Widened schema activates; destructive candidate refuses without moving state; rollback returns to release 1 at generation 3 while recovered-store writes remain |
| Queued job across process death | Pass, 2.216 s | Real scheduler admits one run before serving announces readiness; owned process stops and receives SIGKILL with state `queued`, zero chunks; same run resumes for one chunk/write/effect; another restart does not re-admit the boundary |
| Provider double, accepted outcome resolvable | Pass, 1.127 s | Worker killed after loopback provider acceptance and before either durable step or effect settlement; successor uses the same provider key; two submissions, one accepted delivery; recorded result replays; stale step/effect settlement refuses |
| Provider double, outcome unavailable | Pass, 1.135 s | Same acceptance/crash cut; successor parks the step/effect with `E_STEP_PARKED`; one submission, one acceptance, no blind resend and no `sent` claim |
| Actual push provider/device | Pending | No recipient, enrolled device, provider account or sending authorization selected |

Logs retained on M5 under `/tmp/sb4-3011-20260922/`:
`operational-release-1.log` (2/2, 3.773 s total),
`operational-provider-1.log` (2/2, 6.311 s total).
The tests use disposable directories and stop only their owned processes.
They remove their temporary databases after assertions; the logs are retained.
The recovery point is release 1, generation 1, sequence 1. All writers exit
before the entire deployment is copied into new backup and restored directories.
Restored external workers are never started; an old production device/outbox
is never connected. This is a deliberate isolation procedure, not an assertion
that copied service credentials automatically fence old production workers.

The schedule clock is set directly only as fixture setup; the real serving
host admits the job. No synthetic job, cursor, dedup or effect row is inserted.
The provider double lives in the test parent, survives the worker's SIGKILL,
and uses loopback HTTP only. It is not a real push service or a power-loss
test. SQLite remains WAL with `synchronous=NORMAL`; no durability claim extends
to physical power loss, host loss or a live-file backup.

From `snapback4/`, after the normal build prerequisites:

```sh
SNAPBACK4_BIN="$PWD/target/debug/snapback4" node --test --test-concurrency=1 \
  --test-name-pattern='stopped full-release restore|queued scheduled job' \
  packages/snapback4/test/release-activation.test.mjs
SNAPBACK4_BIN="$PWD/target/debug/snapback4" node --test --test-concurrency=1 \
  --test-name-pattern='provider test double' packages/snapback4/test/worker.test.mjs
```

## Reference native artifact qualification, before publication

The existing `scripts/publish.mjs` builds and qualifies the CLI/client pair.
It does not build or publish Expo, or run an installed simulator. The existing
`AGENTS.md` command sheet separately names the freshly installed reference
Release app and `witness/expo.mjs`. Reuse that witness for the rebuilt Expo
artifact; it does not replace the actual-app extension below.

Read-only M5 discovery found port 4400 occupied by unrelated node PID 1259
and unrelated simulators already booted. Do not use or stop those. Port 49380
was free when inspected; recheck immediately before running. Create a new
run-owned simulator rather than reuse a simulator whose ownership is unknown.
Xcode, CocoaPods, and the iOS 26.5/27 runtimes are available. At inspection the
isolated checkout had no generated reference `ios/` project or xcframework.

The root schedules these commands after the framework/package build and
before the measured cold-builder interval. From the isolated `snapback4/`:

```sh
# Root first rebuilds the candidate native artifact with the normal script:
CARGO_BUILD_JOBS=4 bash scripts/build-xcframework.sh

# Fail if the proposed origin is occupied; never reclaim its listener.
if lsof -nP -iTCP:49380 -sTCP:LISTEN; then exit 1; fi
SB4_NATIVE_UDID=$(xcrun simctl create Snapback4-3011-20260922 \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-26-5)
printf '%s\n' "$SB4_NATIVE_UDID"
xcrun simctl boot "$SB4_NATIVE_UDID"
xcrun simctl bootstatus "$SB4_NATIVE_UDID" -b

cd apps/chat-expo
EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49380 \
  ../../node_modules/.bin/expo run:ios --configuration Release \
  --device "$SB4_NATIVE_UDID" --no-bundler
# The build command launches this installed app. Stop only this owned app.
xcrun simctl terminate "$SB4_NATIVE_UDID" dev.snapback4.chat
cd ../..
WITNESS_UDID="$SB4_NATIVE_UDID" WITNESS_PORT=49380 \
  WITNESS_ARTIFACTS=/tmp/sb4-3011-20260922/native-reference-1 \
  SNAPBACK4_BIN="$PWD/target/debug/snapback4" node witness/expo.mjs
```

`EXPO_PUBLIC_SNAPBACK_URL` is embedded by the Release bundle from
`apps/chat-expo/src/client.ts`; changing only `WITNESS_PORT` afterward is
insufficient. The wrapper runs `offline` and `restart` with fresh temporary
backend projects and the existing published witness verb/helper. No Metro is
needed. Preserve the new simulator's UDID and resulting artifact directory;
use a fresh directory on failure/retry. An existing app installation on a
reused **run-owned** simulator must first be uninstalled, since its store
belongs to an earlier backend. Do not uninstall anything from another run.

This command builds workspace artifacts. Bind its compiled xcframework files
and JS sources to the exact subsequently packed package, or repeat the same
reference build in a disposable copy with the staged tarballs installed,
before calling it an installed-package proof. Record CLI/client/Expo versions,
tarball integrities, xcframework digests, installed build identity and bundle
digest alongside the driver's runtime/origin/video/receipt manifest. A source
version alone is insufficient to identify ignored native build artifacts.

## Actual Clique native adaptation, only after independent grading

Calibration 16 is at `/Users/ccheever/clique-sb4-20260922-astra-cal16` on M5.
At this checkpoint it contains an untouched cold packet, pending package pins
and no builder output. Its instrument and prompt templates remain unchanged.
The timed task requires a Hermes export and makes native installation optional;
the extension must be recorded separately from the comparable grader's verdict.
No plan, prior source or operational-test result is passed into the cold lane.

After the builder and independent grader finish, retain hashes of their final
app, package lock, package pins and reports. Create a disposable extension
copy of that exact app and its stopped backend store. Install its exact lock
and packages. Add only the app-owned runner around `snapback4-expo/witness`
and minimal real-screen navigation needed for these observations. Preserve
the extension diff; a necessary behavior repair gets its own reproduction and
rerun, rather than silently becoming evidence for the graded source.

Prior cal15 source was inspected read-only to make this adaptation concrete.
Its router entry is `app/_layout.tsx`, with `AccountProvider` in
`src/session.tsx`; `src/client.ts` restores a password session through
SecureStore and selects `nativeDevice`, with ordinary viewed-media retention.
Its real conversation/search screens are `src/chat.tsx`/`src/search.tsx`.
The following is a mapping checklist for the **new app**, not an assumption
that cal16 must reproduce those names:

| Observation | Cal15 integration point to locate in the graded app |
|---|---|
| Single native client shared with the real screen | Account provider after SecureStore restore; require `nativeAvailable()` and a local client, never accept the online fallback |
| Authorized history and horizon | Generated `api.chat.history`, real conversation route and its page/complete state |
| Held search | `api.chat.searchChat` and `api.chat.searchAll`, actual search screen and incomplete/offline text |
| Ordinary and view-once media | `client.asset`, `api.chat.sendMedia`, `api.chat.markViewed`, `MediaViewer`; revoke the consumed once handle before terminating |
| Two persistent offline intents | `api.chat.send`; persist both explicit message IDs **and** mutation IDs plus bodies in the app's existing durable storage |
| Settlement and receipts | `client.onWrite`, authoritative history, `api.chat.acknowledge`; distinguish sent from the other participant's delivered/read state |
| Revocation boundary | `api.chat.removeMember`, compiled sync declarations, recipient snapshot/read rules and real retained-history UI |

Implement bounded sequential steps with assertions before completion; reuse
the published helper's own failed-step receipts. Keep the actual app screen
visible, with brief render waits and its existing pending/horizon affordances.
Do not replace its screens with a reference chat or render only a test label.

1. `prime`: authenticate an isolated test principal online through the actual
   app flow, acquire a known authorized history and searchable term, show an
   ordinary image/video and fetch its bytes, consume one once asset and revoke
   its handle. Record exact expected row IDs and media digests without tokens.
   Complete `primed` only after `client.acquired` and the required rendered
   content are observed. The driver then terminates the app and its backend.
2. `restart`, first offline launch: verify link offline, held rows/search and
   media bytes, truthful incomplete horizon, and no durable once bytes. Compose
   two messages with saved intent/message IDs; assert exactly those two pending
   bubbles, persist their IDs, and complete `relaunch`.
3. Second offline launch: restore the same session/store; assert the same two
   pending IDs/bodies without another mutation call. Complete `offline-done`,
   await the driver's `reconnect`, then observe ordered `sent` receipts and
   exactly two authoritative rows. Drive the other test participant's actual
   acknowledge mutations and verify delivered/read progression on the screen.
4. A separate revocation run primes authorized history, removes the viewer
   through the admin's actual mutation, commits a later message for remaining
   members, and waits until the target has learned the leave. Assert which
   earlier rows/media the app's declared policy retains and that the later
   message is absent; relaunch offline and repeat those assertions. Prime mode
   receives only `segment=prime`, so choose this scenario via a persisted
   app-owned extension setting prepared between runs, not a new driver flag.

Run the built extension with the existing command, from its backend project,
using the actual app's bundle ID and baked free loopback origin:

```sh
./node_modules/.bin/snapback4 witness ios --bundle-id "$CLIQUE_BUNDLE_ID" \
  --udid "$CLIQUE_WITNESS_UDID" --segment restart \
  --artifacts "$CLIQUE_EXTENSION_ARTIFACTS/restart-1" \
  --port "$CLIQUE_WITNESS_PORT" --prime --relaunch
./node_modules/.bin/snapback4 witness ios --bundle-id "$CLIQUE_BUNDLE_ID" \
  --udid "$CLIQUE_WITNESS_UDID" --segment revocation \
  --artifacts "$CLIQUE_EXTENSION_ARTIFACTS/revocation-1" \
  --port "$CLIQUE_WITNESS_PORT" --prime
```

For the revocation run, complete `offline-done`, wait for reconnect, then
complete `done`; the same protocol serves application-specific assertions.
Recheck packet port ownership after grading; cal15 baked 49360, but cal16's
actual configuration decides its origin. Never reconfigure or start anything
in the cold packet before its timed run and grading finish.

## Full retained acquisition on the actual app

Use the grader's full retained fixture and a fresh native device store. Before
timing, write down the principal, exact fixture counts/digest, required history,
search and ordinary viewed assets, horizon, and compiled residency report.
Record mount-to-first-useful-render at the real screen; record completed
durable acquisition independently through `client.acquired`/`onAcquired`.
If the actual opener blocks mounting until sync ends, report that coupling
rather than move the timing start past it.

Count actual `/changes` transferred rows and response bytes using an observing
fetch wrapper that returns the original responses and never gates delivery.
State explicitly whether bytes mean uncompressed response-body bytes, not
network framing/TLS bytes. After terminating the app, measure its actual
container's database, sidecars and retained-media files. Sample app-process
memory only if the simulator host exposes it and label the metric precisely;
otherwise peak memory is absent. JavaScript heap is not total native memory.
Finally cold-launch with the backend stopped and assert the declared held
content again. Missing acquisition or missing peak memory remains visible in
the coverage table. Small reference timings and server query latency do not
fill this cell or support a physical-floor ratio for a different fixture.

## Real provider prerequisite, still pending

The inspected cal15 `scripts/push-worker.mjs` is a JSONL sink, not a push
adapter. Its app has no `expo-notifications` dependency or device enrollment
in the inspected source. No usable real-provider configuration was established.

A proposed later exercise is one explicitly authorized Expo Push Service
notification to one selected test recipient/device: title `Snapback
qualification`, body `One test notification for the approved device`, unique
witness ID in `data`. It needs a selected Expo project/account, enrolled
app build/bundle and recipient push token, device owner's authorization, and
access-token configuration if enabled. Supply secrets through existing secure
configuration; do not put recipient tokens or service credentials in artifacts.
No send has been performed or authorized by this plan.

Retain effect admission, provider ticket, later provider receipt, and actual
device observation separately. Expo documents at-least-once handoff, and its
receipt does not prove device receipt. A lost ticket is unresolved; do not
infer deduplication from the loopback double or blindly resend a potentially
accepted notification. See the [provider's delivery documentation](https://docs.expo.dev/push-notifications/sending-notifications/).
