# Lane ER: expiring mutation pages

Design: [LLP 3000.025](../../../llp/3000.025-expiring-mutation-read-prefix.rfc.md).
Base: `f39598de7febb1f3ddea45ae350b79e0bec50104`, branch
`sb4-intent/er-expiring-pages`. Rounds 0–1 were research and a small admission prototype. Round 2 implements
the accepted design; see `../../reports/20260927-er-round2.md` for qualification.
No package was published or branch pushed. Historical logs below are unchanged.

Run from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=8 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 \
  cargo test -p snapback4-lang --test expiring_mutations \
  -- --ignored --nocapture --test-threads=1
```

The latency instrument remains opt-in. Admission, disclosure, receipt and
full-slot checks now run in the normal `expiring_mutations` test target;
the device has a same-named custody and query-entry target. Round-0 build
output was local `target/` (337 MiB); no full suite ran in that round.
Round-2 logs are under `target/lane-er-round2/`.

Files:

- `model.q`: small schema and page/existence/count/point/1,024-probe programs.
- `delivered.q`: the calibration's conversation/member/run/message schema,
  with `delivered` explicitly server-only and its expiry scan before deletions.
- `published-diagnostic.txt`: the supplied package refusal, unchanged.
- `input-hashes.json`: SHA-256 of every supplied calibration evidence file;
  originals remain in `~/sb4-intent/er-evidence/`.
- `baseline.log`: two instrumentation tests before the admission prototype.
- `measurements.json`: all 36 read timings, three sweeps, 24 admission cases,
  and the live-cap/physical-count counterexample extracted from that log.
- `qualification.log`: seven research tests on the prototype, including the
  full calibration rewrite, same-id failed replay, fresh-id success, both
  stores' prediction nonexecution and the retained-ordinal oracle.
- `affected-lang.log`: the complete existing guide and prefix-read tests.
- `affected-page-admission.log`: existing simulator admission tests; old
  blanket-refusal assertions intentionally conflict with the proposal.

Validation: research 7/7, guide 86/86, prefix reads 10/10. Simulator page
admission 13/15; the two deliberate old-policy failures are
`w2_hidden_word_expansion_and_expired_populations_are_refused_at_check`
(its bound expiring page) and `w14b_expiry_rewrite_names_query_and_job_doors`
(its absent refusal). The other disclosure/admission cases pass. Reference
audit reports 518 LLP documents, 9,619 references, zero errors/unchecked.

Timing method: Rust 1.97.0, test opt-level 1, eight compilation jobs, no debug
info or incremental output. Default SQLite build, not the publication
`LIBSQLITE3_FLAGS` configuration. The SQLite store is in memory; the second
store is core `MemoryRows`, not the browser or native device adapter. One
conversation contains 0/1,000/10,000 expired 160-character messages and two
live rows for lookahead. Fixed expiry=1000, read time=2000, live expiry=9000.
No concurrent sweeper. Each operation runs 31 times; median is sorted item
15, p95 item 29 (zero based). Warm-up is not separately excluded. Loading,
schema creation and compilation are outside the timed runner call. This
shared 96-core host had load averages `28.86 47.83 32.77` at the later check;
latencies are descriptive, not cross-platform guarantees.

`Counted` delegates the actual store and records fetched row images/calls.
It uses the existing query IR under `Cut::Abort` directly through `Runner`
to measure otherwise-refused baseline scans. It does **not** claim they passed
baseline admission, nor include argument validation, transaction commit or
HTTP in these timings. Separate `Engine::mutate` tests exercise real admission,
rollback, records and commits. Raw setup writes synthesize a paused sweeper;
the live-cap witness instead uses twelve real authorized inserts in three
expiry-separated waves under `cap 4`.

Sweeping uses the actual `Engine::sweep_expired` path, at most 1,024 deletions
per call. It is one measurement per fixture, with indexes and simple column
audience partition logging, without disk fsync, assets or maintained aggregates.
It is not a prototype of sweeping inside a user mutation.

`prototype.log` preserves the initial instrument mistakes: an extra argument
caused E_INPUT; the duplicate-site fixture inserted its copy before the
lowered write; the oracle fixture left two examined units when it needed one.
All were fixture corrections, not product changes. `prototype-final.log`
records the first five passing cases; `qualification.log` adds the semantic
and calibration cases. No failed run was overwritten.
Committed tool logs trim trailing whitespace; their results and diagnostic
text are unchanged. The supplied published diagnostic is copied verbatim.

At round 0 the guide still described the shipped blanket refusal and its
normative tests were unchanged. Round 1 below revises that guide prototype;
the supervisor still owns acceptance and implementation. No wasm build,
browser/outbox/reopen qualification, Postgres measurement, new index or
same-transaction sweep prototype is claimed.

## Round 1 — 2026-09-27

Both supplied reviews were READY WITH CHANGES. LLP 3000.025 now records
those reviews, the supervisor's unchanged-engine E_BOUND ruling, the exact
LLP 3000.022 queue amendment for lane DC, the §21.9 replacement sentence,
whole-statement diagnostic boundaries, metered but non-writing view recounts,
and explicit implementation acceptance. Production sweeps at most 2,000
rows per one-second maintenance tick; the 1,024-row fixture timing above
omits those waits. `delivery_backlog_bound_sweeps_fresh_id_recovers` is the
required lane-DC queue test, not a test this lane has run.

Prototype changes: one expiry admission check on original scan identities;
no true bypass in population flow; preceding/enclosing-effect refusals;
Mutation/Job rejection before local/device query execution and native dispatch;
programs/refusal/expiry/prediction/bounds card text; and cost output naming
backlog, the examined ceiling and scan attempt, and atomic E_BOUND. The
programs card's binding-before-loop example compiles without notes. Its
module/setup prose was shortened to keep the existing documentation budget.
Related guide expectations were updated without raising that budget.
The compiler-level prefix-exists test now verifies the server rewrite and
keeps matching refused, including on the server.

All commands below run from `snapback4/` with `CARGO_BUILD_JOBS=8`,
`CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_INCREMENTAL=0` and the prompt's PATH:

| Command | Evidence / outcome |
| --- | --- |
| `cargo test -p snapback4-lang --test er_expiry_research -- --ignored --nocapture --test-threads=1` | `round1-research-final.log`: 8/8, including lost-success replay at a later expiry clock returning no historical scalar, zero execution meter, zero local query body reads for Mutation/Job, and short effect-boundary refusals. |
| `cargo test -p snapback4-lang --test guide --test prefix_reads` | `round1-lang-qualified.log`: guide 86/86; prefix initially 9/10 due to the old query rewrite assertion, updated and rerun separately below. |
| `cargo test -p snapback4-lang --test prefix_reads` | `round1-prefix-final.log`: 10/10. |
| `cargo test -p snapback4-device --test er_expiry_research -- --ignored --nocapture` | `round1-device.log`: 2/2 on memory and native SQLite, Mutation/Job and interpreted/native flags, refusal before acquisition or dispatch. This is not outbox/reopen qualification. |
| `cargo test -p snapback4 --test check er_expiry_cost -- --nocapture` | `round1-cost.log`: 1/1, checking page, prefix exists and domain count output through the real CLI. |
| `cargo test -p snapback4-sim --test page_admission` | `round1-page-admission.log`: 13/15; the same two historical blanket-expiry/refusal-wording expectations remain incompatible. |

The final admission change preserves matching's own diagnostic before the
expiry check; prefix tests exercise the combined matching/expiry case.
`round1-research.log` is the earlier seven-test run; `round1-research-expanded.log`
preserves the exposed compiler loop-name failure, fixed by using an illustrative
`row` binding. `round1-lang.log` and `round1-lang-final.log` preserve the guide
notes, size and old-wording failures; the final guide result passes all 86.
No failed output was overwritten. A preliminary edit command used the wrong
working directory and changed no files; it did not affect a test verdict.
The measured round-0 latency table remains the original 31-sample result;
round-1 instrument reruns are additional observations, not replacement data.
No full suite, custody lifecycle, queue recovery or web-byte qualification.
No push, publication, engine retry flag, receipt, meter, version or budget change.

Final reference audit: 518 LLP documents, 9,622 references, zero errors and
zero unchecked. `git diff --check` passes. The working-set link remains;
LLP 3000.025 is still Draft.
