# FH round 6 — integrate UA, RS and QJ

Work is confined to eb1000 (`expose-builder-pixel`) and
`/home/ccheever/sb4-intent/lane-fh`. No push or publication.

The reviewed FH parent is `3d02cc7208038acffaac270880a3a5fdd49e5a12`.
Fetched and merged `origin/main` at
`4a0dded93fd7dc2191ae2f7d11eba1a6951814a8`, including UA `a0eafab66b`,
RS `0945fec860` and QJ `4a0dded93f`. This is a merge, not a rebase.
Both round-5 reviews are READY; Astra's detailed evidence was also read.

## Conflict dispositions

| File | Resolution |
| --- | --- |
| `packages/snapback4/src/app-client.ts` | Kept both import lines: Following's guard/notification and UA's asset progress forwarding. The mutation admission fence, original mutation promise, and UA's `assetReader`/`readAsset` method all remain. |
| `packages/snapback4/src/client.ts` | Kept both import lines: Following transport binding and UA asset progress. Shared POST dispatch still carries OA's arm metadata and Following's abort signal. |
| `packages/snapback4/test/delivery-fault-instrument.mjs` | Retained both FH and UA await classifications and their test rationale. No fault recipe changed. |
| `packages/snapback4/test/delivery-await-boundary.json` | Regenerated from the combined source, then checked with the classification test. Neither parent's stale count/hash was selected. |
| `llp/3000.033-read-only-client-mode.rfc.md` | Combined the `Revised` header entries. RS's refusal-storage rules and FH's named read-only refusal both remain. |
| `JOURNAL.md` | Retained both sets of appended entries; added this round's result separately. |

The other shared files merged without conflict. `react.tsx` keeps both
`useFollowing` and UA's complete `useAsset` diagnostics/lifetime path;
`local.ts` keeps Following's own-write fence and server transport beside
UA's media/refresh/download progress. The online app journal continues to
forward Following privately. Read-only Following remains `E_READ_ONLY` without
an HTTP history request; ordinary inbox reads and read-only asset behavior
retain their existing authority rules.

RS's `store.rs` is byte-identical to main except for the appended
`mod following_history`; `engine/mod.rs` differs only by the SQLite-gated
Following module export. All opening, selected-release checks, transactional
upgrades, no-checkpoint-on-refusal behavior, lazy `_read_sessions` creation,
and native recovery code are main's implementation. Following's store helper
only performs bounded reads inside an existing transaction; it neither opens
stores nor installs schema. The actual FH engine/controller and SDK state
machine are unchanged from the reviewed parent. QJ's starter implementation
and tests are retained. [Source comparison](merge-proof.json).

## Governing context

Applied `llp-orient` to the shared client and opening paths. The binding
constraints are [LLP 3000.026 §9](../../../../llp/3000.026-following-over-a-populated-store.rfc.md#9-exact-on-demand-history-design-handoff)
(exact frozen history, server custody, current authority, client fences),
[LLP 3000.033 §1.2–1.3](../../../../llp/3000.033-read-only-client-mode.rfc.md#12-the-server-guard-a-closed-allow-list-before-dispatch)
(read-only allow-list and unchanged stores on refusal), and
[LLP 3000.008.002.000 §6](../../../../llp/3000.008.002.000-common-client-patterns.rfc.md#6-ephemeral-activity-and-media-interactions)
(asset ownership, transport/host classification and progress diagnostics).
The feeds, client and assets guides were checked against those integration
points. No new architectural decision or completeness claim is introduced.

## Verification

Commands, exit status, CPU affinity and duration are recorded by
`run-check.py` in each check's JSON receipt and log. Cargo uses eight jobs,
debug information disabled, no incremental compilation, and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. A sampled idle set of
24 CPUs confines all builds/tests with `taskset`; the client pool uses four
workers for focused checks and the full suite's default eight workers.

| Check | Result | Evidence |
| --- | --- | --- |
| Core Following, both ignored scale cases enabled | 27 passed | `affected-native.log.gz` |
| Language history / research / guide | 10 / 3 / 113 passed | `affected-native.log.gz` |
| CLI serve filter, including timeline and read-only | 203 passed, four existing ignores | `affected-native.log.gz` |
| Following certificates | 3 passed | `affected-native.log.gz` |
| RS device/SQLite capability and refusal matrix | 8 passed, including retained WAL and recovery rollback | `affected-native.log.gz` |
| Core bound session, identity, read sessions and schema capabilities | 25 passed | `core-authority.log.gz` |
| PostgreSQL refusal matrix, ignored cases enabled | 4 passed, private socket-only cluster stopped | `postgres-refusals.log.gz` |
| Following history / React hook | 18 + 4 passed, one manual measurement skip | `affected-clients.log.gz` |
| Explicit HTTP/SDK scale measurement | 1 passed, both corpora | `following-http-scale.log.gz` |
| OA app online arm | 32 passed | `affected-clients.log.gz` |
| UA assets, React and read types | 250 passed | `affected-clients.log.gz` |
| RS Linux shared refusal fixtures / original capability fence | 3 / 3 passed, seven Darwin-only skips | `affected-clients.log.gz` |
| Ten read-only client files | 118 passed, one optional published-engine skip | `affected-clients.log.gz` |
| Client build, typecheck, await classification | Passed | `client-types.log.gz` |
| Docs budget / LLP references | Passed; zero reference errors or unchecked refs | `docs-budget.log.gz`, `ref-check.log.gz` |
| Full suite | Passed, exit 0, 2,490.281 seconds | `full-suite.log.gz`, `full-suite.json` |

The focused client run totals 428 passes and nine labelled skips. The manual
Following measurement was subsequently enabled and passed. The initial native
command named a nonexistent `bound_sessions` target after its preceding five
commands had passed. The corrected `bound_session` command ran the complete
remaining authority group successfully. This is a command correction, not a
product-test failure; both original and corrected logs are retained.

The full `bash snapback4/scripts/test.sh` run is green: 313 native test
binaries / 1,026 executions and doctests, all 343 client files (6,736 tests
passed, 56 labelled skips), nine fixture tests, and all 79 serial model tests.
All build, budget, release-guard and typecheck stages passed. There were no
full-suite failures or reruns. Neither the known
`20261004-snapback4-native-witness-proc-group-inspection` failure nor round 5's
`20261007-snapback4-export-retention-lock-drain-timeout` recurred. This green
run does not close either intermittent-issue ticket without a causal fix.

All 2,039 recorded runtime/test/guide/build inputs in `source-sha256.json`
were unchanged through the focused and full runs. The logs are retained
losslessly as gzip; `log-archive.json` records original and compressed hashes.
The only unsuccessful verification command was the corrected target-name typo described
above. Darwin-only tests and the optional previous-published-engine control
were not executed here.

## Scale and wasm

The native shaped-page medians below cover seven samples. All per-request
meters remain asserted by the tests. These are shared-host observations,
not isolated performance qualifications.

| Corpus | First page | Later page | Preparation requests | Maximum session storage |
| --- | --- | --- | --- | --- |
| Sparse 50,000 posts | 1.655 ms | 1.577 ms | 0 | 299,636 B |
| 8,200 follows | 201.806 ms | 1.343 ms | 5 | 17,288,752 B |

The explicit HTTP/SDK check observed 44.42 ms to the sparse first page and
317.60 ms for 8,200 follows, with zero and five preparation requests
respectively. Later HTTP pages ranged from 20.28 to 33.30 ms. Raw request
sizes and native meters are retained in the scale logs and summary JSON.

Linux wasm is **2,135,336 B raw / 645,307 B gzip**. SHA-256:
`7cd5e44fae55810e523ae10ee19ee2f11f926466ea7eaaef26296d1d9fb51c9b`.
It is identical to round 5 and to the artifact used by the focused client run.
The unchanged **645,607 B** cap is Linux plus the requested **300 B** allowance.
`wasm-measurement.json` records the comparison; no budget increase is needed.

## Persisted bytes and resources

This merge adds no FH persisted bytes, table, catalog encoding or device
traversal. It imports RS's already-landed lazy auth-table creation and atomic
physical-upgrade behavior unchanged. Following still uses volatile server
custody and the existing timeline bytes; the inbox certificate is unchanged.
Darwin qualification is left to the operator as requested.

Node 24.13.1, Bun 1.3.14 and Rust 1.97.0 were used. Total disk use was
28,534,386,688 B (28.54 GB), including 24,539,127,808 B in the one Cargo target,
below 50 GB. PostgreSQL 16.15 was extracted into this worktree's ignored
target directory, used through a private Unix socket with no TCP listener,
and stopped after its four refusal tests. No other worktree or process was
modified. `environment.json` records versions, resource use and shutdown.
