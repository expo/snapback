# DS round 3 — delivery lookup lifecycle and heap regression coverage

Date: 2026-09-27. Branch: `sb4-intent/ds-delivery-server`.
Read all three earlier briefs, reports and journal entries, both round-2
reviews, and the governing delivery design. Fetched and merged `origin/main`
`8dfbf7daa` first, in `dcd58071a`. No push or publication.

## Changes by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/postgres/through.rs` | Calls `prepare_delivery_lookup()` beside `prepare_contribution_indexes()` in `adopt_at`, before rebuilding or installing the incoming schema. Fresh schemas acquire membership; modified clones discard their shared old membership and binding index. |
| `crates/snapback4-core/src/engine/postgres/tests/delivery.rs` | Adds separate round-trip adoption and warmed-clone reporter-removal regressions, each running in Serialized and Serializable modes. |
| `crates/snapback4-lang/tests/delivery.rs` | Installs a reporter in a file-backed SQLite store, checks its manifest, drops the engine, reopens the stored generation and requires the same manifest and `[["c1",1]]`. |
| `crates/snapback4-core/src/engine/delivery.rs` | Adds an index-only regression that exhausts the heap quarter before steps and pins the heap debit. Production index charging is unchanged. |
| `crates/snapback4-lang/src/guide/language.rs` | Removes 26 words from introductory prose after the merge put the combined cards 26 words over their existing target. Keeps every Quarry block and inventoried Details fact unchanged; the receipts card retains the full clause contract. |
| `packages/snapback4/test/react.test.mjs` | Merge resolution keeps main's extracted harness and DS's `type Viewed` recipe extraction. |
| `packages/snapback4/test/helpers/react-harness.mjs` | Merge resolution carries DS's receipts/seen cases into main's extracted helper, retaining main's journal and controlled-clock repairs. |
| `JOURNAL.md` | Preserves both parent append histories in order; appends this round's result. |
| `reports/20260927-delivery-server/` | Current report pointer, this report, and retained before-fix, mutation and final validation evidence. |

The only runtime change this round is PostgreSQL schema preparation. The
wire binding, receipt semantics, authorization, disclosure and resource
ceilings are unchanged. No device collection, queue, version or budget change.

## Forms and observable behavior

No new syntax or wire fields. Both existing clause forms compile and run:

```quarry
mutation delivered(group: chats, low: int, high: int)
  reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

```quarry
mutation delivered(group: chats, low: int, high: int) reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

These fixture bodies isolate the platform boundary; the receipts card's real
reporter records the claimed coverage. Requests still send
`{id, args, store_id, delivery: {fingerprint}}`. The fixture fingerprint remains
`2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443`.

After PostgreSQL adopts a serialized/deserialized copy of its schema,
`query raw(): return messages['m1']` still carries the binding's
`rows: [["c1",1]]`. After adopting a warmed clone with `delivery.clear()`,
the same read returns the same data, ordinary meter and completeness fields,
with neither a manifest (including `"partial"`) nor a delivery meter.
SQLite reopening likewise retains the complete original manifest.

## Regression evidence

The PostgreSQL tests ran **before** adding the preparation call. Both failed
at the assigned assertions: round-trip adoption produced no manifest;
reporter removal produced `Some(Partial)` and a meter with 24 output bytes.
The existing receipt/replay test passed. After the call, all three tests pass;
each loops over both write modes. The private, socket-only cluster was stopped
when these checks finished. Existing PostgreSQL binaries were reused; nothing
was installed on a shared path.

Two exact mutation probes also fail their new regressions:

| Mutation | Observed failure |
|---|---|
| Delete only `open_at`'s `prepare_delivery_lookup()` | The reopened manifest has no `[["c1",1]]` rows. |
| Replace index reservation's `bytes` with `0` | The cold index incorrectly fits; the heap-limited assertion fails. |

The heap case gives the index **3,000 bytes and 25,000 steps** (quarters of
12,000 and 100,000). Two insertions reserve **2,480 bytes** and **3 steps**:
64 bytes for the tracker, 968 for `tracked0`, 1,448 for `tracked1`. The third
1,448-byte insertion cannot fit. The test requires the exact heap debit,
remaining step headroom, `partial`, and no published incomplete index.

Production files were restored byte-for-byte after each mutation. The final
restored-source internal tests pass. Reproduce the probes, with no other build
using this worktree:

```sh
python3 reports/20260927-delivery-server/round3/mutations.py
```

Evidence: `round3/postgres-before.txt`, `round3/postgres.txt`,
`round3/mutations.json`, both `round3/mutant-*.txt`, and `round3/core.txt`.

## Schema installation audit

Checked constructors, schema assignments and their forwarding callers:

| Backend / path | Lookup handling |
|---|---|
| SQLite `memory`, `new` → `new_at` | Prepares incoming schema before validation and activation. |
| SQLite `new_release` | Prepares before release activation and construction. |
| SQLite `open` → `open_at` | Deserializes the installed generation, prepares contribution indexes and delivery lookup, then constructs the engine. The optional internal upgrade calls `activate` with that prepared schema. New reopen regression covers this. |
| SQLite `attach_release` → `attach_release_at` | Delegates to `open_at` before checking the release pointer. |
| SQLite `adopt` → `adopt_at` | Prepares fresh membership/index state before activation and `self.schema = schema`. Existing reader/adoption regression remains green. |
| SQLite `reader` | Clones the installed schema and deliberately shares its lookup; it installs no new generation. Existing regression checks shared index, unchanged schema hash, replacement on writer adoption and retention by old readers. |
| SQLite private `activate` | Persists the caller's schema; every constructor/adopter/open-upgrade caller above has already prepared it. It does not independently replace an engine schema. |
| PostgreSQL `create` → `attach` | Persists the schema, then prepares lookup in `attach` before constructing the engine. |
| PostgreSQL `open` → `attach` | Decodes stored schema and goes through the same preparation. |
| PostgreSQL `contribution_upgrade::install` | May update indexes and stored generation inside `attach`; the lookup preparation runs afterward. No separate engine installation escapes it. |
| PostgreSQL `adopt_at` | The missing path, now prepares beside contribution indexes, before the rebuild runner and post-commit schema assignment. Both fresh-schema and stale-clone directions are covered. |

PostgreSQL has no separate detached-reader or release-attachment constructor.
`load`/restore use the installed schema and do not replace it. No other
production assignment or constructor bypass was found in either engine.

Scoped `llp-orient` used the available skill in the main checkout because
this worktree's vendored symlink is uninitialized. Governing references:
LLP 3000 §7 (engine/storage ownership), LLP 2000.000 §6 (bounded work),
LLP 3000.022 §§2, 5 and 6 (binding, manifest and receipt boundary), and
LLP 3000.021 §3.2 as amended by 3000.022 §8. The current authoring surface is
`guide receipts`. The lookup is runtime-only, so the fix adds no schema
identity or serialization decision. No new LLP or hand-off is needed.

## Validation and size

Final affected checks pass:

- 16 delivery, 5 clause, 2 replay/fingerprint and 3 read-through provenance
  tests; the existing optional cost benchmark remains ignored.
- **The whole guide: 87 passed**, none failed or ignored.
- 3 internal delivery lookup/heap tests.
- 6 HTTP delivery tests.
- 3 PostgreSQL delivery tests, each in **Serialized and Serializable** modes.
- 47 React tests, none failed or skipped, validating both sides of the merge.
- Frozen Bun install and package build.

Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.13.1, Bun 1.3.14. `wasm-opt` is
absent from PATH. The retained round-2 artifact before this round's rebuild
is 1,985,385 B raw / 573,265 B gzip; SHA-256
`8fb46c34b5536599c516bafe08c83382491828421cf37c598ded27754b2a65a2`.
The build script and 572,841-byte budget are unchanged.

The full-suite unoptimized rebuild is **1,985,385 B raw / 573,265 B gzip**,
with the same SHA-256 as above: **byte-identical to round 2**, delta **0 / 0**.
It remains **424 B over** the unchanged 572,841 B budget. No optimizer or
budget adjustment was used. Evidence: `round3/wasm-before.json`,
`round3/wasm.json`, and the wasm phase in the full log.

`scripts/test.sh` ran **once**, exited **1**, and printed exactly:

```text
== 1 failure(s) in 1492 s
   wasm build
```

**Every full-run failure:** `wasm build` is **ours, carried from earlier DS
rounds**: the unoptimized artifact exceeds the unchanged budget by 424 bytes.
Round 3 adds zero bytes. The supervisor's explicitly assigned integration
ratchet remains the resolution. There are **no baseline or environmental
failures in this full run**.

Every other phase passed: cargo build, docs budget, release guard, package
checks/build, chat check, app typechecks, fixture wrappers, Rust tests,
client tests and all 78 seeded client models. Rust: 246 test binaries,
959 executions plus doctests, **3,915 passed / 0 failed / 25 ignored**, 991 s.
Client tests: **2,636 main passes plus 56 shard passes / 10 skips**, 194 s.
Models: **78 passed / 0 failed / 0 skipped**, 260 s. The full run repeats and
passes the delivery and entire guide targets. The inherited 60-second suite
budget is unchanged; the measured duration above is retained without a rerun.

Exact command, from `snapback4/`, with the recorded toolchain on PATH:

```sh
CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=4 scripts/test.sh
```

Full evidence: `round3/full-suite.log.gz`, `round3/full-suite.exit`,
`round3/focused.txt`, `round3/core.txt`, `round3/http.txt`,
`round3/postgres.txt`, `round3/react.txt`, and `round3/toolchain.txt`.
Reference audit passes with zero errors and zero unchecked; its exact census
is retained in `round3/ref-check.txt`. Changed source files stay below 1,500
lines, including the merged harness. Diff whitespace checks pass.

## Deviations, development failures and remaining work

The merge required moving the earlier DS receipts tests into main's extracted
harness. The whole-guide run then exposed an integration overrun at
`familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`:
18,300 → 12,836 words exceeded the 12,810 target. This was **ours**, fixed by
shortening introductory language-card prose. An intermediate attempt removed
a duplicate paragraph pinned by the Details fact inventory and failed
`familiar::every_moved_fact_has_its_why_or_details_home`; the paragraph is
restored verbatim. Final total is 12,810, and the whole guide passes. No target,
fixture or compiled example was relaxed.

An initial heap-test fixture used a quarter too small for even its first
allocation and an incorrect expected debit; its failing assertion was
**ours**, corrected before the mutation and final passing checks. Two local
edit attempts used the wrong relative working-directory prefix; they changed
no files. The private PostgreSQL startup initially lacked the reused binary's
`libpq` search path (**environmental setup**); a process-local
`LD_LIBRARY_PATH` resolved it. These are outside the full-suite result.
Before-fix and deliberate-mutant assertion failures above are expected
negative-control evidence, not unresolved product failures.

The inherited unoptimized wasm overage remains assigned to the supervisor's
single LLP 3000.022 integration ratchet, per the round-2 ruling. This round
must not increase it. Reproduction without `wasm-opt`:

```sh
bash scripts/build-wasm.sh
```

No other assigned finding remains open. No queue/device-collection work,
package/version change, shared tool installation, push or publication.
