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
