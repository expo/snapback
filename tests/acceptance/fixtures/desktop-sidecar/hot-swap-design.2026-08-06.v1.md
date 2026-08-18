# LLP 0129 Phase 2b: hot swap with live pending work

Date: 2026-08-06  
Status: design spike; not an implementation or capability claim  
Scope: desktop sidecar, JS/Node file-store outbox, same-SQLite runtime replacement  
Recommendation: **BUILD**, as an explicit sidecar-only store handoff; do not change the global per-origin default

> **Post-build note (2026-08-06):** LLP 0129's follow-on now implements this
> design. The PoC's non-writer result intentionally changed from the captured
> pre-build `remaining: 0` below to authoritative `remaining: 1`; the zero was
> the fail-open accounting defect this design required the build to remove.

## Executive finding

The pending record is **not bound to the `SnapbackClient` instance that minted
it**. It is also not bound to a connection id, runtime URL, port, startup nonce,
or file-store writer lease. The record is ordinary `pending` data inside one
selected RQS store blob.

The empty fresh-client view reproduced in this spike has a narrower cause:
`SnapbackClient` resolves its default Node/native file store from the complete
HTTP origin, including the port. A sidecar candidate gets another ephemeral
port, so a default-constructed candidate client selects another blob. Its
`outboxPending()` is correctly empty because it is reading another store
domain. When the candidate client is explicitly given the predecessor's same
caller-owned store, it sees and replays the record today. When it opens a
second store instance with the same identity, it sees the record but replay is
stopped until that instance acquires the single-writer role.

The build should therefore preserve the default origin-isolation rule and add
an explicit sidecar adoption/handoff contract around one stable application
store. It does not need a new outbox record format or a record-moving
migration. The candidate transport is selected by the new client's `baseUrl`;
the durable record itself must remain origin-free.

This solves **pending-work-preserving stop/start swap**. It does not make the
existing stop-then-start sidecar literally zero-request-downtime. A strict
zero-downtime claim would additionally need a stable front door or overlapping
runtime ownership, which is a separate lifecycle/transport design and should
not be smuggled into this follow-on.

## Governing context

- Full resync precedes ordered replay, and failures are visible rather than
  swallowed: LLP 0008#mutation-replay-and-conflict-semantics.
- The client-store contract is store-agnostic, corruption is never empty
  success, and independently constructed clients serialize through one
  writer: LLP 0008#decision-dk-9--client-local-store-mandate-2026-07-02.
- A pending record durably carries the original `clientMutationId`, replay
  inputs, and authority descriptor; a receipt-less transport outcome remains
  pending: LLP 0043#milestone-2-queued-mutation-replay.
- A non-empty outbox takes the full-snapshot path before replay: LLP
  0090#d3-channel-b--persisted-device-snapshot.
- `clientMutationId`, not application-visible mint output, is the durable
  duplicate-suppression key: LLP 0133#exactly-once-identity-under-the-new-semantics
  and LLP 0133#the-protocol-identity-carve-out.
- LLP 0129#phase-2b-desktop-sidecar-first-rung-note--2026-08-05 owns the
  program boundary: the landed rung rolls back with pending work and makes no
  hot-swap claim.

## 1. Precise root cause

### Client to store binding

`SnapbackClient` normalizes and retains `baseUrl`, then, when `rqsStore` is
omitted, calls `resolveDefaultRqsStore({ baseUrl: this.baseUrl })`
(`packages/snapback-client/index.mjs`, constructor near lines 1887 and
1944–1969). The selected store is retained as `this.rqsStore`.
`#offlineQueueStore()` later performs only capability, custody, and durability
checks over that retained store (near lines 5802–5847). It does not select
records by client identity.

The missing link is `packages/snapback-client/rqs-store-default.mjs`.
`originIdentity(baseUrl)` returns `origin:${url.protocol}//${url.host}`;
`url.host` includes the port. The Node and React Native file rungs pass that
identity to `createFileRqsResumeStore`. Thus:

```text
old attachment http://127.0.0.1:42001
    -> identity origin:http://127.0.0.1:42001
    -> blob A

candidate attachment http://127.0.0.1:42002
    -> identity origin:http://127.0.0.1:42002
    -> blob B
```

The origin split is normally correct: unrelated servers must not consume each
other's cached rows or queued writes. An ephemeral-port sidecar replacement is
the exceptional case because two transport origins intentionally represent one
application/database custody domain.

### Store blob and writer relationship

`createFileRqsResumeStore` hashes the supplied identity into the blob and lock
paths (`identitySlug`, `rqs-store-file.mjs` near lines 233–278). The blob holds
one `outbox` section beside RQS entries and store metadata. A same-process
registry plus an exclusively created lock file establishes one writer. The
writer role gates enqueue and every state-changing outbox transition; it does
**not** gate reads.

`rqs-store-file.mjs#outboxPending()` simply reads the selected blob and calls
`pendingOutboxRecords(state.outbox)`. A second instance over the same identity
can therefore see pending work while it is a reader. `SnapbackClient`
`#replayOutboxOnce()` separately awaits `whenLockSettled()` and stops when
`isWriter()` is false (near lines 6214–6226). That is a writer-custody stop, not
a record-visibility filter.

One current sharp edge matters to the build: the non-writer early return says
`remaining: 0, stopped: true` without counting the records it just declined to
touch. A sidecar receipt must never interpret that zero as an empty queue. The
new adoption path should count authoritatively before and after replay, and the
generic replay result should be corrected to report the real remaining count
or a typed unknown/failure.

### Record selection and durable identity

`normalizeOutboxRecordInput()` in `outbox-shared.mjs` stores function, args,
user/auth facts, expected generation, settlement lane/claims, operation
issuance, optimistic operation, and capture time. It stores no client-instance
id, connection id, origin, port, startup nonce, or writer id.

`pendingOutboxRecords()` is exactly:

```text
all records -> status === "pending" -> client-local sequence order
```

There is no adoption predicate. `outboxOps.enqueue()` treats a repeated id as
idempotent only when the complete durable replay identity matches, but that
identity is semantic mutation data, not process ownership.

During replay, `#replayOutboxOnce()` calls `mutate(..., {
clientMutationId: record.id, queue: false, ...recordFacts })`. The transport
target comes from the replaying client's `this.baseUrl`. Consequently the
observed relationships are:

| Question | Actual binding |
| --- | --- |
| Is the record bound to one `SnapbackClient` object? | No |
| Is it bound to an HTTP connection or runtime startup nonce? | No |
| Is it bound to the old runtime origin? | No record field is; the **default store selection** is origin-bound |
| Is it bound to the writer lease? | No; readers see it, but only the writer may settle/fail/consume it |
| What semantically fences replay? | Stored mutation identity, expected generation, authority descriptor/principal, sequence, and settlement facts |

The same-client test at `outbox-store.test.mjs` lines 588–635 is a valid happy
path, but it is not evidence of a same-client restriction. The bounded PoC
below supplies the missing fresh-client controls.

## 2. Design for the three sub-problems

### A. Cross-client / cross-instance outbox re-adoption

#### Stable store custody, explicitly scoped

The embedding application creates one durable RQS store whose physical
directory and identity are stable for the sidecar database, and injects that
same caller-owned store into every old/candidate/rollback `SnapbackClient`.
The identity should be derived from the sidecar's canonical database custody
domain (or an application-minted stable sidecar id), never from the attachment
URL. The sidecar already exposes and validates the database path.

Do **not** change `resolveDefaultRqsStore` globally from per-origin to
per-application. That would merge unrelated server queues and is the wide
semantic change the question warns about. This is an opt-in sidecar adapter
contract.

The simplest lifecycle keeps one store object alive across the swap. Injected
stores are already caller-owned, so closing/replacing a client does not close
the store. If a platform requires separate store objects, quiesce must close
the predecessor store, await `candidateStore.whenLockSettled()`, and require
`candidateStore.isWriter() === true` before replay. A timeout lease is not an
acceptable handoff.

#### Explicit adoption receipt

Add a client API at the existing public replay seam, provisionally:

```ts
client.adoptQueuedMutations({
  expectedClientStoreId,
  afterFreshSnapshot,
}): Promise<OutboxAdoptionReceipt>
```

It is a checked wrapper over the existing replay machinery, not a record move.
It must:

1. require a durable, outbox-capable store;
2. await the application-owned fresh-snapshot barrier required by LLP 0008;
3. await writer settlement and refuse with
   `SNAPBACK_OUTBOX_ADOPTION_NOT_WRITER` if writer custody is absent;
4. read `storeMeta.clientStoreId` and compare it with the id captured by
   `quiesce()`; a mismatch refuses rather than adopting another app's store;
5. count unresolved records before replay;
6. run the existing sequence-ordered replay single-flight;
7. count `pending`, `quarantined`, `result-gone`, and newly failed records
   after replay; and
8. return a frozen receipt containing store id, pending-before, replayed,
   failed delta, quarantined delta, result-gone, remaining, and stopped.

The sidecar must accept success only when `remaining === 0`, `stopped ===
false`, and there is no newly failed/quarantined/result-gone disposition. The
current sidecar receipt validates only replayed/remaining and can therefore be
too optimistic if a pending item becomes terminally failed; the hot path must
close that hole.

Quiescing remains application-owned: prevent new mutations, wait for in-flight
calls to either publish a durable settlement or return to `pending`, and tear
down old live handles/transports without closing the shared store. The sidecar
continues to sequence the lease; it never reads application intent.

### B. Transport/origin re-establishment

Do not rewrite an outbox record's origin: there is no such field, and adding
one to durable replay identity would create the wrong coupling.

After candidate readiness and nonce attestation, the app constructs a fresh
client with:

- `baseUrl = candidateAttachment.url`;
- the candidate's owner-only capability material;
- the exact shared sidecar RQS store; and
- the same application auth/custody configuration.

The rebind receipt should advance to a stronger schema (provisionally v2) and
bind:

```json
{
  "attachedUrl": "http://127.0.0.1:<candidate-port>",
  "startupNonce": "<candidate nonce>",
  "clientStoreId": "<durable store id>",
  "writer": true,
  "freshSnapshotBarrier": "passed"
}
```

The sidecar compares URL and startup nonce with the exact attested candidate;
the adoption API compares the store id. Replay then naturally targets the new
origin because `mutate()` uses the new client's `baseUrl` while preserving the
record's original `clientMutationId` and semantic facts.

`startupNonce` remains control-plane process identity. It must not enter
client-mutation identity. Candidate and predecessor are expected to have
different nonces.

Before replay, `verifyCandidate` must also establish exact application
compatibility (database, app/schema/function generation or the existing
equivalent facts). The record's `expectedGeneration` remains immutable. An
app-code migration or authority change is not an automatic hot-adoption case:
it takes the existing upgrade-required quarantine/rollback path rather than
retagging the record.

### C. Exactly-once settlement across origins

The origin is not part of server duplicate identity. `clientMutationId` is.
The complete server identity is built by `ClientMutationIdentity` in
`crates/snapback/src/storage.rs` and compares:

- `clientMutationId`;
- function;
- auth fingerprint;
- durable authority-instance id;
- input fingerprint over args/read set/context and settlement facts;
- artifact generation when supplied; and
- operation issuance when supplied.

`_snapback_client_mutations` is in the same SQLite database the sidecar carries
across replacement. `record_client_mutation_result()` inserts its row inside
the same transaction as application changes. `client_mutation_result()`
returns the stored output for an identical identity and fails closed on
function, auth, authority, input, or issuance divergence. The idempotent
execution paths check the retained result before execution and re-check after
a concurrent settlement race.

For a replacement over the same database there are only two correctness
cases:

1. The predecessor never committed. No settlement row exists; the candidate
   executes once and atomically records data plus settlement.
2. The predecessor committed but the response was lost. The settlement row
   exists; the candidate's identical submission republishes that output and
   performs no second application write.

The per-process `startupNonce` and ephemeral URL participate in neither case.
For dev/anonymous local authority, `auth/descriptor.rs` derives the authority
instance from the durable authorization-stream incarnation in the same
database, specifically so an ordinary restart does not strand queued work.
Sessions retain their durable session authority instance; service authority is
derived from durable credential/grant axes. A genuine authority rotation must
still refuse. Hot swap must not bypass that fence.

LLP 0133's `(mint site, occurrence)` identity has a different job: it maps
lane-L speculative application ids to authoritative ids and makes divergence
fail closed. It is not the duplicate-suppression key. The cross-origin
exactly-once proof rests on `clientMutationId` plus the compared settlement
identity and the shared SQLite settlement row.

The guarantee is intentionally retention-bounded. Once the application has
durably consumed a settlement and ACKed it, or an administrator purges it, the
server may remove the replay result; LLP 0043 explicitly says purge gives up
exactly-once for those ids. A genuinely pending/ambiguous outbox record has not
crossed that ACK cut, so the row required for swap recovery remains retained.

## 3. Swap state machine

```text
old attached
  -> app quiesces new submissions
  -> in-flight work reaches durable pending or durable settled
  -> capture clientStoreId + authoritative outbox snapshot
  -> stop old runtime
  -> start and attest candidate on same canonical database
  -> verify app/schema/function compatibility
  -> create candidate client(candidate URL, same store)
  -> restore fresh client bindings / full-snapshot barrier
  -> require store writer + same clientStoreId
  -> adopt/replay in sequence under original clientMutationIds
  -> authoritative post-replay count
       zero, no new terminal dispositions -> commit candidate
       otherwise -> stop candidate, restore old attachment, keep same store
```

If the candidate commits a mutation and then fails before local consumption,
rollback replay against the predecessor is still safe: both processes use the
same database and the same id, so the predecessor republishes the candidate's
settlement. If local consumption committed first, the record is already
non-replayable. This is the existing server/client settlement bridge doing the
cross-process work it was designed to do.

## 4. Feasibility and recommendation

**Verdict: BUILD**, with narrow scope.

This is bounded because the supposedly missing cross-client primitive mostly
already exists. The durable record is store-owned, a fresh client can replay
it, the new client already supplies the new transport origin, and the server
ledger already spans process replacement on the same database. The required
product work is:

1. an explicit stable sidecar store domain and writer handoff;
2. a checked adoption/replay receipt that cannot report non-writer or unreadable
   state as empty;
3. a stronger URL/nonce/store/freshness-bound sidecar lease receipt;
4. exact candidate artifact compatibility before replay; and
5. real-child acceptance for candidate replay, duplicate settlement, and
   rollback after the commit/response-loss cut.

No global “bind outbox to store instead of client” redesign is required: that
is already the record model. No global weakening of per-origin store isolation
is recommended.

The value is modest. Cold swap is already safe, and this follow-on mainly
avoids a seconds-scale rollback/refusal when desktop work happens to be
pending. It should be a small, explicitly scoped follow-on, not a reason to
delay higher-value work. If the product requirement is literal zero-request
downtime rather than pending-work preservation, present that separate transport
decision to the author; the existing stop-then-start sidecar cannot honestly
claim it after this build.

## 5. Cheap PoCs and real results

### Client/store characterization — PASS

Command:

```sh
node tests/acceptance/fixtures/desktop-sidecar/hot-swap-outbox-poc.2026-08-06.v1.mjs
```

Real result:

```json
{
  "status": "PASS",
  "sharedInjectedStore": {
    "freshClientVisible": ["<same clientMutationId>"],
    "deliveredTo": "http://127.0.0.1:41002/mutation/createThing",
    "replay": { "replayed": 1, "failed": 0, "remaining": 0, "stopped": false }
  },
  "defaultStoreAcrossOrigins": {
    "oldOriginPending": ["<clientMutationId>"],
    "newOriginPending": [],
    "oldWriter": true,
    "newWriter": true
  },
  "sameIdentityWriterHandoff": {
    "readerPending": ["cm_writer_handoff"],
    "writerBeforeRelease": false,
    "replayBeforeRelease": { "replayed": 0, "remaining": 0, "stopped": true },
    "writerAfterRelease": true
  }
}
```

This is mocked transport. It proves store selection, cross-client visibility,
writer fencing, candidate-origin dispatch, and id preservation. It does not
prove server settlement.

### Same-database, two-runtime settlement — bounded attempt blocked

The retained script starts two sequential sidecar runtimes over one generated
todo app and one SQLite database, submits an identical `clientMutationId` to
both different origins/nonces, and asserts one row plus byte-identical result
and receipt.

Command attempted:

```sh
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback \
node tests/acceptance/fixtures/desktop-sidecar/hot-swap-settlement-poc.2026-08-06.v1.mjs
```

Real result: exit 1 before the first ready descriptor. The managed sandbox
refused the runtime listener:

```text
SIDECAR_START_FAILED
SNAPBACK_DEV_SERVER_START_FAILED
failed to bind Snapback server to 127.0.0.1:0: Operation not permitted (os error 1)
```

No settlement assertion ran, so this spike does **not** claim a passing
two-runtime PoC. The script is a bounded outside-sandbox rerun target. The
design-level conclusion instead rests on the durable same-database settlement
implementation and LLP 0043/0133 contracts described above.

**2026-08-06 addendum — outside-sandbox rerun, PASS.** The retained script
above was rerun outside the managed sandbox, in an isolated git worktree at
origin/main commit `e99d2a328e864c0d4021bec750328d861176ebc3`, against a
freshly built and qualified `target/debug/snapback`. This time the listener
bound and both runtimes started:

```json
{
  "schemaVersion": "snapback.hot-swap-settlement-poc.v1",
  "status": "PASS",
  "databaseShared": true,
  "old": { "url": "http://127.0.0.1:56833", "pid": 94307 },
  "candidate": { "url": "http://127.0.0.1:56840", "pid": 94714 },
  "clientMutationId": "cm_hot_swap_settlement_poc",
  "firstVersion": 1,
  "replayedVersion": 1,
  "rowCount": 1,
  "sameResult": true,
  "sameReceipt": true
}
```

One application row, byte-identical replayed result and receipt across the
two sequential runtimes over the shared SQLite database. This is the passing
two-runtime PoC the earlier record above says the design-level conclusion did
not need to claim; it now stands as additional confirming evidence alongside
the durable same-database settlement implementation and LLP 0043/0133
contracts. The original blocked-attempt record above is retained unedited as
the sandboxed baseline. Full output:
`tests/acceptance/fixtures/desktop-sidecar/hot-swap-promotion.2026-08-06.v1.json`.

## 6. Build acceptance matrix

The implementation should not claim the follow-on until all of these pass:

| Case | Required observation |
| --- | --- |
| Different default ephemeral origins | negative control remains isolated |
| Fresh client + same explicit store object | sees predecessor pending id and drains against candidate URL |
| Fresh store object + same stable identity | sees pending as reader, then drains only after exact writer takeover |
| Old commit, response lost, candidate retry | one application row; stored result republished |
| Candidate commits, post-commit swap fault | rollback attachment can finish without a second write |
| Candidate artifact/generation mismatch | no replay; rollback/quarantine path retains intent |
| Authority-instance mismatch | typed refusal; no retagging and no effect |
| Non-writer/unreadable store | nonzero/unknown fail-closed receipt, never empty success |
| Pending sequence of multiple records | exact order; partial progress remains durable and restartable |
| Real child acceptance | different URL, port, pid, and startup nonce; same canonical database and settlement identity |

This artifact makes no diary claim: it changes no demo application.
