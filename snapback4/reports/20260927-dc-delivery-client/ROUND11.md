# DC round 11 — DS/DC/KG integration

2026-09-27, branch `sb4-intent/dc-delivery-client`. This branch contains DC
round 10 (`7f17cc41c`), fetched main (`608f9cc4c`), DS round 4
(`d6526a21d`) and KG round 12b (`d7c6e375f`). Fetch and main merge came
first (`e629ba47a`), then DS (`00848f72c`), then KG (`fb2b01ae1`). The
specified KG tip was **not** an ancestor of fetched `origin/main`, so its
branch was merged explicitly. Both requested lane tips are ancestors of the
integrated branch. No push or publication; round-10 review was not awaited.

Read the lane prompts through round 10, existing DC reports and journal
entries, the fenced instructions, LLP 3000.022 and 3000.023, DS round 4,
KG's current qualification, the receipts card, and `045/dv-common.md`.
Scoped `llp-orient` used the initialized skill in sibling lane-a5 because
this worktree's vendor skill link is unresolved. Constraints: LLP 3000's
fence/budgets; 3000.002's streaming codecs; 3000.019/3000.021's authoring and
SDK ownership; 3000.022's publication, acceptance, identity and replay
boundaries; 3000.023's retention and authority episodes; and round 10's
ordinary start-only `E_BOUND` policy. No new design decision or LLP number.

## Resolutions, including clean-merge collisions

Paths below are relative to `snapback4/`.

| Path | Resolution and retained behavior |
| --- | --- |
| `JOURNAL.md` | Ran the supplied `merge-both.py` on the two DS and eight KG conflict hunks. Kept both sides, with each parent's lines still an ordered subsequence. Appended this round separately. |
| `crates/snapback4-core/src/schema/delivery.rs` | Kept **DS's final text**. Its binding fields and streaming reader already match DC's adopted interface. Retained DS's `compute_fingerprint` and SQLite-gated writer validation, which DC did not yet have. Missing/duplicate fields and wrong argument arity still refuse. Details and cross-layer proof below. |
| `crates/snapback4-lang/src/guide/codes.rs` | Union of both registries; final bytes equal DS, which includes DC's binding refusal plus clause/`RUNS_FULL` and the other lanes' existing codes. |
| `crates/snapback4-lang/src/guide/receipts.rs` | DS's real `reports delivery` clause, consuming mutation, 64-run `RUNS_FULL` refusal, no-op receipt behavior and exact-range coverage; DC's SDK collector/queue, acceptance restrictions, callback, safe coordinates and ordinary start-only `E_BOUND`. Kept ER's `guide sequences` referral. The hook uses DC's separate `receiptMember` query and reports only `seen`; mounting it cannot advance `progress` through new delivery pages. Kept membership-triggered retries, visibility/pending checks, remount debt and viewer isolation. Explicitly states persisted uncertain IDs, one parked run per wake, 30-second minimum and ten-minute timer. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Union of DS delivery facts/SDK-and-seen checks and all existing GS/ER wording tests; final bytes equal DS. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Union of delivery and existing recovery-action assertions; final bytes equal DS. |
| `packages/snapback4/test/helpers/react-harness.mjs` | Kept DC's no-catch-up/no-hook-delivery witness and seen retry/remount/viewer tests. Retained DS's settled-visible, pending and retained-offline cases, adapting their old progress fixture to the direct membership query. Both sides' assertions survive with the final card's API. |
| `packages/snapback4/src/client.ts` | Kept both import sets, DC delivery reset/stop and accepted-manifest handling, and KG observation reset/close, revision fences, refresh and authority behavior for every keep policy. Viewer change does both resets; close stops delivery and closes retained answers. |
| `packages/snapback4/src/local.ts` | Kept DC queue initialization, store witness/fences, publication wrapper and stop/await lifecycle together with KG's publication, observation, memory expiry and all-policy reset logic. Kept KG's unconditional expiry scheduling; discarded the old DC conditional that skipped expiry for a loading kept watch. Retained KG `armLocalPresence` and expiring remembered server answers. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Kept the complete test blocks from both sides, each with its own closing delimiters. |
| `crates/snapback4-core/src/schema.rs`, `schema/capabilities.rs` | Git's clean merge duplicated the `delivery` fields in `Schema` and its wire reader. Removed the earlier DC copies and kept DS's position after `tables`, its default/skip serialization attributes, and its private prepared `delivery_lookup`. Final bytes equal DS. |
| `crates/snapback4-lang/src/diag.rs` | Removed the duplicate binding-code match arm; retained DS's combined delivery clause/binding/full-run guide referral. |
| `packages/snapback4/src/local-reads.ts` | Moved local watch notification, table-based reruns and remembered-answer expiry out of the merged `local.ts`. Call order and predicates are unchanged. This keeps `local.ts` at 1,500 lines instead of 1,510; all changed source files meet the cap. |

Cleanly merged `local-query.ts` retains KG's composition/retention logic and
DC's rule that only accepted, non-composed server answers carry supplemental
delivery. KG's app facade and approval/oracle implementation remain intact;
DC's app-level `onDeliveryRefused` forwarding coexists with them. No runtime
meter ceilings, timeouts or test thresholds were changed.

All prior report files for these lanes retain their bytes: 13 DC files,
120 DS files and KG's report. The preservation audit compares the main-merged
DC parent, DS and KG journals, respectively 70,533 / 70,212 / 70,776 lines,
against the merged journal in order. Evidence: `round11/merge-audit.json`.

## One shared binding, fingerprint and manifest

The common packet's original interface names binding fields
`table/group/position/mutation/args` and wire envelopes
`table/mutation/args/rows`, with optional `partial: true` or top-level
`"partial"`. The fingerprint extension was agreed and adopted in the prior
rounds and is now in LLP 3000.022 §5; this integration makes no new wire
change. It preserves:

- **Binding:** DS's final `DeliveryBinding`, byte-identical to DC for the
  fields and handwritten streaming decoder; `fingerprint` is required.
- **Fingerprint:** DS's shared implementation: SHA-256 of
  `snapback4.delivery.v1\0`, followed by the seven UTF-8 strings (table,
  group field, position field, mutation, three argument names), each prefixed
  by its u64 big-endian byte length; lowercase hexadecimal. The server
  checks the supplied fingerprint under the writer before executing a new
  report. Replay keeps the already recorded result.
- **Manifest:** DS's production emitter and DC's existing readers, unchanged
  in shape: `[{ table, mutation, args, fingerprint, rows: [[group, position]],
  partial? }]` or `"partial"`. It is self-describing even when the SDK has no
  matching schema entry. DC's fingerprint-scoped adoption/tombstones survive.

Added `packages/snapback4/test/delivery-integrated.test.mjs`: three tests use
the **real compiled DS fixture and real HTTP server**, with online,
wasm-local HTTP fallback, and wasm-local publication clients. No response
injects a delivery manifest. An independent Node SHA-256 implementation and
the Rust compiler/HTTP tests all pin the same binding fingerprint:

```text
2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443
```

The tests observe actual requests with that digest and store identity,
acknowledge exact runs 41 and 43 without inventing 42, and check returned
data, server coverage, wasm stored binding/acknowledged runs and persistence
metadata. They verify scalar-only projections create no debt on the online
and fallback paths, inspect the real self-describing manifest, replay the
same ID, repeat covered delivery under a new ID without advancing sequence,
and refuse a wrong fingerprint with non-retryable `E_DELIVERY_BINDING`.
All three pass as part of the 356-test delivery/browser group. DS's clause
tests independently exercise wire-order independence, every digest component,
strict decoding and schema serialization. PG tests cover both write modes.

## Wasm budget

`scripts/build-wasm.sh`, Rust 1.97.0 / wasm-bindgen 0.2.127, **without
wasm-opt**, measures **2,019,815 B raw / 585,193 B gzip**, SHA-256
`fcb6e9a265f5c317efc6592eadd81cc439b9cf3a0d7310b2ebf6ef7de9286dd1`.
Main's recorded 0.4.4 artifact is **1,980,253 B raw / 571,841 B gzip**:
the integrated whole-artifact delta is **+39,562 B raw / +13,352 B gzip**.
That control is the existing record, not a freshly rebuilt main artifact;
there is no independent per-component attribution.

The device gains the SDK delivery queue's device side, publication-time
collection into persisted debt, and the self-describing manifest and binding
codecs. The TypeScript queue and KG's approval/observation logic are outside
this wasm artifact. Per the supervisor's integration ruling,
`metrics/wasm-budget.json` now sets **586,193 B** (measured gzip + 1,000 B)
and date **2026-09-27**, appending this reason to the existing history.
Runtime meter ceilings are unchanged. The same reason is appended to the
journal. The final build passes with exactly 1,000 B headroom.

## Qualification

Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127. Existing
worktree-local Node/Bun links, eight Cargo jobs, incremental and dev/test
debug information disabled, fd limit 65,536. Frozen Bun installation changes
no lockfile. PG 16 binaries were copied into ignored worktree-local tools;
the private socket-only cluster was stopped after testing. Nothing installed
on a shared path. Approval model uses `SNAPBACK4_APPROVAL_MODEL_SEEDS=240`.

| Focused check | Result |
| --- | --- |
| Language delivery / clause / integration / replay | 26 passed; one existing optional measurement ignored |
| Device delivery | 30 passed |
| Internal core delivery | 3 passed |
| HTTP delivery | 6 passed |
| PostgreSQL delivery | 3 passed, each in **Serialized and Serializable** modes |
| Queue, real integration, source census, browser and prediction routing | 356 passed |
| Approval lifecycle, model and oracle | 874 passed, 240 model seeds per policy |
| React and keep-authority React | 51 passed |
| Additional keep/retention tests | 569 passed |
| Whole guide | 90 passed |
| Generated consumer TypeScript routes | 9 passed |
| Artifact serde-family and server-only absence census | Pass |
| Package build/typecheck, whitespace and changed-source line cap | Pass |
| Reference audits before and after full suite | 521 LLP docs, 9,742 refs, zero errors/unchecked |

The two transaction modes apply to PostgreSQL's adapter; the compiler,
SQLite and HTTP tests have no alternate write-mode switch. Both online and
local device client paths are covered independently above. The full suite
also runs the complete device inventory, not just delivery.

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1712 s
```

**No full-suite failures**: none attributed to this integration, baseline, or
environment. Rust: **4,126 passed / 0 failed / 30 existing ignores**,
including **1,367 device passes / 0 failures / 3 existing ignores**; workspace
doctests pass. Main clients: **4,151 passed / 0 failed / 10 existing skips**;
seven additional shards: **56/56**; fixture wrappers: **9/9**; final client
models: **79/79**. All build, wasm-budget, typecheck, app-check, docs-budget
and release-guard phases pass.

The known dev-adoption timing test passes in this concurrent full run,
including its 500 ms assertion. No isolated rerun was needed. Its reported
whole-test duration includes setup and is not the assertion's measured
interval; this pass does not resolve the existing intermittent timing ticket.
The inherited 60-second total suite target remains exceeded and unchanged.
No second full run. All 1,440 recorded product/test/script/budget inputs and
the wasm digest were unchanged during qualification; only this report,
evidence and the appended journal were completed afterward.

## Preparation and audit corrections, scope limits

These were **ours**, corrected before the full suite: the automatic schema
merge left duplicate fields (compiler E0124/E0025/E0062), and an initial
conflict-resolution helper accidentally dropped registry-file suffixes
(unclosed delimiter); final registry files were restored to DS's complete
union after checking both parents. The first focused Cargo command named
`provenance` in the wrong package and selected no run; the corrected delivery
command above passed. The new integration test initially used an incorrect
fixture path and read the device JSON payload before decoding it; it also
expected literal `retryable: false` where the wire omits false. Corrected
assertions still require non-retryable refusal. These are not unreported
product failures.

The initial wasm gate failure is the **baseline budget before the authorized
ratchet**: 585,193 B gzip exceeded the inherited 572,841 B gate by 12,352 B.
The explicitly authorized measured-plus-1,000 integration budget fixes that
gate, with the final focused build and full-suite build both passing.

One post-suite audit invocation was **ours**: running `../ref-check` from
inside `snapback4/` uses the wrong corpus root and reports zero LLP documents
and 1,029 reference errors. The corrected invocation runs `./ref-check` from
the repository root, as the successful pre-suite audit did. No source or
reference was changed to resolve that command mistake.

Existing conditional-host limitation remains: on custom/process/Expo handles
without `deliveryCommit`, a fallback answer may resolve while supplementary
manifest debt is omitted; ordinary publication stays transactional. This
round adds a real DS-to-DC proof, but makes no new comparative performance,
complete wasm parity, native process-kill or browser-crash claim. Historical
reports remain historical. No follow-up behavior was silently substituted
for round 10's start-only `E_BOUND` ruling.

Raw work logs are under ignored `target/lane-dc-round11/`; durable evidence
and final totals are under `round11/` beside this report.

Reproduce from `snapback4/` with the pinned worktree-local tools on PATH:

```sh
export CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export SNAPBACK4_APPROVAL_MODEL_SEEDS=240
ulimit -n 65536
bun install --frozen-lockfile
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
cargo test -p snapback4-lang --test delivery --test delivery_clause --test delivery_integration --test delivery_replay_conversion
cargo test -p snapback4-device --test delivery
cargo test -p snapback4-core --lib engine::delivery
cargo test -p snapback4 --bin snapback4 serve::tests::delivery_tests
# SNAPBACK4_EVAL_POSTGRES names a private local database:
cargo test -p snapback4-core --features postgres --lib engine::postgres::tests::delivery -- --include-ignored --nocapture
node --test packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/web-review.test.mjs packages/snapback4/test/prediction-routing.test.mjs
node --test packages/snapback4/test/approval-*.test.mjs
node --test packages/snapback4/test/react.test.mjs packages/snapback4/test/keep-authority-react.test.mjs
node --test packages/snapback4/test/retention-*.test.mjs packages/snapback4/test/keep-*.test.mjs
cargo test -p snapback4-lang --test guide
cargo test -p snapback4-lang --test routes
node scripts/attribute-wasm.mjs --families --check-families --check-absent
(cd .. && ./ref-check --verbose)
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```
