# Lane Q — review round 2

2026-09-25. Branch `sb4-intent/q-expiring-counts`; reviewed starting point
`ebfeeb34b`. Read both `q-r1.astra.md` and `q-r1.grok.md`, and rechecked the
completed Grok round-0 review before the final suite.
Implementation: `dc54cbc8f` (adoption accounting, page admission and regressions)
and `3c653bb5f` (`now + 1` witness boundary).

Both Medium adoption findings and both Low test gaps are addressed. The
supervisor's accepted device stop remains: a local read that cannot establish
the answer returns unavailable and uses the existing server fallback. No
physical total or private next-expiry certificate is delivered.

## File map

Paths are relative to `snapback4/` unless marked otherwise.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/rows/adoption.rs` | Shared admission pass: charge `stored_row` once per decode, account for contribution scratch including materialized fields, and distinguish a page that should shrink from a singleton that must refuse. |
| `crates/snapback4-core/src/rows.rs` | Register the shared helper only for SQLite/PostgreSQL builds. |
| `crates/snapback4-core/src/store/activation_walk.rs` | Check every row's scratch while retaining the complete serialized-page reservation. Drop and halve a page before any callbacks if it cannot fit. Add a callback-boundary reservation regression. |
| `crates/snapback4-core/src/store/activation.rs` | Supply the contribution allowance to page admission and use the same allowance during index construction. |
| `crates/snapback4-core/src/engine/postgres/contribution_upgrade.rs` | Apply the same admission pass and decoder accounting to the driver-owned page under the existing writer transaction. |
| `crates/snapback4-core/tests/expiring_adoption.rs` | Add successful legacy upgrades for 1,000,000 bytes, 1 MiB, five 512 KiB rows and five 1,280 KiB rows, with independent allocator measurements and unchanged-state reinstallation. |
| `crates/snapback4-core/src/engine/postgres/tests/expiring_counts.rs` | Extend real PostgreSQL adoption to one 1,000,000-byte body and five 512 KiB bodies. Verify unchanged payloads, every rebuilt key, physical totals and stable generation on reopen. Retain the earlier 96 × 4 KiB and 600 × 64 KiB cases. |
| `crates/snapback4-device/tests/expiring_counts_probe.rs` | Add a selected live witness expiring exactly at `now + 1`, on both stores and both server/device execution paths. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Dated §20.9.3 amendment explains the admission pass, scratch accounting, page retries and retained-buffer test. |
| `JOURNAL.md` | Append the dated round-2 measurements, qualification and accepted limitations. |
| `reports/20260925-lane-q-round2.md` | This report. |

## Behavior and engineering decisions

Serialized images are still reserved before fetching. The half-heap heuristic
is only an initial page-size estimate. Before any adoption callback runs, a
bounded pass decodes each image under its decoder reservation and checks the
remaining contribution allowance. A rejected multirow page is dropped before
its reservation is released; its limit halves, and the page is fetched again.
Only a singleton that cannot fit may refuse for heap. Callback writes are
never retried. Schema, indexes, source images and metadata still share the
existing atomic activation transaction.

The admission pass decodes each candidate once to determine its actual row
footprint, then releases it. The later callback decodes it again. Each decode
charges `stored_row` once, with its existing embedded scratch multiplier.
The admission pass charges examined work and preserves the meter across size
retries. A new meter starts after an accepted page is consumed. This extra
bounded adoption pass is the engineering choice made where the brief did not
specify how to determine scratch before invoking a mutating callback.

Optional/default field footprints are included without allocating a second
row during admission. SQLite's three-copy serialized-page allowance and
PostgreSQL's eight-copy plus metadata allowance are unchanged. No runtime
ceiling, authoring syntax, refusal code, wire shape or device algorithm changed.

No new language form is introduced. The existing Lane Q form still compiles
and runs, including the compiled language-card example:

```quarry
table receipts:
  chat: id
  principal: principal
  state: int
  visible: bool
  expiresAt: time ?
  expire at .expiresAt
  read <- .principal = viewer
view unreadCounts: count receipts where .state < 2 and .visible by .chat, .principal
```

The complete earlier implementation/file map is in
`reports/20260925-lane-q-expiring-counts.md`; round-1 review corrections are in
`reports/20260925-lane-q-round1.md`.

## Tests and measurements

`fitting_large_rows_adopt_without_retrying_the_same_oversized_page` verifies
successful SQLite adoption and idempotent reinstall for each following shape.
The independent allocator measures additional live Rust bytes over the complete
adoption, excluding native SQLite allocations; the meter separately retains
the native-payload allowance.

| Rows | Payload bytes per row | Peak additional Rust bytes |
| ---: | ---: | ---: |
| 1 | 1,000,000 | 3,003,026 |
| 1 | 1,048,576 | 3,148,754 |
| 5 | 524,288 | 3,673,674 |
| 5 | 1,310,720 | 3,935,639 |
| 600 (existing regression) | 65,536 | 2,893,625 |

Every peak is below the unchanged 16,777,216-byte job heap. The existing late
2 MiB singleton refusal still rolls back the complete store digest after 300
ordinary prior rows; its peak is now 4,591,031 bytes. Correcting the decoder
charge lets this singleton reach the contribution-scratch refusal instead of
refusing before decode.

`callback_keeps_the_whole_fetched_page_reserved` independently lower-bounds
the callback's meter by all retained serialized images plus the active row's
decoder. It checks every callback and verifies that earlier callbacks release
only their own scratch. This closes the surviving mutation identified by Astra.

The real PostgreSQL target passes both tests, explicitly invoked with
`--features postgres --lib engine::postgres::tests::expiring_counts -- --ignored
--nocapture` against a private Unix socket. The new one-row case uses
`text <=1000000`; the five-row case uses `text <=2097152`. Reopen stays at
generation 2, every payload and new expiry-ordered key is checked, and the
stored physical count remains exact. Existing smaller-payload query checks
also pass. The private PostgreSQL server was stopped afterward.

The two `probe_seeks_live_witness_*` tests now include expiry 101 at clock 100,
with backlogs 0 and 9,000, server reads and device predictions. They retain
finite/null expiry, absent groups, other-principal groups and unselected rows.

Three temporary mutation checks were run, with the correct source restored
in a `finally` block after each:

- Bypass page scratch admission: the five-by-1,280-KiB SQLite case fails at
  **18,370,134** charged bytes. The requested five-by-512-KiB case alone would
  no longer catch this after the decoder multiplier is fixed.
- Delete the fetched-page heap charge: the callback-boundary test fails at
  a reported heap of **17,356**, below its independent retained-image bound.
- Seek `gt: now + 1`: both memory and SQLite witness tests fail because the
  selected row expiring at 101 is incorrectly absent at clock 100.

Logs: `~/sb4-intent/lane-q-r2-mutation-{page-sizing,page-reservation,next-instant}.log`.
The initial unchanged-code reproductions also failed as required: the
1,000,000-byte case charged **19,017,459** bytes on SQLite and **24,014,816**
on PostgreSQL, against the same 16,777,216-byte ceiling.

## Failures, deviations and remaining limits

- **Ours, expected reproductions:** the new one-row upgrade regression failed
  on the reviewed implementation on both SQLite and PostgreSQL. Fixed.
- **Ours, expected negative tests:** each of the three deliberate mutations
  failed its regression; both store variants fail the seek mutation. All
  mutations were restored before qualification.
- **Ours, first complete suite:** `== 1 failure(s) in 363 s`, exit 1. Only the
  client stage failed, in `wasm-codec-census.test.mjs`: `web-reachable typed JSON
  calls all use the codec funnel` and `census kills parse, encoded, MQ components
  and container regressions`. Both identified the new helper's direct
  `serde_json::from_str` call. It now uses the existing `json_codec::from_text`
  wrapper; no census exception or weakened assertion was added. The complete
  census target passes after the fix. All Rust executions and workspace
  doctests passed in the first run. Log:
  `~/sb4-intent/lane-q-r2-test-codec-fail.log`.
- **Ours, test-fixture correction:** two intermediate PostgreSQL runs passed
  adoption but failed a new subsequent query assertion at `programs.count.0`
  with `HeapBytes actual 268466405`. The first used a 2 MiB payload schema for
  the large row; the next inadvertently reused that wide schema for the
  existing 4 KiB fixture. PostgreSQL's existing query reservation is sensitive
  to the declared source bound. The test now declares each fixture's intended
  bound and verifies large-row adoption directly; ordinary query checks remain.
- **Unchanged PostgreSQL query limit:** declare `payload: text <=2097152`, seed
  one live 1,000,000-byte receipt, adopt the old contribution index, then query
  `counts[viewer]`. Adoption succeeds; the evaluation adapter's existing query
  scan may return unavailable at its conservative heap bound. Query admission
  is outside these adoption corrections; no ceiling or query reservation was
  weakened to make an assertion pass.
- **Accepted device stop:** at 10,000 selected source rows, a local aggregate
  recomputation exceeds the unchanged 8,192 examined-row ceiling. The existing
  `scale_memory` and `scale_sqlite` reproductions require unavailable and exact
  server fallback. Physical-total/next-expiry delivery remains stopped for the
  disclosure counterexample in §20.9.3 and the original report.
- Value-order indexes over expiring sources, maintained columns over expiring
  sources and value comparisons in rules over expiring maintains remain
  refused. No version bump, push or package publication. Build artifacts stay
  on the shared disk. No new source file approaches 1,500 lines.

The shared baseline log was checked before attributing failures. None of this
round's failures is classified as baseline or environmental: the reproductions,
deliberate mutations, fixture corrections and codec-funnel error are all ours.

## Final qualification

Final command, with the supplied Rust/Bun PATH:

```sh
CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=8 scripts/test.sh
```

Exit **0**, exact summary: **`== 0 failure(s) in 222 s`**.
All **883 Rust executions across 175 binaries**, plus separate workspace
doctests, pass. The main client process reports **1,479 tests, 1,469 pass,
0 fail, 10 existing explicit skips**; separate shards also pass. There are
no new skips, waivers, baseline failures or environmental failures in this
final run. The source-audit tests that failed in the first run both pass.

Real PostgreSQL qualification separately passes **2/2**, with both database
tests explicitly enabled. The JSON codec census passes **26/26** independently.
`ref-check --verbose` reports **507 LLP docs, 9,276 refs, 25,862 files,
0 errors, 0 unchecked**. `git diff --check` is clean.

Wasm: **1,768,024 bytes raw / 492,568 bytes gzip**, below the unchanged
493,000-byte artifact ratchet. Runtime ceilings remain unchanged. The existing
server cost regression still asserts **2 / 502 examined rows** for backlogs
**0 / 500** at both **100 / 10,000 live rows**; the accepted device fallback
regressions pass.

Logs:
`~/sb4-intent/lane-q-r2-test-complete.log`,
`~/sb4-intent/lane-q-r2-postgres-tests.log`,
`~/sb4-intent/lane-q-r2-adoption-measurements.log`, and
`~/sb4-intent/lane-q-r2-ref-check.log`.
