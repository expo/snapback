# Lane ER: expiring mutation pages

Design: [LLP 3000.025](../../../llp/3000.025-expiring-mutation-read-prefix.rfc.md).
Base: `f39598de7febb1f3ddea45ae350b79e0bec50104`, branch
`sb4-intent/er-expiring-pages`. Research and a small admission prototype,
not a shippable implementation. No package was published or branch pushed.

Run from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=8 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 \
  cargo test -p snapback4-lang --test er_expiry_research \
  -- --ignored --nocapture --test-threads=1
```

The seven explicit research tests are ignored in ordinary suites. The
instrument is `crates/snapback4-lang/tests/er_expiry_research.rs`. No JS tests
or Bun dependency install are needed. Build output is local `target/` (337 MiB
after the initial experiment); disk was checked before building. No full
Cargo suite ran and no other lane's output was deleted.

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

The existing guide still describes the shipped blanket refusal. This branch
does not update it or its normative blanket-refusal tests: the supervisor
owns acceptance, implementation scope and independent review. No wasm build,
browser/outbox/reopen qualification, Postgres measurement, new index or
same-transaction sweep prototype is claimed.
