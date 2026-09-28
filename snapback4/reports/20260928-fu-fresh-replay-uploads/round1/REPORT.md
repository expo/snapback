# FU round 1 — overload is a refusal, including under logging failure

All eight requested corrections are implemented, plus Grok's additional worker-pool admission finding and route-verifier auth check. No capacity was raised. Push and publication are prohibited for this lane; this is a local revision.

## Inputs and corrected attribution

First ran `git fetch origin && git merge origin/main`. The only conflict was the append-only journal; both entries were preserved. Merge commit `9563912e3` includes main `ddf317b139a9fa97a1dd61b21afd021a62ec1054`. Round 0 is `c5fb46198`. [inputs.json](inputs.json) records prompt/review/old-production-binary hashes. Read Astra's review in full. Grok initially contained progress notes; its completed NOT READY review was read during implementation and checked again before committing; its completed file hash is unchanged.

Round 0's connection-cap diagnosis was incomplete. There are two admission layers: 128 connections and independent bounded request-worker pools. `POST /assets` shares the 32-worker mutation pool. Grok correctly identified that a connection admitted below 128 could still hit `request.abort()` at the worker limit, with no refusal or accounting. The new regression holds 32 real mutation handlers, then sends uploads with an unfinished body: they now receive 503 without draining that body or evicting a handler. All seven worker classes take the same refusal path.

The old replay's individual resets cannot be retrospectively assigned to a specific layer: successful socket writes do not establish peer receipt, and round 0 did not count worker refusals. The new counters separate those layers. This revision does not rerun the full Clique replay or claim that an unbounded zero-wait replay will succeed. Round 0's positive settled-write replay remains its own evidence.

## Changes

- The accept thread only performs the fixed nonblocking refusal attempt and updates saturating counters. It has no print, parser, rejection worker, socket queue or body drain. Every HTTP-written, HTTP-failed and TLS-close refusal counts, including bursts previously suppressed by the one-second log gate.
- The serve loop emits cumulative connection and per-worker-pool summaries, at most one of each per second. The counters survive output failure. One process writer consumes a bounded 32-entry channel of at most 4,096 bytes per entry. Producers use `try_send`; the writer ignores I/O errors. Closed stderr cannot panic; a full pipe can stall only that writer. A successful HTTP write is explicitly best-effort, not a delivery acknowledgement.
- The static public refusal has `family: limit`, `retryable: true`, `Retry-After: 1`, wildcard CORS and exposed `Retry-After`. It contains no counts, identities, paths or data. Protected-response CORS remains unchanged. TLS closes are counted without writing cleartext or starting a handshake.
- Ordinary and generated effect workers, and the route verifier used by `startServer`, exclude retryable `E_RATE_LIMIT` from terminal auth handling. Claims take their existing retry delay; overloaded settlements also delay. Login/upload-slot refusal families otherwise remain unchanged.
- Online/local request handling and sync validate/preserve HTTP refusals before transport-failure handling. Queries and sync retry admission with jitter, four attempts and a ten-second backoff budget. Mutations retain the same ID and their existing outbox retry owner, adding jitter and `Retry-After` for overload. Existing storage/housekeeping retry timing stays unchanged. Malformed 5xx responses retain status-bearing `E_HTTP_RESPONSE` while following existing failure handling: quiet refreshes retain their answer and link; explicit failed sync takes its recovery path. Polls/probes do not mark a received overload offline. Real transport errors retain available causes; no-cause errors use neutral wording.
- Uploads validate required refusal fields and optional field types. Invalid upload/download error envelopes produce status-bearing `E_HTTP_RESPONSE`; missing/viewed outcomes require their established valid refusals. Downloads retry only explicit admission refusals. An ambiguous reset during upload or a once-view download never causes an automatic resend.

### Print-site audit

Moved diagnostics in `assets`, `serve`/request dispatch, `serve_lock`, `serve_maintenance`, `serve_adoption`, `dev_worker`, core store activation and native job fuel probing to the bounded sink. The watcher formerly called the synchronous CLI problem printer; it now formats its reports into the same sink. Dev-refusal evidence keeps its pre-existing bounded asynchronous writer and
persistence/backpressure semantics; its print macros become fallible writes on
that worker, so a closed stderr cannot abort the process. The core logger is excluded from wasm. The native device acquisition-boundary diagnostic uses the same sink too; its wasm-only print branch has no host stderr pipe and is unchanged. Remaining native Rust print macros are test/example output or CLI presentation/protocol output, rather than live HTTP request, accept or engine diagnostics. Fatal signal/panic framing in `lifecycle.rs` is a separate pre-existing raw-write path, not a print macro or overload reporter; this change does not claim to redesign fatal-signal reporting.

## Regression evidence

| Finding | Negative control | Final affected check |
| --- | --- | --- |
| Closed/full stderr | Both subprocess tests fail against the saved round-0 production binary: empty reply/abort path and blocked reply respectively. | Both pass after waiting for the summary writer to encounter the bad pipe, then checking more refusals and an admitted request. |
| Workers stop on overload | The original SDK calls the auth-failure hook and ends; generated, ordinary and route-verifier cases fail. | Each makes a second claim after the retry delay without ending authentication; both legacy auth and new limit families are exercised for effect workers. |
| Every refusal counted | Disabling `RefusalCounters::record` fails the counter test. | 100 burst HTTP replies, a closed peer/write failure and a TLS close produce exact totals. Pool tests assert per-class totals. |
| General client/sync | Both tier tests fail against the baseline SDK. | Online and real wasm local clients retain overload, retry reads/sync, keep the link online and replay one mutation ID with delayed attempts; reset/refused/no-cause cases retain their distinction. |
| Browser CORS | Chromium against the old production binary cannot read the refusal. | Chromium reads 503, the JSON and Retry-After, and its upload helper makes exactly four attempts. An uncached preflight is refused and reports a neutral transport error. |
| Download/upload envelopes | Baseline malformed-envelope and once-view retry cases fail. | Invalid 503/404/410 responses cannot become missing/viewed claims; valid asset refusals remain intact; once-view reset terminates retries. |
| Retryable test strength | Changing the actual server body to `retryable: false` fails the real upload test: 1 attempt instead of 4. | Restored server makes 4 attempts; source restored after the mutation. |
| Grok worker-pool refusal | Restoring `request.abort()` fails both new pool tests. | 32 held mutation handlers refuse excess uploads without draining; all 7 pools return the same public refusal and preserve permits. |

[negative-controls.py](negative-controls.py) runs the three source mutations sequentially and restores original bytes in `finally`. Baseline SDK sources were extracted from the merge commit into this worktree's ignored target directory. Its new suite records **15 expected failures / 2 passes**, not qualification failures. The comparative packet and other worktrees were not edited.

The browser witness uses real Chromium with CORS enforcement and the real backend. A transparent test proxy closes warm connections and, during saturation, withholds upstream request bytes to make delivery of the actual pre-parser refusal deterministic. It changes no CORS headers or response body. This isolates browser policy from best-effort TCP delivery; initial probes also demonstrated a genuine reset when bytes raced the refusal. The witness is not a guarantee that every overloaded upload receives a response. No protected response was made public.

## Validation

- Affected SDK/asset/browser/transport checks: **129 pass**, zero fail/skip. The final overload SDK scope passes **19/19**, including two additional deterministic jitter/Retry-After and ten-second-budget tests.
- Final packaged wasm overload/upload/Chromium selection: **54 pass**, zero fail/skip.
- Affected HTTP unit scope: **135 pass**, three existing ignores.
- Whole guide: **98 pass**. Package build/typecheck and ref-check pass (522 LLP documents, 9,846 references, zero errors/unchecked at that run).
- Final client regression selection: **481 pass**, including the full **317-case delivery fault matrix**, both client tiers, overload, terminal-store/credential behavior, quiet background refresh, sync and storage retry recovery. Await recipes now follow the shared decoder; the original non-overload backoff assertions remain. Actual overload jitter and the ten-second budget have separate assertions.
- Vendored counter test: **1 pass**, covering success, failed delivery, burst and TLS accounting.
- Debug and production (`panic=abort`) stderr subprocess tests: **2 pass each**. The production build uses packaged SQLite flags. These production checks were repeated after all native repairs; `inputs.json` identifies that binary. The repair also passes all **12 dev-refusal tests**.
- Native device diagnostic: the existing invalid-boundary regression fails with closed stderr and times out with full stderr before the fix; it passes both afterward. `device-stderr.py` replays this test. Final watcher/check diagnostic parity: **1 pass**. This restores its exact pre-change presentation while keeping asynchronous output.
- `scripts/test.sh`: invoked **once**, with command-local `ulimit -n 4096`, exit **1**. Exact summary: **`== 2 failure(s) in 1344 s`**; categories `cargo test`, `client tests`. Rust **4,278 pass / 18 fail / 33 ignored**; client shards **4,279 pass / 168 fail / 10 skipped**; models **79/79**; fixtures **9/9**.

All **186 failed cases** are individually classified in [FAILURES.md](FAILURES.md) and [full-suite-failures.json](full-suite-failures.json): **170 ours, repaired with affected checks; 16 baseline, reproduced on the merge commit; 0 environmental**. The single full run began before the final repairs; it remains red. No second full run or all-green full-suite claim.

Wasm rebuilt by that suite and again after the native-device print repair: **2,040,545 B raw / 593,008 B GNU file-input gzip-9**, unchanged from round 0, **711 B** below the unchanged **593,719 B** budget. Final SHA-256 `f6e97419cd2dd84e358add161caafcc7e2948953cee507b7d25927b487d4f409`. The full-run artifact had SHA-256 `17084d758fe1f2e5f9f86ea1f3c10e572ac46b441b7e2d1d3bd1dee9af200ac0`; the only byte difference is a source-line word (105 → 108 at offset 1,984,277) after the native-only diagnostic branch. `wasm.json` and `wasm-suite.json` preserve both records. No wasm budget or toolchain change; Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt. No shared tool installation.

## Failure ledger

Test/setup failure evidence is retained in the adjacent logs; logs and bulky matrix output are losslessly compressed as `.gz`. Expected negative controls are distinguished from qualification failures.

| Class | Failure | Resolution |
| --- | --- | --- |
| Baseline; expected negative | Original workers, general requests, malformed asset errors, browser CORS, and closed/full-stderr regressions (server and native-device diagnostic) fail before fixes. | Final affected checks pass. Baseline SDK: 15 expected failures; two non-auth worker controls pass. |
| Ours; expected mutation | Removing accounting, restoring silent pool abort, or flipping retryable to false fails the respective tests. | Original fixed source restored; positive real-upload control passes. |
| Ours; test harness | First stderr helper inherited its pipe reader into the child, so the closed-reader case was not truly closed. | Added `FD_CLOEXEC`, split closed/full into independent tests, reran both against old and fixed binaries. |
| Ours; test harness | New client checks initially called nonexistent `onConnectivity` and online `sync` APIs. | Use `onLink`; sync only on the local tier. |
| Ours; browser fixture assumptions | Warm browser keepalive reused an admitted connection (401 rather than 503); waiting for its lease expired the short default preflight cache; direct POST racing rejection produced `ERR_EMPTY_RESPONSE`. Toggling network conditions did not close the warm socket. | Deterministic transport control described above; final real-browser CORS/retry and refused-preflight assertions pass. The reset remains a documented best-effort outcome. |
| Ours; changed behavior assertions | Two existing adoption/saturation tests expected empty socket closes. The first failure also disconnected its test commit hook. | Assert coded 503 instead, while retaining bounded admission, original handler counts and read progress; full affected HTTP scope passes. |
| Ours; command setup | `cargo test -p tiny_http` rejects an excluded workspace dependency; exploratory reads included nonexistent paths and some truncated broad output. | Use the vendored manifest for its focused unit test; use located files and focused reads. The first isolated Rust baseline extraction also omitted include-file fixtures (18 compiler errors); copied those exact tracked files from the same commit, then the baseline probe compiled. No product claim relies on failed reads. |
| Ours; full-suite regression | `blocked_stderr_cannot_block_responses_or_later_mutations` failed because routing the existing evidence writer through the new sink changed its coupled persistence/backpressure behavior. | Keep its existing bounded worker and use fallible writes there. All **12 dev-refusal tests pass** after repair. This repair happened during the single full run, after that failure; the full-run failure is not erased. |
| Ours; full-suite test maintenance | The delivery matrix rejected changed await fingerprints and altered ordinary retry delays. | Reclassified all 158 await sites without dropping fault recipes; shared mutation-body decoding remains required. Kept the original storage retry timing and assertions; jitter applies to overload. Final **317/317 pass**. The first repair classified shared JSON as optional, causing two failures; treating mutation receipt I/O as required corrected that classification. |
| Ours; full-suite watcher regression | `w10r1b_dev_reports_the_same_cascades_as_check` failed because the asynchronous conversion changed diagnostic presentation and summary wording. | Restored the existing formatter, pluralization and hidden-cascade line on the nonblocking sink; the original test passes. |
| Ours; full-suite client regressions | Twelve further cases found malformed-5xx background publication/link changes, altered ordinary storage retry timing, and incomplete refusal fixtures. | Restore background failure behavior and storage timing; add required fields to the fixtures without changing terminality assertions. All pass within the final **481-case** selection. Every name is in the individual ledger. |
| Baseline; full suite | 16 device search cases fail with `Type { expected: "array", actual: "null" }`. | An isolated `9563912e3` source extraction reproduces exactly the same 16 names: 34 pass / 16 fail. See the individual ledger below. |
| Ours; artifact assertion | The final wasm hash equality assertion failed after the native-only branch moved a diagnostic source line. | Exactly one byte changed (105 → 108), with identical raw/gzip sizes; corrected the final fingerprint and reran overload/browser checks on the final packaged wasm. The staged whitespace check also found an extra blank line at the end of FAILURES.md; removed it. |
| Environmental | **None.** | No failure is assigned to the environment. |

## Scoped LLP audit

Used `llp-orient`, read-only, under the Snapback 4 fence. Governing context remains LLP 3000 §7 (bounded admission and private assets), LLP 2000.000 §§6/11/12, LLP 3000.019 §3.6 (temporary WAL readers and same-ID replay), and the assets/refusals guide cards. Preserve all caps, worker reservations, admitted leases, authority checks and ambiguous-effect rules. Extended the existing HTTP overload section and current guide rather than creating a design document. No contract reshape, new gate, runtime generator or publication change. Hand-off: none.

### Individual baseline full-suite failures

Each name below has the prefix `snapback4-device::device::`; all are reproduced on the isolated merge baseline. [baseline-failures.json](baseline-failures.json) verifies exact set equality.

- `search_global::forms::memory::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page` — **baseline**, reproduced.
- `search_global::forms::memory::cases::w13e_dense_1000` — **baseline**, reproduced.
- `search_global::forms::memory::cases::w13e_dense_500` — **baseline**, reproduced.
- `search_global::forms::memory::cases::w13e_grouped_cut_continues_through_9000_memberships` — **baseline**, reproduced.
- `search_global::forms::memory::cases::w13e_newest_measures_complete_page_and_opening_envelope` — **baseline**, reproduced.
- `search_global::forms::sqlite::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page` — **baseline**, reproduced.
- `search_global::forms::sqlite::cases::w13e_dense_1000` — **baseline**, reproduced.
- `search_global::forms::sqlite::cases::w13e_dense_500` — **baseline**, reproduced.
- `search_global::forms::sqlite::cases::w13e_grouped_cut_continues_through_9000_memberships` — **baseline**, reproduced.
- `search_global::forms::sqlite::cases::w13e_newest_measures_complete_page_and_opening_envelope` — **baseline**, reproduced.
- `search_global::lazy::memory::cases::w13f_clique_every_row_hits_in_1000_lanes` — **baseline**, reproduced.
- `search_global::lazy::memory::cases::w13f_dense_1000` — **baseline**, reproduced.
- `search_global::lazy::memory::cases::w13f_dense_500` — **baseline**, reproduced.
- `search_global::lazy::sqlite::cases::w13f_clique_every_row_hits_in_1000_lanes` — **baseline**, reproduced.
- `search_global::lazy::sqlite::cases::w13f_dense_1000` — **baseline**, reproduced.
- `search_global::lazy::sqlite::cases::w13f_dense_500` — **baseline**, reproduced.
