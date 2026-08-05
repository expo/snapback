# `@expo/snapback-sidecar`

`@expo/snapback-sidecar` is the first desktop rung from LLP 0129 Phase 2b. An
application embeds the JavaScript supervisor and receives a typed attachment;
the packaged native Snapback runtime stays a managed child process. The child’s
HTTP origin is the application data channel. Lifecycle control (`start`,
`health`, `stop`, and `swap`) is deliberately in-process and composes the
existing ready-file and native `snapback stop` contracts instead of introducing
another IPC protocol.

```js
import { createSidecarSupervisor } from '@expo/snapback-sidecar';

const sidecar = createSidecarSupervisor({
  database: '.snapback/desktop.sqlite3',
  restartPolicy: {
    maxAttempts: 2,
    decide: ({ attempt }) => attempt === 1 ? 'restart' : 'surface',
  },
  outbox: applicationOutboxAdapter,
});

const attachment = await sidecar.start();
const adminToken = await attachment.capabilities.adminToken.read();
// Give attachment.url and adminToken to an application-owned SnapbackClient.
```

The supervisor always requests port `0` and accepts only the actual loopback
origin in the validated `HostReadyDescriptor`. Capability handles re-attest the
descriptor’s startup nonce before reading their owner-only files, and their
inspection/JSON forms redact secret bytes.

## Runtime swap

`swap({ runtime })` is a stop-then-attach protocol over one SQLite custody
domain:

1. The application’s outbox adapter quiesces new submissions and settles any
   in-flight submission back into client custody or completion. Durable pending
   intents are allowed to remain pending.
2. The supervisor persists a swap journal, stops the predecessor through the
   nonce-verified native stop command, and starts the candidate on another
   OS-assigned port.
3. The app re-points or replaces its app-owned `SnapbackClient` through the
   lease's `rebind()` hook, using the candidate attachment's actual ephemeral
   URL. The supervisor rejects a binding receipt for any other URL.
4. The app calls `resume()`, which either uses a supported adoption path to
   drain the client-custodied outbox or reports the application store's
   authoritative pending count. The hook returns a URL-bound receipt; a
   stopped replay or any remaining intent is a failed swap, never a successful
   no-op. Only `remaining: 0` commits the candidate attachment.
5. Any candidate-start, candidate-verification, or outbox-resume failure stops
   the candidate and reattaches the predecessor (falling back to the candidate
   if the predecessor package itself became unavailable). A retained journal
   lets a recreated supervisor recover either package after a supervisor crash.

The application owns re-pointing because it owns both the data client and its
outbox. The sidecar never reads or submits application intent; it sequences and
attests `rebind()` before `resume()` so an updater cannot commit while replay is
still aimed at the predecessor's dead port.

The current evidence-backed first rung successfully swaps only with a drained
outbox. The shipped replay path drains through the same client instance that
queued on a transport failure; a fresh candidate client does not re-adopt that
predecessor instance's durable pending record. The acceptance adapter therefore
does not attempt a cross-instance drain. It reports the application store's
authoritative pending count, and the guard rejects that attempt with
`SIDECAR_OUTBOX_RESUME_INCOMPLETE`, recovers the predecessor, and preserves the
record as pending. Hot swap with pending intent requires explicit cross-client
outbox re-adoption and exactly-once settlement on the new origin; `/health`
readiness alone does not prove that path ready.

This is the attachment point for LLP 0081’s upgrade-required quarantine: the
`onUpgradeRequired` hook receives the refusal and the app-owned outbox snapshot.
The sidecar does **not** implement tombstone-and-re-entry. Likewise,
`verifyCandidate` is an updater verification hook, not LLP 0123 sealing:
today’s runtime packages remain co-packaged assembly closures until the
production attestation/sealing follow-on lands.

There is no stable in-process native ABI in this package. That is a later LLP
0129 rung behind its own spike.
