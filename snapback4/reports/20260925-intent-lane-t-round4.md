# Lane T: round-4 aggregate reply metadata, 2026-09-25

Addresses `t-r3.astra.md` and `t-r3.grok.md`, following `02469ea82` on
`sb4-intent/t-read-through`. The author's ruling keeps authorized backlog work
metered and makes aggregate source dependencies constant.
Implementation commit: `f4faf0c00`.

## Behavior and examples

A keyed read of an aggregate over an expiring source registers that source in
`tables` before occupancy or authorization is discovered. Empty, expired-only,
live and denied groups therefore carry the same invalidation dependency.
Rule probes register it at the same boundary, even when called directly without
precomputed rule dependencies. Scans also register the source before discovering
any group. The conditional insertion inside the live recount is removed.

For `view totals: count children by .parent`, `totals[p]` always names `children`
and `totals` in `tables`, whether it yields zero, a live count, null or a metered
cut. A rule using `exists totals[parent = .parent]` also registers both tables.

Denied authorization restores the `next_expiry` saved before the synthetic
shortcut. The actual-row denial path uses that same boundary. Errors and cuts
preserve work and exhaustion while discarding deadlines learned inside the
failed read; a deadline established by an earlier successful read survives.

The reviewer's rule
`read <- exists gates[parent = .parent] and viewer = 'service:allowed'`
returns the same denied reply to Bob when the private gate is absent, due at
300 or due at 500, queried at time 200. A successful earlier clock read due at
700 keeps `next_expiry = 700` in all three worlds. The allowed principal still
gets the live count and the gate's deadline.

Authorized recounts charge every visited contribution, including expired ones.
A 40-row expired backlog costs 41 examined rows for a point count, and cannot
complete at an examined ceiling of 16; an empty group costs one. Denied readers
get identical data, metadata, meters and availability in both worlds. LLP §5
and the maintains card record this accepted cost channel and the role of sweeping.

## File-by-file changes

Paths below are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/read.rs` | Centralizes schema-derived expiring aggregate dependencies; registers them before reads and raw probes; moves the expiry mark before synthetic authorization and restores it on denial and failure without refunding charges or cuts. |
| `crates/snapback4-core/src/engine/live_aggregate.rs` | Registers the source at the wrapper's entry; removes occupancy-dependent registration inside the recount. Work charges and I53 range checks remain. |
| `crates/snapback4-core/src/engine/mod.rs` | Registers the native in-memory metadata unit tests under the same SQLite/test gates as the neighboring native test module. |
| `crates/snapback4-core/src/engine/aggregate_metadata_tests.rs` | Exercises native MemoryRows metadata and raw probes directly, without adding a production API for test inspection. |
| `crates/snapback4-lang/tests/read_through/review_cases.rs` | Loads the new shared scenarios, provides expected-query-refusal support, and updates denial expectations to include the source unconditionally. |
| `crates/snapback4-lang/tests/read_through/review_metadata.rs` | Shared metadata, gate-expiry, page-recount, signed-sum and backlog-meter scenarios. |
| `crates/snapback4-lang/tests/read_through_review.rs` | Runs the shared scenarios on SQLite and the native MemoryStore server runner; captures expected query refusals. |
| `experiments/postgres/tests/read_through_review.rs` | Runs the same scenarios and expected refusals on PostgreSQL. |
| `crates/snapback4-lang/src/guide/maintains.md` | Documents constant dependencies, denied expiry restoration and the accepted metered backlog cost. |
| `../llp/3000.014-a-child-reads-through-its-parent.rfc.md` | Records the backlog-cost decision in one sentence in §5 and the reply-metadata contract beside it. |
| `JOURNAL.md` | Appends this round's changes, validation, measurements and non-claims. |
| `reports/20260925-intent-lane-t-round4.md` | This report. |

## Tests and controls

- `aggregate_tables_constant`: empty/expired/live groups, authorized and denied
  readers, ordinary and read-through sources, plus rule probes of the aggregate;
  asserts exact dependency sets and identical complete denied SQL replies.
- `aggregate_denied_gate_expiry`: the three gate worlds on synthetic, stored-value
  and ordinary aggregate authorization; checks preservation of an earlier read's
  expiry, an allowed-principal positive control, and cuts with no probe allowance.
- `ordinary_expiring_page_recounts`: a non-read-through aggregate page returns
  two contributions at time 100, one at 200, then no group at 400; checks expiry,
  dependencies, completeness and availability.
- `authorized_expiring_sum_overflow`: both positive and negative signed limits;
  a cancelling contribution expires and the now-authorized live sum refuses
  `E_OVERFLOW` rather than emitting an out-of-range I53 value.
- `authorized_expired_backlog_stays_metered`: 0 versus 40 expired contributions;
  authorized work and cuts remain charged, while denied replies stay identical.
- `memory_aggregate_point_and_raw_probe_dependencies_are_constant`: native
  MemoryRows point metadata and direct `probe_witness` calls, including misses.
- `memory_denied_aggregate_restores_probe_expiry`: native MemoryRows synthetic
  and stored-value denials preserve an absent or pre-existing expiry mark.

Against unchanged round-3 production code, five current regressions fail:
`aggregate_tables_constant`, `aggregate_denied_gate_expiry`,
`authorized_expired_backlog_stays_metered`, and both existing aggregate denial
metadata/work scenarios after their expected dependency set was updated.
All six separate mutations fail their targeted tests:

| Mutation | Failing witness |
|---|---|
| `scan_consumed` returns the stored group without a live recount | `ordinary_expiring_page_recounts` (missing live expiry at 100; the same test asserts live values after expiry) |
| Remove the former `read.rs:455` expiry restoration | `aggregate_denied_gate_expiry`, stored authorization with the private gate due at 300 |
| Restore the former conditional `live_aggregate.rs:66` source insertion and omit registration before lookup | `aggregate_tables_constant`, empty group lacks `children` |
| Remove registration at `probe_witness` entry | Native MemoryRows raw-probe test, empty group lacks `children` |
| Remove the live I53 range check | `authorized_expiring_sum_overflow`, live overflow no longer refuses |
| Remove synthetic-shortcut expiry restoration | `aggregate_denied_gate_expiry`, synthetic authorization with the private gate due at 300 |

Every mutation was restored before qualification. Logs are
`~/sb4-intent/lane-t-r4-negative-controls.log`, `lane-t-r4-mutations.log` and
`lane-t-r4-*-mutant.log`.

Focused review tests: 20 passed on SQLite/native MemoryStore; two direct native
MemoryRows metadata unit tests passed. PostgreSQL: 22 tests passed (seven
read-through scenarios and 15 review scenarios), with ignored tests explicitly
enabled on the lane's isolated cluster. Ref-check passed with 508 LLP documents,
9,285 references, zero errors and zero unchecked references. `git diff --check`
passed. Full-suite qualification below includes the guide and existing suites.

## Decisions, measurements and failure accounting

The source dependency now remains present on denied reads, intentionally
replacing round 3's tests that expected it absent. Existing source charges,
runtime ceilings, authorization and the expiring value-rule refusal remain.
The broader scan entry uses the same dependency helper because source writes
can invalidate an empty page too. No store or cursor format changed. No sync or
device feature, broad guide rewrite, push or publication was added.
No requested fix is deferred and no review reproduction remains open.

The round-3 artifact, remeasured before this round's wasm build on the same
Rust 1.97.0 / wasm-bindgen 0.2.127 toolchain, was 1,795,777 raw / 501,638 gzip
bytes. Round 4 is 1,795,984 raw / 501,788 gzip: +207 raw / +150 gzip, a
whole-artifact comparison without individual component attribution. The
503,000-byte size budget is unchanged, with 1,212 bytes headroom. Runtime
ceilings are unchanged.

Final full `scripts/test.sh`: **`== 0 failure(s) in 428 s`**, exit 0.
Command: `TMPDIR=/dev/shm/sb4-intent-lane-t-tests CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 scripts/test.sh`.
Rust: 3,008 passed, zero failed, 16 ignored. Clients: 1,557 total, 1,547
passed, zero failed, ten skipped. All 80 guide tests passed. The isolated
PostgreSQL cluster was stopped after its 22 passing adapter tests.

The first full run returned **`== 1 failure(s) in 481 s`**, solely the
`client tests` step. Both failing tests were ours, in
`packages/snapback4/test/wasm-codec-census.test.mjs`:

- `web-reachable typed JSON calls all use the codec funnel`;
- `census kills parse, encoded, MQ components and container regressions`.

The new native unit module used the same cross-crate serde round trip as the
neighboring native tests, but lacked their SQLite feature gate. The source
census consequently treated its test-only calls as web-reachable. Adding the
same `cfg(test)` / `cfg(feature = "sqlite")` module gates fixed both without
changing the census or adding an allowance. All 26 census checks passed in the
targeted rerun. The first full run's Rust tests all passed.

An initial shared test fixture also reused a moved `Context`; cloning it for
the optional SQL observation fixed that compile error before qualification.
The other red runs were intentional regression controls and mutations listed
above. No baseline or environmental failure was waived or repaired.

Logs: `~/sb4-intent/lane-t-r4-{before,focused,memory,pg,census,ref-check,test,test-final}.log`,
plus the negative-control and mutation logs named above.
