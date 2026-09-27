# DS round 4 — integration with current main

Date: 2026-09-27. Branch: `sb4-intent/ds-delivery-server`.
Fetched and merged `origin/main` at `51b318c63c622b8e93413de42328d9b41354bc3c`
into round-3 head `a36e9221a179ece9e2ecb3c64386bdc061f36de5`, in merge
commit `db46bfe6d`.
Regression coverage is committed separately as `36a2e09fb`.
Read rounds 0–3 prompts, reports and DS journal entries. This is preparation
for the supervisor’s DS + DC landing. No push or publication.

## Merge resolutions

All paths here are relative to `snapback4/`.

| File | Resolution and preserved behavior |
| --- | --- |
| `JOURNAL.md` | Concatenated both sides at each of the two append conflicts. A line-subsequence audit proves every line of both parent journals survives in its original order; no old entry was rewritten. |
| `crates/snapback4-core/src/error.rs` | Kept two separate match arms: DS’s SQLite-gated `E_DELIVERY_BINDING` site/rewrite/receipts guide and GS’s server-search-gated `SearchOpening` site/rewrite/search guide. Each retains its original feature boundary. |
| `crates/snapback4-lang/src/guide/receipts.rs` | Combined the SDK/seen explanation with ER’s referral to `guide sequences` for expiring messages and engine allocation. Kept the accepted SDK Owing/Waiting protocol and the other session’s `RUNS_FULL` behavior, which DS also implemented. The obsolete hook delivery prose cannot coexist with the accepted SDK reporter; the hook still owns `seen`. Both original histories remain in Git and the journal. |
| `crates/snapback4-lang/tests/guide.rs` | The two parents independently require the same 65th-run refusal. Kept main’s `failed(&full) == "RUNS_FULL"` assertion plus unchanged zero-event and `sent` assertions; subsequent merge/freed-slot coverage remains. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Kept all DS delivery definitions and SDK/seen checks, all GS search definitions, and all three ER wording tests as separate functions. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Kept both delivery and search recovery-action entries. |

No report conflicted; both sides’ report files remain. Incoming recorded logs
and reviews have existing whitespace findings; their historical evidence is
preserved verbatim, rather than edited to clean `git diff --check HEAD`.

## Audit of automatically merged code

- `engine/read.rs` is byte-identical to the fetched main. It stamps only after
  authorization, expiry, disclosure and sequence materialization; the final
  manifest walks surviving output images, so filters and lookahead candidates
  cannot be reported. CQ’s cursorless bound stops before another fetch; mutation
  scans retain aborting attempt/lookahead semantics.
- `engine/membership_search.rs` is byte-identical to main. Its authorized,
  materialized emitted hit passes through `stamp_source`. Compact head scans
  may produce transient metadata, but their keys are not emitted row images.
  The regression covers actual-size and expiring selected-field paths,
  overlapping search words, hidden/expired/tombstoned candidates, successive
  aliases and membership revocation before continuation.
- `engine/runner.rs` keeps DS’s supplemental tracking and field/variable origins,
  plus GS’s compact-page ownership, heap/refusal boundary and caller reservation
  state. CQ’s discovery-loss flags remain separate from declared bounds.
- `engine/mod.rs` retains manifest construction and no-op receipt custody,
  CQ’s direct `value_source_incomplete` veto, and FA’s release/adoption
  dispatch. The new `new_release_with_feed_adoption` implementation still
  prepares delivery lookup before activation; its wrapper forwards to it.
  ER’s entry/admission checks and TK’s existing session handling survive.
- `engine/local.rs` retains ER’s query-kind guard and CQ’s completeness veto;
  server delivery fields stay absent on device outcomes.
- `engine/postgres/through.rs`: the original DS optional adoption-report
  `None` argument and main’s cherry-pick `3fade730c0` collapse to one argument,
  with no conflict or double call. The round-3 delivery lookup preparation
  remains exactly once beside contribution-index preparation. No additional
  adoption fix is needed.

## New regression files and forms

`crates/snapback4-lang/tests/delivery/integration.q` supplies one compiled
fixture with membership authorization, immutable delivery coordinates,
expiry, overlapping-word search and the admitted server read prefix.
`crates/snapback4-lang/tests/delivery_integration.rs` adds three tests:

1. `compact_membership_search_reports_only_authorized_emitted_images`: two
   authorized emitted images produce exactly `[["r2",2],["r1",2]]`, despite
   newer hidden/expired/tombstoned candidates and multiple matching words.
   Returning only successive aliases still retains coordinates. Revoking r2
   before continuation leaves only `[["r1",1]]`. Runs both with and without
   expiry, and compares data, ordinary meters, completeness, cuts, continuation
   presence and expiry against an otherwise identical schema without delivery.
2. `cursorless_page_stamps_its_exact_bound_without_lookahead`: `first 2` with
   exactly two examined units returns two images and a complete answer,
   without reading the physically present third row. A one-unit ceiling
   returns only the first image and an incomplete answer. A denied scope
   reports no rows. The delivery-enabled and ordinary answers/meters agree.
3. `admitted_expiring_scans_keep_query_delivery_out_of_mutations_and_replay`:
   a query skips a physically retained expired row and reports only positions
   1, 2 and 4. The same read in a `: server` reporter returns live rows without
   delivery stamps, keeps a receipt-only no-op at the committed head, and
   replays without reading or returning historical images. A bound refusal
   writes nothing, keeps the head, and replays the same refusal; a denied
   scope returns no rows. Ordinary mutation work matches the untracked control.

Representative forms (all compiled and executed by the fixture):

```quarry
query newest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.room, viewer] last 2 by .at after c {alias: .body} {alias}

query plain(room: rooms):
  return messages where .room = room first 2 by .ordinal {alias: .body} {alias}

mutation delivered(group: rooms, low: int, high: int)
  reports delivery of messages by .room, .ordinal: server
  require low <= high else NOT_A_RUN
  page = messages where .room = group and .ordinal >= low and .ordinal <= high first 3 by .ordinal
  return page
```

The fixture reporter isolates the platform boundary; its body is not a
production coverage implementation. The receipts/sequences cards retain
actual coverage logic. No new syntax or wire field is introduced. DC still
sends `{id, args, store_id, delivery: {fingerprint}}`; the digest and compiled
binding/manifest formats are unchanged from round 1.

## Design context

Scoped `llp-orient` used the available skill from the GS checkout because this
worktree’s vendored skill symlink is uninitialized. Governing references:
LLP 3000 §4 (fence), LLP 2000.000 §6 (meters/disclosure), LLP 3000.022 §§2, 5,
6 (delivery and receipts), LLP 3000.024 §3/Decision (compact search), LLP
3000.025 §3 (initial read-only server mutation prefix), LLP 3000.027 §2
(cursorless query bounds). LLP 3000.021 §3.2 is amended by 3000.022 §8.
Read the current receipts, sequences, programs and search cards before edits.
No protocol design changed, no new LLP is needed, and no hand-off is pending
except the already assigned integration budget ratchet.

## Validation

Restored-source focused checks pass: 16 existing delivery tests, 3 new
integration tests, 5 clause tests, 2 replay/fingerprint tests (the optional
cost benchmark remains ignored), 3 provenance tests, all **90 guide tests**,
3 internal delivery lookup/heap tests, and all 6 HTTP delivery tests.

Three deliberate production mutations each fail their new regression:

| Mutation | Discriminating failure |
| --- | --- |
| Remove only GS’s emitted-row `stamp_source` call | The projected search result’s manifest loses its emitted coordinates. |
| Restore CQ’s cursorless lookahead by disabling `stop_at_bound` | The exact two-row examined allowance is exceeded and the examined-debit assertion fails. |
| Remove delivery’s `Cut::Cap` guard | The admitted server mutation returns stamped rows, violating query-only collection. |

`round4/mutations.py` reproduces these controls and restores each source file
byte-for-byte in `finally`. Run it only with no other build using this
worktree. `round4/mutations.json` and `mutant-*.txt` retain the failures.
Final focused tests were rerun after restoration.

The frozen Bun install passes. Reference audit: `ref-check: ok — 521 LLP docs,
9698 refs in 27579 files, 0 errors, 0 unchecked`. All Rust source files are
at most 1,500 lines. Both parent journals survive in order; all 2,669 main
report files and all 2,564 DS report files were byte-identical to their
parents immediately after resolution (`journal-audit.json`, `report-audit.json`).
The historical DS landing report pointer is updated separately in `REPORT.md`.

All three PostgreSQL delivery regressions pass; each executes both
**Serialized and Serializable** write modes. They cover adopted round-trip
schemas, cleared bindings on warmed clones, manifest/receipt-only behavior,
fingerprint refusal and replay. PostgreSQL 16.15 binaries were copied from
existing local tools into ignored `target/ds-pg-tools`; the cluster was
socket-only under this worktree, and was stopped before the full suite.
Evidence: `round4/postgres.txt` and `postgres-setup.txt`.

The full suite uses Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.13.1 and Bun
1.3.14, with no `wasm-opt` on PATH. Exact command from `snapback4/`:

```sh
CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=4 scripts/test.sh
```

The unoptimized integrated artifact is **1,983,605 B raw / 573,716 B gzip**,
SHA-256 `5a15e533a42a5f199fe04ccfecbbc5c87d93d641fbc3d357915219f91809ec00`.
It exceeds the unchanged **572,841 B** budget by **875 B**. Relative to DS
round 3’s pre-merge artifact, that is −1,780 raw / +451 gzip bytes; this is a
whole-merge comparison, not a DS-only code attribution. This round adds no
production read-path implementation, and both the wasm script and budget are
byte-identical to the fetched main (`round4/unchanged-audit.json`). No optimizer
was used. The integration ratchet remains the supervisor’s work, as instructed.
Reproduce with `bash scripts/build-wasm.sh` and no `wasm-opt` on PATH.

Full Rust validation passes in **1,305 s**: **257 test binaries, 970 target
executions, 4,095 passed / 0 failed / 30 ignored**, plus passing doctests.
Chat and Expo typechecks and fixture-wrapper tests pass. The script’s original
60-second budget is unchanged; the measured duration is reported honestly.

Client tests pass in **198 s**: **2,700 passed / 0 failed /
10 skipped** across the main process and seven shards.
The main process reports 2,644 passes; the shards contribute 56.

All **78 seeded client models pass**, zero failures or skips, in **262 s**.
`scripts/test.sh` ran **once**, exited **1**, and printed exactly:

```text
== 1 failure(s) in 1844 s
   wasm build
```

**Every full-run failure:** `wasm build` is **ours**, the carried DS integration
budget failure: 573,716 gzip bytes exceeds 572,841 by 875. It remains assigned
to the supervisor’s single LLP 3000.022 ratchet at DS + DC integration. There
are **no baseline or environmental failures** in this full run. Every other
phase passed; no test count, timeout, skip policy or ceiling was changed.

Evidence: `round4/full-suite.log.gz`, `full-suite.exit`, `suite-summary.json`,
`wasm.json`, `focused.txt`, `core.txt`, `http.txt`, `postgres.txt`, the three
mutant logs, and the audit/summary JSON files. The sole remaining open problem
is reproducible with `bash scripts/build-wasm.sh` without `wasm-opt`; it has
no new DS runtime fix assigned in this round. No other integration defect
remains open.

## Development corrections and scope

Before the full suite, two new fixture assertions failed (**ours**): the
manifest follows emitted-image order, rather than sorting groups, and a
capped ordinary meter records its failed attempt above its ceiling. Corrected
those expectations; the exact-bound case still pins two examined rows and is
mutation-proven. The initial combined card lead had three sentences; the
whole guide rejected it (**ours**). Reworded it into two sentences under 45
words, retaining SDK responsibility and ER’s sequences referral; the whole
guide passes without changing any targets or fact pins.

The first HTTP filter used `serve_tests::delivery` and selected zero tests.
Corrected it to the actual `serve::tests::delivery_tests` module by running
the just-built test executable with `delivery_tests`; all six pass. The empty
selection is retained as `http-empty-filter.txt`, not counted as validation.

No runtime correction beyond merging both parents was needed. New code is
regression coverage; no runtime meter, binding/interface, package version,
device collector or client queue changed. No shared tool installation,
budget increase, push or publication. The only planned exception remains the
supervisor’s integration ratchet for LLP 3000.022.
