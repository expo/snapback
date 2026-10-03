# Full-run failure classification

The full run initially used a symlink for `snapback4/target`. That violates the
private-store requirement that the SQLite data directory be real. The correction
creates a real local `target` and links only build-output subdirectories into
`~/sb5-lanes/target`; it changes no tracked source or engine behavior.

## Rust failures

### snapback4-core::row_view_accounting (1.2 s)

**Environmental setup failure:** every listed case refused the local target symlink with `Store("private store: private data directory must be a real directory")`.

- `generated_scalar_comparisons_count_insertions_and_forward_reverse_marks`
- `pending_and_completed_expiry_corrections_have_identical_public_meters`
- `repeated_count_reads_release_transient_members`
- `private_expiry_recount_reconciles_edits_clock_advance_and_sweep`
- `a_new_live_basis_and_later_sweep_cannot_subtract_the_same_input_twice`
- `count_member_decode_obeys_the_same_heap_bound_as_an_ordinary_read`

### snapback4-core::row_view_disclosure (1.8 s)

**Environmental setup failure:** every listed case refused the local target symlink with `Store("private store: private data directory must be a real directory")`.

- `grok_born_expired_cardinality_is_absent_from_counts_meters_and_commits`
- `formerly_live_populations_and_insertion_orders_have_identical_transcripts`
- `legacy_adoption_expiry_and_member_interpretations`
- `interleaved_expired_prefix_live_suffix_before_mark`
- `redundant_logical_witness_alternatives`
- `generated_populations_transitions_and_expiry`
- `value_witnesses_and_mixed_live_expiry_ranges`
- `public_source_blind_private_parent_refuses_without_recount_work`

### snapback4-core::row_view_witness (9.0 s)

**Environmental setup failure:** every listed case refused the local target symlink with `Store("private store: private data directory must be a real directory")`.

- `denied_view_witness_reserves_before_hidden_presence`
- `hidden_member_payload_through_witness`
- `ordinary_member_witness_control`

### snapback4-lang::guide (4.7 s)

**Lane B documentation failures** (fixed within existing budgets).

- `client::existence_card_and_starters_teach_the_sdk_words`
- `client::published::published_file_references_resolve_against_package_contents`
- `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`

### snapback4-core::snapback4_core (207.4 s)

**Environmental setup failure:** every listed case refused the local target symlink with `Store("private store: private data directory must be a real directory")`.

- `engine::row_views::certification_tests::incremental_certification_matches_naive_after_every_random_step`
- `engine::row_views::certification_tests::incremental_certification_matches_naive_with_expiring_members`
- `engine::row_views::certification_tests::lifetimes::generated_direct_lifetimes`
- `engine::row_views::certification_tests::lifetimes::generated_inherited_lifetimes`
- `engine::row_views::certification_tests::lifetimes::generated_through_lifetimes`
- `engine::row_views::tests::exact_expiring_cursor_delete_survives_private_chunk_reopen_and_sweep`
- `engine::row_views::tests::numeric_view_witness_certifies_before_comparing_a_stored_value`
- `engine::row_views::tests::private_expiry_chunks_keep_durable_cursor_edits_and_restart`

## Client failures

- `event-slot-capability.test.mjs` and `event-slots.test.mjs`: environmental `ENOENT` for the generated local `target/event-slots-traces.json` after correcting the directory layout. Regenerate with the checkout’s Rust producer and rerun both files.

Affected rerun summaries and the original suite summary are recorded in REPORT.md.
No failure is classified as inherited without a base reproduction.

## Earlier focused checks

Lane-owned documentation failures before the full run also named
`w14b_first_account_screen_is_self_contained`,
`client::client_aliases_keep_typing_on_ephemeral`,
`client::native_smoke_is_the_milestone_path_with_honest_limits`, and
`start::openings_fit_without_growing_the_eight_reference_cards`. They checked
README first-screen scope and guide line/word limits; all pass in the final
110-test guide run. No test or budget was loosened.

`every delivery await is explicitly classified` was a lane-owned stale census,
corrected by regenerating counts and documenting the new read-only awaits.
It passes in the focused rerun. An early declaration test invoked from the
repository root could not resolve the Snapback 4 workspace's Node types;
running from the documented fenced workspace corrected that environmental
working-directory error.

## Complete client-run case list

### `packages/snapback4/test/event-slot-capability.test.mjs`

Environmental missing generated event-slot trace, described above.

- `packages/snapback4/test/event-slot-capability.test.mjs`

### `packages/snapback4/test/event-slots.test.mjs`

Environmental missing generated event-slot trace, described above.

- `packages/snapback4/test/event-slots.test.mjs`

### `packages/snapback4/test/readme-examples.test.mjs`

Lane-owned: new sample names lacked documentation-fixture declarations, the set-state snippet lacked its imports/props, and internal pure selectors had been exposed without a public recipe. Made examples self-contained, added explicit-ID operation types to the strict fixture, and kept the pure implementation internal. No type assertions or test weakening.

- `README TypeScript examples compile and call every public function`

### `packages/snapback4/test/social-browser.test.mjs`

Environmental shared CLI replacement: Vite explicitly reported that the generated starter requested `useSeen`, which is absent from Lane B. The same mismatch is caught by the starter typecheck below.

- `social recipes in React/browser: real online signals and media, controlled read interleavings`

### `packages/snapback4/test/social-starter.test.mjs`

Environmental shared CLI replacement: generated starter/API requested Lane R `useSeen` and `ReceiptFamily`, absent from this checkout. Rebuilt this checkout with an explicit host target and copied its CLI to a private local path before rerunning.

- `published social starter and guide snippets typecheck against generated operations`

### `packages/snapback4/test/witness-acquire.test.mjs`

Environmental binary location: `current_exe()` resolves the shared target path, whose ancestors do not contain this checkout’s SDK helper. Every listed case failed with `E_WITNESS_PROCESS: install the matching snapback4 client package to run witness acquire`. A private local CLI copy restores the expected checkout ancestry.

- `acquire CLI refuses invalid arguments before connecting`
- `acquire CLI saves actual SDK acquisition and cold retained receipts across fresh runs`
- `acquire refuses unknown personas, mismatched bearer identity, unreachable servers and unknown queries`
- `serve accepts a matching bearer, refuses a different principal, and omits server timings`
- `bounds guide command and receipt excerpt execute against a small fixture`
- `reconnect proof rejects more-then-drop and records every attempted request`
- `reconnect proof rejects denied and records every attempted request`
- `reconnect proof rejects malformed-json and records every attempted request`
- `reconnect proof rejects null and records every attempted request`
- `reconnect proof rejects missing-fields and records every attempted request`
- `reconnect proof rejects bad-more and records every attempted request`
- `reconnect proof rejects behind-server and records every attempted request`
- `reconnect proof rejects dropped-first and records every attempted request`
- `reconnect proof rejects drop-once and records every attempted request`
- `reconnect proof rejects truncated-body and records every attempted request`
- `reconnect proof rejects bad-ack and records every attempted request`
- `reconnect proof rejects bad-acquisitions and records every attempted request`
- `echoed bearer and derived refusal text never reach stderr, JSON, text or receipt files`
- `witness family usage advertises both commands and shares input diagnostics`
- `receipt identifies the JSON-line subprocess host`
- `restart times coverage separately from first answer`
- `binary native module installs and survives restart`
- `binary native module digest refusal fails proof`
- `server allowlist drops raw from every acquisition output surface`
- `server allowlist drops hex from every acquisition output surface`
- `server allowlist drops HEX from every acquisition output surface`
- `server allowlist drops base64 from every acquisition output surface`
- `server allowlist drops base64url from every acquisition output surface`
- `server allowlist drops percent from every acquisition output surface`
- `server allowlist drops percentLower from every acquisition output surface`
- `server allowlist drops sha256 from every acquisition output surface`
- `caller query and args are echoed from the request, never selected schema metadata`
- `failed query receipts distinguish argument rejection, query refusal and incomplete coverage`
- `equals token spelling authenticates without exposing the bearer`
- `acquire argument refusals omit values including equals bearers`
- `runtime refusals do not echo caller argument values in stderr`
