# Proving it on an iOS simulator

Prove the native runtime of an installed app with **no app code**:

```sh
# UDID is your dedicated, booted simulator. Build from the Expo project:
npx expo run:ios --configuration Release --device "$UDID"
# Quit the app, then run from the backend project:
npx snapback4 witness ios --smoke --bundle-id com.example.chat --udid "$UDID" --artifacts artifacts/native-smoke
```

Use the matching `snapback4` and `snapback4-expo` packages, with `createApp`
and `AppProvider` using `nativeDevice`. The older `createLocalClient` path
also works. Release embeds JavaScript; no Metro server is needed. Sign in
through the app normally first if it requires user interaction; smoke waits
for the app's own session and never invents a guest or bypasses authentication.
The app must point at `http://127.0.0.1:4400` (or pass `--port N` for its
configured port). Quit the app before starting. The driver builds nothing,
refuses a busy port, and owns its `snapback4 dev` process.

Read `artifacts/native-smoke/smoke-ios-run.json`: `exitStatus: 0` and all
three `segments` marked `passed` mean:
- `prime`: the own client is online and acquisition is complete. The receipt
  records the device's held counts per synced table, backend store identity,
  generation, watermark and link, with no uncaught JS errors.
- `offline`: after termination and verified backend connection refusal, the
  cold app opens its kept store, reports offline and holds the same counts.
  Every query whose arguments are all optional (including no arguments) runs
  through the app's client. `queries` records ready/count/completeness or an
  explained refusal. A thrown query, loading result or uncaught JS error fails.
- `restart`: after another termination and backend restart, the cold app is
  online and its watermark has reached the exact `syncBarrier.seq` passed
  by the driver, not merely a tail persisted after prime. The driver inserts
  this zero-write commit while the backend is stopped; it changes no
  application data.

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
history you want to qualify before running. Required-argument queries, writes,
media and application-specific correctness need the deeper runner below.
Ordinary launches do not load the smoke runner or install its error handler.

## Deeper application scenarios

`snapback4 witness ios` drives an installed Release app on macOS. It builds
nothing. Add `snapback4-expo/witness` to the app and rebuild its native module.
The helper is null on ordinary launches. Mount this runner beside the chat
screen, using the same local client and a conversation already seeded online:

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

Keep the actual chat screen visible: its observed query renders the two
pending bubbles while the runner waits. An assertion must throw before its
step completes. Add your own media, search or read-receipt assertions in the
same way; the tool imposes no application receipt schema.

```sh
xcrun simctl list devices available --json
# Set UDID to your dedicated, booted simulator's identifier.
npx expo run:ios --configuration Release --device "$UDID"
# Run from the backend project, with the app built for this backend origin.
npx snapback4 witness ios --bundle-id com.example.chat --udid "$UDID" \
  --segment offline --artifacts artifacts/offline --port 4400 --prime
```

The driver owns `snapback4 dev --port 4400 --no-watch`; stop any manually
started backend first. A bound port is refused, never reclaimed. `--udid` is
required with more than one booted iOS simulator. Without it exactly one
available booted iOS simulator must exist. `--timeout 120` is the default
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

Each run writes `<segment>-ios-screen.mp4` (uninterrupted native screen
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


## Refused witness runs

E_WITNESS_INPUT means a flag, launch configuration or signal label is
invalid. For example, invoking `witness ios` without a bundle ID cannot
select an app. Use `snapback4 witness ios --bundle-id com.example.chat`
with the dedicated simulator, segment, port and fresh artifacts directory
shown above. Follow the named invalid argument; signal labels must match
the runner's supported step protocol.

E_WITNESS_PLATFORM means the iOS witness lacks its required host tools.
For example, running it on Linux cannot drive an iOS simulator. Run on
macOS with Xcode and its command-line tools selected, and install an iOS
simulator runtime. Verify `xcrun simctl list devices available --json`
before invoking the witness; the deterministic simulator remains available
for engine scenarios without that native UI host.

E_WITNESS_SIMULATOR means selection was ambiguous or simctl failed.
For example, two booted iOS simulators cannot be chosen by omission.
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
