# M6 iOS-simulator choreography segment

This is the frozen P1 specification for the native M6 proof. The executable
simulator driver lands with the P2 pilot; `choreography.mjs` currently records
`ios-simulator-m6` as required external evidence with `externalPass:null`.
That is intentionally non-green.

## Preconditions

- A booted iOS simulator running the lane's release-style Hermes build.
- Alice is signed in and has completed an online sync of the named M6 fixture
  conversation.
- Alice opened and closed one ordinary fixture image and one view-once fixture
  image while online. The ordinary image is therefore previously viewed; the
  view-once asset has been revoked after its single view.
- The app is terminated cleanly after sync. The backend origin and process are
  recorded, then the backend is stopped before the offline launch. No warm app
  process or live network response may satisfy the cold-start checks.
- The fixture names a search token and the two queued message bodies so receipts
  can bind observations to exact content rather than screenshots alone.

## Exact proof steps

1. Start the screen recording before launch. Confirm the app process is absent
   and the backend is stopped/unreachable.
2. Cold-launch the app. Without reconnecting, open the fixture conversation.
   Previously synced history must render from durable local state.
3. Open the previously viewed ordinary image. It must render actual media, not a
   placeholder, retry affordance, or network error.
4. Inspect the previously viewed view-once message. Its media must not render
   and no cached asset may be opened. The UI must expose the consumed/denied
   state rather than stale bytes.
5. While still cold-offline, search for the named synced-message token. The
   expected result must appear and open the owning conversation.
6. Return to the fixture conversation. Send queued body 1, then queued body 2.
   Both bubbles must appear immediately with visible `pending` state and in
   compose order.
7. Restart the recorded backend without restarting the app. Observe both sends
   flush exactly once and in original order. Bob opens the conversation; both
   Alice receipts must advance through the normal states and finish at `read`.
8. Stop the recording only after the ordered flush and final receipts are
   visible. Export structured receipts and the run manifest, then validate them
   before accepting the segment.

## Artifacts

The P2 driver writes one run directory containing:

- `m6-ios-screen.mp4` — uninterrupted recording from pre-launch offline state
  through reconnect, ordered flush, and final receipts.
- `m6-ios-receipts.jsonl` — assertion receipts compatible with
  `receipts.schema.json`, including cold history, ordinary media, view-once
  refusal, cold-offline search, pending states, flush order, and final receipts.
- `m6-ios-run.json` — bundle ID, simulator UDID/runtime, app build identifier,
  backend command/origin, fixture IDs, start/end timestamps, and SHA-256 digests
  of the video and JSONL file.

A recording without passing structured receipts is not a pass. Receipts without
the bound recording and run manifest are not a pass.

## `xcrun simctl` invocation outline

The P2 wrapper resolves an explicit UDID and bundle ID; it never targets an
unresolved `booted` device when more than one simulator is running. In outline:

```sh
xcrun simctl list devices available --json
xcrun simctl bootstatus "$CHOREO_SIM_UDID" -b
xcrun simctl terminate "$CHOREO_SIM_UDID" "$CHOREO_IOS_BUNDLE_ID"

# Stop the recorded lane backend here. Start log capture and video before launch.
xcrun simctl spawn "$CHOREO_SIM_UDID" log stream \
  --style json \
  --predicate 'subsystem == "dev.snapback.benchmarks.social-messenger.choreography"'
xcrun simctl io "$CHOREO_SIM_UDID" recordVideo \
  --codec h264 "$CHOREO_ARTIFACT_DIR/m6-ios-screen.mp4"

xcrun simctl launch --terminate-running-process \
  "$CHOREO_SIM_UDID" "$CHOREO_IOS_BUNDLE_ID" \
  --choreo-segment m6 --choreo-receipts m6-ios-receipts.jsonl

# After the offline assertions and two pending sends, restart the same backend.
# The native driver observes ordered flush/read, stops recording, hashes artifacts,
# and validates every JSONL line before returning its external pass receipt.
```

`recordVideo` and `log stream` are long-running child processes; the wrapper
tracks their PIDs, sends an orderly interrupt after the final receipt, and fails
if either artifact is missing or empty. The wrapper injects only fixture IDs and
artifact paths into the app. It does not inject a fake offline data store or a
fake successful response. Offline is established by the cold app launch while
the configured backend is actually stopped; reconnect is the restart of that
same backend.

At P2 the outer harness runs the web `m6()` segment first, invokes this simulator
driver second, validates its artifacts, and replaces `externalPass:null` with the
simulator receipt result before evaluating milestone green.
