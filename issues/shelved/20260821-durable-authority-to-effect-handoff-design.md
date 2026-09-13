# Design: durable authority-to-effect handoff for irreversible external effects

Status: Accepted direction — three open rulings resolved by author 2026-08-23;
implementation remains open
Created: 2026-08-21
Related: LLP 0283 F-1, issues/shelved/20260821-authorized-effect-remedy-classification.md,
issues/shelved/20260821-nonsql-durable-effects-unguarded.md, LLP 0044, LLP 0070, LLP 0204

## Why this exists

The remedy classification left one category undesigned: irreversible and external effects, where
fencing does not work. Holding an admission guard across the moment of irreversibility is too
late — once a provider has accepted the request, no lock un-sends it.

This is the design for what replaces fencing.

## The rule

Authority is transferred to a durable record BEFORE the physical cut, and the cut is performed
from that record rather than from a live caller:

1. Prepare and normalize the exact effect outside `LocalSnapback`.
2. For caller-backed work, reserve session/service authority outside `LocalSnapback`.
3. In one short transaction: revalidate the authority predicate, acquire the mode guard last,
   and commit an effect-specific durable handoff record binding the exact effect.
4. Return an opaque, type-state cut ticket.
5. Release all authority locks and `LocalSnapback`.
6. Perform the filesystem/provider cut using only that ticket.
7. Settle the outcome from the handoff record, not from the original live caller.

No lock is held across DNS, HTTP, S3, or filesystem sync.

## Window semantics — the part that must not be fudged

Let `H` be the durable handoff commit and `R` an authority-retirement transition.

- `R < H` — revalidation/CAS fails, no ticket exists, the effect must not start.
- `H < R` — the recorded predecessor remains authorized. Retirement blocks NEW handoffs but does
  not retract this one.
- After `H`, no session, service-token, watch, anchor, function-basis or job-claim liveness check
  may veto the already-authorized physical attempt.

So if logout, grant revocation, watch cancellation, anchor expiry or claim expiry commits between
`H` and provider acceptance, the attempt still proceeds. For webhooks specifically: cancellation
after the attempt transition does not unsend that attempt; it prevents a LATER attempt being
authorized.

Guaranteed: the predicate was current at `H`; the exact bounded effect was fixed by the record;
crash behaviour follows the record's delivery class; later retirement cannot silently reinterpret
the attempt as unauthorized.

NOT guaranteed: that the provider received or accepted it; that a transport error means "not
received"; exactly-once delivery; that an at-least-once receiver honours an idempotency key.

## Crash and double-send, per delivery class

| Class | Effects | Recovery |
|---|---|---|
| Replay-safe exact object/offset | TUS, canonical staging, blob PUT, DELETE | Retry same key/offset, verify. |
| At-least-once, cooperative receiver dedup | Webhook | Retry same delivery + idempotency key; duplicates possible if receiver ignores it. |
| No trustworthy provider dedup | fetch, Ask, Expo | Crash after `transmitting` is `ambiguous`; NEVER auto-resend. |

## What this costs: 4 of 9 need real work, 5 do not

| Effect | Verdict |
|---|---|
| Local blob publication / S3 PUT | **Already correct.** `Planned` names key, digest, policy, generation, attempt; the put ticket is constructible only from that proof. No redesign. |
| Owner asset physical deletion | **Already correct.** The delete transaction verifies ownership and absence of references, then commits the cascade. |
| Expo push | **Lifecycle correct.** Reservation already binds payload, audience, batches, messages. Only the authority boundary needs correcting: the pre-transmit check at `server.rs:2144` must stop acting as a session/service veto AFTER an accepted reservation. |
| S3 DELETE | **Mostly correct — one real ordering defect.** See separate ticket. |
| Arbitrary mutating fetch | New handoff record required; no idempotency identity exists today. |
| Webhook | New atomic composite attempt transition required; the attempt table records only terminal outcomes, with no pre-send state. |
| Ask-provider submission | Spend reservation is insufficient — it is aggregate day/lane/caller accounting, not a request identity. Needs per-provider-turn attempt records. |
| TUS staging append/sync | New per-chunk plan required; bytes are appended and synced before the offset CAS. |
| Canonical staging rewrite | Not covered by `planned` — staging is written during unlocked preparation, plan commits afterward. Needs an `asset-finalize-preparation` record. |

## Verified claims about existing state

The classification asserted that planned/tombstone/condemnation/claimed-job states already provide
sufficient authority. Checked against source:

- **Planned publication** — true for blob/local/S3 publication; FALSE for the earlier canonical
  staging rewrite, which happens before `planned`.
- **Tombstone/cancellation** — true.
- **Condemnation** — true for the normal loops; FALSE in one torn-`planned` branch.
- **Claimed job** — NOT sufficient alone. A claim binds job/attempt/claim ID/fence/lease but not
  every physical key or the webhook authority predicate. Asset cleanup needs
  `{claimed work, condemned record}`; webhook needs the full watch/job composite.

## Author rulings — 2026-08-23

Charlie Cheever accepted the general durable-handoff rule and ruled:

1. **Webhook delivery is at-least-once.** Arbitrary receivers may ignore
   `Idempotency-Key`, so duplicates remain part of the advertised contract;
   no exactly-once claim follows.
2. **Ask authorization is per provider turn.** A turn whose exact durable
   marker commits before retirement may send and settle; later turns stop.
3. **Expo reservation is the authority cut.** No live-session veto remains
   after accepted reservation. A pre-reservation check may exist only as a
   non-authoritative fast-fail aid; atomic validation at reservation remains
   mandatory.

These rulings are recorded in LLPs 0070, 0204, and 0143 respectively. They
unblock the three named implementation tickets; they do not silently decide
arbitrary-fetch automatic-redrive policy.

## Provenance

Read-only codex analysis against `4241f5890`. Full per-effect design with file:line citations
appended below.

---

# Design: durable authority-to-effect handoff

Status: Proposed  
Analysis basis: current checkout at `4241f58901a5644edc993ed6863edd74c5354365`  
No files were modified.

## Decision

Irreversible effects use a durable authority handoff:

1. Prepare and normalize the exact effect outside `LocalSnapback`.
2. For caller-backed work, reserve session/service authority outside `LocalSnapback`.
3. In one short transaction:
   - revalidate the applicable authority predicate;
   - acquire the mode guard last;
   - commit an effect-specific durable handoff record binding the exact effect.
4. Return an opaque, type-state cut ticket.
5. Release all authority locks and `LocalSnapback`.
6. Perform the filesystem/provider cut using only that ticket.
7. Settle the outcome from the handoff record, not from the original live caller.

`PreparedAuthority` contains session and service publication carriers, while `effect_guard` delegates only to the admission lease, so the current mode-only guard cannot itself implement this transfer ([invocation.rs:1182](crates/snapback-sync/src/auth/invocation.rs:1182), [invocation.rs:1608](crates/snapback-sync/src/auth/invocation.rs:1608)). The split-phase ordering—authority reservation outside `LocalSnapback`, mode guard last, retention only through commit—is already the recorded SQLite design ([authorized-effect-fence-design.md:21](issues/closed/20260821-authorized-effect-fence-design.md:21)).

The durable record must bind, as applicable:

- a stable logical effect identity;
- root invocation/job/watch/asset identity and generation or claim fence;
- destination and operation kind;
- canonical request/payload digest and bounded length;
- the provider idempotency key or an explicit `none`;
- delivery class: replay-safe, receiver-deduplicated at-least-once, or non-redrivable;
- state and attempt number.

Bearer credentials, signing secrets, provider keys, and application data need not be persisted. The handoff may bind their opaque reference or request digest while the cut ticket carries the actual material only in memory.

This is a uniform rule, not necessarily one uniform table. Expo and assets should retain their existing domain-specific state machines; fetch, Ask, and webhook attempts can share the same handoff abstraction and proof shape.

## Window semantics

Let `H` be the durable handoff commit and `R` an authority-retirement transition:

- `R < H`: the transaction’s revalidation/CAS fails; no cut ticket exists and the effect must not start.
- `H < R`: the exact recorded predecessor remains authorized. Retirement blocks new handoffs but does not retract this one.
- After `H`, no session, service-token, watch, anchor, function-basis, or job-claim liveness check may veto that already-authorized physical attempt.

Therefore, if logout, grant revocation, watch cancellation, anchor expiry, function replacement, or claim expiry commits in the gap between `H` and provider acceptance, the attempt remains authorized. It proceeds according to its delivery class. For webhook specifically, cancellation after the attempt transition does not unsend that attempt; it prevents a later attempt from being authorized.

What is guaranteed in this window:

- the relevant authority predicate was current when `H` committed;
- the exact bounded effect was fixed by the record;
- crash and replay behavior is determined by the record’s delivery class;
- later retirement cannot silently reinterpret the attempt as unauthorized.

What is not guaranteed:

- that the provider receives or accepts the request;
- that a transport error means “not received”;
- exactly-once delivery;
- that an at-least-once recipient honors an idempotency key;
- that a non-redrivable attempt will happen after a process death immediately following `H`.

No lock is held across DNS, HTTP, S3, filesystem sync, or other physical work.

## Crash classes

| Class | Effects | Recovery |
|---|---|---|
| Replay-safe exact object/offset | TUS, canonical staging, blob PUT, DELETE | Retry the same key/offset and verify. |
| At-least-once with cooperative receiver dedup | Webhook | Retry the same delivery with the same idempotency key. Duplicates remain possible if the receiver ignores it. |
| No trustworthy provider dedup | Arbitrary fetch, Ask, Expo | A crash after `transmitting` is `ambiguous`; never automatically resend. |

This matches the durable-work rule that an external effect without stable idempotency becomes ambiguous and cannot be silently retried ([LLP 0070:603](llp/0070-durable-background-work.rfc.md:603), [LLP 0044:1333](llp/0044-asset-storage-pipeline.rfc.md:1333)).

## Existing-state verification

| Asserted authority | Verdict |
|---|---|
| Planned publication | True for blob/local/S3 publication. The record binds opaque key, digest, policy, generation, and attempt; Phase B receives a ticket constructible only from a planned-publication proof ([assets.rs:542](crates/snapback-kernel/src/assets.rs:542), [assets.rs:610](crates/snapback-services/src/assets.rs:610)). False for the earlier canonical staging rewrite, which currently happens before `planned`. |
| Tombstone/cancellation | True. The deletion cascade commits attempt cancellation, asset `Deleted`, reference release, grant removal, and receipts before returning the staging key ([asset_maintenance.rs:25](crates/snapback-kernel/src/storage/asset_maintenance.rs:25), [asset_reads.rs:914](crates/snapback-kernel/src/storage/asset_reads.rs:914)). |
| Condemnation | True for the normal condemned-publication and condemned-blob loops. False in one torn-`planned` branch, which currently deletes before committing condemnation ([engine.rs:13622](crates/snapback-engine/src/local/engine.rs:13622)). |
| Claimed job | Not sufficient alone. A job claim binds job, attempt, claim ID, fence, and lease ([jobs.rs:224](crates/snapback-kernel/src/storage/jobs.rs:224)), but not every physical key or webhook authority predicate. Asset cleanup requires `{claimed work, condemned record}`; webhook requires the complete watch/job composite. |

## Per-effect design

### 1. Arbitrary mutating fetch — new handoff required

Current state:

- The physical cut is `call`/`send_string` ([server.rs:2035](crates/snapback-server/src/server.rs:2035)).
- `HostFetchRequest` has no dedicated idempotency identity ([host_glue.rs:229](crates/snapback-engine/src/runtime/host_glue.rs:229)).
- Durable job retry can rerun the whole action, including fetch ([LLP 0028:814](llp/0028-cron-scheduled-execution.rfc.md:814)).

Discharge point:

Commit a new `fetch-effect/<root-id>/<effect-ordinal>` transition directly to `transmitting`, binding method, authored URL, target-policy identity, canonical headers/body digest, timeout, and any declared provider idempotency identity.

- Ordinary action: commit under the caller’s split-phase reservation.
- Durable job: derive from the current fenced job claim, using a stable `(job_id, effect_ordinal)` key.
- A retry presenting a different digest for the same key is a conflict.
- Once committed, provider initiation uses the ticket without another live-authority check.

Crash behavior:

Default to at-most-once initiation. `transmitting` without a terminal outcome becomes `ambiguous`; generic job retry must not resend it. A job should surface `ambiguousExternalEffect`, which is already the durable-work vocabulary ([LLP 0070:603](llp/0070-durable-background-work.rfc.md:603)).

Author ruling required for an optional stronger mode:

> Does an application-authored `Idempotency-Key` header count as a platform-recognized stable provider mechanism?

Options:

1. V1 always treats arbitrary fetch as non-redrivable.
2. Add an explicit declared idempotency field/contract and permit at-least-once retry only for that mode.

Do not infer provider dedup merely from an arbitrary header map.

### 2. Expo push — lifecycle already correct; authority boundary needs correction

The push reservation already commits the payload binding, resolved audience, batches, and messages before transmission ([push.rs:1302](crates/snapback-kernel/src/push.rs:1302)). That is the accepted command and therefore the authority discharge.

The later `claimed → transmitting` transition is the physical cut gate and crash discriminator, not a reason to revisit the live caller. It verifies claim ID, fence, and lease and must commit before request construction/write ([push.rs:1769](crates/snapback-kernel/src/push.rs:1769)).

Consequences:

- Fence the immediate caller-backed reservation correctly.
- After reservation commits, batch claim and `transmitting` derive from the durable intent and are mode/lifecycle-owned.
- Remove the current service/session-shaped authorization meaning from the pre-transmit check at [server.rs:2144](crates/snapback-server/src/server.rs:2144). It may remain only as an implementation aid before reservation, not as a veto after accepted reservation.
- System, Deferred, and maintenance/recovery branches need no authority change.

Crash/double-send behavior is already correct:

- expired pre-transmit claims return to `reserved`;
- expired `transmitting` batches become `ambiguous` and are never automatically redriven ([push.rs:2170](crates/snapback-kernel/src/push.rs:2170));
- explicit `redriveAmbiguous` acknowledges duplicate notification risk ([push.rs:85](crates/snapback-kernel/src/push.rs:85));
- this code sends no provider-side idempotency header ([push.rs:64](crates/snapback-services/src/push.rs:64)).

No new Expo state machine is needed.

### 3. Webhook — new atomic composite attempt transition required

Current revalidation checks the right predicate:

- active watch;
- matching pending ordinal/job;
- webhook reaction;
- active user or integration anchor;
- current function basis;
- delivery owner, target, and secret reference ([engine.rs:23469](crates/snapback-engine/src/local/engine.rs:23469)).

But it returns only an in-memory request. `LocalSnapback` is then released and the HTTP request is sent ([server.rs:3443](crates/snapback-server/src/server.rs:3443)). The attempt table currently records only terminal outcomes, not a pre-send state ([webhooks.rs:33](crates/snapback-kernel/src/storage/webhooks.rs:33)).

Discharge point:

Replace the read-only revalidation with an atomic `authorize_watch_webhook_attempt` transition that:

1. verifies the current job row still matches `job_id`, attempt, claim ID, fence, and unexpired claim;
2. verifies the complete watch/firing/owner-or-anchor/current-functions predicate;
3. verifies the immutable delivery binding;
4. inserts the exact attempt as `transmitting`;
5. commits under the job’s mode lease;
6. returns `AuthorizedWebhookAttempt`.

`WatchJobContext` and `PreparedWatchWebhook` must carry claim ID and fence; they currently retain only job ID/attempt-level facts while `ClaimedJob` contains the stronger claim identity ([engine.rs:1804](crates/snapback-engine/src/local/engine.rs:1804), [jobs.rs:225](crates/snapback-kernel/src/storage/jobs.rs:225)).

There is no session reservation in this design.

Crash/double-send:

Webhook remains bounded at-least-once. Every retry uses the existing immutable body and stable `watch:{watchId}:{ordinal}` key ([LLP 0070:689](llp/0070-durable-background-work.rfc.md:689)). The transport sends both `Idempotency-Key` and delivery ID ([webhooks.rs:134](crates/snapback-services/src/webhooks.rs:134)).

An unsettled `transmitting` attempt becomes an ambiguous predecessor and a later claimed job may authorize another attempt with the same logical delivery key. **INFERRED:** arbitrary receivers may ignore the header, so duplicate delivery remains part of the advertised at-least-once contract.

### 4. Ask-provider submission — spend reservation is insufficient

The current spend table is aggregate by day/lane/caller and stores only reserved/spent counters ([ask_spend.rs:25](crates/snapback-kernel/src/storage/ask_spend.rs:25)). Its returned reservation is an in-memory accounting value, not a request identity ([ask_spend.rs:46](crates/snapback-kernel/src/storage/ask_spend.rs:46)). It cannot authorize any particular provider request.

Each Ask run can issue several provider calls ([server.rs:24774](crates/snapback-server/src/server.rs:24774)), and the provider transport sets only authorization and content type—no idempotency key ([ask.rs:318](crates/snapback-engine/src/ask.rs:318)).

Discharge point:

Add a durable Ask run identity and a per-provider-turn attempt. Immediately before each `chat_completion`:

- bind run ID, provider/model, turn ordinal, messages/tools/request digest, maximum remaining tokens, and budget reservation identity;
- reserve the live caller authority outside `LocalSnapback`;
- commit that turn as `transmitting`;
- send using the returned ticket.

Per-turn rather than per-run authorization follows the stated contract that Ask executes under the caller’s authority and each inner function call uses that authority ([LLP 0204:474](llp/0204-app-external-surfaces.rfc.md:474)). A turn whose marker commits before logout may send; later queries and provider turns require new authorization and stop after retirement.

Crash/double-send:

- `transmitting` with no result becomes `ambiguous`;
- never automatically resubmit the provider turn;
- preserve conservative spend reservation because actual provider usage may be unknown;
- a new client Ask request is a new run and may spend again;
- request-scoped caller provider keys remain unpersisted as required ([LLP 0204:486](llp/0204-app-external-surfaces.rfc.md:486)).

### 5. TUS staging append/sync — new per-chunk plan required

Current preflight returns only an in-memory ticket; bytes are appended and synced before the offset CAS ([asset_routes.rs:266](crates/snapback-server/src/server/asset_routes.rs:266)). The later CAS cannot authorize an already-written chunk.

Discharge point:

Commit an `asset-append-plan` before the append, keyed by `(attempt_id, lifecycle_generation, expected_offset)` and binding:

- staging key;
- expected and resulting offsets;
- chunk length and always-computed SHA-256;
- prior/new checksum-grade facts;
- state `planned`.

Commit it under caller split-phase authority. The physical append and final acknowledgment then derive from this plan. Final settlement is host/lifecycle bookkeeping and must not recheck the caller.

Crash/double-write:

The local store already writes at an exact offset, flushes and syncs, and documents same-tail overwrite on retry ([assets_store.rs:181](crates/snapback-services/src/assets_store.rs:181), [assets_store.rs:43](crates/snapback-kernel/src/assets_store.rs:43)).

- The server cannot automatically retry because it does not persist chunk bytes.
- A client retry with the same offset, length, and digest resumes the same plan and overwrites identically.
- Different bytes for the same plan conflict.
- Cancellation may logically win after the plan commits, but physical cleanup must wait until the append plan is terminal. Otherwise cancellation could delete staging while the authorized append recreates it.

### 6. Canonical staging rewrite — new preparation plan required

This is not currently covered by `planned` publication. Canonical local/S3 staging is written during unlocked preparation ([assets.rs:335](crates/snapback-services/src/assets.rs:335)), while the publication plan is committed only afterward ([engine.rs:13227](crates/snapback-engine/src/local/engine.rs:13227)). The governing LLP explicitly confirms that preparation writes canonical staging but creates no durable database state ([LLP 0044:745](llp/0044-asset-storage-pipeline.rfc.md:745)).

Discharge point:

Before unlocked preparation, commit a durable `asset-finalize-preparation` record—or an equivalently bound early `Finalizing` transition—containing:

- attempt and lifecycle generation;
- staging key and acknowledged complete length;
- finalize request including declared digest;
- frozen intent policy and implementation generation/hash;
- canonicalization operation and preparation ID.

A bare early `Finalizing` state is insufficient unless the finalize request and frozen policy are also durably bound; those facts currently exist only in `FinalizePrepareTicketV1` ([assets.rs:652](crates/snapback-services/src/assets.rs:652)).

After that commit, canonical rewriting may finish despite caller logout. Intent-policy revocation may still prevent the later publication plan; the rewrite remains restricted staging and is then cleaned up.

Crash/retry:

- local rewriting uses durable replacement ([assets_store.rs:200](crates/snapback-services/src/assets_store.rs:200));
- S3 rewrites the same canonical staging key ([assets_s3.rs:666](crates/snapback-services/src/assets_s3.rs:666));
- retry reconstructs the same frozen operation and verifies the resulting digest;
- cleanup must exclude an active preparation plan.

### 7. Local blob publication and S3 PUT — existing plan is correct

Discharge point:

The Phase A `AssetPublicationRecordV1::Planned` commit is sufficient once its caller-backed transaction is properly fenced. It names the exact opaque key, digest, canonicalization policy, generation, and attempt ([assets.rs:542](crates/snapback-kernel/src/assets.rs:542)). `FinalizePutTicketV1` can be constructed only from the planned proof and performs the database-free put and verification ([assets.rs:586](crates/snapback-services/src/assets.rs:586)).

After `planned`, no live caller check belongs at PUT or truthful completion.

Crash/double-PUT behavior is already correct:

- local publication reuses the existing object or durably replaces it ([assets_store.rs:208](crates/snapback-services/src/assets_store.rs:208));
- S3 uses `If-None-Match: *` and treats 412 as the already-present success case ([assets_s3.rs:675](crates/snapback-services/src/assets_s3.rs:675));
- recovery verifies a `planned` object and advances it to `staged`; the protocol is explicitly replayable ([LLP 0044:827](llp/0044-asset-storage-pipeline.rfc.md:827)).

No physical PUT or recovery redesign is required.

### 8. S3 DELETE — mostly correct; one ordering defect

Valid discharge records are:

- attempt `Cancelled` or `Expired` for staging cleanup;
- asset `Deleted` tombstone for owner/pending cleanup;
- publication `Condemned` for abandoned publication objects;
- blob `condemned=1` for immutable blob GC;
- for asset work, `{Claimed work row, exact Condemned publication row}`.

S3 DELETE is idempotent in this implementation: 204 and 404 both succeed ([assets_s3.rs:783](crates/snapback-services/src/assets_s3.rs:783)). Local deletion is likewise NotFound-tolerant ([assets.rs:935](crates/snapback-services/src/assets.rs:935)).

One change is required: the torn, non-redrivable `planned` branch currently deletes the object before committing condemnation ([engine.rs:13622](crates/snapback-engine/src/local/engine.rs:13622)). Reverse that order:

1. `planned → condemned` commit;
2. delete;
3. retire/receipt.

The ordinary condemned-publication loop and blob-GC loop already use the correct order ([engine.rs:13651](crates/snapback-engine/src/local/engine.rs:13651), [engine.rs:14048](crates/snapback-engine/src/local/engine.rs:14048)).

### 9. Owner asset physical deletion/cleanup — current lifecycle order is correct

Discharge point:

The explicit-delete transaction verifies ownership and absence of references, then commits the shared deletion cascade ([asset_reads.rs:914](crates/snapback-kernel/src/storage/asset_reads.rs:914)). The cascade:

- cancels a current attempt;
- retires renditions and releases references;
- removes grants;
- transitions the asset to `Deleted`;
- writes receipts;
- returns the staging key ([asset_maintenance.rs:25](crates/snapback-kernel/src/storage/asset_maintenance.rs:25)).

Only that transaction needs caller split-phase fencing. The subsequent staging cleanup is already correctly ordered after it ([engine.rs:13934](crates/snapback-engine/src/local/engine.rs:13934)).

Crash behavior:

- retrying cleanup is harmless because local/S3 deletion tolerates missing objects;
- orphan staging is discoverable by the mandatory sweep ([engine.rs:13971](crates/snapback-engine/src/local/engine.rs:13971));
- blob bytes are not immediately owner-deleted: the tombstone releases references and later condemnation/retention GC owns physical blob deletion, matching the documented lifecycle ([LLP 0044:1419](llp/0044-asset-storage-pipeline.rfc.md:1419)).

No physical cleanup redesign is required.

## What needs no change

Literally no change is required for:

- System/Deferred and maintenance/recovery Expo sending.
- Condemned-publication S3 DELETE.
- Condemned-blob GC DELETE.
- Scheduled expired-attempt and pending-asset staging cleanup after their terminal transitions.

No physical adapter or crash-state redesign is required for:

- immediate Expo, after fixing authority transfer at reservation;
- local blob/S3 PUT after fixing the caller-backed `planned` commit;
- owner cleanup after fixing the tombstone/cancellation commit fence;
- ordinary tombstone/condemnation-backed DELETE.

New durable handoff state is required for:

- arbitrary fetch;
- webhook attempt initiation;
- each Ask provider turn;
- each TUS append;
- canonical staging preparation.

## Ordered implementation sequence

1. Introduce the common handoff/ticket contract and interleaving test vocabulary: retirement-before-handoff, handoff-before-retirement, crash-before-cut, crash-after-cut.
2. Correct Expo semantics: fence immediate reservation, treat it as command acceptance, and stop rechecking live caller authority after it.
3. Finish the already-designed asset paths: fence `planned`, cancellation, and deletion transitions; reverse the torn-object delete/condemn order.
4. Add atomic webhook-attempt authorization with full job claim identity and the watch/job/anchor/functions composite.
5. Add Ask run and per-provider-turn attempt records; make spend settlement derive from them.
6. Add TUS append plans and canonical preparation plans, including cleanup exclusion for live plans.
7. Implement arbitrary fetch handoff after the idempotency-contract ruling.

The riskiest item is arbitrary mutating fetch. It combines arbitrary providers, no platform idempotency field, secret-bearing request material, and whole-action job retry. It must not ship with generic automatic redrive.

Each lane should prove the two ordering outcomes and its crash matrix with affected tests and provider/store fakes. No complete proof tied to an exact moving `HEAD` is required.
