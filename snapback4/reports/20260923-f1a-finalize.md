# F1a finalization — 2026-09-23

Branch: `sb4-03/f1a-columns`. Fetched origin and rebased all four F1a
commits onto `origin/main` at `91694b4c0`. No push, stash, LLP edits, or
`scripts/test.sh` execution. The supervisor owns the landing suite.

## Governing context

Read-only `llp-orient`: LLP 3000 (Snapback 4 root), LLP 2000.000
(shared design brief), LLP 3000.007.001 §2, §3.2 and §3.7 (ordinary-table
maintained columns, private lowering, public projection and server-valued
device fields), and LLP 3000.007.003 §3.1–3.3 (the three derived forms).
The maintained-column and derived-data proposals are in `llp/current/`.
The sync guide and SERVER reference are updated with this implementation.
No new design decision or LLP hand-off is needed.

## Rebase conflicts and resolutions

Five conflict occurrences across three files:

1. Replaying `783fc0ce5`, `crates/snapback4-lang/src/diag.rs`: retained
   all F1a maintained-column diagnostic routes to `maintains`, plus
   FENCE's `E_SCHEMA_CAPABILITY` route to `sync`.
2. Replaying `965d9dadb`, the same file: retained the review's added
   `E_POSTGRES_MAINTAINED_COLUMN` route alongside the capability route.
3. Replaying `c7e40c4ac`, `metrics/wasm-budget.json`: kept main's newer
   470,000 B ratchet and complete FENCE/EDGES attribution, appending F1a's
   historical integration measurement instead of resetting the limit to
   its older 469,000 B value.
4. Replaying `eed561aa5`, `metrics/wasm-budget.json`: kept the combined
   history and main's limit, applying round 2's corrected journal pointer
   to the F1a paragraph.
5. Replaying `eed561aa5`, `JOURNAL.md`: preserved every new main entry
   and appended F1a's round-2 integration-ratchet entry unchanged.

The rebase completed without dropping a commit. The first build caught an
additional semantic integration issue: F1a's exhaustive constraint walker
in `schema/columns.rs` needed to handle `Constraint::Capabilities`.
The carrier now has no dependency-walk effect, like the legacy `Recorded`
marker; it names no column, rule, identity, lifetime or delivery dependency.
The device run also caught an obsolete assertion in
`crates/snapback4-device/tests/maintains/columns.rs`: F1a's combined F1/F2
projection test expected `Constraint::Recorded` after decoding. FENCE now
emits a wire-only capability carrier and strips it during decode. The test
now requires exactly `maintained-column` and `recorded-attribution` in the
serialized carrier, derives the same set after decoding, and verifies that
neither carrier remains in runtime constraints. All original capture,
forged-write and parent-value checks remain; its five-case maintained-column
rerun passes on both stores.

FENCE, EDGES, timeline authority and maintained-column behavior remain in
the integrated branch. The range-diff record is
`/tmp/f1a-finalize-range-diff.log`.

## Capability registration

`crates/snapback4-core/src/schema/capabilities.rs`, `CAPABILITIES`, derives
`maintained-column` whenever any table has nonempty `maintained` metadata
**or** any maintain has a `private` owner. This also supplies the decoder
allowlist. Thus the full stored schema and the public device projection
both carry the existing strict `Constraint::Capabilities` fence.

Core tests cover the full schema, the projection with no private maintains,
a raw private-maintain-only schema, all three capabilities together, round-trip
serialization, malformed carriers, and the unchanged legacy-byte control.
The published witness adds a maintained-column-only fixture to
`packages/snapback4/test/schema-capabilities.test.mjs`, through the existing
integrity-verified `helpers/published-capabilities.mjs` helper. The old-readable
plain app keeps real prior-generation data. F1a correctly refuses activation
on a populated server store, so the maintained-column fixture constructs
generation 2 on a separate empty server store before seeding it, then tests
adoption by the populated old device. Its source-only prediction must
contain one row; no timeline or recorded-attribution capability can
accidentally supply the fence.

## Published-binary evidence

**PASS: 4 tests, 0 failed, 0 skipped**, using the helper's pinned registry
SHA-512 checks for `snapback4@0.2.33` and
`snapback4-darwin-arm64@0.2.33`. The three individual capability cases
and the capability-free control all pass.

| Maintained-column-only operation | Published 0.2.33 result |
| --- | --- |
| Native device install | Refuses unknown `Capabilities`; no device store created |
| WASM device install | Throws unknown `Capabilities` |
| Native and WASM adoption | Refuse; old data, generation and persisted state preserved |
| Native and WASM kept reopen | Refuse unknown `Capabilities`; native store preserved |
| Engine stored-schema reopen (`doctor`) | Refuses `E_STORE`, unknown `Capabilities`; store preserved |
| Engine `serve` | Refuses from persisted schema with old-readable source; store preserved |
| Engine mutation on reopen (`run`) | Refuses; store preserved |

For the maintained-column fixture, current native and WASM devices accept
the supported schema and predict one source row. Current devices and engines refuse an injected future capability
with `E_SCHEMA_CAPABILITY`, including kept-backend replacement openings.
Removing only the carrier makes the old device accept, showing that this
capability supplies the fence. Both the public backend response and stored
schema of the capability-free control are **byte-identical** to published
0.2.33; the old device and engine can still use it.

The initial witness runs caught fixture indentation and the expected F1a
populated-store activation refusal; those fixture corrections are included.
The final entire file exits 0, recorded in
`/tmp/f1a-finalize-capabilities-verified.log`.

## Verification

Commands run from `snapback4/`, with Node 24.18.0 on `PATH`, Rust 1.97.0
and wasm-bindgen 0.2.127. Four Cargo build jobs and two Rust test threads;
two Cargo jobs for WASM. No wasm-opt is installed.

```sh
CARGO_BUILD_JOBS=4 cargo build
CARGO_BUILD_JOBS=4 cargo test --no-fail-fast \
  -p snapback4-core -p snapback4-lang -p snapback4-device \
  -p snapback4-sim -p snapback4 \
  --features snapback4-core/postgres -- --test-threads=2
CARGO_BUILD_JOBS=2 bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
SNAPBACK4_FENCE_PUBLISHED=/tmp/f2-round1 \
  node --test --test-concurrency=1 packages/snapback4/test/schema-capabilities.test.mjs
node --test --test-concurrency=1 packages/snapback4/test/maintained-columns.test.mjs
```

The existing tarball cache only avoids downloads; the helper checks registry
metadata and pinned integrity and extracts fresh copies on every run.

The native build passes after the constraint-walker integration fix.
The package build passes. Maintained-column package tests pass **2/2**,
zero skipped, on SQLite and rebuilt WASM: HTTP projection, private-data
visibility, prediction, watches, interrupted catch-up and cold reopen.
The broad Rust invocation completed with exit **101** because of the single
obsolete `Recorded` assertion described above. Every other target passed.
The corrected maintained-column cases pass **5/5**, zero ignored, with
exit **0**:

```sh
CARGO_BUILD_JOBS=4 cargo test --no-fail-fast \
  -p snapback4-core -p snapback4-lang -p snapback4-device \
  -p snapback4-sim -p snapback4 --features snapback4-core/postgres \
  --test device maintains::columns:: -- --test-threads=2
```

This preserves the broad command's feature union. The simulator's separate
`device` target has no matching case and reports zero selected tests; its
full results come from the broad invocation.

Final distinct results, counting the corrected case once:

| Affected check | Passed | Existing ignored |
| --- | ---: | ---: |
| Core, including all 18 corpus tests | 208 | 9 |
| Language, including all 53 guide tests | 416 | 4 |
| Device, SQLite and memory | 1,044 | 3 |
| Simulator | 525 | 5 |
| `snapback4` crate | 345 | 1 |
| **Rust total** | **2,538** | **22** |
| Published capability package tests | 4 | 0 |
| Maintained-column package tests | 2 | 0 |

No unresolved failure remains. This is a combined final result, not a claim
that the initial broad command exited successfully. The four already-passing
cases in the focused rerun are not counted twice. Core capability tests pass
4/4 and legacy-capability tests 3/3; device READAUTH passes 81/81 and recorded
coverage 24/24. Doc-test targets pass with zero cases.

The ignores are nine isolated-Postgres tests, two documented device presence
limitations, three language-analysis limitations, one retained-calibration
survey, and seven opt-in timing, scale, deeper-exhaustive and native-host checks.
This change adds no ignores and makes no live-Postgres or Kani proof claim.
Compilation took 68m 36s on the loaded host; the targeted correction rebuilt
in 3m 35s. The complete `scripts/test.sh` remains the supervisor's landing check.

## WASM

Final `build-wasm.sh`: **1,707,766 B raw / 473,306 B gzip**, reproducible
on the verification rebuild. The initial 470,000 B ratchet failed by
3,306 B; the authorized increase to **474,000 B** passes with 694 B
headroom. The reason is in `metrics/wasm-budget.json`, `JOURNAL.md` and
the finalization commit message.

Against main's recorded EDGES+FENCE landing (1,693,862 B raw / 469,031 B
gzip), the delta is **+13,904 B raw / +4,275 B gzip**. This is the complete
F1a integration plus capability registration: maintained-column metadata,
projection, implicit zero, ownership, write-result stripping and shared
write/meter paths alongside FENCE, EDGES, recorded attribution, timelines
and READAUTH. Private-total rebuild and SQLite import remain server-only.
The comparison uses the recorded main baseline, not a second baseline build;
no separate component cost is claimed.

Source and package `dist` WASM SHA-256 match:
`c508f683711633cd35ba9d1036826ce6503c2ac48deadcaa95130aece7efecaa`.

## Logs

- Native build: `/tmp/f1a-finalize-build-fixed.log` (the initial exhaustive-match
  compile failure is `/tmp/f1a-finalize-build.log`).
- Rust affected suites: `/tmp/f1a-finalize-rust.log`; corrected maintained-column
  cases: `/tmp/f1a-finalize-columns-rust-fixed.log`. Per-target and final distinct
  totals: `/tmp/f1a-finalize-results.json`.
- Published witness: `/tmp/f1a-finalize-capabilities-verified.log`; the two
  fixture-correction runs are `capabilities.log` and `capabilities-fixed.log`
  under the same `/tmp/f1a-finalize-` prefix.
- Maintained-column package tests: `/tmp/f1a-finalize-columns-package.log`.
- Package build: `/tmp/f1a-finalize-package-build.log`.
- WASM ratchet failure and final success: `/tmp/f1a-finalize-wasm.log` and
  `/tmp/f1a-finalize-wasm-verified.log`.

## Final commits

Sequence above `91694b4c0`, oldest first:

1. `2ac93f11d` — `feat(snapback4): maintained columns on a fresh store (F1a; LLP 3000.007.001)`
2. `4755dc1b6` — `fix(snapback4): review round 1 for maintained columns (F1a)`
3. `9377ac70a` — `fix(snapback4): integrate F1a with final F2 and READAUTH`
4. `b32c16935` — `fix(snapback4): review round 2 for maintained columns (F1a) — the mirror respects timeline authority`
5. This report's commit — `fix(snapback4): fence maintained columns after F1a rebase`

Final self-review and `git diff --check` pass. No changes under `llp/`
relative to the rebase base; all changed Rust/JavaScript source files remain
below 1,500 lines.

The concrete final hash is in the handoff response; the report is part of
that commit. No push is performed.
