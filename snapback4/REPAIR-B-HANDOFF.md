# Repair B — round 7 handoff

Scope: base `27a8a4d66`, incoming HEAD `5a55e7717653fc2a37757267efba7b92ecdd29cb`,
branch `sb4/repair-b-defer-image-0bf8a4b5`. Local commit only; no push, rebase or merge.

## Requested findings

| Finding | Disposition and evidence |
| --- | --- |
| **W1 — teardown outlives its persisted revision** | **Fixed at recovery.** `open_store` abandons the previous request capture and increments its revision atomically, without clearing deferred pages, published replay limits, outbox or rows. The next request captures the durable outbox. Advancing the revision also fences a surviving owner's delayed response. No capture means no extra metadata writes. `round7::teardown_loses_send_revision_after_durable_admission` persists the empty capture and q's admission, commits q on the real engine, then drops the memory device without draining the send-revision batch. Both present/omitted-wire forms and persisted/lost-revision controls give **1/1/1** through a second reopen. The same test on incoming source gives **1/2/2**. The existing live-capture test still proves same-owner capture reuse; it now proves abandonment and late-response refusal at reopen. |
| **W2 — receipt arms omit restore** | **Disproved against the complete function and incoming source.** `settle` calls `predictions::restore` before `match seq`, hence before both `record_receipt` and `remove`; then it replays and commits. The review packet omitted that preceding line. `predictions::restore` uses the confirmed-base sidecar, not the removed entry's `predicted` list. No new withdraw helper is needed. `round7::receipt_arms_restore_before_replaying_relative_survivors` admits two relative writes, reopens, exercises both rejection and receipt, checks survivor counts/values, reopens again, and dequeues to the original base. It passes unchanged on incoming source on memory and SQLite. Separate mutations removing restore from each arm fail. |
| **W3 — identity-free receipt becomes bound to no store** | **Fixed.** `record_receipt` leaves `receipt_store` absent without a real id. Missing outer identity and historical `Some({id: None})` both match as unbound; `bind_legacy_receipts` binds either on the first real identity. Known foreign identities remain immutable. The first-acquisition regression covers both encodings, terminal acknowledgement, exact value 1, empty outbox and reopen on both stores. A storage regression also binds through private identity and proves foreign receipts stay foreign. Incoming source fails the same first-acquisition test. Three separate receipt mutations fail. |
| **W4 — snapshot skips current events / drops live ordinary slot** | **Disproved against full staging and incoming source.** Every replacement page first calls `snapshot::stage` and staged `history::events`; terminal publication installs that staging, its boundaries, history and accumulated acknowledgements. Applying events again would duplicate scope/history work. `replacing && transfer > watermark` refuses the alleged coexisting advanced ordinary slot before staging or publication. `round7::snapshot_catchup_installs_intermediate_and_terminal_events` checks a distinct intermediate row, terminal multirow update, receipts, privacy and reopen; `snapshot_cannot_discard_an_advanced_ordinary_slot` checks refusal, intact progress and successful ordinary drain. All pass on incoming source on both stores. Skipping intermediate staging, terminal staging, or the advanced-slot guard separately fails. |
| **W5 — private identity escapes into published client state** | **Fixed.** Request identity still comes from `transfer_store_id`; closure identity and adoption comparison now come from native `store_id` at capture and after durable observation/publication. A page's identity alone no longer invalidates watches. Actual native replacement reset still invalidates and adopts immediately. The client regression holds published A while fetching private B, asserts unchanged watch value/notification/read counts during deferral, no spurious observation/adoption, then checks B's published value. The existing native A→A2→row-reset→B backend-adoption test also passes. Two mutations promoting a private identity fail. |
| **W6 — false snapshot mode disables outstanding ordinary stream** | **Fixed with distinct modes.** `publicationOutstanding` derives from native transfer progress beyond published progress and unpublished apply results. It keeps HTTP `stream` enabled independently of `snapshot_catchup`, survives a round interruption via native cursor facts, and does not mark ordinary pages as snapshot-owned. Snapshot pagination still uses its continuation. The client regression reports explicit `snapshot_catchup:false`, defers, loses the next request, resumes from 7 with `stream:true`, publishes at 9, and checks both applies have `snapshot_catchup:false`. Removing stream mode, recovery from durable progress, or the ownership distinction each fails. |
| **Reset test weakness** | **Strengthened.** `clear_rows_lifetime` asserts `device:watermark == "0"` in the same transaction as all private-key checks, then reopens with the same `Some(Backend)` used at setup. Zero is this implementation's reset representation, not an absent key. Removing that reset write fails. |
| **Terminal-gap test weakness** | **Strengthened.** The storage regression now drives both live and snapshot terminal gaps with nonempty `committed_above` through `apply_publication`, asserts the protocol refusal, unchanged watermark and no private publication. The existing four-mode real-device test also covers live, direct/staged snapshot and catch-up, through reopen. Exempting live terminal gaps from validation fails. |

## Remaining review packets

Numbers below are `grok-b7-NN.finding`. No finding is inferred from a packet's verdict alone.

| Finding | Disposition / concrete evidence |
| --- | --- |
| 01, 06, 12 | No findings. Core interval split, additive encoding, transaction hook and apply result are unchanged. |
| 02's unverified questions | `SyncState` derives Serialize only and is not a persisted decode format. `predictions::reset` retains outbox entries and converts observed sequences to sent evidence when dropping images. Apply checks generation before staging; client adoption resets private transfer before restarting from native state. |
| 03.1, 03.2, 03.4 | Previously disproved U3/U5/U4; retained. Publication clears all snapshot keys and owner, first identity stages before promotion, and `reset_publication` clears all private namespaces. Round 6 lifecycle tests plus the stronger reset assertions pass. |
| 03.3 | No same-revision recapture: `capture` returns `current_capture`; a send changes revision and old response fails `observe`'s revision check before declaration/replay. The overlapping-capture and late-response tests remain green. Recovery is now a deliberate additional invalidation boundary under W1. |
| **03.5 — cleanup hides apply error (Low)** | **Fixed.** Rejection cleanup is best effort in both `apply_publication` and `observe_store`; the original error is returned. A store wrapper lets the original transaction fail for overlap and refuses the cleanup transaction. Both APIs preserve the overlap error on both stores. Restoring either error-masking `?` fails. |
| 04.1, 04.2 | Invalid terminal pages already fail shared validation before the replacing/deferring split. No second terminal predicate added. Both direct apply tests now cover the alleged live terminal case explicitly. |
| 04.3 — missing touched tables | Disproved: `deferred::install(..., &mut touched)` inserts every row table and, for an occupied bundle, all schema tables (including metadata-only changes). `restore` restores the confirmed base; it does not install deferred effects. The HTTP/native counter-watch test observes final value 2. |
| 04.4 — generation replacement livelock | Disproved: the client handles generation change with `adopt` before apply; the install reset clears private transfer, preserving outbox execution evidence, then the client restarts. `every_reset_clears_one_publication_state` and generation-adoption transport tests exercise this. Same-generation arbitrary replacement while an advanced slot exists is correctly refused; the new W4 test drains it. |
| 04.5 — cursor below published watermark | No reachable writer: deferred staging requires `page.watermark >= requested >= published`; publication consumes the whole slot atomically; reset clears it. A clamp would hide corrupted progress. No extra predicate added for manually corrupted metadata. |
| 05.1–3 | W2/W4 above. |
| 05.4 — ACKS can be absent for empty receipts | Disproved: `deferred::stage` unconditionally writes `ACKS`, including `{}`. Identity or cursor alone is not an occupied effects bundle. The occupancy test now also commits ACKS and cursor together and asserts pending. |
| 05.5 — debug-only cleanup assertion | No reachable leftover: both publication branches unconditionally clear the whole prefix inside the transaction before watermark/acks/replay, with failure rolling back. The assertion documents this postcondition; it is not the only cleanup mechanism. Runtime scanning is not added as protection against a hypothetical omitted deletion. Reset/publication lifecycle tests retain the durable checks. |
| 07.1 — inherited admission overwritten | Disproved: `stage` installs inherited rows and metadata inside the savepoint **before** constructing `Recording`; the next put sees the inherited row as `old: Some`. A delete removes its admission and permits a fresh candidate. `later_qualifying_image_upgrades_admission_and_moves_keep_it` covers same-page, later-page and marker-only upgrades, moves and recreation, with reopen and immediate-apply controls on both stores. |
| 07.2 — unrecorded outbox/base/staged writes | No reachable call: the recorded window calls only `events_recording` (rows, boundary/history/media metadata). Restore and inherited install execute before wrapping; acknowledgements execute after publication. No outbox/base/staged mutator is called through Recording. No extra recording machinery or panics added for unused trait methods. |
| 07.3 — inherited metadata invisible to reads | Disproved by ordering: `install_metadata(tx)` runs before `Recording::new`, and recording writes also modify the real savepoint transaction before logging. Reads see both inherited and current effects. The multi-page boundary/history tests and prefix-fold tests pass. |
| 08.1 — missing published declaration at replay | Disproved: publication calls `publish_declaration` before `replay` in the same transaction. Before any page publication, `(0,0)` correctly allows the admitted overlay. Cap/prefix and legacy-exclusion tests exercise this boundary. Falling back to an in-flight capture during private deferral would change the published overlay prematurely. |
| 08.2 — foreign receipt sequence should retire | Rejected: another store's sequence number is not proof of inclusion in this store's log. Replacement binds/settles the old incarnation first; preserved foreign receipts must not acquire current authority merely because their number is below a watermark. Known/legacy foreign-receipt lifecycle tests remain green. The actual anonymous-binding error is W3. |
| **08.3 — declaration consumes wrong revision (Medium)** | **Fixed.** Declaration lookup filters by the page's local send revision, or current revision if omitted. A late named response can still read its own capture, but another revision's un-echoed page falls back to published evidence. The new unit test covers both forms; removing the filter fails. |
| **08.4 — bad checkpoint bounds / recovery (Medium)** | **Fixed bounds and recovery.** Bounds-only checkpoints now reject `through > bound`. Invalid persisted captures remain fail-closed during a live request; reopen abandons even undecodable capture bytes without parsing them, preserving private effects and published limits. New both-store recovery regression verifies this. Silently rebuilding a live response's declaration is deliberately avoided. Removing checkpoint validation or recovery invalidation fails. |
| **08.5 — optional bound differs on rejection (Low)** | **Fixed.** `echo_matches` is shared by declaration validation and rejection; an omitted optional bound matches, a present one must equal the captured bound. Removing optional-bound acceptance on reject fails. |
| 09.1–3 | W3 and the two requested test strengthenings above. The suggested private-vs-published receipt mismatch after `clear_rows` does not occur as claimed: `clear_rows` preserves a known STORE_ID; when identity is private only, published watermark is zero and no named-store image is yet being replayed as published. |
| **09.4 — legacy fixture bypasses apply (Medium)** | **Strengthened.** The legacy no-capture/no-echo page now applies on a device whose `[100,150]` replay exclusion is already committed. Apply succeeds and preserves it. Erasing the fallback exclusion fails. |
| **10.1 — occupancy lacks joint state** | **Strengthened.** Tests cursor-only, ACKS-only, then committed cursor+ACKS, publication, and terminal publication. The erroneous `ACKS && !cursor` mutant fails. |
| **10.2 — reset only tests dirty state (Medium)** | **Strengthened.** Plant state and commit; reset in a new transaction; commit and reread every namespace and staged rows. Omitting committed-slot cleanup fails. |
| **10.3 — no nonempty cursor assertion (Low)** | **Strengthened.** Assert committed cursor decodes to `Some(77)` before reset. An always-None cursor mutant fails. |
| 11.1 — omitted identity unstages | Disproved: `stage_identity(None)` is explicitly a no-op. The omitted-identity publication test covers repeated omission and promotion from staging. |
| 11.2 — stale private identity promoted over another store | Disproved: replacement calls `reset_publication`, which clears the whole deferred namespace before installing the replacement identity. The assumed S/T mismatch has no writer. Row-reset/private-incarnation lifecycle tests cover the reset/adopt/reopen sequence. |
| 13.1, 13.2 | W5/W6 above. |
| **13.3 — HTTP page cursor treated as published (Medium)** | **Fixed.** Removed the post-apply assignment from `page.watermark`; published progress refreshes from native only after publication. Each next request still reads native transfer progress. |
| 13.4 — omitted published flag (Low) | Native dispatcher always emits the boolean returned by `apply_publication`; private returns carry false. Kept the existing old-native polarity `published !== false`. No wire/version change. The dispatcher storage test and transport regressions cover the actual contract. |

## Verification artifacts

The complete record is [target/review-fix7/report.md](./target/review-fix7/report.md):
verbatim stdout/stderr for each requested command, exits, source hashes,
mutation edits/compiler commands/assertion failures, passing controls, and
incoming-source probes. Tests compile normal native features with repository
profiles; isolated mutation builds preserve those features and debug assertions
with optimization disabled. Mutated source never replaces branch files.

W2/W4 were independently executed against source bytes archived from incoming
HEAD, using the same current core/language dependencies (unchanged this round).
Both receipt outcomes and both snapshot tests pass there. The teardown and
anonymous-binding regressions fail there. This is evidence for the disproofs,
not merely a green result on changed code.

The persistence test is the production memory store's host-drain/reopen boundary;
it is not a browser termination or physical-power-loss witness. The native
transport tests exercise the process device; the focused shell tests inject
native state to isolate publication, watch and request-mode behavior.

## Final results

| Command | Passed | Failed | Ignored | Exit |
| --- | ---: | ---: | ---: | ---: |
| `cargo test -p snapback4-device` | 617 | 0 | 3 | 0 |
| `cargo test -p snapback4-core` | 160 | 0 | 0 | 0 |
| `cargo test -p snapback4` | 265 | 0 | 0 | 0 |

Verbatim results, without omitted targets or warning lines, are embedded in
[target/review-fix7/report.md](./target/review-fix7/report.md) and retained as
individual raw logs. Eight client/transport tests and TypeScript compilation
pass. All **27 mutations** (21 Rust, six client) failed the intended regression
assertions with passing controls and final-source hash verification. This includes
the post-publication native-cursor regression for 13.3. `ref-check --verbose`
reports 484 LLP docs, 9440 refs, zero errors; `git diff --check` passes.

The first full run exposed needless absent-key deletion records; that production
issue was corrected. The next exposed a fixture issuing a new request with its
pre-reopen revision; it now captures the new owner and still checks rejection
of the unchanged old reply. Final full runs supersede those incomplete runs,
whose logs remain in the verification record. No push, rebase or merge.
