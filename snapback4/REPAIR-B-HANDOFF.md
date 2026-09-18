# Repair B — round 5 handoff

Scope: base `27a8a4d66`, handoff `178fe48f3`, branch `sb4/repair-b-defer-image-0bf8a4b5`.
All eleven Grok packets and the GPT-family review under `target/reviews-closing/` were read. No push, rebase or merge is authorized or performed.

## Requested High findings and author correction

| Finding | Disposition and evidence |
| --- | --- |
| Author correction; G5.1: absent image head | **Fixed.** `should_defer` intersects replayability with `committed_above` only. Missing fields never defer. The no-gap fast path remains. `legacy_live_tail_publishes_with_an_unsent_prediction` publishes three consecutive `more=true` pages on both stores. The old-server double-apply remains an explicit compatibility limitation, recorded in LLP 3000.001. |
| T1; G2.1: snapshot cut beats live cursor | **Fixed.** `sync_state` prefers `deferred::cursor`, then terminal `SNAPSHOT_THROUGH`, then published watermark. `live_cursor_precedes_terminal_snapshot_cut` sets through=100 and live=150 independently and requires 150 on both stores. The actual snapshot catch-up test advances through three pages, publishes once, observes the receipt, reopens, and settles it. |
| T2; G2.2: send clears terminal snapshot | **Fixed.** Only a nonempty `SNAPSHOT_NEXT` aborts paging. Terminal staging and its owner/cut survive; its send-revision binding advances with the send so subsequent catch-up can apply. `send_after_terminal_snapshot_drains_multiple_catchup_pages` checks cursor, unchanged private overlay, publication, receipt and reopen. The older restart test now creates a genuinely nonterminal snapshot; its former expectation contradicted this correction. |
| T3; G3.1–2: obsolete-page gate and replacement start | **Fixed.** Missing request echoes are accepted only at ordinary published progress; private continuation requires a match. Backwards checks use the requested floor. First replacement pages are exempt from ordinary request equality (the published-watermark monotonic check remains). Snapshot catch-up is no longer misclassified as an identity-free ordinary rewind before that gate. Three both-store regressions cover absent echo, snapshot floor and replacement from zero. |
| T4; G5.2 and G3.4: terminal snapshot gap | **Fixed.** Validation rejects terminal gaps for snapshots and streams. Independently, `should_defer` returns false for every terminal page. Both-store integration and direct-predicate tests cover each guard separately. Synthetic replacement tests now use legal snapshot continuations and a terminal no-gap page. |
| T5; G10.1: omitted first identity | **Partly misdiagnosed; actual defect fixed.** `stage_identity(None)` already does nothing in the handoff, so it did not clear identity on observation. Publication nevertheless derived identity only from the current page and then cleared the slot. Publication now adopts page-or-staged identity before disposal. The regression observes an omitted identity, publishes, observes A again without replacement, and reopens with A. |
| T6; GPT High: row reset forgets incarnation | **Fixed.** `clear_rows` preserves known private incarnation around publication reset, as generation installation already does. The dispatcher regression covers keep/drop × adopt/open on memory and SQLite, replacement backend obligation, old-receipt retirement and two reopens. The new TypeScript/native HTTP regression independently runs A→A2→row reset→B at A2's generation, requires B's backend fetch, and checks B's program/rows and empty outbox through two reopens. |

## Remaining Medium/Low findings

| Packet / finding | Disposition and evidence |
| --- | --- |
| G1 Low: inverted `acknowledged_at` cuts | **Fixed.** Reject `images_at < through` with an input error; equal-cut legacy lookup remains unchanged. `stream_heads_and_receipt_intervals` exercises the refusal with real committed operations. |
| G2.3: send wipes in-flight declaration | **Fixed.** `begin_send` leaves capture intact. A matching echoed rejected reply releases its capture; apply consumes successful captures as before. The regression verifies byte-identical capture through send and polling, rejection, recapture including the later write, and both surviving overlays. |
| G2.4: every state read recaptures | **Sticky behavior already existed; getter fixed.** Handoff `capture` returns `load_capture` before building/writing. Added `sync_state_read`, using a read transaction with rollback. Dispatcher `sync_state` selects it with additive `capture:false`; startup, readiness refresh and restore/identity polling use that path. Only the sync request path declares. Tests independently kill recapture, send clearing, writable getter and rejection retention. |
| G3.3: observe publishes before deferral | **Fixed structurally.** Apply first observes with `publish_first=false`; only the publishing branch promotes identity and revision. Removed the two-field manual undo. The regression requires unchanged published identity/revision while holding and adoption only with installation. Replacement/restore observation retains its existing durable reset/refusal behavior and exits apply before a deferred success. |
| G3.5: defer/replay eligibility disagreement | **Not reproduced.** Both use `predictions::replayable`; deferral uses this page's prospective declaration, which publication installs before replay. Using the old published exclusion band would wrongly omit newly declared IDs (`newly_declared_commit_participates_in_deferral`). For an intersecting ID, the server receipt lies above `page.watermark`; advancing to that watermark cannot cover its receipt. Published observations exclude replay in both paths. Acknowledgements are installed before replay. |
| G4.1: dequeue leaves stale overlay | **Fixed.** Restore confirmed bases, remove the entry, then replay survivors in one transaction. New both-store regression checks 2→1→0 for two relative writes. Merely calling replay without restore would apply the survivor over its existing prediction. |
| G4.2: ACKS occupancy differs from namespace assertion | **Wrong premise.** `deferred::stage` unconditionally writes ACKS, including `{}`. Identity and cursor alone intentionally are not unpublished effects. Testing PREFIX would report identity-only observations as pending indefinitely. `pending_publication_reads_the_slot_not_request_progress` independently varies cursor/slot; replacement disposal has a both-store/reopen regression. |
| G5.3: snapshot inherits deferred rows/meta | **Unreachable in the implemented call graph.** `deferred::stage` is called only under `!replacing && defer`; `replacing = page.snapshot || page.snapshot_catchup`. Snapshots use `snapshot::stage`, then discard a superseded same-position ordinary bundle, including its receipts. An advanced ordinary transfer must drain first. `replacement_discards_same_position_slot_and_its_receipts` checks direct/staged replacement, an inherited 99 image omitted by the snapshot, leaked receipts, and two reopens. No second snapshot applicator was added to an ordinary-only helper. |
| G5.4: rejected held row loses media/keeps stale image | **Unreachable predicate.** `admission=None` passes `held=true` to `Boundaries::accept`, whose first statement returns true for held rows. A failed gate therefore necessarily has admission provenance (a new/recreated row); that branch forgets media and deletes any superseded old image. Boundary tests cover rejected recreation and final media; moved held rows remain accepted. Changing this to horizon eviction would violate the holding rule. |
| G6.1: unpublished create cannot retract | **Wrong read-state premise.** Before constructing `Recording`, stage restores bases and installs inherited private rows/metadata into the live savepoint. Its pass-through `get` sees the prior private create; `delete` records its removal, then rollback leaves the visible base untouched. Row delta tombstones survive until install. No parallel row overlay is needed. |
| G6.2: update clobbers inherited admission | **Same incorrect premise.** Installed inherited rows make `old=Some`; that path uses `entry.or_insert(None)`, preserving prior admission. A real delete removes admission and a later creation intentionally gets fresh evidence. `folded_create_update_and_delete_recreate_preserve_indexes` and the boundary suite exercise cross-page holding, upgrade, move and recreate. |
| G7 Medium: absent capture/echo erases published exclusion | **Fixed.** Fall back to `replay_limit`, not `(0,false,0)`. New both-store unit test publishes an echo-free page after an existing `(100,150)` exclusion and requires it to remain unchanged. |
| G7 Low: stored new-format capture unchecked | **Fixed.** Validate cap, duplicate IDs, interval ordering and live outbox membership. Captured IDs that have since retired are allowed; a current outbox cannot reconstruct the original set after retirement. Tests cover over-cap, omitted in-prefix ID, included excluded ID, and duplicates. |
| G8.1: `ReceiptStore { id: None }` must be unbound | **Declined: those are different facts.** Outer None is a checkpoint's implicit receipt; inner None records execution in an unidentified legacy store. Binding that receipt to a future named store would grant an unsupported execution claim. A clean unacquired write is not predictable. First identification of an already acquired legacy partition resets and retires its matching anonymous receipts; foreign named receipts stay bound. Existing legacy/replacement/foreign-receipt tests exercise these rules. T6 preserves actually known identity instead of weakening receipt ownership. |
| G8.2: prefer private identity over published receipt identity | **No reachable conflicting identities.** A different incoming named incarnation triggers reset/adoption before acquisition; the old deferred namespace is cleared. First identity remains private only while published STORE_ID is absent. Thus both IDs are equal, or one is absent, on receipt-writing paths. Blindly giving an unrelated staged value precedence would not repair a reachable state. The A→A2→reset→B dispatcher/transport tests check the lifecycle directly. |
| G9 tests packet | **No findings.** Its existing storage-contract tests remain in the requested full device run. |
| G10.2: unidentified reset should retire every named receipt | **Declined.** An unbound checkpoint receipt matches None and retires; a receipt explicitly bound to an unrelated named incarnation does not belong to the discarded anonymous partition. The preserved entry is made nonpredictable, so the claimed replay also cannot occur. `unrelated_receipt_cannot_be_retired_by_replacement_watermark` is the deliberate counterexample to the suggested blanket retirement. |
| G10.3: empty ACQUIRED should count as acquisition | **Declined.** Open/adopt explicitly write `""` when acquisition is invalidated; reads compare with the active generation string. Treating empty as authority was the earlier false replacement bug. The generation-lifetime tests cover it; real private identity persists separately. |
| G11.1: transport watermark/store variables publish private state | **Different roles, not a defect.** The loop-local watermark is request progress; after a round, `seq=watermark` runs only if `caughtUp`, which requires terminal published apply. `publishedStore` is freshly read from durable `store_id` for adoption, never assigned from an ordinary deferred page. It changes on `observe_store.reset` because that operation durably installs replacement identity. `storeIdentity` is an immediate incarnation fence, intentionally invalidating old watches before backend adoption (LLP 3000.007 §18.2). Delaying that fence until image publication would permit old-store reads. Focused transport tests cover both cursor and adoption CAS. |
| G11.2: persisted false demotes snapshot catch-up | **Wrong persistence premise.** A terminal staged snapshot writes NEXT="" and retains its matching owner; `sync_state.snapshot_catchup` is true. Partial snapshots have a nonempty continuation and correctly remain false. Existing interrupted-round transport test and the new multi-page catch-up test exercise the durable transition. T2 fixes the actual send-induced loss. |
| G11.3: optional image head serialized as null | **Fixed.** Omit absent `images_at` and empty `committed_above`. The CLI's byte-exact stream test covers both the populated and omitted forms. |
| GPT Medium: CLI tests did not compile | **Already corrected in the handoff, preserved here.** Both `StreamReply` literals include the Rust fields. Their omitted-field expectation is updated for G11.3. `cargo test -p snapback4` is a required executed command in this round, not a source-only check. |
| GPT S1 / S2 / previous nine mutations | **Preserved.** Ordinary installation consumes its bundle and receipts; replacement discards the superseded bundle and receipts. Pending uses ACKS/owner, not cursor. Existing regressions remain green; this round's fresh mutation evidence is listed separately and does not claim the earlier logs as new executions. |

## Test-fixture corrections

Older tests that expected every missing-head page to defer now use explicit image gaps and committed IDs for their intended tombstone/replacement scenario. A separate live-tail test asserts the corrected legacy behavior. Private synthetic continuations now echo their actual request cursor. Terminal snapshot tests do not use the now-invalid `images_at > watermark` terminal shape. These changes preserve each test's intended row/receipt assertions while enforcing the corrected protocol.

## Evidence

The complete command transcripts and mutation records are local under
[`target/review-fix5/`](./target/review-fix5/). `report.md` combines the per-finding
dispositions, source-bound mutation results and verbatim stdout/stderr from all
three required crate test commands. Mutation scripts compile copied source;
the branch source is never replaced with mutant code. The normal Cargo runs
verify the repository test profile; mutation controls and mutants use the same
explicit native features with debug assertions and optimization disabled.



## Final verification

| Command | Passed | Failed | Ignored | Exit |
| --- | ---: | ---: | ---: | ---: |
| `cargo test -p snapback4-device` | 593 | 0 | 3 | 0 |
| `cargo test -p snapback4-core` | 160 | 0 | 0 | 0 |
| `cargo test -p snapback4` | 265 | 0 | 0 | 0 |

All five focused TypeScript/native transport tests and the strict TypeScript
compile passed. All 28 behavioral mutations compiled and failed their intended
regressions, with passing controls and final workspace source hashes verified.
The three ignored device tests are existing. `git diff --check` passed.

[Complete per-finding dispositions, mutation links and verbatim command results](./target/review-fix5/report.md).
No push, rebase or merge was performed. The lane's work is committed locally only.
