# Lane DC, round 5 — bound budgets outlive debt eviction

2026-09-27, branch `sb4-intent/dc-delivery-client`. No push or publication.
Prior reports and journal entries remain historical records.

Fetched and merged `origin/main` first as `ce02eb3d5` (main `166fe0579`).
Both parent journals remain subsequences of the merged journal. The device
keeps main's `replace_rows` transaction and DC's acquired-row candidates;
the local client keeps main's 10,000-row page and DC's acceptance behavior.
The local source remains at the 1,500-line cap after consolidating comments.

## Findings and files

Paths are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `packages/snapback4/src/delivery.ts` | Findings 1–2: never take a park from a group with an attempt, including one in backoff. At the terminal bound cap, also merge the run into `refused`, then notify once. |
| `packages/snapback4/src/delivery-state.ts` | Finding 2: saturate before overflowing a group with a live bound budget, including transport retry parks; group eviction retains the saturation marker. Terminal refusal capacity remains 64. Finding 3: retired records carry fingerprints; removal and restoration match them. |
| `crates/snapback4-device/src/device/delivery.rs` | Findings 2–3: the same saturation policy for publication pressure and the 4,096-group cap, fingerprint-specific retired cleanup/restoration, and the unchanged shared-cursor reset. Activation still blocks before eviction. Known coverage is calculated once per collection. |
| `packages/snapback4/test/delivery-bound.test.mjs` | Findings 1, 2 and 4: held replay versus each wake source; terminal pressure/drain/recollection through both the TS collector and actual wasm publication; partial budgets in attempts, bound parks and transport parks; serialized transport-retry restart and the cumulative 17-id cap; terminal refused-set saturation. |
| `packages/snapback4/test/delivery.test.mjs` | Findings 3–4: fingerprint-scoped retired state and restoration; startup with a ready bound park from a previous process; existing tombstone fixtures now carry their binding fingerprint. |
| `crates/snapback4-device/tests/delivery.rs` | Findings 2–3 on memory and SQLite: interval and 4,096-group pressure across all three partial-budget locations and terminal suppression, reopen/recollection, adoption with old/new retired fingerprints, mismatched restoration, and the shared-cursor reset. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Eviction/saturation behavior and the online queue's memory-only lifetime. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Finding 5 and the requested lifetime ruling: explicitly “across local restarts”; online processes start fresh budgets. Correct the previous parked-only suppression claim and record saturation and fingerprint-scoped tombstones. |
| `crates/snapback4-device/src/device.rs`, `packages/snapback4/src/local.ts` | The merge resolutions above; no acceptance, outbox or authorization relaxation. |
| This report and `JOURNAL.md` | Measurements, qualification, exact failures and append-only round record. |

## Behavior and forms

No new Quarry form, public API or request field. The existing manifest still
consumes this descriptor and reports exactly position 41:

```json
{"table":"messages","mutation":"delivered","args":["conversation","from","through"],"fingerprint":"fixture:messages","rows":[["c",41]]}
```

The request remains:

```json
{"id":"held-id","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

A `denied: E_BOUND` still requires replaying `held-id`; only a replay-confirmed
failed receipt permits a new id. A sibling park cannot replace that held id.
Eight burst ids plus eight wake ids, after the initial id, still bound a
continuously failing interval to 17 distinct ids. Transport retries and local
restarts do not replenish either counter.

A terminal interval enters the existing non-evictable `refused` set. Its park
may be trimmed, but pressure, later manifests and local restart cannot notify
again or start another budget. A partially spent budget uses the supervisor's
allowed saturation alternative: if its group overflows the interval limit or
is evicted, that group stops collection and dispatch. This can under-report
other positions in the same group; it cannot grant a new budget. No extra
counter ledger or higher capacity is introduced. As with existing saturation,
a leave/rejoin or a new store clears it. Online state remains memory-only.

## Discriminating tests

- Against the unmodified queue, 11 new cases fail: both terminal collector
  cases, all three wake sources, and all six partial-budget location/pressure
  combinations. The other tests pass.
- Before the device fix, both memory/SQLite pressure tests and both retired
  adoption tests fail; 26 existing device delivery tests pass.
- Grok's exact `flushed` mutation, removing `kind === "bound"`, fails the
  new startup case at “41 is ready but has not dispatched.”
- Astra's exact mutation clearing `bound` when resuming a transport retry
  fails at “start cannot replenish the burst” (0 rather than 3). The positive
  test also spends wake retries, repeats transport exhaustion/restart, and
  reaches exactly 17 cumulative ids and one callback.
- The cap tests exhaust 41, collect 256 higher disjoint positions, verify the
  stopped park disappears, successfully drain the new positions, recollect 41,
  and then apply whole-group pressure and serialize/restart. The count stays
  17 ids for 41 and one callback. The device variant uses actual wasm
  publication for the interval pressure and recollection; native tests exercise
  the device's actual 4,096-group eviction separately.
- A terminal bound failure filling the 64th refused interval saturates and
  stays silent on restart. Existing acceptance, outbox, blocked activation,
  manifest adoption and browser commit-gap tests remain in the affected run.

## Qualification

Raw evidence stays in `target/lane-dc-round5/`. Tools and experiments stayed
inside this worktree. Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen
0.2.127 match the previous qualification. The worktree PATH excludes the
shared incompatible wasm-opt 108. A private Binaryen 123 experiment increased
gzip size and was discarded; the selected artifact uses no wasm-opt.

| Device wasm | Raw bytes | Gzip bytes |
|---|---:|---:|
| Merged baseline `ce02eb3d5` | 2,023,371 | 585,656 |
| Initial lifetime fixes | 2,024,162 | 586,018 |
| Final round 5 | 2,022,790 | 585,118 |
| Supervisor's accepted remainder | — | 585,362 |
| Unchanged checked-in gate | — | 572,841 |

Final gzip is **538 B below the merged baseline** and **244 B below the
accepted remainder**. The unchanged build gate still reports an inherited
12,277 B overrun. The diet keeps one coverage calculation per collection,
moves rare whole-group eviction to a cold helper, uses explicit first-minimum
scans for both eviction choices, avoids allocating intervals just to test
whether refusals exist, and transfers the retired-map key without cloning it
again. No codec, meter, capacity, profile, dependency or budget was changed.
Larger measured alternatives were discarded, including the owned-object,
binding-serialization and allocation-free coverage experiments.
The selected wasm SHA-256 is
`d9ce146065cd58b4d642c87d2568ffcbf2fda64718936c503e01fbbc6922cf61`.

Checks completed before the full suite:

- Complete device inventory, including all shards and doctests: **1,353
  passed, 0 failed, 3 ignored**. This preceded the final size-only scan
  refactors; the full suite also passes **1,353/1,353 device tests, 3 ignored**
  on the selected source. Its device delivery target passes **30/30** (1.53 s).
- Whole guide: **86 passed, 0 failed**.
- Affected delivery, source codec census and browser persistence tests:
  **152 passed, 0 failed**; repeated on the final artifact, **152/152**
  (21.06 s). Package build and typecheck passed.
- Symbol-bearing artifact census: **passed** both the serializer-family
  check and server-only/Unicode-table absence check. The surviving IR clone
  symbols total 14,158 B across 31 symbols; no new codec family is excused.
- Reference audit: **517 LLP documents, 9,646 references, 0 errors,
  0 unchecked**. Whitespace checks passed.

Ran `scripts/test.sh` **exactly once**, exit 1. Exact summary:

```text
== 1 failure(s) in 1530 s
   wasm build
```

Every failure: **`wasm build` — baseline**. Its measured 585,118 B gzip exceeds
the unchanged 572,841 B gate by 12,277 B, while staying 244 B below the
supervisor's accepted remainder. Reproduce with `bash scripts/build-wasm.sh`
on this source and the toolchain above. No lane-owned or environmental
full-suite failures remain, and no second full suite was run.

The full Rust phase passed **3,954 tests, 0 failed, 24 ignored**, including
the entire device inventory and whole guide. Main client tests passed
**2,765, 10 skipped**, all seven additional shards passed **56/56**, client
models passed **78/78**, and fixture wrappers passed **9/9**. Docs budget,
release guard, package typecheck/build, chat app check, and both chat/Expo
app typechecks passed. The inherited 60 s whole-suite target remains exceeded;
the command above reproduces that timing limit on this shared host.

Reproduction commands, from `snapback4/` after the frozen Bun install, with
the worktree's Node/Bun bin directory and the existing Cargo bin directory
on PATH, `CARGO_INCREMENTAL=0`, `CARGO_BUILD_JOBS=8`, and dev/test debug info
disabled:

```sh
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/web-review.test.mjs
cargo test -p snapback4-device --test delivery
cargo test -p snapback4-lang --test guide
node scripts/attribute-wasm.mjs --families --check-families --check-absent
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

The standalone complete-device run used a worktree-local copy of
`scripts/run-rust-tests.mjs` with its two workspace selectors replaced by
`-p snapback4-device`; the existing inventory, shards, doctests and eight-worker
limit remained unchanged. No second full-suite invocation is needed to
reproduce the individual regressions. The deliberate pre-fix and mutation
failures above are lane-owned, expected negative controls. One discarded
borrowed-slice serialization experiment initially failed Rust compilation;
it was repaired for measurement and discarded. Intermediate wasm candidates
above 585,362 B were lane-owned size failures and were trimmed or discarded.
None is a remaining failure of the selected implementation.

## Scope and limits

Used `llp-orient` from the initialized sibling lane-a5 checkout, since this
worktree's skill link is uninitialized. Governing context: LLP 3000 §§1–4,
LLP 3000.022 §§3–5, LLP 3000.021 §3.2 as amended, and LLP 3000.002's device
codec/size rules. No new LLP, gate, dependency, budget, meter or version.

The saturation choice is explicitly allowed by the brief. Its conservative
scope is the whole group on pressure, avoiding a second persistent counter
ledger. The DS/ER server paths, full comparative choreography, full wasm path
matrix, native process-kill and IndexedDB crash witnesses remain unclaimed.
The existing hosts without conditional supplementary commits still omit
fallback-manifest debt: accept a server-only manifest on a process/Expo or
custom handle without `deliveryCommit`, then read delivery state; the answer
resolves but that supplementary debt is absent. Ordinary publication remains
transactional. This is the previously approved under-reporting fallback.
