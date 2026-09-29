# Round 2 failure inventory

The full script was run exactly once and remains red in the record. This inventory names every test failure in retained ordinary logs, deduplicated within a log. Intentional negative controls are separate. The final affected run passed 1,417 tests; the final bounded HTTP run passed 156 (4 ignored), and the whole guide passed 98.

## Required full run

Exact summary: `== 2 failure(s) in 1167 s` (`cargo test`, `client tests`). The main client worker reported 4,508 tests: 4,482 pass, 15 fail, 1 cancelled, 10 skipped. The separately scheduled acquisition worker reported 12 tests: 11 pass, 1 fail. Other acquisition/server-e2e shards passed. The final model worker passed 79/79.

| Failure | Attribution | Resolution |
| --- | --- | --- |
| serve::changes::column_tests::repeated_polls_build_program_proofs_once_per_generation | ours | The first test tried to increment generation by adopting identical inputs. It now changes the read rule, asserting cache reuse before adoption and fresh proofs afterward. |
| wasm: snapshot and catch-up publish readiness together; later failures preserve acquired rows | baseline | The merged baseline reproduces the failed-preflight generation race when a queued write receipt observes adoption first. The fixture now withholds that independent write as well as the failed sync; both stores pass. |
| native: synced list elements survive offline reopen and drop revokes only that element | ours | Cached media was stamped with its download cut instead of the locally revalidated authority cut. Capture the device watermark before validating the cached home; both stores pass offline reopen. |
| wasm: synced list elements survive offline reopen and drop revokes only that element | ours | Cached media was stamped with its download cut instead of the locally revalidated authority cut. Capture the device watermark before validating the cached home; both stores pass offline reopen. |
| every local prediction invalidates observations, including unrelated tables | ours | The old assertion required unrelated tables to refetch. Indexed invalidation now refreshes only affected observations; the updated test verifies the affected read reruns and the unrelated read does not. |
| W8R1a online opted-out server-run observations retain nothing during a replacing fetch | ours | The no-op pulse no longer triggers a blanket refetch. The fixture now mutates the observed tables and still asserts opt-out withdrawal during that replacing fetch. |
| process: kept typing withdraws on member commits and rejects expired held replies | ours | Initial-read timeout in the intermediate full run. All three tiers pass the isolated follow-up and final affected run. No baseline or environmental exemption is claimed. |
| createApp keep=true: useQuery and usePage preserve owned inputs through 20 invalidations, loaded cursors and removal | ours | Intermediate browser failure/cancellation while sources were being edited. Frozen-source final affected run passes; no baseline exemption is claimed. |
| wasm keep=undefined: expiry withdraws across settle with the replacement held | ours | Settlement may preserve an already checked replacement when its footprint is empty. The test accepts only the new replacement (never the old body) and still checks deadline withdrawal while the next read is held. |
| wasm keep=true: expiry withdraws across settle with the replacement held | ours | Settlement may preserve an already checked replacement when its footprint is empty. The test accepts only the new replacement (never the old body) and still checks deadline withdrawal while the next read is held. |
| process keep=undefined: expiry withdraws across settle with the replacement held | ours | Settlement may preserve an already checked replacement when its footprint is empty. The test accepts only the new replacement (never the old body) and still checks deadline withdrawal while the next read is held. |
| process keep=true: expiry withdraws across settle with the replacement held | ours | Settlement may preserve an already checked replacement when its footprint is empty. The test accepts only the new replacement (never the old body) and still checks deadline withdrawal while the next read is held. |
| maintained columns: sqlite watches use server values across interrupted sync and reopen (queued tail) | ours | Dependency evidence from a receipt now fences the unpublished old base. The test separately checks that the core still holds the old image and that the public query/watch are loading until apply. |
| maintained columns: web watches use server values across interrupted sync and reopen (queued tail) | ours | Dependency evidence from a receipt now fences the unpublished old base. The test separately checks that the core still holds the old image and that the public query/watch are loading until apply. |
| web IndexedDB device withdraws expired inbox data in useQuery and usePage | ours | Overlapping reconciliation legitimately causes additional authoritative replies. The artificial deadline is now attached consistently to every reply in the deadline phase, instead of only the first reply per key. |
| wasm: a reply that names no store cut is ordered by when its read began | ours | The early server gate incorrectly interpreted a missing cut as zero. Cutless replies now use request order and the final dependency evidence serial check. |
| process: a reply that names no store cut is ordered by when its read began | ours | The early server gate incorrectly interpreted a missing cut as zero. Cutless replies now use request order and the final dependency evidence serial check. |
| web held typing: deadline republishes locally and clock advance expires on the next query response without a deletion | ours | An explicitly empty server dependency footprint was treated as unknown/global. It now certifies no data dependencies, preventing a constant clock query from fencing unrelated held data. |

## Other runs

All of the following are intermediate reds, not qualifications. Some filenames contain “qualified” or “final” because they were intended as qualification runs; that never changes their recorded result.

### [affected-final.log.gz](./affected-final.log.gz)

- **ours** — web IndexedDB device withdraws expired inbox data in useQuery and usePage
- **ours** — web held typing: deadline republishes locally and clock advance expires on the next query response without a deletion

### [affected-first.log.gz](./affected-first.log.gz)

- **ours** — native: synced list elements survive offline reopen and drop revokes only that element
- **ours** — wasm: synced list elements survive offline reopen and drop revokes only that element

### [baseline-acquisition.log.gz](./baseline-acquisition.log.gz)

- **baseline** — wasm: snapshot and catch-up publish readiness together; later failures preserve acquired rows

### [browser-idb.log.gz](./browser-idb.log.gz)

- **ours** — Astra 5 browser wasm: builder profile gate survives another profile update and unrelated mutation
- **ours** — Astra 5 browser online: builder profile gate survives another profile update and unrelated mutation

### [browser-replay-qualified.log.gz](./browser-replay-qualified.log.gz)

- **ours** — Astra 5 browser online: builder profile gate survives another profile update and unrelated mutation

### [browser-third.log.gz](./browser-third.log.gz)

- **ours** — Astra 5 browser wasm: builder profile gate survives another profile update and unrelated mutation

### [guide-final.log.gz](./guide-final.log.gz)

- **ours** — familiar::every_moved_fact_has_its_why_or_details_home

### [model-overlap.log.gz](./model-overlap.log.gz)

- **ours** — independent fence model seed 12

### [model-seed12.log.gz](./model-seed12.log.gz)

- **ours** — independent fence model seed 12

### [mutations-canonical.log.gz](./mutations-canonical.log.gz)

- **ours** — Error: mutation did not match: replacement-call

### [proof-cache.log.gz](./proof-cache.log.gz)

- **ours** — error[E0061]: this function takes 3 arguments but 2 arguments were supplied
- **ours** — error[E0063]: missing field `change_proofs` in initializer of `serve::Shared`
- **ours** — error: could not compile `snapback4` (bin "snapback4" test) due to 2 previous errors

### [qualified-affected.log.gz](./qualified-affected.log.gz)

- **ours** — an invalid store_id receipt cannot erase another confirmed entry
- **ours** — an invalid table receipt cannot erase another confirmed entry
- **ours** — an invalid row receipt cannot erase another confirmed entry
- **ours** — an invalid column receipt cannot erase another confirmed entry
- **ours** — an invalid missing receipt cannot erase another confirmed entry
- **ours** — native image/png bytes survive a fresh cache opener; response ownership ends after copying
- **ours** — native video/mp4 bytes survive a fresh cache opener; response ownership ends after copying
- **ours** — once responses with valid receipts remove stale ordinary bytes without reading or storing the once Blob
- **ours** — once responses with absent receipts remove stale ordinary bytes without reading or storing the once Blob
- **ours** — once responses with malformed receipts remove stale ordinary bytes without reading or storing the once Blob
- **ours** — once responses with incomplete receipts remove stale ordinary bytes without reading or storing the once Blob
- **ours** — once responses with no table receipts remove stale ordinary bytes without reading or storing the once Blob
- **ours** — once responses with no row receipts remove stale ordinary bytes without reading or storing the once Blob
- **ours** — once responses with no column receipts remove stale ordinary bytes without reading or storing the once Blob
- **ours** — once falls back to a transient data URI without a second fetch or durable bytes
- **ours** — retention drops old inferred homes and refuses downloads without a valid home receipt
- **ours** — retained receipt store binding is revalidated on read
- **ours** — retained receipt store binding is revalidated on reconcile
- **ours** — retained receipt store binding is revalidated on reopen
- **ours** — retained receipt store binding is revalidated on unbound reopen
- **ours** — a foreign once receipt checks the entry after serialized writes and never copies its body

### [qualified-affected2.log.gz](./qualified-affected2.log.gz)

- **ours** — retained asset homes and expiry use the same estimated time as device reads

### [regressions-first.log.gz](./regressions-first.log.gz)

- **ours** — Astra 5 browser wasm: builder profile gate survives another profile update and unrelated mutation
- **ours** — Astra 1 process: revoked rows cannot reappear during pending sync after unrelated prediction
- **ours** — Astra 1 wasm: revoked rows cannot reappear during pending sync after unrelated prediction
- **ours** — Astra 4 online: asset refusal revokes existing grants and listeners; failures preserve grants
- **ours** — Astra 4 process: asset refusal revokes existing grants and listeners; failures preserve grants
- **ours** — Grok: withheld reply cannot advance the retained body cut past a later changes revocation
- **ours** — authoritative E_ASSET_VIEWED and HTTP transport failure preserve the already granted first view
- **ours** — online: receipt after an unseen commit gap fences old authority
- **ours** — process: receipt after an unseen commit gap fences old authority
- **ours** — online: public rule witnesses do not qualify as harmless profile puts
- **ours** — process: public rule witnesses do not qualify as harmless profile puts
- **ours** — round 2 process: remote null fences a new local alias until apply
- **ours** — round 2 wasm: remote null fences a new local alias until apply
- **ours** — round 2 online: old-refusal cannot overtake newer asset authority
- **ours** — round 2 online: old-grant cannot overtake newer asset authority
- **ours** — round 2 process: old-refusal cannot overtake newer asset authority
- **ours** — round 2 process: old-grant cannot overtake newer asset authority

### [regressions-qualified.log.gz](./regressions-qualified.log.gz)

- **ours** — Astra 5 browser wasm: builder profile gate survives another profile update and unrelated mutation

### [regressions-second.log.gz](./regressions-second.log.gz)

- **ours** — Astra 5 browser wasm: builder profile gate survives another profile update and unrelated mutation

### [rust-http-qualified.log.gz](./rust-http-qualified.log.gz)

- **ours** — serve::tests::adoption_tests::reads::adoption_keeps_queries_and_sync_readable_and_serializes_writes_once
- **ours** — serve::tests::latency_tests::headers::dev_headers_cover_operations_and_refusals_without_data_and_respect_the_fence
- **ours** — serve::tests::refresh_rotates_and_logout_all_revokes_every_session
- **ours** — serve::tests::foreign_origins_and_rebound_hosts_cannot_seed_or_impersonate
- **ours** — serve::tests::latency_tests::headers::wildcard_listener_omits_timing_for_loopback_and_external_peers
- **ours** — serve::tests::a_presence_answer_asks_its_client_to_refresh
- **ours** — serve::tests::ephemeral_tests::rate_and_input_refusals_are_http_200_failed_under_dev_and_serve
- **ours** — serve::tests::latency_tests::headers::thread_cpu_excludes_another_busy_thread_and_records_own_work
- **ours** — serve::tests::public_live_logout_keeps_the_bound_family_tombstone_authoritative
- **ours** — serve::tests::latency_tests::latency_release_requires_a_live_service_and_never_allows_reset
- **ours** — serve::tests::refusal_tests::a_checked_out_reader_keeps_its_source_coordinates_across_publication
- **ours** — serve::tests::latency_tests::headers::changes_reopens_after_a_commit_and_times_each_open_as_wait
- **ours** — serve::tests::ephemeral_tests::revoked_bearer_poll_finishes_on_a_read_only_connection_without_engine_lock
- **ours** — serve::tests::adoption_tests::atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes
- **ours** — serve::tests::full_poll_admission_preserves_short_request_progress
- **ours** — serve::tests::latency_tests::latency_reset_excludes_requests_that_arrived_in_the_previous_window
- **ours** — serve::tests::asset_list_tests::image_list_http_regression_with_scalar_upload_admission
- **ours** — serve::tests::ephemeral_tests::mutation_wire_query_version_and_no_sqlite_writer_lock
- **ours** — serve::tests::adoption_tests::reader_failure::failed_file_reader_refuses_without_waiting_for_the_writer
- **ours** — serve::tests::adoption_tests::a2_adoption_fences_supervised_claims_before_the_old_child_stops

## Phase notes and operational failures

- **Ours:** early new HTTP fixtures omitted membership insert authority and used a non-server remote alias. Corrected them to exercise actual null/subset replies and restoration, with real process and wasm stores.
- **Ours:** the browser notes prediction initially used non-durable memory persistence and was refused. The witness now uses real IndexedDB. A held sync/write fixture also deadlocked; waiting for apply before releasing the notes send makes the intended overlap explicit.
- **Ours:** the historical replay fixture initially used an invalid mutation id. It now seeds and replays a real 26-character id, asserts replayed=true, holds the profile fetch, and inspects the mounted gate while it is held.
- **Ours:** the cache state read required updates to fake MediaCache hosts. These failures account for the asset-blob-lifecycle and server-clock intermediate reds. Real offline reopen is covered separately.
- **Ours:** the guide reads-06 prose snapshot was stale after the dependency wording changed. Updated that one fact and reran the whole guide, 98/98.
- **Ours:** the initial independent model drained multiple authority completions before the corresponding client microtasks, making its oracle know a later revocation before an earlier publication. Drain one completion per event-loop turn. Random drains and an explicitly remote operation now exercise authority delivered without a change notification.
- **Ours:** affected-qualified.log was interrupted by my 300-second subprocess timeout while keep-app-model was still running. It has no complete summary and is not a pass. The final 1,417-test batch excludes that long file; the required full run completed every keep-app-model case.
- **Ours:** several preparatory Python commands used the wrong relative working directory, and the first Rust mutant staging lacked the relative benchmark include path. No product files were mutated by these failed preparations. The corrected isolated mutation runs are retained.
- **Ours:** rust-http-qualified.log used unbounded host-default concurrency. The log contains OS error 24 (too many open files), connection resets, OS error 11 and timing assertion failures. All twenty names are listed above; --test-threads=4 passes without a source change.
- **Baseline:** only the acquisition generation assertion has a demonstrated baseline exemption, in baseline-acquisition.log. The baseline browser run passed both deadline tests and confirms those were ours.
- **Environmental limitation:** this Linux workspace has no dedicated booted iOS simulator. No new Expo UI success is claimed; the required script passed its Expo typecheck, and process-device tests pass. No environmental product-test exemption is claimed.

## Negative controls

The final ten JavaScript mutants all produce assertion failures, including the per-asset refusal guard and removal of replacement publication in both the real fixtures and the independent model. The Rust proof-cache mutant produces 8,000 program visits instead of 400. These are expected failures; see mutations.json and mutant-program-proofs-qualified.log.gz.

Two earlier mutation checks survived and were treated as test weaknesses: the replay guard before the valid-id/held-profile fixture was fixed (mutations.log.gz), and the replacement fence before random schedules included independent remote evidence and completion drains (mutation-model.log.gz / mutation-model-final.log.gz). Both are killed by the final unchanged product code plus strengthened tests. mutations-initial.json records the original replay survivor; mutations-intermediate.json records the later nine-mutant run.
