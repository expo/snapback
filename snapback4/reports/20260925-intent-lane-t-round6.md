# Lane T: round-6 provisional read deadlines, 2026-09-25

Addresses `t-r5.astra.md` and `t-r5.grok.md`, following `d81b99fc0` on
`sb4-intent/t-read-through`.
Implementation commit: `5c2167257`.

## Behavior and examples

Deadline publication now has one ownership mechanism. Every point read and
page candidate starts a provisional scope. Authorization, private rule probes,
parent resolution and live aggregate recounts note deadlines in that scope.
Dropping a scope discards those deadlines; explicit emission joins them into
the enclosing answer. Neither operation changes charges or cuts. Nested scopes
also cover page errors and incomplete scalar aggregates.

Prefix authorization and candidate preparation return opaque pending deadlines.
They cannot publish them: a prefix needs an emitted row, and an admitted
candidate still has to pass filtering, lookahead and retention. Point reads
commit after successful completion; authorized aggregate zero remains an
answer. A partial page retains deadlines of its emitted rows, while a later
denied or cut candidate contributes none. Removed the old individual expiry
snapshots/restores from point reads, synthetic authorization, per-row page
authorization, prefix decisions and the parent resolver.

The reviewer's existing forms compile and run; no new syntax is introduced:

```quarry
view totals: count children by .parent.owner
  read <- exists gates[owner = .owner] and exists guards[owner = .owner] and viewer = 'service:allowed'
query point(owner: principal):
  return totals[owner]
query pageTotals():
  return totals first 10 by .id
```

With a live child, private gate due at 300 or 500, and a guard, reading at 200
as `service:allowed` under `examined: 1` produces the same unavailable null
point and page replies. The private deadline is absent. Ample allowance emits
count one and the gate deadline. A preceding successful clock read due at 700
keeps its deadline when the following aggregate read cannot finish.

The uniform-prefix program uses:

```quarry
table docs:
  body: text <=100
  by search: words(body), id
  read <- exists gates[owner = viewer] and exists guards[owner = viewer]
query page():
  return docs first 10 by .id
query words():
  return docs matching 'hello' first 10 by .id
```

At `rule_probes: 1`, the absent-gate, gate-300 and gate-500 worlds have identical
empty capped replies, both with and without a document. The rule still charges
two probes. With ample allowance, a matching emitted document carries its gate
deadline; an empty page carries none. The fixtures also exercise a preceding
clock, a filtered-out aggregate row and an aggregate page's lookahead.

For two aggregate groups, Alice's first row has deadline 300; authorization of
Bob's second row cuts on the fourth probe under `rule_probes: 3`. Bob's deadline
can be 250 or 500. Both partial replies retain only Alice's row and
`next_expiry = 300`, with the same charges, cut and dependency tables.

## File-by-file changes

Paths are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/expiry.rs` | New provisional scope, pending token and emission primitive; default drop discards; debug assertions enforce nested ownership. |
| `crates/snapback4-core/src/engine/read_candidate.rs` | Prepares an authorized, recounted candidate and its pending deadline without publishing either deadline early. |
| `crates/snapback4-core/src/engine/read.rs` | Scopes point reads, page candidates and containing reads; defers prefix deadlines; commits retained rows/complete answers; removes redundant expiry restores. |
| `crates/snapback4-core/src/engine/runner.rs` | Stores the deadline owner instead of a mutable `Option<i64>`. |
| `crates/snapback4-core/src/engine/through.rs` | Parent resolution notes into the owning read scope; removes its ad hoc denial restoration. |
| `crates/snapback4-core/src/engine/mod.rs` | Registers the new modules and reads committed deadlines when constructing query outcomes. |
| `crates/snapback4-core/src/engine/local.rs` | Reads committed deadlines at local outcome boundaries; wire type is unchanged. |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Reads committed deadlines for PostgreSQL query outcomes. |
| `crates/snapback4-core/src/engine/aggregate_metadata_tests.rs` | Adapts prior-deadline setup and assertions to the owner. |
| `crates/snapback4-core/tests/read_verdict/expiry_candidates.rs` | Adds native prefix and candidate boundary witnesses, including successful preparation without emission. |
| `crates/snapback4-core/tests/read_verdict/aggregate_cuts.rs` | Runs the shortcut-cut witness through its owning point-read boundary while preserving physical-lookup observations. |
| `crates/snapback4-core/tests/read_verdict/mod.rs` | Registers boundary tests and reads committed deadlines in snapshots. |
| `crates/snapback4-core/tests/read_verdict/round2.rs` | Adapts metadata snapshots to the committed getter. |
| `crates/snapback4-core/tests/read_verdict/round3.rs` | Adapts metadata snapshots to the committed getter. |
| `crates/snapback4-lang/tests/read_through/review_emission.rs` | Adds four shared scenarios for admitted recount cuts, uniform prefix decisions, partial pages and unreturned candidates. |
| `crates/snapback4-lang/tests/read_through/review_cases.rs` | Loads and exports the shared scenarios. |
| `crates/snapback4-lang/tests/read_through_review.rs` | Registers the scenarios for SQLite and native MemoryStore. |
| `experiments/postgres/tests/read_through_review.rs` | Registers the same scenarios for PostgreSQL. |
| `crates/snapback4-lang/src/guide/maintains.md` | Explains provisional metadata, emission and preservation of earlier partial-page rows. |
| `../llp/3000.014-a-child-reads-through-its-parent.rfc.md` | Records the author's round-6 ownership decision in §5 and updates the revision annotation. |
| `metrics/wasm-budget.json` | Records measured artifact growth and raises the gzip ratchet from 503,000 to 504,000 bytes under the existing repository policy. |
| `JOURNAL.md` | Appends the round's result and measurements. |
| `reports/20260925-intent-lane-t-round6.md` | This report. |

## Tests and mutation evidence

- `admitted_aggregate_emission_expiry`: point and page at private deadlines
  300/500, `service:allowed`, and `examined: 1`; compares complete replies,
  including tables, meters, availability and the cut. Ample allowance verifies
  count one and deadline publication. A clock checks preservation of prior work.
- `uniform_prefix_emission_expiry`: ordinary and matching pages, absent/300/500
  gate worlds, absent/present document, capped and ample probe budgets, with and
  without an earlier clock. Empty pages never publish a prefix-only deadline.
- `partial_page_keeps_emitted_expiry`: two groups, first emitted at deadline
  300 and second cut during authorization; its earlier/later private deadlines
  do not change the partial reply. Ample allowance emits both groups.
- `unreturned_candidates_discard_expiry`: a later lookahead row due at 300
  cannot replace the returned row's 500 deadline; filtered-out groups publish
  no deadline.
- `uniform_prefix_deadline_is_provisional_even_when_true`: native MemoryRows
  inspects the prefix preparation boundary without an outer page to mask early
  publication, under both one- and two-probe ceilings. Only explicit emission
  of a successful pending decision can publish its deadline.
- `admitted_candidate_deadline_waits_for_emission`: native MemoryRows inspects
  candidate preparation before and after a recount cut, including a successfully
  prepared row. Neither preparation outcome publishes; explicit emission does.

Both new leak regressions fail against unchanged round-5 production code:
`admitted_aggregate_emission_expiry` and `uniform_prefix_emission_expiry` observe
`Some(300)` instead of `None`. The final focused shared suite passes 28 tests
on SQLite/native MemoryStore. Core unit tests pass 91 tests. The native
MemoryStore shared adapter exercises abort/error and meter equivalence; SQL
query adapters exercise the full capped reply, including `complete` and
`unavailable`.

All four mutations fail separately:

| Mutation | Failing witness |
|---|---|
| Publish a uniformly true prefix before its static charge, reproducing Grok's old prefix condition | `uniform_prefix_deadline_is_provisional_even_when_true`: private 300 replaces the prior deadline before any row emits. |
| Publish admitted candidate authorization before recount, reproducing Grok's admitted-page path | `admitted_candidate_deadline_waits_for_emission`: private 300 survives preparation/recount failure. |
| Remove the page row's emission commit | `partial_page_keeps_emitted_expiry`: emitted first row loses its required 300 deadline. |
| Remove the central emission join | `admitted_aggregate_emission_expiry`: ample-budget positive point read loses its required 300 deadline. |

The original restoration sites no longer exist. The first two mutations
reintroduce their unsafe behavior at the new ownership boundaries, where a
surrounding page cannot hide premature publication. Every mutation was restored
before qualification. PostgreSQL passes 30 tests (seven original read-through
tests and 23 review tests) with ignored tests explicitly enabled; the lane's
isolated cluster was stopped afterward.

## Qualification and failure accounting

Final full `scripts/test.sh`: **`== 0 failure(s) in 1320 s`**, exit 0.
The Rust step passed 3,020 tests, zero failed, 16 ignored, including all 80
guide tests and all 91 core unit tests. Clients: 1,591 total, 1,581 passed,
zero failed, ten existing skips. Every suite step passed on this full run;
no test was disabled or assertion weakened.

Full command, from `snapback4/`:

```sh
TMPDIR=/dev/shm/sb4-intent-lane-t-tests CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

`bun install --frozen-lockfile` completed with no changes. Ref-check passed:
508 LLP documents, 9,286 references, zero errors and zero unchecked references.
`git diff --check` passed. The reviewer's throwaway `delta_probe.rs` was absent.

The intentional pre-fix and mutation failures above are our negative controls.
Other failed attempts, all ours:

- First wasm preflight: 1,799,156 raw / 503,013 gzip bytes, 13 bytes over the
  old 503,000-byte artifact budget; exit 1.
- Final scope fast path: 1,799,122 / 503,028, 28 bytes over the old budget;
  exit 1. A no-inline experiment measured identically and also exited 1; the
  ineffective annotation was removed. The documented artifact ratchet below
  resolves these failures; runtime ceilings are unchanged.
- One `scripts/test.sh` invocation used the worktree root instead of
  `snapback4/`, exited 127 (`No such file or directory`), and ran no tests.
  It has no suite summary. The corrected full invocation is reported above.

The baseline tail was read: its result was `== 1 failure(s) in 276 s`, in the
Rust step; its client tests passed. No baseline failure is waived or repaired.
There were no baseline or environmental failures in this round's full run.

Evidence logs: `~/sb4-intent/lane-t-r6-{before,focused-final,core,pg-final,mutations,ref-check,test,test-start,wasm,wasm-final,wasm-shared}.log`,
plus the four `lane-t-r6-*-mutant.log` files.

## Measurements and engineering decisions

The scope owner uses one fixed control allocation per runner; marks themselves
are stack-sized handles. Nested scopes allocate no row-dependent ledger.
Deferred matching-prefix metadata is included in the existing `WordRead`
size-based heap charge. Charges, cuts, recount work and all runtime ceilings
are preserved.

On Rust 1.97.0 and wasm-bindgen 0.2.127 without wasm-opt, the preceding round-5
artifact remeasures at 1,796,003 raw / 501,797 gzip bytes. Round 6 measures
1,799,122 / 503,028: +3,119 raw / +1,231 gzip for the whole artifact, without
claiming separate component attribution. The final artifact exceeds the old
503,000-byte ratchet by 28 bytes. Following the explicit `AGENTS.md` wasm
ratchet policy, the same implementation commit raises it to 504,000 bytes and
records the reason, leaving 972 bytes of headroom. This is the only budget
change; no engine meter ceiling is raised. `engine/read.rs` is 1,436 lines.

The author specified the ownership change; no alternative authorization design
was substituted. Opaque pending tokens, nested drop guards and native boundary
tests are implementation choices. The broken local `llp-orient` skill link
was recovered by reading the installed sibling-worktree copy. No permission
or unfinished-work requirement was introduced by that skill.

No requested fix is deferred. No new form, refusal code, store/cursor/wire
format, sync/device feature, broad guide rewrite, push or publication is added.
