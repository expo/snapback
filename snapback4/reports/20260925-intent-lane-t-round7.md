# Lane T: round-7 predicate expiry dependencies, 2026-09-25

Addresses `t-r6.astra.md` and `t-r6.grok.md`, following `31de7e8a1` on
`sb4-intent/t-read-through`.
Implementation commit: `a27d2b1f6`.

## Behavior and examples

A completed filter now owns its authorized reads independently of the candidate
it tests. Its scope commits to the page on either a match or a mismatch.
Interrupted or failing predicates still discard their scope and keep their work
charges and cuts. The candidate's pending private authorization deadline is
inherited only after the row is retained or consumed by a scalar aggregate;
rejection and lookahead do not publish it. This uses the existing provisional
ownership mechanism, with no new restoration path.

The named-key reproduction compiles and runs:

```quarry
query absent():
  return docs where not exists gates[docId = .id] first 10 by .id
query absentCount():
  return count(docs where not exists gates[docId = .id])
```

With readable documents `a` and `b`, and a readable gate for `a` expiring at
300 or 500, the page at 200 returns `[b]`, the scalar returns 1, and both carry
the gate deadline. At that deadline they return `[a, b]` and 2, with no future
expiry. An unreadable gate contributes no deadline to either answer.

The intrinsic-ID witness uses the same stored identity and the existing generic
`id` type:

```quarry
fn rawId(value: id): value
query absentById():
  return docs where not exists gates[id = rawId(.id)] first 10 by .id
```

A single rejected document produces a complete empty page with the readable
gate's deadline, then appears at that deadline. The corresponding filtered
count changes from zero to one. See the fixture adjustment below for why the
helper is needed by this checkout's existing binder.

Point predicates and ordinary streaming scalars are covered too:

```quarry
query labels():
  return docs where .body = gates[id = .gate].label first 10 by .id
query labelCount():
  return count(docs where .body = gates[id = .gate].label)
query gateCount():
  return count(gates)
```

Matched-only, rejected-only and mixed document sets read the same expiring
point predicate. Both page and count keep its deadline, even when no document
matches. `count(gates)` over one readable expiring row returns 1 and its deadline,
then 0 with no deadline when the row expires.

## File-by-file changes

Paths are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/read.rs` | Gives the filter a separate scope; commits completed predicate answers before match/mismatch branching; delays candidate metadata inheritance until retention or scalar consumption. |
| `crates/snapback4-lang/tests/read_through/review_predicates.rs` | Five shared scenarios for intrinsic-ID and secondary-key predicates, point predicates, private authorization separation and streaming scalar emission. |
| `crates/snapback4-lang/tests/read_through/review_cases.rs` | Registers and exports the predicate scenarios. |
| `crates/snapback4-lang/tests/read_through_review.rs` | Runs those scenarios on SQLite and native MemoryStore. |
| `experiments/postgres/tests/read_through_review.rs` | Runs the same scenarios on PostgreSQL. |
| `../llp/3000.014-a-child-reads-through-its-parent.rfc.md` | Clarifies in §5 that completed authorized predicate answers are dependencies even when they reject the candidate; records the distinction from private candidate authorization. |
| `JOURNAL.md` | Appends this round's result and measurements. |
| `reports/20260925-intent-lane-t-round7.md` | This report. |

## Tests and mutation controls

- `predicate_id_expiry`: Astra's runtime intrinsic-ID case; complete empty page
  and zero count carry deadline 300/500, then the document appears and count
  becomes one at expiry. A denied gate remains invisible in metadata.
- `predicate_index_expiry`: Grok's `docId` case; gate's stored ID deliberately
  differs from the document ID, proving the secondary unique lookup is used.
  Page and scalar transition from `[b]`/1 to `[a, b]`/2 at the recorded deadline.
- `predicate_point_expiry`: matched-only, rejected-only and mixed rows read
  one common expiring gate through a point lookup. Both predicate outcomes
  retain authorized dependencies; expiry and denied reads publish none.
- `predicate_private_authorization_expiry`: a private permit expires at 300
  or 500 while an authorized predicate gate expires at 700. The rejected row
  publishes only 700. Complete page replies, including meters and tables, are
  identical across the private permit worlds. Filtered count retains 700 too.
- `streaming_count_expiry`: one readable gate yields 1 with its deadline at
  time 200 and 0 without a deadline at expiry. This directly covers the
  streaming scalar emission boundary identified by Astra.

SQL query checks require `complete`, `!unavailable`, no cap, the expected data,
the exact deadline, and the source dependency tables. Native MemoryStore uses
the existing shared server runner adapter for data semantics; SQL adapters
expose full query metadata. The existing `unreturned_candidates_discard_expiry`
and every earlier shared review test still pass.

The four new predicate scenarios fail against unchanged round-6 production,
each with a complete answer but missing the required deadline (`None` instead
of 300 or 700). After the change, all 33 shared review tests pass on
SQLite/native MemoryStore. PostgreSQL passes 35 tests: seven original
read-through tests and 28 review tests, with ignored tests explicitly enabled
on the lane's isolated cluster; that cluster was stopped afterward.

All three mutations were applied separately and failed their witnesses:

| Mutation | Failing witness |
|---|---|
| Remove `filter_expiry.emit()` | All four predicate scenarios lose the completed predicate dependency. |
| Inherit the candidate's private `pending` token inside the filter scope | `predicate_private_authorization_expiry` observes 300 instead of the public dependency at 700. |
| Remove `expiry.emit()` from `stream_aggregate` | `streaming_count_expiry` observes count 1 without the required deadline 300. |

Every mutation was restored before PostgreSQL and full-suite qualification.

## Qualification and failure accounting

Final full `scripts/test.sh`: **`== 0 failure(s) in 1149 s`**, exit 0.
Rust: 3,025 passed, zero failed, 16 ignored, including all 80 guide tests.
Clients: 1,591 total, 1,581 passed, zero failed, ten existing skips. Every
suite step passed on this full run. No test was disabled or assertion weakened.

Command from `snapback4/`:

```sh
TMPDIR=/dev/shm/sb4-intent-lane-t-tests CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

`bun install --frozen-lockfile` completed without changes. Ref-check passed:
508 LLP documents, 9,287 references, zero errors and zero unchecked references.
`git diff --check` passed. The baseline tail was read: its result was
`== 1 failure(s) in 276 s`, in the Rust step, with client tests passing.
No baseline failure is waived or repaired.
There were no baseline or environmental failures in this round's full run.

The first fixture run failed all four predicate tests during compilation,
before exercising the engine. These were our fixture errors: a `text` mutation
argument exceeded the table's `text <=20` type; the two tables' intrinsic ID
reference types differed; the point lookup needed named columns because two
single-column unique keys existed; and a literal permit ID was not a typed rule
term. Corrected the argument bound, made the point lookup explicit, used a
principal-keyed permit, and routed the cross-table intrinsic-ID witness through
the existing generic `id` helper. No binder or authorization rule was relaxed.
The subsequent four pre-fix runtime failures and three mutation failures are
intentional negative controls described above.

Logs: `~/sb4-intent/lane-t-r7-{before,before-runtime,focused,mutations,pg,wasm,ref-check,test}.log`
and the three `lane-t-r7-*-mutant.log` files.

## Decisions, measurements and remaining work

The only fixture deviation from the literal review example is
`gates[id = rawId(.id)]` in place of `gates[id = .id]`. In this checkout,
`docs.id` has reference type `docs`, while `gates.id` expects reference type
`gates`; the direct spelling refuses with `E_QUARRY_TYPE` before execution.
The identity helper preserves the same ID value and runtime lookup through
the supported generic `id` type. The named `docId` reproduction is unchanged.
This existing type restriction is outside the requested engine correction.

The author specified the scope split; no authorization or lifetime design was
substituted. LLP 3000.014 §5 and LLP 3000.013 §5.1 govern the distinction between
predicate dependencies, private candidate authorization and complete scalar
answers. The `llp-orient` context pass used those sections and LLP 3000.007
§20.22; no additional policy or approval requirement was introduced.

Round 6 measures 1,799,122 raw / 503,028 gzip bytes. Round 7 measures
1,799,206 / 503,057 on Rust 1.97.0 and wasm-bindgen 0.2.127 without wasm-opt:
+84 raw / +29 gzip for the whole artifact, without independent component
attribution. The 504,000-byte artifact budget is unchanged, with 943 bytes
remaining. No runtime meter ceiling or charge changes. `engine/read.rs` is
1,440 lines; the new fixture module is 224 lines.

No requested engine fix is deferred. Sync/devices and the guide remain for
increments 2 and 4 as directed. No new syntax, refusal code, store/cursor/wire
format, publication or push was added.
