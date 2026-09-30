# Proving it on an iOS simulator

The iOS witness records native offline execution on macOS. It can prepare a bounded
own Release build, or run an already installed app, then retain receipts and video.

```sh
npm run native:smoke
# Equivalent, from the backend/Expo project:
npx snapback4 witness ios --build . --smoke
# Explicit device, or an already installed Release app:
npx snapback4 witness ios --smoke --bundle-id com.example.chat --udid "$UDID" --port 4400
```

For a heaviest-account proof on any CLI host, use `witness acquire --as <persona> --restart` (`guide bounds`).
At every milestone, run `npm run export:ios` for the Hermes export; on a Mac with Xcode, `npm run native:smoke` (about 3 minutes warm).
Both Expo starters provide these scripts; export alone proves no native execution.

The build route chooses a free backend port and writes fresh artifacts under
`artifacts/native-smoke/<timestamp>`. Reuse requires an available booted device, the smoke prefix, and a creation record
in `$XDG_STATE_HOME/snapback4/witness/simulators` (default `~/.local/state/`). Records and their directory must be user-owned, not symlinks or writable by others.
Otherwise it creates a current iPhone; unsafe records are ignored with one warning.
Newest iOS runtime wins. Device identity is recorded before boot; names alone prove no ownership. `--udid` chooses an explicit booted
device; `--port` and `--artifacts` override defaults. Shared-host lanes can set
`SNAPBACK4_SMOKE_DEVICE_PREFIX=sb4-ns-` to isolate selection and creation.
The socket stays owned through backend startup. Devices remain for warm runs; delete their recorded UDIDs when finished.
Without Xcode or an iOS runtime, one setup message appears before any build.

Use matching `snapback4` and `snapback4-expo` packages, with `createApp` and
`AppProvider` using `nativeDevice`. The older `createLocalClient` path also works.
Release embeds JavaScript; no Metro server is needed. The starters call normal
`auth.guest()` during smoke prime only if no account was restored. Other apps
must sign in normally first if authentication requires interaction. The driver
supplies no credentials. Installed-app mode builds nothing and defaults to port
4400; configure the app for that origin or pass its matching `--port`.
The driver owns its backend and refuses existing listeners and simulator owners.

Read `artifacts/native-smoke/<timestamp>/smoke-ios-run.json`: `exitStatus: 0` and all
three `segments` marked `passed` mean:
- `prime`: the own client is online and acquisition is complete. The receipt
  records the device's held counts per synced table, backend store identity,
  generation, watermark and link, with no uncaught JS errors.
- `offline`: after termination and verified backend connection refusal, the
  cold app opens its kept store, reports offline and holds the same counts.
  Every query whose arguments are all optional (including no arguments) runs
  through the app's client. `queries` records ready/count/completeness or an
  explained refusal for compiler-declared device-answerable reads. Loading,
  a thrown query or an uncaught JS error fails for those reads. Server-only
  reads are recorded as `online-only: unavailable offline (expected)` with
  their actual `E_OFFLINE`-style refusal. The driver reads
  the committed compiler generation actually served by its owned backend and
  includes its generation and complete eligible query facts in each receipt.
  Before querying, the helper matches every runs/held fact and the generation
  against the kept backend; missing or stale facts fail. A loading result
  never determines the classification.
- `restart`: after another termination and backend restart, the cold app is
  online and its watermark has reached the exact `syncBarrier.seq` passed
  by the driver, not merely a tail persisted after prime. The driver inserts
  this zero-write commit while the backend is stopped; it changes no
  application data. Eligible server-only queries must return data in both
  prime and restart; their online loading or refusal fails.

Each segment has timings, a receipt and a screenshot (`smoke-ios-prime.png`,
`smoke-ios-offline.png`, `smoke-ios-restart.png`). The same driver also keeps
video, receipts JSONL and logs with hashes. Counts and identity are reread
after the render pause; the owned process must remain alive until deliberate
termination, even after a success receipt. The runner follows the published
client when session restoration replaces a constructor candidate.
A failed or unrun segment is never
reported as passed; exit is nonzero. Preserve failed artifacts and choose a
fresh directory when retrying. Receipts contain counts, not query row contents;
video and screenshots show the actual app and may contain its visible data.
An empty partition proves opening and lifecycle only; seed/sign in with the
history you want to qualify before running. Pending write replay, required-argument queries, writes,
media and application-specific correctness need the deeper runner below.
Optional-argument native queries require an application witness: generic smoke
refuses their conditional module availability rather than calling them server-only.
Ordinary launches do not load the smoke runner or install its error handler.

## Own Release preparation (bounded adapter)

`--build <project>` requires `--smoke`; each invocation gets fresh artifacts. It
prepares that project's own Release simulator application with a private stable
snapshot, CocoaPods and Xcode DerivedData cache, then installs with `simctl`
and launches its bundle ID directly. It never opens Simulator.app, invokes
AppleScript, opens a dev-client URL, or starts Metro. Native preparation has a
separate 900-second deadline; smoke keeps its 120-second step default.

This adapter currently accepts Apple-silicon macOS, Xcode 27.0 / iOS SDK 27.0,
Expo 57.0.22, RN 0.86.3, `@expo/fingerprint` 0.20.13, New Architecture and
Hermes, an installed npm dependency tree with `package-lock.json`, and static
`app.json`. An existing iOS project keeps its native customizations; generated projects
use the starter's UIScene lifecycle for iOS 27. Products, intermediates and module caches
are pinned to the private workspace; every app/Pods target's resolved output
paths are checked before compilation. Custom output-directory and linker side-output overrides refuse, including
`LD_MAP_FILE_PATH`, `LD_DEPENDENCY_INFO_FILE`, LTO objects and SDK imports.
The same checks cover `PER_ARCH_OBJECT_FILE_DIR` and `COMPILATION_CACHE_CAS_PATH`.
Checked destinations include module/header caches, build-session files, response
lists and Info.plist/dSYM outputs. Links resolve even with missing targets; escapes refuse.
Nonempty `SKIP_BUNDLING` and `SOURCEMAP_FILE` settings are refused. Every build
removes the old product bundle and requires Xcode to produce a new one before
sealing its receipt. Resolved Swift and module-verifier flags, including forwarded
compiler arguments, must keep outputs inside the private cache. Unsupported
bundler command, output-name, config and argument overrides also refuse.
The adapter audits supported Xcode references and resolved output destinations;
uncovered references, custom build scripts/Podfile/environment hooks, and scheme
actions are refused. Its native inventories are provenance, not a complete
compatibility key: Xcode is invoked for every build. The adapter accepts only its pinned generated build phases.
Dynamic config, fingerprint overrides,
local workspaces/modules/plugins and linked `expo-updates` are refused; prepare
those projects yourself and use installed-app mode. The witness makes no
compatibility claim for them. It never migrates your native lifecycle for you.

Set the app's client to `process.env.EXPO_PUBLIC_SNAPBACK_URL`; preparation
bundles it as `http://127.0.0.1:<port>`. An app that ignores that variable must
already use this origin. Smoke checks the actual client origin against the owned
backend. Install matching current `snapback4` and `snapback4-expo` packages and rebuild
the native app; an older installed app does not gain the helper from a JS reload.
The helper observes React Native SourceCode.scriptURL and requires its resolved
local file to equal the verified installed main.jsbundle before hashing that
selected file and the native executable. Unknown, remote or alternate bundle
selection, a true/unknown runtime __DEV__ value, linked Updates or a nonempty
launcher/updates manifest fail. The validator checks
these observations against the sealed external proof on every launch.
No session, credentials or application rows are supplied by the driver.

`build.json` is created once, read-only, after successful preparation. It binds
the complete app inventory, HBC version and compiler, native Mach-O files,
source/dependency/native input inventories, fingerprint, toolchain, build
settings, commands, phase logs and timings. It is a preparation receipt, not a
passing smoke receipt. `proof.json` binds installation and that receipt before
launch; native startup, exact installed inventory and artifact hashes are
rechecked during execution and collection. CoreSimulator 27's measured
framework execute-bit normalization is explicitly recorded; bytes must match.
Project/simulator leases preserve concurrent owners through bounded process cleanup.

After a JS or asset edit, run `npm run native:smoke` again. The stable private Xcode cache supplies warm intermediates, while
Xcode builds the current application and each run gets a new `build.json`.
Repack is withdrawn; credentials, signing settings and native identity are unchanged.

Warm build-plus-smoke runs on the shared M5 Pro mini have measured about three
minutes. Cold preparation is longer; Xcode/runtime and dependency installation
are separate costs. The private cache reuses generated iOS/Pods and Xcode
intermediates, but every run invokes Xcode and produces new embedded JavaScript.
The starter's packaged `snapback4-expo/plugin` supplies Expo 57's UIScene lifecycle;
custom native lifecycle projects should keep their own configuration.
These pinned-toolchain observations are not a general SDK guarantee. A build
receipt alone is not a passing smoke result; no physical-device or publication claim.

## Deeper application scenarios

```tsx
import { useEffect, useRef } from "react";
import { isReady, type Client, type Write } from "snapback4/contract";
import { witness } from "snapback4-expo/witness";
import { api } from "../snapback/generated/api";
export function WitnessRunner({ client, conversationId, onError }: {
  client: Client; conversationId: string; onError(error: unknown): void;
}) {
  const started = useRef(false);
  useEffect(() => {
    const w = witness();
    if (!w || started.current) return;
    started.current = true;
    const pause = () => new Promise(resolve => setTimeout(resolve, 100));
    const assert = (ok: unknown) => { if (!ok) throw Error("witness assertion failed"); };
    const run = async () => {
      if (w.segment === "prime") {
        await w.step("primed", async () => {
          const r = await client.query(api.thread, { conversationId });
          assert(isReady(r) && r.fresh && r.data.length > 0);
        });
        return;
      }
      await w.step("history", async () => {
        const r = await client.query(api.thread, { conversationId });
        assert(isReady(r) && !r.fresh && r.data.length > 0);
        await w.receipt({ history: r });
      });
      const sent: Extract<Write, { state: "sent" }>[] = [];
      const unsubscribe = client.onWrite(write => { if (write.state === "sent") sent.push(write); });
      try {
        const bodies = ["offline first", "offline second"], ids: string[] = [];
        await w.step("offline-done", async () => {
          for (const body of bodies) {
            const write = await client.mutate(api.send, { conversationId, body });
            assert(write.state === "pending"); ids.push(write.id);
          }
          const r = await client.query(api.thread, { conversationId });
          assert(isReady(r) && bodies.every(body => r.data.some(m => m.body === body && "pending" in m && m.pending)));
          await w.receipt({ pending: r, ids });
        });
        await w.waitFor("reconnect");
        await w.step("done", async () => {
          while (ids.some(id => !sent.some(write => write.id === id))) await pause();
          const writes = sent.filter(write => ids.includes(write.id));
          assert(writes.length === 2 && writes[0]?.id === ids[0] && writes[0]!.seq < writes[1]!.seq);
          await w.receipt({ writes });
        });
      } finally { unsubscribe(); }
    };
    void run().catch(onError);
  }, [client, conversationId, onError]);
  return null;
}
```

`snapback4 witness ios --bundle-id ...` drives an installed Release app on macOS
and builds nothing. Add `snapback4-expo/witness` to the app and rebuild its native module.
The helper is null on ordinary launches. Mount this runner beside the chat
screen, using the same local client and a conversation already seeded online:

Keep the actual chat screen visible: its observed query renders the two
pending bubbles while the runner waits. An assertion must throw before its
step completes. Add your own media, search or read-receipt assertions in the
same way; the tool imposes no application receipt schema.

## Operations

```sh
xcrun simctl list devices available --json
# Set UDID to your dedicated, booted simulator's identifier.
npx expo run:ios --configuration Release --device generic --no-bundler --output private-release
# Install the exact application product emitted above (not a DerivedData glob):
xcrun simctl install "$UDID" private-release/YourApp.app
# Run from the backend project, with the app built for this backend origin.
npx snapback4 witness ios --bundle-id com.example.chat --udid "$UDID" \
  --segment offline --artifacts artifacts/offline --port 4400 --prime
```

The driver owns `snapback4 dev --port 4400 --no-watch`; stop any manually
started backend first. A bound port is refused, never reclaimed. Omitting `--udid` selects only a recorded tool-created device, as described above. `--timeout 120` is the default
number of seconds per driver step. The app's configured origin must be
`http://127.0.0.1:<port>`; the kit does not change its client configuration.
A Release build embeds its JavaScript and needs no Metro server.
Quit the named app before starting: an already running instance is refused
with `E_WITNESS_APP`, and termination targets only the PID reported by the
driver's own launch, leaving a replacement instance running.

`--prime` first launches with `segment === "prime"`, waits for the completed
`primed` step, and terminates the app. It then stops the backend, verifies
connection refusal, starts video and logs, and cold-launches with the given
segment. Complete `offline-done`, await `waitFor("reconnect")`, then complete
`done`. `step(name, fn)` returns the function's result and records completion
only if it succeeds. Receipts inside a step carry `name:running`; failure
records `name:failed`. Steps are sequential. `receipt(object)` preserves the
object's fields and adds only `witness: { at, step }`; `witness` is reserved.
The helper serializes the app object before adding that envelope; custom
`toJSON` results must still be objects without `witness`.
`at` is an ISO timestamp. The helper appends and syncs each JSONL line in
Documents. The driver writes a run-specific reconnect file only after its
backend announces readiness again; container files require no simulator
network entitlement. Ordinary app launches cannot activate stale run files.

For the kill-and-relaunch variant, persist the two write IDs and bodies in
your app's storage. On the first offline launch complete `relaunch` after
asserting both are pending. On the second launch of the same segment read
the saved IDs and assert those exact pending rows survived, then complete
`offline-done`. Subscribe to `onWrite` on each launch before reconnect; wait
for both saved IDs to be `sent` in order, assert the visible rows, and complete
`done`. No extra sends belong on the second launch. Run that app scenario:

```sh
npx snapback4 witness ios --bundle-id com.example.chat --udid "$UDID" \
  --segment restart --artifacts artifacts/restart --port 4400 --prime --relaunch
```

Legacy `--segment m6` / `m8` use `installed-m6` / `installed-m8` artifact prefixes.
Preparation is unknown; no smoke proves M6/M8 assertions or benchmark admission.

Each ordinary scenario writes `<segment>-ios-screen.mp4` (uninterrupted native screen
recording), `<segment>-ios-receipts.jsonl` (the app's assertions and completed
steps), and `<segment>-ios-run.json` (simulator/runtime, installed Info.plist
build identifiers, backend command/origin/port, millisecond timestamps,
termination/relaunch events, byte counts, SHA-256 digests and exit status).
The device log and backend/capture logs accompany them. Missing or empty
artifacts, malformed receipts, failed steps, timeouts and backend failures
exit nonzero with an `E_WITNESS_*` diagnostic. Existing artifacts are never
overwritten; choose a fresh directory for a retry. Keep the manifest with
the exact video and receipt files it hashes.
A persistent `<segment>-ios-reserved` marker exclusively reserves all output
names; concurrent runs cannot share them, and backend/launch logs append
across restart and relaunch.
Every complete receipt is validated, including rows after a milestone and
again at collection; after `done`, only app receipts with the unchanged
`between-steps` state are accepted.

The manifest binds this execution's artifacts. It does not independently
verify the truth of application assertions, prove physical-device behavior,
simulate loss of every network connection, or establish media, search,
view-once exclusion or recipient `read` state unless your app asserts and
renders those observations. The deterministic simulator remains the main
engine harness; this witness covers native process, storage and UI boundaries.

## Refusals

E_WITNESS_INPUT means a flag, launch configuration or signal label is
invalid. For example, invoking `witness ios` without a bundle ID cannot
select an app. Use `snapback4 witness ios --bundle-id com.example.chat`
with the dedicated simulator, segment, port and fresh artifacts directory
shown above. Refusals name flags and reasons, never values; required output paths
are labelled the command's own. Signal labels must match the runner's protocol.

E_WITNESS_PLATFORM means the iOS witness lacks its required host tools.
For example, running it on Linux cannot drive an iOS simulator. Run on
macOS with Xcode and its command-line tools selected, and install an iOS
simulator runtime. Verify `xcrun simctl list devices available --json`
before invoking the witness; the deterministic simulator remains available
for engine scenarios without that native UI host.

E_WITNESS_SIMULATOR means the explicit device is unavailable or simctl failed.
For example, `--udid` cannot select a shutdown device.
Use `xcrun simctl list devices available --json`, boot the intended dedicated
device, and pass its exact `--udid`. If simctl itself fails, repair that
simulator/runtime first; do not let the witness choose someone else's device.

E_WITNESS_PORT means the requested backend port is occupied. For example,
a manual `snapback4 dev` already listening on 4400 prevents the witness
from owning its backend there. Stop that server if it is yours, or choose
a free `--port` and rebuild/configure the app for that origin. The witness
never kills an existing listener to reclaim a port.

E_WITNESS_BACKEND means the owned backend failed to become ready, exited
early, or did not leave its port refusing connections after stop. For
example, a refused schema can prevent the first listening URL. Inspect the
backend log, run `snapback4 check` in the app, repair the startup failure,
and retry in a fresh artifacts directory. Confirm the configured origin
and port; only the backend owned by this witness may be stopped.

E_WITNESS_PROCESS means a child command could not start, exited early or
could not be stopped. For example, a failed screen-recording child cannot
produce evidence for the run. Inspect the named capture/backend log and
command, repair its tool or permissions, and retry with a fresh artifacts
directory. Preserve the failed run's logs and stop only its recorded child
processes, never every process with the same name.

E_WITNESS_ARTIFACT means an expected artifact is absent, empty, changed
containers or would overwrite an earlier run. For example, reusing
`--artifacts artifacts/offline` after a completed run collides with its
reserved output names. Choose a new directory, such as
`--artifacts artifacts/offline-2`, and inspect the failed manifest for
missing video or receipts. Keep each manifest beside the exact files it
hashes; do not fill a failed run with another run's recording.

E_WITNESS_RECEIPT means a receipt is not a complete valid JSON object with
the expected witness envelope, changed after observation, or could not be
written. For example, `w.receipt({ witness: 'mine' })` overwrites a reserved
field; use `w.receipt({ history: read })` and let the helper add `witness`.
Await receipt writes and keep one complete object per JSONL line. Inspect
the failed artifact and app log for truncation or storage errors rather
than editing a receipt after the driver has observed it.

E_WITNESS_STEP means an application assertion failed, milestones arrived
out of order, or steps overlapped. For example, running `offline-done` and
`done` in `Promise.all` cannot prove the offline/reconnect sequence.
Await `w.step('offline-done', ...)`, then `w.waitFor('reconnect')`, then
`w.step('done', ...)`. If an assertion failed, repair the application behavior
and rerun; skipping the assertion does not establish the promised scenario.

E_WITNESS_TIMEOUT means a step, child command or signal did not arrive
within its timeout, 120 seconds by default per driver step. For example,
an app that never completes `offline-done` leaves the driver waiting even
if its screen renders. Inspect the last receipt and app log, repair the missing step
or connection, and retry. Increase `--timeout` only after measuring a slow
but progressing run; a longer wait cannot fix an absent milestone.

E_WITNESS_INTERRUPTED means the run was interrupted before completion.
For example, Ctrl-C while recording leaves a failed run, not a completed
offline proof. Keep its available artifacts and manifest for diagnosis;
the driver stops its owned backend and capture processes. Start another
run in a fresh artifacts directory and let the required milestones finish.

E_WITNESS_BUILD means own Release preparation failed or is outside the bounded
adapter. For example, a failed CocoaPods or Xcode command cannot yield a build
receipt. Inspect the named phase log, repair the build or use manual installed-app
mode, and choose a fresh artifacts directory. An iOS 27 application must already
have its proper UIScene lifecycle before this witness can launch it.

E_WITNESS_NATIVE_COMPAT means the requested inputs cannot support the recorded
preparation claim. For example, linked expo-updates can execute a cached bundle
instead of the embedded bundle. Use manual installed-app mode for that project;
its preparation remains unknown. Do not delete fingerprint exclusions or native
modules merely to make an unsupported configuration look admitted.

E_WITNESS_HERMES means the embedded bundle is not the expected Hermes bytecode
or its compiler/version differs. For example, renaming a JavaScript export to
main.jsbundle does not produce HBC. Rebuild through the matching CocoaPods and
Hermes toolchain and retry; a valid header alone does not prove a cold launch.

E_WITNESS_PROOF means recorded bytes or native startup identity did not match.
For example, an older native helper cannot attest a prepared proof. Rebuild the
app with the current native witness helper, preserve the failed artifacts and
retry in a new directory. Never edit a sealed build receipt to match a replaced
application, bundle, native executable or resource.

E_WITNESS_ORIGIN means the smoke client used a different backend origin.
For example, an app bundled for port 4400 cannot attest the witness on 49371.
Use the app's matching --port or rebundle the app to consume the preparation
EXPO_PUBLIC_SNAPBACK_URL value. The witness will not stop someone else's backend
or accept an unrelated server's session and store as its own proof.
