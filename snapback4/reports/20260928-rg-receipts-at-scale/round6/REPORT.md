# RG round 6 — receipt delivery under repeated faults

Astra's blocking observation-read stall is fixed. The generated matrix found
and fixed one more gate: receipt recovery for an already-proven successful
head. Both operations now schedule the existing retry and let the FIFO visit
later entries. The observation read catches only its own rejection and makes
sync eligibility false; `syncOnce()` keeps its existing failure boundary.
Unknown heads still require custody reads and durable settlement before the
next send. Production changes are three replaced lines in `local.ts`, with no
new state or public surface; the file remains 1,500 lines.

Read rounds 0–5 prompts/reports/RG journal entries, the Snapback 4 fence and
rules, and the complete Astra review before coding. Grok was unfinished at
start; it completed READY during this round and was read in full. Its Low
(recovered event shape), omitted settling-marker control, and weak round-4
exit-code-only control checks are covered below. No waiting for Grok and no
new review delegation. [Context pack](CONTEXT.md).

Inherited merge instruction: fetched and merged origin/main
`ea7ecc896c166c31caf88f843e0c4dce4ea900b6` in local merge `87c918ebf`.
The only conflict was the append-only journal; both parents' entries were
retained in their original order. The implementation is on that merged tree.
No push, publication, version/budget increase or tool installation.

## Reproductions and delivery behavior

Copied Astra's reproduction from
`/tmp/rg-r45-astra-vpk9iwum/snapback4/packages/snapback4/test/rg-extra.test.mjs`
into the audit module: a completed but unobserved success, a second admitted
send, persistently failing observation-only `queued()` read, and eight
five-second retries. It fails before the fix with one POST instead of two
([before](astra-before.log)); it passes after the fix. The round-6 guard
removal controls recreate that failure.

The additional gate is `deliverAcknowledgedReceipt` at the same proven-success
head. A receipt-history rejection used to end the entire FIFO pass. The matrix
injects below that awaited helper, leaving the ordinary queue read healthy;
the persistent case cannot send either healthy tail without the new guard.
Retrying receipt delivery retains the existing reference-counted emission
owners. No receipt is invented and no unknown execution is skipped.

Grok's event-shape check now checks the exact recovered object, including
`replayed: true` and absence of `result`, in replacement integration tests and
both overlapping-owner orders. A separate retiring-settlement test pins its
emission marker across a queue read and confirms bounded cleanup after release.
The existing integration race can be protected by another live snapshot; the
focused test proves the settling guard itself.

## Matrix boundary and invariants

[Manifest](../../../packages/snapback4/test/delivery-fault-sites.json),
[recipes](../../../packages/snapback4/test/delivery-fault-recipes.mjs),
[runner](../../../packages/snapback4/test/delivery-fault-matrix.test.mjs),
[source census](await-sites.json), [results](matrix.json), and
[final TAP](matrix-final.log).

140 sites generate 280 cases: 92 optional and 48 required, each transient and
persistent. A real wasm device is acquired, completes a success without
observing it, then admits two more sends behind a held queue read. Branch
recipes drive acknowledgement, receipt recovery/save, reset housekeeping,
backend adoption, reconnect/probe/change-feed, exit settlement, native fallback,
media home/manifest/byte pruning, hold reasons and clock persistence. No app
hooks or matrix instrumentation enter the distributed client.

The instrumenter uses the TypeScript AST and async call context. Host calls,
fetches, response decoding and stream reads fail below their existing catches;
compound awaits inherit those real failures. Explicit no-op callback recipes
reject the callee instead. The queue iterator's `next()` is included. Six
non-rejecting timer/exit waits are marked O*: a resolve-only promise cannot
honestly be made to reject. Their cases fail the upstream operation once or
persistently, reach the wait and demonstrate bounded recovery. Exit transport
still resolves within its existing one-second bound.

This is the SDK delivery boundary, not recursive fault injection into the wasm
engine or every IndexedDB/native transaction instruction: those are represented
by `DeviceCore.call`. The entry fixture is an admitted, live persona client.
Session revocation/credential deletion, client construction/close, independent
query rendering and media upload/view APIs are separate lifecycles. A revoked
session is not permission to post a healthy send; the awaited refusal checks at
the delivery boundary are included. Reset/adoption bookkeeping uses controlled
host replies; the existing real replacement/restore audit remains independent.
Pruning of emission IDs, receipt counts and metering/notification calls is
synchronous; it adds no await. Their ownership and bounds remain covered by
the audit, pending/clock tests and prior controls. Media byte/manifest pruning
and custody calls that do await are explicit rows below.

The exact manifest rejects a changed/new await in the listed delivery owners.
A second AST boundary seal inventories awaits across the client source tree,
including owners outside that list: a new helper/module cannot silently escape
classification. Updating that seal requires reviewing reachability, then adding
a recipe and required/optional classification for a delivery site. There is no
default recipe; ambiguous/missing sites fail. The two census mutations test both
an added delivery await and an added helper await. This is conservative source
change detection, not a claim of a sound static call-graph analysis.

For every case:

- Freeze time, fail once or on every attempt, and advance eight five-second
  retries. Assert no attempts occur while time stays frozen. Timer delays must
  be among 250/500/1000/2000/4000/5000 ms and stay monotone after the initial
  successful tail settlements (which legitimately reset the existing backoff).
- Optional failures must let all three healthy IDs POST once and emit exactly
  once while the fault remains; `client.write(id)` agrees during the failure.
- Required failures may withhold an unknown head or a receipt lookup. Removing
  the fault must restore progress, FIFO and receipt agreement. "Required" does
  not mean all sites always block: a post-commit result or bounded exit wait may
  preserve progress, while the underlying uncommitted custody call cannot be
  ignored. Each row states the custody/transport reason.
- After recovery, each terminal ID has exactly one `onWrite`, and lookup agrees.
  Transient callers reach their terminal outcome within their wait. A persistent
  fault can outlast the contract's 25-second caller wait and return `pending`;
  same-ID caller collection after repair returns the terminal outcome without
  another POST or event. A Promise that already returned pending is not changed.
- Lost mutation response/processing is necessarily different from optional
  housekeeping: indices 11 and 116 exercise an unknown response and replay the
  same ID (four POST attempts transient; twelve persistent including recovery).
  They keep one terminal notification and FIFO; they do not assert one HTTP
  attempt when its result was lost. Actual server at-most-once remains covered
  by the receipt/settlement suites. No healthy optional-fault send is reposted.

The final result file records actual reachability, injected failures, whether
an outer await propagated rejection, retry delays and POST counts. A swallowed
inner failure is expected for a guarded optional call, not evidence of a missing
injection. Every final case must reach its classified site and inject a fault.

## Awaited-site table

R = required custody/transport read or write; O = optional to healthy delivery;
O* = optional, non-rejecting wait with upstream-failure injection. T/P means
transient/persistent both pass. Full expressions are in the census; long
expressions are abbreviated here. IDs are the manifest's stable case indices.

| ID | Source / owner | Awaited call | Class and reason | T/P |
|---:|---|---|---|---|
| 0 | `local.ts:171` read | `call({ op: "meta", key: "write-history" })` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 1 | `local.ts:172` lookup | `call({ op: "meta", key: "write-history", lookup: true })` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 2 | `local.ts:174` save | `terminalDeviceCall(committed => call({ op: "keep_write", value }, undefined, committed), () => {})` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 3 | `local.ts:243` refreshAcquired | `call({ op: "sync_state", capture: false })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 4 | `local.ts:309` captureStore | `call({ op: "sync_state", capture: false })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 5 | `local.ts:316` call | `history.persistPending()` | O — sync preflight; unresolved receipt retains its own custody | pass/pass |
| 6 | `local.ts:344` call | `work` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 7 | `local.ts:348` call | `media?.reconcile()` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 8 | `local.ts:532` sendPost | `captureStore()` | O — independent query/restore bookkeeping | pass/pass |
| 9 | `local.ts:535` sendPost | `postForCaller(doFetch, base, path, request.headers, body, eph?.signal ?? aborter.signal, (json, status) => captured?.capture(json, status))` | R — mutation transport/response has no usable outcome; same-ID retry after recovery | pass/pass |
| 10 | `local.ts:540` sendPost | `holds.record((body as { id: string }).id, why.code)` | O — held-reason bookkeeping; retain retryable head | pass/pass |
| 11 | `local.ts:548` sendPost | `refusedSession(denied, request.revision)` | R — mutation transport/response has no usable outcome; same-ID retry after recovery | pass/pass |
| 12 | `local.ts:558` sendPost | `witnessRestore(json.store_id, json.head ?? json.seq, capture)` | O — independent query/restore bookkeeping | pass/pass |
| 13 | `local.ts:587` syncRound | `history.persistPending()` | O — sync preflight; unresolved receipt retains its own custody | pass/pass |
| 14 | `local.ts:588` syncRound | `call({ op: "state" })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 15 | `local.ts:606` syncRound | `call({ op: "sync_state" })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 16 | `local.ts:621` syncRound | `fetchSync(`${base}/sync`, { method: "POST", headers: request.headers, signal: aborter.signal }, { generation: capturedGeneration, from: watermark, limit…` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 17 | `local.ts:623` syncRound | `response.json()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 18 | `local.ts:648` syncRound | `refusePartition(denied, pageRevision)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 19 | `local.ts:660` syncRound | `call({ op: "observe_store", page: denied ? { ...page, snapshot: false, events: [], more: true, ...(generationChanged ? { images_at: page.watermark } : {…` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 20 | `local.ts:675` syncRound | `call({ op: "sync_state", capture: false })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 21 | `local.ts:680` syncRound | `call({ op: "set_meta", key: "syncedAt:wall:1", value: "0" })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 22 | `local.ts:697` syncRound | `loadBackend(doFetch, base, request.headers, aborter.signal)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 23 | `local.ts:699` syncRound | `call({ op: "adopt", backend: nextBackend, store_id: publishedStore ?? null, send_revision: page.send_revision, adoption_capture: adoptionCapture })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 24 | `local.ts:707` syncRound | `refreshAcquired(true)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 25 | `local.ts:708` syncRound | `installNative(aborter.signal)` | O — native discovery/install fallback | pass/pass |
| 26 | `local.ts:710` syncRound | `refusedSession(error.denied, backendRevision)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 27 | `local.ts:728` syncRound | `refusePartition(denied, pageRevision)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 28 | `local.ts:735` syncRound | `call({ op: "apply", page, first: !catchingUp && after === undefined }, touched)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 29 | `local.ts:744` syncRound | `call({ op: "sync_state", capture: false })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 30 | `local.ts:766` syncRound | `refreshAcquired()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 31 | `local.ts:769` syncRound | `call({ op: "set_meta", key: "syncedAt:wall:1", value: String(lastSyncAt) })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 32 | `local.ts:795` probe | `captureStore()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 33 | `local.ts:797` probe | `doFetch(`${base}/probe`, { headers: request.headers, signal: aborter.signal })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 34 | `local.ts:799` probe | `response.json()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 35 | `local.ts:801` probe | `refusedSession(json.denied ?? json.why, request.revision)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 36 | `local.ts:804` probe | `witnessRestore(json.store_id, json.seq, capture)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 37 | `local.ts:814` waitForChange | `new Promise((r) => setTimeout(r, 1000))` | O* — bounded resolve-only wait | pass/pass |
| 38 | `local.ts:815` waitForChange | `probe()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 39 | `local.ts:818` waitForChange | `probe()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 40 | `local.ts:823` waitForChange | `captureStore()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 41 | `local.ts:825` waitForChange | `changes(seq, options.waitSeconds ?? 25, request.headers, storeIdentity, Object.values(backend!.schema.tables).some(table => table.ephemeral) ? ephemeral…` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 42 | `local.ts:828` waitForChange | `refusedSession(json.denied, request.revision)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 43 | `local.ts:835` waitForChange | `witnessRestore(json.store_id, json.seq, capture)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 44 | `local.ts:850` waitForChange | `new Promise((r) => setTimeout(r, 1000))` | O* — bounded resolve-only wait | pass/pass |
| 45 | `local.ts:859` follow | `waitForChange()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 46 | `local.ts:862` follow | `syncOnce()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 47 | `local.ts:867` follow | `new Promise((r) => setTimeout(r, 1000))` | O* — bounded resolve-only wait | pass/pass |
| 48 | `local.ts:1078` flush | `flushOnce()` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 49 | `local.ts:1095` flushOnce | `exitDone` | O* — bounded resolve-only wait | pass/pass |
| 50 | `local.ts:1097` flushOnce | `media?.reconcile()` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 51 | `local.ts:1099` flushOnce | `exitDone` | O* — bounded resolve-only wait | pass/pass |
| 52 | `local.ts:1103` flushOnce | `deliverAcknowledgedReceipt(history, receiptCall, entry, success, completeWrite)` | O — already-proven success; retry recovery, continue FIFO | pass/pass |
| 53 | `local.ts:1105` flushOnce | `queued().catch(() => { retryFlush(); return undefined; })` | O — observation only; queued custody is already established | pass/pass |
| 54 | `local.ts:1105` flushOnce | `syncOnce()` | O — observation only; queued custody is already established | pass/pass |
| 55 | `local.ts:1110` flushOnce | `network(async () => { await exitDone; if (closed \|\| sessionDead) return { ok: false as const }; const current = (await queued()).find(current => curre…` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 56 | `local.ts:1111` flushOnce | `exitDone` | O* — bounded resolve-only wait | pass/pass |
| 57 | `local.ts:1113` flushOnce | `queued()` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 58 | `local.ts:1118` flushOnce | `recoverReceipt(history, receiptCall, entry.id, current.sent_seq ?? current.observed_seq, successSequence(current) != null)` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 59 | `local.ts:1124` flushOnce | `call({ op: "begin_send", id: entry.id })` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 60 | `local.ts:1127` flushOnce | `recoverReceipt(history, receiptCall, entry.id, receipt.state === "sent" ? receipt.seq : undefined, (started.ok as { qualified?: boolean }).qualified ===…` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 61 | `local.ts:1130` flushOnce | `post(`/m/${entry.op}`, { id: entry.id, args: entry.args, newIds: entry.new_ids, store_id: binding }, settled.get(entry.id)?.response)` | R — mutation transport/response has no usable outcome; same-ID retry after recovery | pass/pass |
| 62 | `local.ts:1135` flushOnce | `settleReceipt(history, receiptCall, json.state === "sent" ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true } : { state: "fail…` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 63 | `local.ts:1144` flushOnce | `syncUnobserved()` | O — observation only; queued custody is already established | pass/pass |
| 64 | `local.ts:1148` flushOnce | `syncUnobserved()` | O — observation only; queued custody is already established | pass/pass |
| 65 | `local.ts:1160` flushOnce | `syncUnobserved(outcome.state === "sent")` | O — observation only; queued custody is already established | pass/pass |
| 66 | `local.ts:1164` flushOnce | `syncUnobserved()` | O — observation only; queued custody is already established | pass/pass |
| 67 | `local.ts:1165` flushOnce | `syncUnobserved()` | O — observation only; queued custody is already established | pass/pass |
| 68 | `local.ts:1168` flushOnce | `syncUnobserved()` | O — observation only; queued custody is already established | pass/pass |
| 69 | `local.ts:1172` replayOnOpen | `captureStore()` | R — reopen must validate store/head before authorizing replay; recovery heals | pass/pass |
| 70 | `local.ts:1177` replayOnOpen | `doFetch(`${base}/probe`, { headers: request.headers, signal: aborter.signal })` | R — reopen must validate store/head before authorizing replay; recovery heals | pass/pass |
| 71 | `local.ts:1180` replayOnOpen | `response.json()` | R — reopen must validate store/head before authorizing replay; recovery heals | pass/pass |
| 72 | `local.ts:1181` replayOnOpen | `refusedSession(head.denied ?? head.why, request.revision)` | R — reopen must validate store/head before authorizing replay; recovery heals | pass/pass |
| 73 | `local.ts:1183` replayOnOpen | `witnessRestore(head.store_id, head.seq, capture)` | R — reopen must validate store/head before authorizing replay; recovery heals | pass/pass |
| 74 | `local.ts:1441` commit | `history.read(write.id, true)` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 75 | `local.ts:1443` commit | `receiptCall({ op: "settle_exit", write })` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 76 | `local.ts:1452` listenForExit | `holds.record(entry.id, why.code)` | R — exit outcome/custody may remain unknown; bounded exit resumes ordinary recovery | pass/pass |
| 77 | `local-receipts.ts:11` settleReceipt | `history.keep(write, revalidatedStore)` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 78 | `local-receipts.ts:12` settleReceipt | `call({ op: "settle", id: write.id, ...(write.state === "sent" ? { seq: write.seq } : {}) })` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 79 | `local-receipts.ts:30` receiptBatch | `queued()` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 80 | `local-receipts.ts:43` deliverAcknowledgedReceipt | `history.acknowledged(entry.id, seq, true)` | O — already-proven success; retry recovery, continue FIFO | pass/pass |
| 81 | `local-receipts.ts:44` deliverAcknowledgedReceipt | `settleReceipt(history, call, receipt)` | O — already-proven success; retry recovery, continue FIFO | pass/pass |
| 82 | `local-receipts.ts:65` syncSettledWrites | `queued()` | O — observation only; queued custody is already established | pass/pass |
| 83 | `local-receipts.ts:66` syncSettledWrites | `sync()` | O — observation only; queued custody is already established | pass/pass |
| 84 | `local-receipts.ts:70` recoverReceipt | `history.read(id, true)` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 85 | `local-receipts.ts:70` recoverReceipt | `history.acknowledged(id, observedSeq, qualified)` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 86 | `local-receipts.ts:74` recoverReceipt | `settleReceipt(history, call, known)` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 87 | `local-receipts.ts:82` lookupWrite | `queued()` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 88 | `local-receipts.ts:86` lookupWrite | `history.lookup(id)` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 89 | `local-receipts.ts:88` lookupWrite | `queued()` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 90 | `local-receipts.ts:94` lookupWrite | `history.read(id)` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 91 | `local-receipts.ts:94` lookupWrite | `history.acknowledged(id, seq, successSequence(entry) != null).catch(() => history.read(id))` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 92 | `local-receipts.ts:108` terminalDeviceCall | `call(reply => { durable = reply; })` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 93 | `local-receipts.ts:117` readQueued | `call({ op: "queued" })` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 94 | `writes.ts:154` keep | `this.storage.save(JSON.stringify({ ...receipt(write), ...(proof ? { revalidated_store: proof } : {}) }))` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 95 | `writes.ts:181` acknowledged | `this.read(id, true)` | O — already-proven success; retry recovery, continue FIFO | pass/pass |
| 96 | `writes.ts:187` acknowledged | `this.keep(sent)` | O — already-proven success; retry recovery, continue FIFO | pass/pass |
| 97 | `writes.ts:194` persistPending | `this.keep(write)` | O — sync preflight; unresolved receipt retains its own custody | pass/pass |
| 98 | `writes.ts:200` read | `this.keep(known)` | O — known outcome survives failed receipt repair | pass/pass |
| 99 | `writes.ts:203` read | `this.storage?.read()` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 100 | `writes.ts:215` lookup | `this.read(id)` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 101 | `writes.ts:217` lookup | `this.storage.lookup()` | R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals | pass/pass |
| 102 | `local-exit.ts:38` exitTransport | `response.json()` | R — exit outcome/custody may remain unknown; bounded exit resumes ordinary recovery | pass/pass |
| 103 | `local-exit.ts:41` exitTransport | `held?.(entry, why)` | R — exit outcome/custody may remain unknown; bounded exit resumes ordinary recovery | pass/pass |
| 104 | `local-exit.ts:42` exitTransport | `refused?.(entry, why)` | R — exit outcome/custody may remain unknown; bounded exit resumes ordinary recovery | pass/pass |
| 105 | `local-exit-settlement.ts:22` exitRefusalSettlement | `options.commit(write)` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 106 | `local-exit-settlement.ts:25` exitRefusalSettlement | `work` | R — uncommitted terminal custody cannot be discarded; store recovery heals | pass/pass |
| 107 | `local-assets.ts:52` call | `this.core.call(request)` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 108 | `local-assets.ts:70` home | `this.call({ op: "asset_home", id, home, viewer: this.viewer, now: this.now() })` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 109 | `local-assets.ts:73` save | `this.call({ op: "set_meta", key: "media:manifest", value: JSON.stringify([...this.entries.values()]) })` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 110 | `local-assets.ts:79` drop | `this.store.remove(id)` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 111 | `local-assets.ts:95` check | `this.home(entry.id, entry.home)` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 112 | `local-assets.ts:97` check | `this.drop(entry.id)` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 113 | `local-assets.ts:104` check | `this.drop(entry.id)` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 114 | `local-assets.ts:108` check | `this.save()` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |
| 115 | `request-wait.ts:17` postForCaller | `doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), ...(path.startsWith("/q/") ? { signal: stopped } : {}) })` | R — mutation transport/response has no usable outcome; same-ID retry after recovery | pass/pass |
| 116 | `request-wait.ts:18` postForCaller | `response.json()` | R — mutation transport/response has no usable outcome; same-ID retry after recovery | pass/pass |
| 117 | `local-sync.ts:50` legacyInput | `response.clone().json().catch(() => null)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 118 | `local-sync.ts:67` syncTransport | `doFetch(url, { ...init, body: JSON.stringify(attempt) })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 119 | `local-sync.ts:68` syncTransport | `legacyInput(response)` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 120 | `local-sync.ts:69` syncTransport | `doFetch(url, { ...init, body: JSON.stringify(withoutGeneration) })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 121 | `device-restore.ts:57` restoreWitness | `call(restoreObservation(storeId, Number(head), capture, generation()))` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 122 | `local-backend.ts:11` loadBackend | `doFetch(`${base}/schema`, { headers, ...(signal ? { signal } : {}) })` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 123 | `local-backend.ts:13` loadBackend | `response.json()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 124 | `local-native.ts:16` installNativeAttempt | `call({ op: "state" })` | O — native discovery/install fallback | pass/pass |
| 125 | `local-native.ts:28` installNativeAttempt | `loadBackend(doFetch, base, requestCredentials().headers, signal)` | O — native discovery/install fallback | pass/pass |
| 126 | `local-native.ts:41` installNativeAttempt | `doFetch(`${base}/native.wasm`, { headers: request.headers, ...(signal ? { signal } : {}) })` | O — native discovery/install fallback | pass/pass |
| 127 | `local-native.ts:43` installNativeAttempt | `response.arrayBuffer()` | O — native discovery/install fallback | pass/pass |
| 128 | `local-native.ts:46` installNativeAttempt | `call({ op: "install_native", wasm: hex, digest: wanted, generation: targetGeneration })` | O — native discovery/install fallback | pass/pass |
| 129 | `pending-writes.ts:50` revision | `call({ op: "sync_state", capture: false })` | O — held-reason bookkeeping; retain retryable head | pass/pass |
| 130 | `pending-writes.ts:57` record | `revision()` | O — held-reason bookkeeping; retain retryable head | pass/pass |
| 131 | `pending-writes.ts:60` record | `call({ op: "hold_write", id, reason })` | O — held-reason bookkeeping; retain retryable head | pass/pass |
| 132 | `clock.ts:89` wrapped | `fetcher(input, init)` | R — mutation transport/response has no usable outcome; same-ID retry after recovery | pass/pass |
| 133 | `clock.ts:135` save | `core.call({ op: "set_meta", key: "server-clock", value })` | O — sampled clock metadata; preserve retryable save chain | pass/pass |
| 134 | `changes.ts:52` changeFeed | `doFetch(`${base}/changes?since=${seq}&wait=${seconds}${streaming ? "&heartbeat=1" : ""}${storeIdentity === undefined ? "" : `&store_id=${encodeURICompon…` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 135 | `changes.ts:61` changeFeed | `reader.read()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 136 | `changes.ts:70` changeFeed | `response.json()` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 137 | `changes.ts:74` changeFeed | `Promise.race([work, aborted])` | O — observation/reconnect/adoption; healthy outbox remains authoritative | pass/pass |
| 138 | `local.ts:1098` flushOnce | `receiptBatch(queued, history)` | R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals | pass/pass |
| 139 | `local-assets.ts:48` remove | `this.call({ op: "set_meta", key: `media:bytes:${id}`, value: "" })` | O — media housekeeping; preserve repair flag/serial chain | pass/pass |

## Mutation controls

[Runner](controls.py), [results](controls.json), [run log](controls-final.log).
The round-6 runner reruns the exact round-5 script (which reruns round 4), copies
its evidence under [prior-controls](prior-controls/), then restores all historical
report bytes. The five round-4 kills must now also contain `ERR_ASSERTION` and
`testCodeFailure`; exit 1 alone is insufficient. Every new kill requires its
named behavioral assertion (or the named census failure), not merely an error.

The 27 new mutations plus 11 prior mutations cover:

- New observation and acknowledged-receipt guards; final-loop sync removal;
  terminal observation delivery/retry; committed-reply recovery; known-receipt
  persistence; pending-receipt sync preflight.
- POST bookkeeping, sync transport/backend, follow, changes and probe guards;
  native discovery/install and legacy JSON fallbacks; bounded exit rejection;
  media/network serial recovery; clock serial/cache recovery; held-reason metadata.
- Exact recovered event shape, active settling-marker pruning, adding an
  unclassified delivery await and adding an await in a new helper.
- Prior media gate/backoff/flag, admission, receipt-save, pre-dispatch and all
  snapshot/replacement/overlapping emission-owner mutations.

Several awaits share one owning guard; the controls remove that guard once,
while the matrix injects at every listed site underneath it. An optional call
whose rejection is safely handled by its enclosing dispatcher has no redundant
catch added merely to satisfy a mutation. Synchronous marker guards are tested
separately. No mutation touches the live source or distributed build.

## Qualification

[Commands](commands.sh) run from `snapback4/`; toolchain Node 24.13.1. Rust uses
`CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
No `scripts/test.sh` invocation; the supervisor owns that landing suite.

| Check | Result | Evidence |
|---|---:|---|
| Client build / typecheck | pass / pass | [build](client-build.log), [types](typecheck.log) |
| Audit including copied Astra reproduction and Grok checks | 60 pass | [audit](audit-final.log) |
| Generated fault matrix + census | 281 pass (280 cases + census) | [matrix](matrix-final.log) |
| Clock / pending / React | 141 pass | [log](clock-pending.log) |
| Receipts / delivery | 212 pass | [log](receipts-delivery.log) |
| Settlement | 90 pass, 1 named skip | [log](settlement.log) |
| Media | 72 pass, 1 named skip | [log](media.log) |
| Transport | 12 pass | [log](transport.log) |
| Web admission | 55 pass | [log](web-admission.log) |
| Whole guide | 94 pass | [Rust log](rust-guide-delivery.log) |
| Rust receipt/delivery modules | 42 pass, 1 ignored benchmark | [Rust log](rust-guide-delivery.log) |
| Native build | pass | [log](native-build.log) |
| Wasm build / existing budget | pass | [log](wasm-build.log), [measurement](wasm.json) |
| Mutation controls | 38/38 killed | [results](controls.json) and prior-controls |
| References / whitespace / source size / append-only journal | pass | [final checks](final-checks.log) |

Totals: 923 client passes and 136 Rust passes, 1,059 passing checks/tests in
those test modules; three explicitly skipped/ignored tests are not passes.
The settlement skip needs a legacy server binary, the media skip is macOS-only,
and the Rust ignore is the opt-in throughput benchmark. None is new.
No baseline or environmental test failure. Ordinary wasm dead-code/unused
warnings remain in the log. No d-01 algorithm or server/device code changes,
no new CPU/browser timing claim, and no per-row pending-list reread.

## Failure ledger

All failures encountered this round are ours, including expected red controls.
The final unmutated qualification is green. Baseline failures: none.
Environmental test failures: none.

| Failure / experiment | Classification and disposition |
|---|---|
| Copied Astra regression before fix: one POST, expected two | Ours, inherited lane defect; fixed and mutation-killed |
| Matrix persistent acknowledged-receipt read stranded the tail | Ours, newly found lane defect; new guard and control |
| Early census/recipe runs: inaccessible branches, required reads treated as optional, missing fault hits | Ours, test construction; branch-specific recipes and explicit classification; retained logs listed below |
| Exit/follow instrumentation had shifted AST offsets; direct JSON injection was outside a catch | Ours, instrumentation; transformed exit assignment after transpile and injected below response methods |
| Reset synthetic flag and buffered changes fixture could loop without waiting | Ours, fixture; bounded reset injection and exhausted-budget fallback; interrupted development runs retained |
| 278 failures after adding census test before top-level awaited imports | Ours, harness lifecycle; Node's root after-hook removed hooks too early; all module imports now precede test registration |
| Receipt-save guard mutation survived when another path repaired the receipt first | Ours, weak fixture; hold alternate repair until target lookup observes the failure; control now dies |
| Grok shape/settling mutations initially survived integration-only selection | Ours, overlapping protections obscured mutation; explicit overlapping event-shape and retiring-settlement checks kill both |
| Four caller-recollection failures at sites 81/96 | Ours, fixture served watermark 10 after applying 11; corrected sync response preserves monotone store head |
| Backoff assertion failed on valid reset after successful tails | Ours, assertion; retain exact allowed delays/no-spin and enforce monotonicity after initial successful settlements; prior reset-every-pass control still dies |
| Fallback media-remove site was not reached with a host-supplied media store | Ours, fixture; select the real fallback storage adapter for its two cases |
| One transient follow-delay case initially injected before reaching the intended wait | Ours, scope; inject in the follow sync context and assert every site is reached |
| Controls: wrong expected message, teardown held admission barrier, later changed census failure text | Ours, runner/assertions; specific messages corrected, queue gate released in teardown; final 38 controls pass |
| Staged whitespace check found blank-space indentation in TAP and a trailing empty Rust log line | Ours, evidence formatting; normalized only trailing whitespace/EOF newlines in round-6 logs |
| Missing guessed paths, stale skill link, wrong working-directory prefix/redirection, explicit TypeScript import at nonexistent hoisted path | Ours, command setup; read-only sibling skill and resolved package imports/paths; no shared-path install |

[Development failure inventory](development-failures.json) enumerates every
failed test name/error by retained development log; [line index](development-failures.txt)
points to the original output. Interrupted `matrix-full-first.log`,
`matrix-full-second.log` and early controls are experiments, not qualification.
Expected control assertion failures are in each mutation log and the controls
JSON. Failed evidence is not counted as a pass or hidden as baseline drift. Round-6 text logs have trailing whitespace and extra EOF blank lines normalized; test output and failure content are retained.

## Wasm and handoff

Current rebuilt wasm: **2,018,847 B raw / 585,968 B GNU file-input gzip-9**, unchanged 586,193 B budget, **225 B headroom**. SHA-256 `3fcccccdd4cefc2d4a6d441acfb8211bb6bcb94149c5ea030ced1ed717db7f52`.

Relative to round 5: raw −968 B, gzip +587 B. These are the current merged
Rust inputs; round 6 changes only TypeScript/tests/docs and contributes no wasm
input delta. The build used the standard script without wasm-opt (its normal
available-tool path); no tool was installed or ceiling changed.

LLP 3000.019 §3.3 now records both proven-success housekeeping boundaries and
the required-custody distinction. One dated journal entry is appended. Commit
locally with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`; push and publish
nothing. Supervisor review/landing remains separate from this local evidence.
