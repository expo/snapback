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
domain. For pending-work preservation, the application creates one durable
caller-owned RQS store whose directory/identity is stable for that database
and injects that exact store into predecessor, candidate, and rollback
`SnapbackClient` instances. This is explicit opt-in: the ordinary client
default remains isolated by complete HTTP origin, including port, so unrelated
servers never share queues.

1. The application’s outbox adapter quiesces new submissions and settles any
   in-flight submission back into client custody or completion. Durable pending
   intents are allowed to remain pending.
2. The supervisor persists a swap journal, stops the predecessor through the
   nonce-verified native stop command, and starts the candidate on another
   OS-assigned port.
3. The app re-points or replaces its app-owned `SnapbackClient` through the
   lease's `rebind()` hook, using the candidate attachment's actual ephemeral
   URL and the shared store. A v2 binding receipt must carry that URL, the
   candidate startup nonce, `clientStoreId`, writer ownership, passed
   full-snapshot evidence, and the exact app/schema/function generation.
4. The app calls `SnapbackClient.adoptQueuedMutations()` from `resume()`. The
   checked client API revalidates the store id, writer, full-snapshot barrier,
   candidate `/inspect` generation, and every pending record generation before
   replay. Its adoption receipt carries authoritative before/after counts; the
   v2 sidecar resume receipt projects the pending-before count, replay count,
   terminal deltas, and authoritative remaining count. A stopped replay,
   remaining intent, or newly failed, quarantined, or result-gone record is a
   failed swap. Only a clean zero commits the candidate attachment.
5. Any candidate-start, candidate-verification, or outbox-resume failure stops
   the candidate and reattaches the predecessor (falling back to the candidate
   if the predecessor package itself became unavailable). A retained journal
   lets a recreated supervisor recover either package after a supervisor crash.

The application owns re-pointing because it owns both the data client and its
outbox. The sidecar never reads or submits application intent; it sequences and
attests `rebind()` before `resume()` so an updater cannot commit while replay is
still aimed at the predecessor's dead port.

The durable record is store-owned and origin-free. Replay therefore preserves
its original `clientMutationId` and semantic identity while the fresh client's
`baseUrl` selects the candidate origin. Exactly-once comes from the existing
`_snapback_client_mutations` row in the same SQLite database: a duplicate with
identical identity republishes the stored result, while identity divergence
fails closed and the adoption path leaves the local intent pending for
rollback. URL, port, pid, and startup nonce are attachment facts, never
duplicate-suppression inputs.

The legacy v1 URL-only receipt remains accepted only when the predecessor
snapshot authoritatively reports `pending: 0`, preserving the cold empty-outbox
swap. Pending work requires the v2 shared-store handoff.

This is the attachment point for LLP 0081’s upgrade-required quarantine: the
`onUpgradeRequired` hook receives the refusal and the app-owned outbox snapshot.
The sidecar does **not** implement tombstone-and-re-entry. Likewise,
`verifyCandidate` is an updater verification hook in addition to the packaged
runtime seal; it is not a substitute for exact app/schema/function comparison
before adopted replay.

There is no stable in-process native ABI in this package. That is a later LLP
0129 rung behind its own spike.

This is pending-work-preserving **stop/start**, not zero-request-downtime. The
predecessor is stopped before the candidate starts. A literal no-request-gap
claim needs a separate stable-front-door or overlapping-runtime design.
