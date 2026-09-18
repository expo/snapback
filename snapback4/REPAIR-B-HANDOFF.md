# Repair B — round 8 handoff

Incoming `8c49c95cc2eb99cfa6c04a8743eb4705551c42ca`, base `27a8a4d66`,
branch `sb4/repair-b-defer-image-0bf8a4b5`. Local commit only; no push, rebase or merge.
Round 7's dispositions remain recorded in the incoming commit and append-only journal.

## Governing context

Scope: private replica publication, incarnation restore detection, and client watch
invalidation after publication. LLP 3000 §4 supplies the Snapback 4 fence;
LLP 2000.000 §7 supplies the partition/prediction model;
[LLP 3000.001, Repair B](../llp/3000.001-durable-replica-and-write-lifecycle.research.md#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes)
and [LLP 3000.007 §18.2](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#18.2)
govern publication versus transfer and incarnation ownership. These are current
LLPs, not foundation documents. The implementation retains the existing additive
wire fields, publication transaction and legacy no-deferral behavior. The
existing Repair B LLP is updated with this correction; no new design document
or workflow gate is introduced. Orientation hand-off: none.

## Findings and dispositions

**X1 — fixed.** The deferred accumulator retains its maximum validated
`images_at` alongside its cursor. Snapshot staging retains the equivalent head
alongside `snapshot:through`. Restore detection compares a current, echoed
private request with the maximum of published progress, private progress and
its retained image head. The incoming `images_at` is the server head; a terminal
page without that additive field supplies its head through its watermark. A
truncated page's cut below an earlier image head is not itself a restore. An
obsolete private-request echo cannot set the halt, and rejected pages never
advance the retained evidence. A private first identity already owns its restore
evidence before the identity becomes published.

Both `observe_store` and `apply` commit `E_STORE_RESTORE` durably, before
returning the refusal. Queries, sends, reopen, refill to 15 **or beyond the old
head to 25**, row clearing and backend adoption cannot release it. Inspection
also exposed a related reset escape: an identity-omitted legacy rewind could
clear an existing halt. That path now preserves it; only a different named
incarnation (or disposal of the entire device store) releases it.

The protocol regressions publish at **5**, privately transfer to **10** using
images at **20**, then exercise **7** and **15**, on memory and SQLite.
They test preflight and direct apply, reopen before the first image-head restore
observation, reopen after halt, refill, sends and queries. Snapshot coverage
includes live catch-up, first private identity, and a preflight of the retained
private cut after reopen; it does **not** claim that a reopened owner resumes
another owner's snapshot. Incoming source fails both ordinary X1 regressions.

Numbers below identify the three NOT-READY packets in `target/reviews-r8/`.
Every claim has a disposition; verdict words alone are not treated as findings.

| Finding | Disposition and evidence |
| --- | --- |
| **03.1 — reset retains transfer/snapshot progress (High)** | **Disproved.** `clear_rows` calls `reset_publication`, which unconditionally calls `deferred::clear`, `predictions::reset` and `snapshot::clear`. The latter clears staged rows and every `SNAPSHOT_KEYS` entry. Only identity is restaged. Existing `clear_rows_consumes_all_private_progress` and `empty_cursor_and_reset_remove_all_publication_keys` assert committed state and reopen; the new head keys join these same explicit lifetimes. |
| **03.2 — first identity fails owner check or escapes binding (High)** | **Disproved.** Private first observation stages identity without changing published `STORE_ID`; `require_owner` therefore compares `None` with durable `None`. Publication promotes identity and updates this owner's in-memory identity in the commit tail. Existing first/omitted-identity regressions cover publication. New `first_private_identity_already_owns_its_restore_evidence` additionally proves restore refusal before promotion. |
| **03.3 — failed rejection cleanup lets capture double a write (Medium)** | **Disproved as stated.** A live capture is immutable at its send revision; new sends invalidate that revision, successful apply consumes it, matching rejection consumes it, and reopening atomically abandons it and advances revision. Failure to delete a capture does not give it newer-revision authority. Existing overlap, late-response, recovery, and `cleanup_failure_preserves_the_original_apply_and_observe_error` tests cover the boundaries. Replacing the primary failure with cleanup failure would regress round 7's accepted behavior. |
| **03.4 — snapshot flag resends the old snapshot cut (Medium)** | **Disproved.** The client sends `from: transfer_watermark`; `snapshot_catchup` controls staging ownership and stream mode, not an alternate server cursor. Real snapshot catch-up writes `snapshot:through`, not the ordinary slot. `send_after_terminal_snapshot_drains_multiple_catchup_pages` advances each requested cut and publishes the terminal result on both stores; `interrupted snapshot catch-up resumes its durable mode` covers transport. |
| **03.5 — crash after send commit leaves in-memory owner active (Medium)** | **Disproved.** Crash discards the process owner; reopening starts with `snapshot_owner: None`. In a surviving process, apply compares its owner against the durable owner and the snapshot send revision; `sync_state` also requires owner equality. No path authorizes snapshot continuation from the memory field alone. Paging-send and obsolete-owner tests remain green. |
| **03.6 — compatibility `apply` callers refetch the published cut (Low)** | **No production counterexample.** `apply` remains the touched-table convenience API; requests use `sync_state().transfer_watermark`, as the real-engine `next` helper and the JSON client do. The dispatcher calls `apply_publication` and returns its boolean. Rust API documentation now states both requirements explicitly. The real-engine deferral/termination and HTTP/native cursor tests pass. |
| **05.1 — `settle(None)` omits restore (High)** | **Disproved; accepted W2 evidence retained.** The complete function calls `predictions::restore` before `match seq`. `receipt_arms_restore_before_replaying_relative_survivors` passes on both stores; the previous incoming-source and per-arm mutation evidence remains under `target/review-fix7/`. |
| **05.2 — dequeue restores admission images for an excluded write (High)** | **Disproved with new incoming-source evidence.** Restore reads the confirmed-base sidecar, never `Queued.predicted` or admission images. Publication consumes old bases, installs images, then remembers bases only for replayed writes. `capped_dequeue_keeps_the_published_image` declares 256 of 257 writes, publishes value 3 for the excluded row, dequeues its write, and still reads 3 through reopen. It passes on incoming `8c49c95cc` and HEAD, on both stores. Keeping the stale base sidecar makes the regression fail. |
| **05.3 — an effects bundle can lack ACKS (Medium)** | **Disproved.** `deferred::stage` always writes ACKS, including `{}`, in the same transaction as effects and cursor. Identity alone is not an effects bundle. `pending_publication_reads_the_slot_not_request_progress` checks cursor-only, ACKS-only, committed cursor+ACKS, and publication. |
| **16.1 — unpublished page never advances the next fetch (High)** | **Disproved.** Every loop iteration starts with native `sync_state`, then assigns the request cursor from `transfer_watermark` before fetching. It does not depend on the post-publication read. The native integration and ordinary-interruption tests assert advancing requests and final publication. |
| **16.2 — snapshot continuation receives a published cut (High)** | **Disproved.** A nonterminal snapshot always returns `published:false` from native; the client also sets `stage_snapshot:true`. Pagination keeps the prior published request cut until terminal staging moves into catch-up. The alleged first-page `published:true` is not emitted by this implementation. Multi-page snapshot tests pass on both stores. |
| **16.3 — adoption must compare private requested identity (Medium)** | **Disproved.** `store_id` on adopt is a compare-and-swap expectation for durable **published** `STORE_ID`, not an instruction to open a different database. The device is already open. Passing private identity would fail that comparison. `generation adoption compares published identity during private acquisition` explicitly asserts null and succeeds on its first attempt; the native A→A2→B test also passes. |
| **16.4 — failed post-publication read loses progress (Medium)** | **Cursor allegation disproved, adjacent watch bug fixed.** The next round captures native progress before any request, but the fallible read previously ran before adding committed touched tables. A denial lost watch invalidation. The client now accumulates touched tables immediately after successful apply so `finally` reruns watches even if metadata inspection fails. New regression reproduces stale value 1 on incoming client output, reads/notifies value 2 with the fix, and asserts request cursors **5,5,9**. Reverting the ordering fails its watch assertion. |
| **16.5 — omitted native identity clears a known store (Low)** | **Disproved for this native contract.** `SyncState.store_id` is serialized, including null before first publication. Once named, omission of wire identity does not erase native `STORE_ID`; generation and row resets preserve it, while actual replacement names the successor. The shell intentionally reflects native published identity. Existing omitted-wire-identity and private-identity watch tests pass. |

## Durable keys: authority and explicit invalidation events

This supersedes the round-3 table and its round-5/6/7 corrections. The third
column names the semantic event, not just a clearing helper. “Store disposal”
means destruction of the whole durable device store, not a row reset. An allocator
may deliberately last that long: its old numeric value is superseded on each
allocation, and resetting it earlier would reuse identities.

| Durable key/value | Reader and authority | What invalidates it |
| --- | --- | --- |
| `device:deferred:rows:*` (image, admission) | Private fold/install only | A later accepted effect supersedes that row's value; ordinary publication consumes the bundle; replacement publication, row clearing, changed-generation installation or incarnation replacement discards it. Deletion/recreation starts new admission provenance. |
| `device:deferred:meta:*` | Private ordered metadata effects | Later accepted operations supersede each key; the same publication/discard events as private rows consume the bundle. |
| `device:deferred:acks` | Private receipts, consumed only with effects | Publication consumes and acknowledges them; row clearing, changed-generation installation or incarnation replacement discards them without claiming publication. Always present for an effects bundle, even empty. |
| `device:deferred:cursor` | Next request and private monotonic floor; never replay retirement | Next validated deferred page supersedes the cut; publication, row clearing, changed-generation installation or incarnation replacement consumes it. Recovery and sends preserve valid ordinary transfer. |
| `device:deferred:images_at` **new** | Highest validated image head for restore detection | Publication consumes it with its bundle; row clearing, changed-generation installation or incarnation replacement discards its images and head together. Lower or omitted heads do not overwrite stronger evidence while staged. |
| `device:deferred:identity` | Private transfer and execution-receipt binding | First publication promotes it and consumes private identity; a different incarnation replaces it. Row clearing and generation installation deliberately restage the known identity; sends/reopen preserve it. |
| `device:declaration:capture` | Immutable request IDs, bounds and revision | Successful apply consumes it; matching echoed rejection releases it; a new send revision makes the old capture unusable and next request replaces it; open abandons it and advances revision; row clearing, changed-generation installation and incarnation replacement erase it. |
| `device:declaration:first-capture` | No reader/writer; historical residue | Next capture cleanup, recovery, row clearing, changed-generation installation or incarnation replacement removes residue. |
| `device:declaration:published` | Published replay exclusion | Next publication replaces it; image-dropping row reset, schema installation or incarnation replacement erases it. Literal-default evolution retaining images retains the exclusion for those images. |
| `device:snapshot:through` | Private catch-up cut | Next accepted snapshot/catch-up page advances it; publication, row clearing, changed-generation installation, incarnation replacement or a send during snapshot pagination clears it. First accepted replacement page supersedes the old cut. Reopen does not grant its new owner authority over it. |
| `device:snapshot:images_at` **new** | Private snapshot image head for restore detection | Same snapshot disposal events as `through`; a first replacement page explicitly starts fresh image-head evidence. |
| `device:snapshot:owner` | Snapshot continuation/publication ownership | Snapshot restart replaces owner; publication, row clearing, changed-generation installation, incarnation replacement or paging send clears it. Reopen has no in-memory owner match, so it cannot continue the old owner's snapshot. |
| `device:snapshot:owners` | Monotonic owner-token allocator, not acquisition | Each new snapshot allocation supersedes its numeric value; whole-store disposal ends the allocator. Row reset/reopen must not reuse tokens. |
| `device:snapshot:watermark` | Original snapshot cut | First replacement page replaces it; publication, row clearing, changed-generation installation, incarnation replacement or paging send clears it. |
| `device:snapshot:send_revision` | Snapshot's permitted send revision | A send during pagination discards the snapshot; a send during terminal catch-up explicitly rebinds this revision. Snapshot restart replaces it; publication and the named image/identity reset events clear it. |
| `device:snapshot:next` | Exact continuation, or terminal empty sentinel | Each accepted snapshot page supersedes it; restart, publication, paging send, row clearing, changed-generation installation or incarnation replacement ends its validity. |
| `device:snapshot:acks` | Private snapshot receipts | Accepted pages merge them; first replacement starts a new receipt set; publication consumes it; paging send and the named image/identity reset events discard it. |
| Snapshot staging rows | Private replacement images | Later staged effects supersede each row; snapshot restart, publication, paging send, row clearing, changed-generation installation or incarnation replacement discards staging. |
| `device:snapshot:boundaries:*` | Private acquisition boundaries | Validated markers update boundaries; first replacement reinitializes from retained published boundaries; publication consumes staging; paging send and the named image/identity reset events clear it. |
| `device:snapshot:groups` | Private held/left groups | Accepted scope/join events supersede membership; snapshot restart rebuilds it; publication consumes it; paging send and the named image/identity reset events clear it. |
| `device:store_id` | Published incarnation, owner/adoption CAS and receipt matching | Authenticated different-incarnation replacement supersedes it; whole-store disposal removes it. Row clearing and generation installation preserve incarnation. First publication promotes private identity. |
| `device:send_revision` | Request/send invalidation token | New send, identity promotion/replacement, or recovery of an abandoned capture supersedes its value. Whole-store disposal ends the allocator; ordinary row reset does not reuse tokens. |
| `device:watermark` | Published acquisition/replay progress | Next publication advances it; explicit row clearing, changed-generation installation or incarnation replacement sets zero. Private progress never overwrites it. |
| `device:acquired-generation` | Read/prediction readiness | Row clearing or incarnation replacement erases it; changed-generation installation invalidates it unless literal-default evolution preserves all acquired tables, in which case it translates the marker. Terminal publication replaces it. Restore halt makes it unusable immediately. |
| `device:generation` | Installed interpreter generation | Successful backend installation/adoption replaces it; whole-store disposal removes it. A changed value does not itself prove acquisition. |
| `device:backend`, `device:backend-identity` | Installed schema/programs and owner validation | Successful backend installation/adoption replaces them, making prior interpreters obsolete; whole-store disposal removes them. |
| `device:backend-required` | Durable replacement/adoption obligation | Successful checked backend installation clears the obligation; later incarnation replacement supersedes it. Neither private pages nor a matching generation satisfy it. |
| `device:restore-refused` | Durable same-incarnation halt | **Only authenticated replacement by a different named incarnation or whole-store disposal.** Reopen, refill, omitted identity, row clearing and generation/backend adoption preserve it. |
| `device:submission` | Inclusive monotonic submission allocator | Each admission supersedes its number; whole-store disposal ends the allocator. Entry retirement, row reset and incarnation replacement do not reuse numbers. |
| `Queued.id`, `seq` | Durable write/submission identity | Receipt-covered retirement, explicit dequeue or terminal refusal removes the entry; whole-store disposal removes the outbox. Replay preserves both. |
| `Queued.receipt_store`, `sent_seq` | Incarnation-bound execution evidence | Entry retirement/removal consumes it. First named identity binds previously anonymous receipts; known foreign bindings never rebind. Image reset preserves execution proof; replacement retires matching old-incarnation executions. |
| `Queued.observed_seq` | Published-effect evidence | Dropping images clears it after preserving execution as `sent_seq`; entry removal consumes it. Image-preserving generation evolution retains it. |
| `Queued.predictable`, `predicted` | Speculation metadata, never undo authority | Replay updates the write set or withdraws an ineligible prediction; incarnation replacement withdraws predictions; refusal/dequeue/retirement removes the entry. |
| Confirmed-base sidecar | Base beneath the current overlay | Restore consumes it before publication, settlement, withdrawal or replay; a new prediction remembers a new base. Image-dropping reset/disposal clears it. Excluded writes leave no admission-time undo authority. |
| `device:acquisition-boundaries:*` | Published coverage/admission | Scope loss removes/changes that group's boundary; accepted acquisition markers supersede it; replacement publication installs staged boundaries; image-dropping row/schema/incarnation resets clear it. |
| `device:history:groups` | Published held/left membership | Scope/join changes membership; replacement publication installs staged membership; row clearing, changed-generation installation or incarnation replacement clears it. |
| `device:acquisition-report` | Diagnostic report, no authorization | A later boundary report supersedes it; image-dropping row/schema/incarnation reset removes it. |
| `device:media:*` | Revalidated home-row hint | Row edit/deletion or scope loss forgets it. Even if bytes remain after a reset, generation mismatch, missing/different row asset, revocation or expiry invalidates use on the next access. It is not an independent media grant. |
| `device:upload:*` | Uploader/asset-keyed server facts for prediction, not execution or acquisition proof | A newer authenticated upload receipt for the same key replaces it; whole-store disposal removes it. There is no incarnation/asset-expiry invalidation in this cache; see audit limit below. |
| `device:native`, `device:native:digest`, `device:native:generation` | Installed native module/owner identity | Changed-generation or replacement adoption invalidates it; module installation replaces it; invalid bytes/digest/generation on open discard the cache. Owner checks reject another owner's obsolete digest. |

All publication keys now have a specific invalidation event; no publication row
relies on an unspecified caller of reset. Two allocators intentionally belong to
the entire durable store. This is a scoped lifetime audit, not proof that every
possible lifetime bug is closed. In particular, enumerating neighboring device
metadata found the **upload-facts cache has no incarnation/expiry invalidation**:
`media::inputs` reads it by uploader and asset ID and prediction uses those facts;
server execution still resolves/validates the asset independently. That is an
explicit remaining audit boundary, not a claim that stale facts authorize a
server write. A native SQLite probe retained S's facts through T replacement,
adoption, acquisition and reopen; the [follow-up ticket](../issues/20260918-snapback4-upload-facts-cache-lacks-incarnation-invalidation.md)
records the scope and reproduction. The prior table omitted this key. It prevents an unqualified
“every lifetime is closed” conclusion.

## Verification and mutation proof

Fourteen new Rust cases (seven scenarios × two stores), plus one client
regression. Mutation controls pass with identical test source; all ten Rust
mutations and the client mutation compile and fail their intended assertions.
Mutants are isolated copies with default native features and debug assertions,
not replacements for branch files.

| New regression | Mutation proving sensitivity |
| --- | --- |
| Private cursor/lower-head halt and refill | Remove private restore floor; separately discard the halt on reopen. |
| Image head retained through reopen/refill | Omit ordinary image-head persistence; separately omit snapshot image-head persistence. |
| Halt only released by a new named incarnation | Re-enable legacy identity-omitted rewind past the halt. |
| Healthy paging, obsolete replies, publication disposal | Ignore the echoed private-request cut; separately leave snapshot head after publication. |
| Capped dequeue retains published image | Keep the consumed confirmed-base sidecar so stale undo survives publication. |
| First private identity owns restore evidence | Require an already-published identity for restore detection. |
| Only validated pages advance restore evidence | Persist a preflight head before the page's effects validate. |
| Watch invalidation after post-publication read failure | Move touched-table collection back after that fallible read. |

Exact edits, compiler/test commands, source hashes, assertion failures, passing
controls, incoming-source checks and **verbatim output of all three requested
commands** are in [target/review-fix8/report.md](./target/review-fix8/report.md).
The report retains raw logs as separate files. The persistence witness is the
production memory host's drain/reopen boundary and native SQLite reopen, not a
physical power-loss or browser-process-kill claim.

Final results:

| Command | Passed | Failed | Ignored | Exit |
| --- | ---: | ---: | ---: | ---: |
| `cargo test -p snapback4-device` | 631 | 0 | 3 | 0 |
| `cargo test -p snapback4-core` | 160 | 0 | 0 | 0 |
| `cargo test -p snapback4` | 265 | 0 | 0 | 0 |

Strict TypeScript compilation and nine client/transport tests pass. All four
old-wire probes remain **1/1/1**. Eleven mutation input hashes match final
source/output. `ref-check --verbose`: 484 LLP docs, 9441 refs, zero errors;
`git diff --check` passes.

## Round 9 — client observations must reach the device's private evidence

Incoming HEAD `d0dc78878`, base `27a8a4d66`; work remains on the supplied branch.
Review inputs are the received files in `target/reviews-r9/`. No new review
was commissioned. Packet numbers below name `grok-b9-NN.txt`.

### Context and implementation

The governing context is LLP 3000 §7 and LLP 3000.001's Repair B section:
private progress is restore evidence, never publication authority; native
transactions own capture, replay and durable refusal. LLP 3000.007 §18.2
separates incarnation/adoption from freshness. The published client guide's
restore paragraph is updated with the code. No contract.ts change, new LLP,
new gate, deployment or publication is part of this round.

`witnessRestore` no longer decides from the published watermark whether a
head deserves validation. Authenticated same-captured-identity heads from
startup, reconnect and change polling are passed to `observe_store`, with
captured revision and published/private cuts. Any native refusal fences the
client decision; only `E_STORE_RESTORE` records the client halt. Invalid heads
also cannot authorize replay. Credential revision checks cover probe and
change-feed responses as they already did startup and sync.

`SyncState.restore_watermark` captures the device's existing private restore
cut independently of its paging cursor. This matters for a reopened snapshot:
it must restart paging, but its retained images still prove an earlier head.
Sync replies separately echo `captured_restore_watermark`, so a restarted
snapshot can validate its head without pretending to continue its old cursor.
The field and validator call the same `restore_cursor` helper; the shell never
reads image-head keys or implements the head comparison. It does not create a
new durable key. `/sync` preflight now runs on every reply, before generation
adoption; only an actual native reset refreshes published identity.

### Per-finding dispositions

| Finding | Disposition and evidence |
| --- | --- |
| **Y1 — startup probe skips private restore evidence (High)** | **Fixed.** Real SQLite/compiled-client startup tests publish 5, stage through 10 with images at 20, reopen, then report head 7 or 15. They require zero begin-send/HTTP sends, unchanged published 5, refused reads, and a durable halt across two reopens and attempted publication at 25. Reopened-snapshot, reconnect and change-feed cases exercise the same boundary. A head-20 control permits exactly one mutation send. Send-revision and published-capture controls reject stale observations without persisting a halt. |
| **Audit: generation preflight can discard private evidence** | **Fixed.** The previous client conditional did not observe a same-store page at 15 when its request cut was 10, even though images at 20 were retained. With a changed generation, adoption could erase that evidence before apply validated it. The new native client regressions require no adoption and a durable halt for ordinary and reopened-snapshot transfers; restoring the conditional or dropping the private-cut echo fails them. A replacement reply at cut 8/head 20 does not falsely persist restore: its existing snapshot acquisition floor may still reject that old cut, preserving the private state. |
| **02.1 — mandatory SyncState fields break wire decoding (High)** | **Disproved.** `SyncState` derives `Serialize`, not `Deserialize`. It is native request preparation output, not the HTTP request type or a persisted capture. The server decodes `/sync`'s `from`, `pending`, etc.; the client supplies `from: transfer_watermark`. Persisted `Capture` and incoming `StreamPage` have their own decoders/defaults. The real HTTP/native round trip and existing old-wire tests pass. |
| **02.2 — generation reset occurs after metadata installation (High)** | **Disproved.** SQLite `install_device_checked_with` runs `prepare(tx)` before writing device metadata, inside the activation transaction; SQLite passes `reset_for_install` as that callback. Memory calls the reset before installing metadata and exposes the whole call's changes to the host. The second open transaction abandons request capture, not generation progress. Existing generation-reset, install-failure and reopen tests exercise the boundary. Generation zero denotes the uninstalled initial state on this supported backend path; the alleged generation-5-to-6 crash window does not exist. |
| **02.3 — keep_images polarity drops wrong state (Medium)** | **Disproved.** `reset_publication` always clears deferred state and snapshots. Its boolean reaches only `predictions::reset` and controls published replay evidence. Both reasons clear private transfer; literal-default evolution can preserve published images. Existing lifetime tests cover both resets. The hypothesized future caller is not current behavior. |
| **03.1 — first page owner check ignores its identity (High)** | **Disproved.** `observe` first stages an authenticated identity privately. `require_owner` checks the installed backend and durable **published** STORE_ID against this owner's interpreter; passing a private identity would fail that CAS. Replacement sets backend-required, while first publication promotes the private identity. First-private-identity and A→A2→row-reset→B tests verify the full caller chain. |
| **03.2 — rejected capture silently loses a prediction (High)** | **No demonstrated bug.** Rejection consumes only a matching echoed capture, never the outbox or published exclusion. The real retry recaptures before fetching; an already-echoed page carries its declaration. An un-echoed page preserves the existing exclusion rather than manufacturing replay authority. Round-5 capture lifetime, round-6 abandoned-request/revision tests, and `absent_capture_and_echo_preserve_published_exclusion` remain green. Moving cleanup into a rolled-back apply would defeat release; making every absent capture an error would break the supported omitted-echo path. |
| **03.3 — row reset leaves snapshot keys (Medium)** | **Disproved.** `reset_publication` calls `snapshot::clear`, which deletes the entire SNAPSHOT_KEYS array and staging in the reset transaction. `clear_rows_consumes_all_private_progress_and_keeps_incarnation` asserts every member absent after commit, then verifies reopen. |
| **03.4 — cleanup error must replace original failure (Medium)** | **Rejected.** It contradicts the accepted round-7 requirement. Capture is revision-bound, not an exclusive lock: a new send revision can recapture even if cleanup failed. Strengthened tests now count the injected second-transaction failure, match the exact Generation error, and compare all device metadata/outbox bytes after both apply and observe failures. |
| **03.5 — deferred cursor and snapshot flag differ (Medium; received text stops mid-sentence)** | **No counterexample in the received fragment.** `transfer_watermark` chooses request progress, while `snapshot_catchup` denotes staging ownership. These are distinct facts. `live_cursor_precedes_terminal_snapshot_cut`, multi-page snapshot catch-up and ordinary false-snapshot-mode transport regressions pass. No missing remainder was inferred. |
| **09.1 — publication tests use opposite first booleans (High; truncated)** | **No contradictory invariant.** `terminal_gap_is_a_protocol_refusal` tests a malformed terminal head on snapshot and ordinary pages. `absent_capture_and_echo_preserve_published_exclusion` tests a valid ordinary page without a declaration. `first` controls replacement/snapshot start; terminal validation runs independently. Both-store controls and the round-6 terminal mutation evidence retain this distinction. |
| **10.1 — snapshot owner/next unasserted (Medium)** | **Disproved by the review's own exception.** Both SNAPSHOT_OWNER and SNAPSHOT_NEXT are members of SNAPSHOT_KEYS. The post-clear loop explicitly checks every member, including the overwritten empty NEXT. SNAPSHOT_OWNERS is intentionally a separate allocator that survives reset. No added redundant assertion. |
| **11.1 — corrupt-capture recovery fixture lacks effects and published progress (High)** | **Strengthened.** Seed published 5, private cut 7, a row image, metadata effect, and nonempty receipt map; compare the whole private prefix through reopen and retain `(5,7,1)`. Independent mutations dropping rows, metadata or receipts, or zeroing the watermark, fail. |
| **11.2 — cleanup injection may never fire / error kind unchecked (Medium)** | **Strengthened.** Count injected failures for apply and observe separately, match the exact RuntimeError::Generation message, and compare metadata/outbox bytes. Skipping either cleanup fails its counter assertion. |
| **11.3 — object-form inverted declaration untested (Low)** | **Strengthened.** Both the tuple checkpoint and object capture with inverted bounds must refuse. Removing the object-form bound check fails. Their diagnostic wording is intentionally different; the test asserts refusal. |
| **11.4 — rejection could erase published exclusion (Low)** | **Strengthened.** After matched rejection, the `[1,9]` published exclusion must remain. Adding PUBLISHED to capture cleanup fails. |
| **12.1 — capped capture could delete overflow (High)** | **Strengthened.** Compare all 257 serialized outbox entries before/after both capture and checkpoint recovery. Deleting q257 while capturing fails. |
| **12.2 — contiguous sequence fixture confuses sequence and count (Medium)** | **Strengthened.** Submission numbers are `110,120,…,2670`, in reversed storage order. Expected bounds are `(2660,false,2670)` for 256 declared writes. Substituting a count fails. |
| **12.3 — checkpoint test never supplies a widening echo (Medium)** | **Strengthened.** A tuple capture `(10,true,10)` now receives `(11,true,11)` and must refuse its echo. Bypassing echo comparison for tuple captures fails. |
| **12.4 — empty cursor not inspected after commit (Low)** | **Strengthened.** A new transaction reads `None` before replacing the empty cursor with 77. A memory-store commit mutation that changes empty to zero fails the new post-commit assertion (the pre-commit assertion still passes). |
| **18.1 — deferred ordinary pages have no cursor (High)** | **Disproved.** Every iteration captures native state and uses `transfer_watermark` as `from`. `after` is a snapshot token, not the ordinary log position. Native and stub transport tests assert advancing requests and publication through interruption. |
| **18.2 — adoption must receive page/private identity (High)** | **Disproved.** Adoption's store_id is the expected durable published identity, not an assignment. `adopt_captured` compares that value. `generation adoption compares published identity during private acquisition` and the native replacement test cover it. This is separate from the real pre-adoption restore gap fixed above. |
| **18.3 — missing wire identity clears the native identity (Medium)** | **Disproved for the current device contract.** Native serializes store_id explicitly; once known it survives identity-omitted wire pages, row clearing and generation changes. Null denotes genuinely unpublished identity. Preserving stale shell identity across native reset would be incorrect. The omitted-identity and private-watch tests pass. |
| **18.4 — unpublished ordinary apply falls through to success (Medium)** | **Disproved.** It sets publicationOutstanding, receives no touched tables from native, does not set caughtUp, and loops to the next native transfer capture. Snapshot ownership and stream mode remain separate. The ordinary interrupted/false-snapshot-mode regression checks exactly this. |
| **18.5 — reset clears shell flag without clearing slot (Medium)** | **Disproved.** Incarnation replacement and generation installation call reset_publication transactionally, consuming the slot before the shell clears its flag. Both-store reset/reopen tests and native replacement transport tests remain green. |
| **18.6 — failed post-publication state read retries stale cursor (Low)** | **Disproved.** Retry captures native state before constructing every request. Round-8's adjacent watch-loss fix records touched tables before the fallible read; its regression still checks watch value 2 and request cuts 5,5,9. Falling back to page.watermark could instead overwrite another owner's newer native progress. |

Packets 01, 13, 15 and 16 explicitly report no actionable finding. Packets
04–08, 14 and 17 contain only memory-flush notices or are empty; there is no
review conclusion to invent for them.

### Other client entry points audited

| Entry point | Decision owner / result |
| --- | --- |
| Startup replay, reconnect probe, change feed | Fixed above: native head observation precedes replay/freshness decisions; captured transfer identity is used even before first publication. |
| Sync reply and generation adoption | Fixed above: unconditional preflight before adoption; requests use private transfer progress, watches/adoption CAS use published state. |
| Ordinary queued send / newly admitted mutation | `begin_send` reaches native health checks before HTTP; `admit`, prediction, reads and settlement likewise use device health/ownership. No shell published-watermark replay predicate found. |
| Web teardown and orphan recovery | `web.ts` invokes the native `begin_send` synchronously before teardown transport. Orphan recovery inspects native restore_refusal/backend_required; it does not clear a halt using a shell watermark. |
| Acquisition and watch readiness | `refreshAcquired` asks native for acquired; native incorporates restore refusal and backend ownership. Watch identity stays published while images remain private. |
| Change subscription `seq` | Published progress intentionally schedules notification/sync; it no longer determines whether a private restore deserves validation. |
| Server-only actions and reads | Their server authority is separate from local outbox replay; no private/public watermark choice controls execution there. |

This is an entry-point audit with concrete regression evidence. It does not
close the entire lifetime class. The upload-facts cache limitation and its
round-8 follow-up ticket remain unchanged.

### Verification and mutation evidence

The new native client scenarios use a real compiled backend and SQLite device,
with controlled HTTP history, including the actual web startup `onSuspend`
callback branch. They do not claim a browser termination or power-loss witness.
The existing 9 client/transport cases and all 11 new scenarios pass (Node counts
21 tests including the new parent). Existing stub devices now answer the newly
unconditional preflight; their cursor, watch, mode and adoption assertions remain.

Each new/strengthened regression has mutation proof:

| Regression | Mutation(s) |
| --- | --- |
| Startup heads 7 and 15; durable halt through refill/reopen | Restore the published-head filter; separately echo the published request cut. |
| Reopened snapshot head 15 | Drop restore_watermark and use the restart/paging cursor. |
| Reconnect and change-feed head | Remove the respective call to native head validation. |
| Generation preflight, including snapshot reopen | Restore the client conditional that bypasses observe_store; drop the captured private restore cut. |
| Healthy snapshot restart below the private cut | Replace its request cursor with the restore cut, falsely treating restart as continuation. |
| Stale send and published-capture responses | Ignore a non-restore native denial and permit early replay. |
| Healthy head 20 | Refuse every head observation; the required send disappears. |
| Corrupt capture preserves effects/progress | Delete row effects, metadata effects, receipts, or the published watermark independently. |
| Cleanup failure preserves original kind and state | Skip apply cleanup or observe cleanup independently. |
| Object capture inversion; rejection preserves exclusion | Remove object bound validation; clear PUBLISHED during capture cleanup. |
| Capped outbox and noncontiguous prefix | Delete q257; use count in place of last sequence. |
| Checkpoint cannot widen; empty cursor survives commit | Bypass tuple echo check; change empty cursor to zero only at commit. |

Exact mutations, commands, passing controls, failing assertions, source hashes,
incoming-client counterexamples, and complete verbatim output of all three
requested Cargo commands are in [target/review-fix9/report.md](./target/review-fix9/report.md).

Final results: `cargo test -p snapback4-device` **631 passed, 0 failed,
3 existing ignored**; `cargo test -p snapback4-core` **160 passed, 0 failed**;
`cargo test -p snapback4` **265 passed, 0 failed**. All exit 0. The final device
run includes the last snapshot-capture change. Strict TypeScript compilation,
21 client/transport tests and four existing native reconnect tests pass. All
12 Rust and 10 client mutations fail their intended assertions with passing
controls, and all 22 input hashes match final source/compiler output.
`ref-check --verbose`: 484 LLP documents, 9441 refs, zero errors.
`git diff --check` passes. No push, rebase or merge was performed.

## Round 10 — request evidence survives private-only overlap

Incoming `e896e0b1a`, base `27a8a4d66`. Review inputs are the received files in
`target/reviews-r10/`; no additional review was commissioned. This is a local
commit on the supplied branch, with no push, rebase or merge.

### Context and change

Scope: device observation/capture, local transport and schema adoption.
Governing constraints: LLP 3000 §7 (one Rust authority), LLP 3000.001's Repair B
section (private progress is evidence, publication owns visibility), and LLP
3000.007 §18.2 (incarnation, restore and atomic adoption). These documents are
in `llp/current/`; no new foundation policy or design document was introduced.
The current client operations guide was read and updated alongside the code.
No new durable metadata key, server wire field, contract.ts change or
upload-facts work is part of this fix.

**Z1 is fixed.** `sync_state` captures the retained private image head in the
same transaction as the private and published cuts. The client echoes that
head for probe/change observations and sync preflight. `observe` derives the
restore floor from these request echoes, not from the current private slot.
The original published-watermark and send-revision fences run first. A
same-incarnation head below the request's evidence persists E_STORE_RESTORE,
even if private progress advanced in the meantime. A newer pending-write declaration cannot erase this independent head proof;
declaration validation still precedes effect application. Otherwise, changed private
cut/head yields E_GENERATION: it neither authorizes replay/adoption nor falsely
condemns an older healthy reply. A terminal snapshot's second observation
inside its own apply transaction does not mistake its own staging for an
external overlap.

The adjacent `/schema` response window is also fenced. Successful native preflight returns raw expected metadata from that same
transaction. The client carries it unchanged across the schema fetch; it does
not recapture and bless intervening private progress. Adoption
compares it atomically in both existing store installation implementations,
including private cut/head and snapshot owner, published progress, halt,
backend identity, generation and native digest. Credential revision is also
checked after that schema fetch. The protocol startup check rejects native
modules lacking these capture fields. Old HTTP peers still omit images_at and
committed_above as before; the client adds local echoes after transport.

### Received findings, individually

Packet numbers name `grok-b10-NN.txt`; GPT's Z1 is above.

| Finding | Disposition and evidence |
| --- | --- |
| 03.1 sticky snapshot cut | Disproved. `snapshot::clear` consumes the snapshot owner on publication, including an intermediate published catch-up page. `live_cursor_precedes_terminal_snapshot_cut` and the existing multi-page snapshot/catch-up cases cover this path. |
| 03.2 reset skips acquisition | Disproved. `reset_publication(false)` clears deferred state and all snapshot keys; only identity is deliberately restaged by `clear_rows`. The round-6 reset test inspects every key and reopen. |
| 03.3 first-apply owner bypass | Disproved. `observe(false)` privately stages the first identity; `require_owner` compares this interpreter with durable published STORE_ID. First publication promotes identity. First-private-identity and native acquisition regressions pass. |
| 03.4 rejection loses declaration/effects | No demonstrated defect. Cleanup removes only a matching request declaration, not outbox or published exclusion. Real retries recapture; echoed responses carry bounded declarations. The cleanup failure and absent-echo regression suites remain applicable. No transaction atomicity counterexample was supplied. |
| 03.5 recapture widens an outstanding request | Disproved. `predictions::capture` reuses the existing capture at its send revision. Inspection uses `capture:false`. Changed revisions invalidate the earlier response; bounds and IDs are checked together. |
| 05.1 receipt None fails to restore | Disproved by `Device::settle`: `predictions::restore` precedes the entire match, including None. Existing relative-survivor tests cover it. |
| 05.2 ACKS absent on deferred page | Disproved. `deferred::stage` always writes ACKS, including `{}`. `publication_pending` uses that occupancy invariant; cursor alone is not occupancy. |
| 05.3 snapshot misses touched tables | Disproved. The replacement publication branch explicitly extends touched with both joined keys and acquisition marker tables before staged installation. |
| 05.4 absent watermark blocks dequeue | Disproved. `meta_u64` defaults missing metadata to zero. Dequeue restores the base before removal and replay. |
| 13.1 omitted identity must latch restore | Rejected. Omitted identity cannot prove same incarnation. A persistent existing halt survives omission; a new identity-free lower cut uses the legacy rewind/replacement contract. Snapshot catch-up does not inherently omit identity. The proposed unconditional halt would infer identity the response does not establish. |
| 13.2 ordinary private cursor mistaken for legacy rewind | No new counterexample in the received fragment, which stops after its input clause. A head below an identity-free request is the documented legacy reset signal; private receipts are preserved unless independently covered by published progress. Current apply rejects a below-request page. The legacy/private receipt tests cover this distinction. |
| 15.1 malformed head treated as restore / images_at omission breaks peers | Disproved. `witnessRestore` receives probe/change `seq`, not optional images_at. True means “do not authorize this response”; it does not persist a halt. Unsafe or absent sequence numbers cannot authorize sends. Old-wire tests still exercise omitted images_at. |
| 15.2 non-restore denial should authorize replay | Rejected: that proposed change reintroduces the overlap bypass. E_GENERATION must fence the response without persisting a restore halt. Stale-send, stale-published, private-only and image-only client controls prove this. |
| 15.3 transfer/published identity mismatch | No supported lifecycle shown. Named replacement resets the old slot before staging the replacement. First private identity exists only without published identity. Arbitrary corrupt metadata is not evidence of that proposed state. The native replacement/private-identity tests remain green. |
| 15.4 capture:false loses declaration | Disproved. Head observations are not acquisition pages and cannot publish/defer/replay a declaration. Their returned values are request-local evidence. Actual sync uses capture:true. Z1 fixes the head evidence's later comparison, not declaration admission. |
| 15.5 stale restore watermark survives publication | Disproved. Publication consumes deferred/snapshot progress; `restore_cursor` then falls back to published progress in SyncState. Existing ordinary/snapshot publication-disposal tests inspect the image-head keys. |
| 16.1 mixed after/from livelocks ordinary pages | Disproved. `after` is assigned only for snapshot pages. Ordinary publication-outstanding requests use the native transfer cursor with stream:true; snapshot paging intentionally preserves its token. The interrupted ordinary and snapshot client controls exercise both. |
| 16.2 first identity adoption uses null published identity | Disproved. First observation stores identity privately without changing durable STORE_ID. Null is therefore the correct published identity CAS until first publication. The private-identity/adoption tests exercise this exact case. |
| 16.3 publicationOutstanding never clears | Disproved. Immediately after successful apply it is assigned `!published`, and reset/adoption also clear it. The quoted `||=` is recovery at request construction, not the sole writer. |
| 16.4 receipt evidence check misses distinct private store | The proposed P/T durable split is not produced by replacement/reset. Known receipts are inspected by native reset before discarding their identity authority, and returned in observation.retired; it is not only the shell history prepass that preserves them. |
| 16.5 observeIncarnation(undefined) resets | Disproved: the function explicitly returns for undefined unless force is true. Native SyncState serializes store_id as null or string. |
| 17.1 deferred ordinary cursor never advances | Disproved by the next loop's native capture and `watermark = transfer_watermark`. `first` only starts a replacement when page.snapshot is true. Existing request-cursor transport tests assert the advancing sequence. |
| 17.2 post-publication metadata read / lifetime check | A denied read already stops the round and touched tables are retained for finally. Added a closed/incarnation recheck after the await. A malformed custom DeviceCore remains outside the production serialized shape. The broader current-state freshness dependency is explicitly listed in the audit below, not certified by this change. |
| 17.3 restore runs across replacement | Disproved by the review's stated exception: `witnessRestore` returns false on a store-id mismatch. Only same captured identity reaches native head validation. |
| 17.4 slow-head path loses validity/rewind checks | Disproved. `witnessRestore` rejects unsafe/missing seq first and native observation handles same-store shrink. Startup stale-send/published/private controls demonstrate that no send is authorized by a refused observation. |

Packets 01, 10 and 11 report no actionable defects. Packets 02, 04, 06–09,
12 and 14 contain only memory-flush notices. No missing conclusion was inferred.

### Response-path check inventory: captured versus current

“Captured + CAS” means the request carries evidence and the response path
compares current state for equality/obsolescence. Reading current state for
that comparison is necessary; replacing the evidence with current state is
not equivalent. This table includes current-only paths instead of treating
all response handling as covered by the Z1 tests.

| Check / action | State compared today | Result / remaining boundary |
| --- | --- | --- |
| Startup, reconnect and change head validity | Response seq must be a safe nonnegative integer; response identity compared with captured transfer/published identity. | Request-local; invalid heads authorize nothing. |
| Probe/change/sync credentials and local incarnation | Captured credential revision and (except constructor-only startup) captured shell incarnation compared with current revisions. | Captured + CAS; obsolete replies stop. |
| Native observation send revision | Echo captured before HTTP versus current SEND_REVISION. | Captured + CAS; existing stale-send control. |
| Native published acquisition fence | Echoed captured_watermark versus current WATERMARK. | Captured + CAS; existing stale-published control. |
| Private restore proof | Response head/cut versus captured private cut, captured retained image head and captured published cut. | **Fixed Z1.** Does not substitute current private evidence. |
| Private overlap authorization | Captured private cut/head versus current cut/head after checking captured restore proof. | **Fixed Z1.** Mismatch returns retry, never success. |
| Same-incarnation / sticky halt | Response identity versus current published/private identity; current durable halt. | Current authority protected by send revision for replacement. Halt is an enduring prohibition, not new historical evidence. |
| Schema adoption | Expected raw metadata captured atomically with successful preflight and retained through `/schema`, credentials/incarnation captured before request, versus install transaction/current shell. | **Fixed adjacent gap.** Atomic CAS includes private progress and halt. Legacy direct adopt without this map still fills omitted expectations from current state; modern client always passes the map. |
| Sync generation/backend ownership | Response generation versus this owner's current interpreter generation; durable backend/store/native digest versus this owner's loaded values. | Current owner guard in the application transaction. No separate immutable request-backend token; same-number/backend replacement remains dependent on owner checks and serialization. |
| Pending declaration | Echoed through/complete/bound versus durable same-send-revision capture, or echoed bounds when capture is consumed. | Captured bounds. Direct legacy no-echo fallback reads current capture/published exclusion. That fallback is **not** certified as a request capture. |
| Transfer continuity | Echoed requested_watermark versus current ordinary/snapshot transfer cut. | Captured cursor + CAS; prevents applying a page over another transfer. |
| Snapshot owner/token/send fence | This Device's owner token versus durable owner; server after token versus stored continuation; stored snapshot send revision versus current send revision. | Current snapshot authority plus echoed continuation, not a new image-head proof. Snapshot restart/reopen remains separately fenced. |
| Deferred validation / terminal invariant | Only response fields (images_at, watermark, more, committed_above bounds) and declared request bounds. | Intrinsic response consistency, not replacement with current progress. |
| Deferral, receipt retirement and replay | Captured declared ID interval combined with current outbox liveness, confirmed base and matching receipt incarnation inside one transaction. | Current work selection is intentional: a dequeued write must not be replayed merely because it was alive at request time. It is not the historical restore verdict. |
| begin_send after observation | Current durable health; increments current send revision. | **Current-only action boundary:** no observation token is passed into begin_send. Client network serialization and the earlier observation fence are still assumptions, not a request-bound authorization receipt. |
| Mutation HTTP response and settle | post captures credential revision for obsolete E_AUTH; settle checks current owner and records receipt against current incarnation. | **Current dependency remains:** no request store/send capture reaches settle, and successful post responses are not generally revision-fenced. This audit does not close that lifetime. |
| Native module fallback `/schema` | Refreshed response generation versus current shell generation. | **Current dependency remains:** this separate fallback lacks the full request capture added to generation adoption. |
| `/native.wasm` installation | Wanted digest and target generation captured locally; digest verified; current native owner/backend/health checked. | Mixed: bytes/generation captured, request credentials/incarnation not passed to installation. Same-number identity transitions rely on current owner checks. |
| Server query results/cache/watch return | Shell incarnation captured by runLocal/evaluateLocal; post's credential revision only rejects obsolete E_AUTH, with an extra credential comparison for unremembered composition reads. | Mixed. Successful remembered reads do not carry a native request-store capture; current session and shell incarnation guard them. |
| Post-apply acquired/fresh/caughtUp | Current native acquired/store/watermark plus terminal flag of the completed response; closed/incarnation checked after the read. | **Current dependency remains:** readiness is not bound to a publication receipt. The lifecycle recheck does not establish that broader property. |
| Assets and actions | Asset fetch captures credential revision; action uses post's credential handling and current unavailable state. | No native store/request capture. Upload-facts lifetime remains the existing out-of-scope ticket, unchanged. |
| Direct legacy native observe/apply | Optional local echoes; absent image-head echo attests only the request cursor. Published-restore fallback can read current WATERMARK when capture is omitted. | Compatibility path, **not** an implementation of the full captured-evidence contract. Modern client version-checks the native protocol and always echoes its captures; HTTP field omission does not omit these local fields. |

The response-path class is **not closed**. The explicit current dependencies
above are the remaining audit list the author requested; they are not new
verified counterexamples. The fixed Z1 path and schema-adoption window have
controlled overlap regressions, which is a narrower claim.

### Regression and mutation proof

The memory witness uses its production host drain/reopen boundary; SQLite
uses real on-disk stores. The compiled-client cases use two simultaneously
open process devices sharing one SQLite store and controlled HTTP responses.
No browser-kill or physical-power-loss claim is made.

| New/strengthened regression | Passing control and killed mutation |
| --- | --- |
| Private 10→12 at unchanged published 5/send revision; restored head 7 or 15; ordinary and snapshot, halt/reopen/refill | Both stores pass. Reintroducing current-cut eligibility for restore fails the required E_STORE_RESTORE assertion. |
| Healthy response 20 captured before later image evidence 25 | Both stores/client pass without a halt. Substituting current image head for the captured floor falsely halts and fails. |
| Image head advances alone, private cursor stays 10 | Both stores/client return E_GENERATION without halt. Removing the private overlap fence returns success and fails. |
| A later same-revision pending declaration differs | Both stores and the native generation case still halt on the older request's captured evidence. Reintroducing current declaration validation before the restore proof fails. |
| Native capture actually carries retained image head | Setting the returned image capture to zero fails the lower-head restore regressions. |
| Two-owner compiled startup at heads 7/15 | Zero begin_send/HTTP sends; durable halt across reopen/refill. Omitting the probe image-head echo fails the head-15 case. |
| Two-owner generation reply at head 15 | No adoption; durable halt. Omitting the sync image-head echo fails. |
| First private evidence acquired after a head request | No false halt; no early replay. Ignoring a non-restore observation denial causes a send and fails, as do the late-evidence/image-only controls. |
| Private progress changes during `/schema` | Both stores reject atomic installation; native client retains generation 1/private cut 12. Omitting CURSOR from the captured map, dropping the preflight map, ignoring it in native adoption, or omitting it in the client each fails. A second client case advances private progress immediately after native preflight returns; recapturing after preflight fails that case. An unchanged capture permits adoption. |
| Older native modules lack cut, image head or adoption capture | Online/offline compatibility tests reject before any further core call. Removing each corresponding version predicate independently fails. |

Exact compiler/test commands, mutation edits, input hashes, passing controls,
assertion failures and complete verbatim results of the three requested Cargo
commands are retained in [target/review-fix10/report.md](./target/review-fix10/report.md).


Final commands all exit 0: `cargo test -p snapback4-device` **639 passed,
0 failed, 3 existing ignored**; `cargo test -p snapback4-core` **160 passed,
0 failed**; `cargo test -p snapback4` **265 passed, 0 failed**. Final source
also passes strict TypeScript compilation, 30 transport/native client tests,
3 device-compatibility tests and 18 session tests. All 8 Rust, 5 client and
3 protocol mutations fail their intended assertions with passing controls;
all 16 input hashes match final source/compiler output. `ref-check --verbose`
reports 484 LLP documents, 9441 references and zero errors. `git diff --check`
passes. The first full device run's legacy-cursor refusal and the initial
first-evidence test-fixture correction remain in the evidence record.
No push, rebase, merge, Wasm build or publication was performed.


## Round 11 — startup must preserve evidence before validating the server head

Incoming HEAD `ee1252d73b0aeb74758aa5d624e087bc1a61dcd6`, requested base
`27a8a4d66`. This round changes the client and process opener; device/store
algorithms and HTTP wire fields are unchanged.

### Findings and dispositions

| Finding | Disposition and evidence |
| --- | --- |
| **AA1 (P1): changed-generation startup erases restore evidence before head validation** | **Confirmed and fixed.** `createLocalClient` first opens the kept backend with `null`. Only the device's explicit empty-store `E_AUTH` permits installing the fetched backend. The shell takes the installed generation and, on mismatch, the kept backend. Existing sync preflight validates the server identity/head before captured adoption can reset evidence. The corrected tests fail against the incoming client: same-incarnation heads 15/19 permit mutation sends or adoption after destructive opening. Final tests preserve generation 2 / published 17 / private 18 / image head 20, persist `E_STORE_RESTORE`, and block sends, reads and refill through two reopens. |
| **Round-9 opener bypasses production installation** | **Confirmed and corrected throughout the file.** The shared opener now receives `(_name, fetchedBackend)` and calls the real `opener.open("fixture", fetchedBackend)` on each client open. Only the store name is aliased to the seeded fixture. The unconditional preopen with `null` was removed. Thus every previous scenario, including generation, polling and two-owner overlap, traverses actual opening. The remaining explicit `null` opens are peer attachment and the deliberate offline/durable-reopen checks; they do not stand in for the client opener. |
| **Response-path audit was too narrow** | **Accepted.** It started after the destructive open and thus certified observations over already-erased evidence. The widened inventory below includes evidence consumers before a request capture, not just response checks. |
| **Native opening can lose its typed refusal when exit precedes stdout** | **Found during verification and fixed.** The existing native end-to-end test failed with `native device exited (1)` during the newly exercised empty-store open. Waiting for `close` lets stdout finish before transport failure is reported. A controlled child emits exit, then the typed refusal, then close; reverting to exit kills that regression. The full native lifecycle test now passes. |

No additional Grok packet was supplied this round. AA1 and the harness/audit
findings were evaluated against the incoming source and executable witnesses;
no finding was rejected on its source. Z1's implementation is unchanged and
its corrected client cases pass. This report does not turn the absence of a
new deferral, release/effect-loss or atomicity counterexample into a proof that
those entire classes are closed.

### Widened audit: evidence consumption from opening through response and reset

This adds to the round-10 captured/current-state inventory above. That table
alone was insufficient: validation cannot protect evidence a previous action
has already discarded.

| Boundary / consumer | Evidence and action at this revision | Established scope / remaining dependency |
| --- | --- | --- |
| Initial `/schema` fetch | Fetches backend metadata without installing it. Constructor credentials are established first. | Fetching does not attest the store head; it cannot authorize discarding persisted restore evidence. |
| Existing-store startup open | Calls the production opener with `null`, preserving kept generation/backend, published watermark, private cut, retained image heads and halt. Native opening abandons only the old request declaration. | SQLite and wasm memory ordinary/snapshot witnesses inspect these values after refusal and reopen. Both startup replay and direct initial sync are covered. |
| Initial empty-store open failure | Only `E_AUTH` with the device's exact never-synced message permits a second open with the fetched backend; operational, other auth and corrupt-store failures propagate. | Real first-install controls on both hosts; targeted error tests distinguish code and message. The absence observation and installation are separate opener attempts, with no atomic absence receipt. Concurrent creation between these attempts is not qualified by these tests. |
| Process refusal delivery | Process `close`, after stdio closes, terminates the response stream; `exit` alone does not discard pending stdout. | Deterministic exit-before-refusal witness plus the production native lifecycle test. |
| Startup shell generation / routing | Read installed device generation; if it differs from `/schema`, use the kept backend. | Healthy-generation control proves actual adoption from 2 to 1; trusting fetched generation instead fails that control. |
| Startup head observation | Capture persisted published/private cuts, image head, send revision and incarnation before `/probe` or `/sync`; native observation validates them. | Same-incarnation heads 15 and 19 halt; head 20 and a different incarnation at 15 remain valid controls. Native no-suspend startup goes directly through sync preflight. |
| Generation installation | After successful preflight, carry its raw metadata map through `/schema` into `adopt` / `install_checked`. | Round-10 capture/CAS remains the installation guard. Existing private-advance and post-preflight overlap cases now also use the corrected opener. |
| `reset_publication` during client startup/adoption | Existing persisted startup no longer enters a changed-generation reset. A validated adoption can reset in the install transaction. | No new durable key or alternative restore floor; the original private evidence survives until validation. |
| Direct low-level `Device::open_store(Some(backend))`, direct uncaptured `adopt`, and web orphan adoption | These APIs can still install caller-supplied backends; direct calls do not implement the client's preceding head-validation protocol. | Explicit audit boundary. This fix qualifies `createLocalClient` startup, not arbitrary direct host installation as authenticated head evidence. |
| Identity replacement / legacy rewind / explicit clear | Existing native transaction owns receipt retirement, rows, publication reset, incarnation and sticky-halt decisions. | No change this round; full device suite and old-wire probes run. Explicit low-level clear is not a server-head observation. |
| Later response consumers | Round-10 rows still apply: declaration and cursor guards, snapshot owner, receipt settlement, native-module refresh, successful query responses, acquired/freshness reads and assets. | Their previously recorded current-state dependencies remain. The upload-facts cache ticket remains open and out of scope. |

The test harness controls HTTP replies and timing. SQLite's optional no-op
suspend hook selects the web early-replay branch; wasm uses its real suspend
hook. The native-startup variants omit that hook to exercise direct initial
sync. Calls, installation, queries, outbox decisions, restore validation and
persistence are production implementations. The wasm witness uses
`webDevice` with `memoryPersistence`, not IndexedDB termination or power loss.

### Regressions, mutations and controls

| Regression / control | Mutation evidence |
| --- | --- |
| Generation 2 / published 17 / private 18 / images 20; generation-1 same-incarnation heads 15/19; ordinary and snapshot; early-replay and direct-sync startup; both stores | `aa1-install-before-restore` restores the destructive ordering and fails all ten new negative cases. Archived incoming `local.ts` also fails all ten against the corrected harness. Both require no sends/adoption and a durable halt through reopen/refill. |
| Image head is evidence even with head 19 above published 17/private 18 | `aa1-probe-omits-image-evidence` kills the early-replay regressions; `aa1-sync-omits-image-evidence` kills direct-sync snapshot cases. |
| A healthy changed generation is actually installed, on both stores | `aa1-trust-fetched-generation` fails the generation-1 assertion. Head-20 and replacement-identity controls pass unmodified; replacement retires the old known receipt with zero sends. |
| Empty-store bootstrap remains usable on both stores | `aa1-disable-first-install` fails both fresh-store cases with the typed empty-store refusal. Offline reopen retains all four evidence values and performs no adoption/send. |
| Nonempty/operational failures cannot authorize install | Removing the code or exact empty-store-message guard independently causes a second open and fails the original-error/one-attempt assertion. |
| Refusal stdout arriving after process exit | `aa1-native-exit-loses-refusal` fails the required `E_AUTH` assertion with generic process-exit error. |

All eight mutations fail their intended tests with passing controls. Exact
edits, commands, compiler-output and test hashes, assertion failures,
incoming-source comparison and verbatim output of all three requested Cargo
commands are retained in [target/review-fix11/report.md](./target/review-fix11/report.md).
The first native lifecycle failures and initial mistaken replacement-send
expectation are retained there too, rather than omitted from the record.


Final results: `cargo test -p snapback4-device` exits 0 (**639 passed,
0 failed, 3 existing ignored**); `cargo test -p snapback4-core` exits 0
(**160 passed, 0 failed**); `cargo test -p snapback4` exits 0 (**265 passed,
0 failed**). The 45 client/transport tests, 4 compatibility/process-lifecycle
checks, 4 process-opener tests, strict TypeScript build/typecheck and native
end-to-end lifecycle pass. The session/reconnect batch has 19 passing cases;
its one initial native-opener failure is repaired and its dedicated final
rerun passes. Old-wire probes still report server/device/reopened **1/1/1**
in all four memory/SQLite fresh/abandoned variants. The wasm artifact was
rebuilt for the new memory-host witnesses; no artifact is committed or
published. No push, rebase or merge was performed.

## Review fix round 12 — overlap at first installation

**Overlap witness: reachable, confirmed before the fix.** The production
client's first `open(name, null)` returned the real never-synced refusal.
Before that refusal reached its fallback continuation, another production
owner installed generation 2 and acquired published 17 / private 18 / image
head 20, then closed. Resuming the generation-1 fallback changed the stored
state to generation 1 / 0 / 0 / 0 on both SQLite and wasm memory. The subsequent
same-incarnation head 15 (ordinary) or 19 (snapshot) permitted `begin_send`
and an HTTP mutation. This is a defect, not merely hardening. The witness
controls scheduling and HTTP replies; installation, acquisition, persistence,
reopening and sends use the production implementations. The wasm host uses
`memoryPersistence`, not a real IndexedDB browser or a power-loss simulation.
The later compiled incoming `fb5c8804d` client reproduces these failures too.

| Finding | Disposition at this revision |
| --- | --- |
| **BB1: expired emptiness observation authorizes destructive first installation** | **Fixed.** The fallback passes `{ initial_backend: backend }` through the existing host JSON boundary. The shared device opens the backend now present or checks the absence of `device:backend` in the installation transaction before installing. It never upgrades an obsolete absence observation into unconditional installation. A changed persisted generation reaches the existing head preflight and captured adoption. |
| **Other client two-step backend-open/fallback paths** | `local.ts` is the only such path found in the Node/Expo/web client inventory. Node and Expo forward the input; web initial restore, failure recovery and orphan opening operate under an exclusive claim. No other expired-absence fallback was established. |
| **Observation inside a kept-backend open** | Hardened as part of the same boundary: a kept open compares the exact backend read before installing it. Changes during the open return `E_GENERATION`. Both-store transaction-boundary injections qualify this comparison independently of SQLite's handle activation guard; they are not additional real-browser race claims. |
| **Older device opening protocol** | The initial envelope has no ordinary backend generation/schema/program fields, so older modules reject it instead of ignoring the condition. CLI, wasm and C ABI share decoding and installation. Existing explicit low-level backend installation remains supported; callers of it still own their adoption/head-validation policy. |

No new server wire field, durable metadata key, release operation or publication
was added. The user supplied one new review finding, BB1; it was accepted on
executable evidence. AA1's existing startup cases continue to pass. Earlier
response-lifetime audit boundaries and the upload-facts ticket are unchanged.

### New regressions and mutation proof

| New regression / control | Mutation and result |
| --- | --- |
| First-install overlap, lower heads 15/19, ordinary/snapshot, SQLite and wasm memory (four cases); healthy head 20 actually adopts generation 1 (two cases) | `bb1-unconditional-fallback` restores the raw-backend fallback. All six cases fail: lower heads send after cuts are erased, and healthy controls skip validated adoption. The incoming client gives the same failures. Final cases preserve 2/17/18/20 before validation, keep `E_STORE_RESTORE` through two reopens/refill for lower heads, and perform validated healthy adoption. |
| Initial absence checked inside installation, memory and SQLite | `bb1-no-absence-check` removes the initial-open expected backend. Both tests fail because the obsolete opening succeeds. |
| Kept backend checked inside installation, memory and SQLite | `bb1-no-kept-backend-check` removes the kept-open expected backend. Both tests fail because the obsolete opening succeeds. |
| C ABI fresh conditional install, followed by a stale conditional reopen | `bb1-ignore-initial-mode` decodes the envelope but treats it as unconditional. The test fails with generation 1 instead of preserved generation 2. |
| First-install decoder accepts the envelope while a legacy backend decoder refuses it | `bb1-remove-initial-decoder` makes the new input undecodable and fails the fresh conditional-install control. |

All five mutations fail their intended assertions. Their original-source hashes
match final source/compiler output. Exact edits, commands, assertion output,
incoming-client comparisons and verbatim output of all three Cargo commands
are in [target/review-fix12/report.md](./target/review-fix12/report.md).

### Additional verification boundaries

The affected client/host batch passes **69 tests**, including the 47-case
round-9–12 file, native end-to-end opening, transport and store reconnect.
Strict TypeScript build/typecheck pass. The wider lifecycle sweep is **not
green**: its mock does not handle `observe_store`, and its native send-overlap
assertion expects an apply rejection after preflight has already rejected the
reply. Both isolated failures reproduce with the compiled incoming client
against the same final device. The broader file also timed out a pending-write
case and retained handles; it was terminated to collect output. That timeout
is not independently baseline-qualified. The bounded follow-up is
[the lifecycle fixture ticket](../issues/20260918-snapback4-client-lifecycle-fixtures-lag-restore-preflight.md).

The wasm build reports 488,235 B gzip, 658 B above the incoming round-11
artifact; the already-open size-budget ticket remains, and no publication was
attempted. This is no new size-budget qualification claim. No push, rebase or
merge was performed.

Final requested commands all exit 0: `cargo test -p snapback4-device`
(**645 passed, 0 failed, 3 existing ignored**), `cargo test -p snapback4-core`
(**160 passed, 0 failed**), and `cargo test -p snapback4`
(**265 passed, 0 failed**). These are totals across each command's test binaries;
the report preserves every individual result line and the complete command output.
The old-wire probe still reports server/device/reopened **1/1/1** in all four
memory/SQLite fresh/abandoned variants. Ref-check passes with 484 LLP documents,
9,443 references, zero errors; `git diff --check` passes.
