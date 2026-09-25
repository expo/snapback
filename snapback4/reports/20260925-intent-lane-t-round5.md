# Lane T: round-5 aggregate cut metadata, 2026-09-25

Addresses `t-r4.astra.md` and `t-r4.grok.md`, following `0723c1d28` on
`sb4-intent/t-read-through`.
Implementation commit: `ce769c9dc`.

## Behavior and examples

An aggregate page that exhausts authorization restores the expiry mark saved
before evaluating that row's rule. It retains every charge and the cut. Private
probe deadlines cannot enter the empty capped page's reply, and a deadline from
an earlier successful read remains intact.

The reviewer's existing form compiles and runs:

```quarry
view totals: count children by .parent.owner
  read <- exists gates[owner = .owner] and exists guards[owner = .owner] and viewer = 'service:allowed'
query pageTotals():
  return totals first 10 by .id
```

With both probe tables private, a gate due at 300 or 500, and Bob reading at
200 with `rule_probes: 1`, both replies are identical: empty data, incomplete,
not unavailable, two charged probes and the same rule-probe cut. `next_expiry`
is absent, or 700 if an earlier successful clock read established that mark.
With ample allowance, the allowed principal receives the group and its deadline.

The point-read witnesses use `totals[p]` and
`[clocks['k'].until, totals[p]]`. A cut produces an unavailable null result;
private authorization deadlines and deadlines learned during an unfinished
recount are discarded. A preceding clock deadline survives.

The inherited-only fixture has `middles read through .root` and
`children read through .middle`, with `expire at .until` declared only on roots.
`view totals: count children by .middle` with the explicit key rule
`read <- .middle = .middle` retains both `children` and `totals` in its dependency
set for empty, expired-only and live groups. A denied key rule has the same set.
No new syntax or refusal code was introduced.

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/read.rs` | Restores `row_expiry_mark` before the authorization-cut exit in `scan_consumed`, with a reference to LLP 3000.014 §5. |
| `crates/snapback4-core/src/engine/aggregate_metadata_tests.rs` | Adds native MemoryRows point-read and direct `probe_witness` dependency checks for a source with only inherited expiry. |
| `crates/snapback4-core/tests/read_verdict/mod.rs` | Registers the shortcut-boundary test module. |
| `crates/snapback4-core/tests/read_verdict/aggregate_cuts.rs` | Observes the private shortcut boundary and physical lookups, proving that each cut guard independently restores expiry or stops the lookup. |
| `crates/snapback4-lang/tests/read_through/inherited_deadline.q` | Three-level inheritance fixture with no local expiry on either descendant. |
| `crates/snapback4-lang/tests/read_through/review_cuts.rs` | Four shared scenarios for page cuts, inherited-only dependencies, live recount cuts and authorized shortcut cuts. |
| `crates/snapback4-lang/tests/read_through/review_cases.rs` | Loads and exports those shared scenarios. |
| `crates/snapback4-lang/tests/read_through_review.rs` | Registers them for SQLite and the native MemoryStore server runner. |
| `experiments/postgres/tests/read_through_review.rs` | Registers the same scenarios for PostgreSQL. |
| `JOURNAL.md` | Appends the round's changes, measurements and validation. |
| `reports/20260925-intent-lane-t-round5.md` | This report. |

## Tests and mutation controls

- `aggregate_page_cut_expiry`: the two private gate deadlines produce identical
  capped page replies, including metadata and meters, with and without an earlier
  clock. The allowed principal supplies a positive control for both probes.
- `aggregate_inherited_only_dependencies`: empty, expired-only and live groups
  retain the exact source dependency for both allowed and denied key rules.
  Both descendant tables explicitly assert no declared expiry and an effective
  expiring classification. Successful SQL point reads are complete and available.
- `aggregate_live_recount_cut_expiry`: two live finite contributions, cut after
  the first, retain only the pre-read expiry mark. Full replies agree across
  first-contribution deadlines 300 and 500. Ample allowance returns count two.
- `aggregate_authorized_shortcut_cut`: a true two-probe key rule under a one-probe
  ceiling cannot publish its private deadline. The cap and both charged probes
  survive; ample allowance returns count one.
- `authorized_aggregate_shortcut_stops_at_its_own_cut_boundary`: directly checks
  both shortcut cut guards, before later cleanup can mask their removal. An
  observed MemoryRows wrapper proves no aggregate or contribution lookup occurs
  after the cut; the expiry mark and null sentinel are also checked.
- `memory_inherited_only_aggregate_dependencies`: native MemoryRows point reads
  and direct raw probes retain the source dependency even without a local expiry
  declaration, for misses, expired-only groups and live groups.

The native MemoryStore adapter exercises the abort contract (`E_BOUND` and
unchanged meters); SQL adapters compare full capped query outcomes. The native
unit tests inspect internal runner state without adding a production API.

The page test fails against unchanged round-4 production code: 23 shared tests
pass, and `aggregate_page_cut_expiry` fails with `next_expiry = Some(300)` instead
of `None`. After the fix, all 24 shared scenarios pass on SQLite/native
MemoryStore, and all four selected native aggregate unit tests pass.

Every requested mutation was applied separately and failed its targeted test:

| Mutation | Failing witness and observation |
|---|---|
| Remove the new page authorization-cut restore | `aggregate_page_cut_expiry`: private deadline 300 survives instead of the empty expiry mark. |
| In `aggregate_source_dependency`, replace `is_expiring()` with `expire.is_some()` | `aggregate_inherited_only_dependencies`: the empty group's dependencies omit `children`. |
| Remove only `|| self.read_capped()` from the shortcut restore guard (former line 391) | Native shortcut-boundary test: private deadline 300 survives. |
| Remove only `|| self.read_capped()` from the shortcut exit guard (former line 392) | Native shortcut-boundary test: physical reads include `totals` after the cap, instead of only `gates` and `guards`. |
| Remove the failed/cut point-read restore (former line 355) | `aggregate_live_recount_cut_expiry`: the first live contribution's deadline 300 survives the unavailable read. |

All five mutations were restored before full qualification. PostgreSQL passed
26 tests (seven original read-through scenarios and 19 review scenarios), with
ignored tests explicitly enabled on the lane's isolated cluster; that cluster
was stopped afterward. `bun install --frozen-lockfile` completed with no changes.
Ref-check passed: 508 LLP documents, 9,286 references, zero errors and zero
unchecked references. `git diff --check` passed.

Before this round's build, the round-4 wasm artifact measured 1,795,984 raw /
501,788 gzip bytes. Round 5 measures 1,796,003 / 501,797 on the same Rust 1.97.0 /
wasm-bindgen 0.2.127 toolchain: +19 raw / +9 gzip for the whole artifact, with
1,203 bytes remaining under the unchanged 503,000-byte budget. No runtime
ceiling changed. The largest modified source is `engine/read.rs`, 1,435 lines.

Final full `scripts/test.sh`: **`== 0 failure(s) in 1162 s`**, exit 0.
Command: `TMPDIR=/dev/shm/sb4-intent-lane-t-tests CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh`.
The Rust step passed 3,014 tests, zero failed, 16 ignored. Client tests: 1,591
total, 1,581 passed, zero failed, ten skipped. All 80 guide tests passed. No
test was disabled or weakened for the rerun.

The first full run returned **`== 1 failure(s) in 272 s`**, exit 1, solely the
`client tests` step. The two failing tests were:

- `packages/snapback4/test/app.test.mjs`: `shared logout fences a held local rotation while signed out`;
- `packages/snapback4/test/routes.test.mjs`: `bounded invalid responses are terminal; only application GiveUp acknowledges, never infrastructure or ParkStep`.

Both failed at HTTP fetches with `ECONNRESET`, outside the changed aggregate
path. The two affected files then passed together with client files serialized:
91 passed, zero failed, without source changes. Classified as environmental
transient connection resets, not baseline failures or waived test results.
The baseline tail was checked: its recorded failure was the Rust step, and its
client tests passed. The final full run uses the script's supported
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` setting. The first run's Rust tests and
all 80 guide tests passed. Intentional pre-fix and mutation failures are listed
above; no unrelated product or test change was made.

Logs: `~/sb4-intent/lane-t-r5-{before,targeted,core,pg,mutations,ref-check,test,client-recheck,test-final}.log`
and the five `lane-t-r5-*-mutant.log` files. Both full runs used the same
production and test sources; only client-file scheduling changed.

## Decisions and remaining work

The only production change is the requested page-cut restoration. The existing
LLP §5 contract already requires restoration while retaining charges and cuts;
there is no new design decision. The page keeps its established partial-page
contract (`complete: false`, `unavailable: false`). Unavailable scalar reads keep
their existing null contract. Runtime ceilings and backlog charges are unchanged.

The shortcut guards are tested internally because outer and later restorations
otherwise mask removal of either guard separately. No new production inspection
API, store format, cursor format, sync/device feature, guide rewrite, push or
publication is introduced. There are no deviations from the requested behavior
and no requested fixes remain open. The only engineering choice beyond the brief is
the internal boundary witness needed to distinguish the two shortcut guards.
