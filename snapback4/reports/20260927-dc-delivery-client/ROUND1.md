# Lane DC, round 1 — device wasm size

2026-09-27. Size work only, on `sb4-intent/dc-delivery-client`, starting
at round-0 head `2059ffdd0`. The final local commit includes the code, this
report and the journal entry together. No round-0 review responses, push or
publication.

**The budget remains unmet.** This round removes **6,673 B gzip / 19,891 B
raw** from round 0. The final device is **2,024,468 B raw / 585,362 B gzip**,
**12,521 B over** the unchanged **572,841 B** budget. It is not ready to land.
The remaining delivery implementation adds 13,309 B gzip to the clean base;
that base had only 788 B of headroom. The supervisor owns the budget decision.

## Measurement

Same source directory, Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt,
`CARGO_INCREMENTAL=0`, eight Cargo build jobs. Every production row below
comes from `bash scripts/build-wasm.sh`, with its normal wasm profile,
features, bindgen step and `gzip -9` measurement.

| Revision / change | Raw B | Gzip B | Gzip versus budget |
|---|---:|---:|---:|
| Clean base `3369ae543`, rebuilt this round | 1,981,512 | 572,053 | −788 |
| Round-0 head `2059ffdd0`, rebuilt this round | 2,044,359 | 592,035 | +19,194 |
| Remove two `RuntimeError` debug roots | 2,030,525 | 587,585 | +14,744 |
| Share retention, move membership state, construct JSON interval scalars directly | 2,028,580 | 586,957 | +14,116 |
| Final, including compact interval sorting | **2,024,468** | **585,362** | **+12,521** |

The final row is the full suite's production build, also rebuilt at the code
checkpoint `92b5c83db` with the identical SHA-256, before adding documentation. The immediately preceding
heap-sort probe was 585,363 B gzip; a subsequent blank-line shift in the Rust
source changed source-location data and one compressed byte, with the same
raw size. The raw final delta from base is +42,956 B; gzip is +13,309 B.

For the base rebuild, the changed tracked Rust files were saved, replaced
with `git show 3369ae543:<path>` at their original paths, and restored in a
Python `finally` block with byte equality checks. This avoids attributing
embedded source-path differences to delivery. The worktree was clean before
the measurement. The source swaps completed before implementation edits or final checks started.

Production wasm SHA-256:

```text
base    5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969
round0  837a1dca1413d44cc996b469a7293980007dfbc40e6a7644c2b51f916f0de6a8
final   8fef4df0dd558fb0146d73293c5540f55f64b52514d01850c6b482206c037ed8
```

## Attribution: what grew

Installed twiggy 0.8.0 into `~/.cargo/bin`. Built symbol-bearing versions
with the same profile and feature set, adding only
`CARGO_PROFILE_WASM_STRIP=none`, and ran `twiggy top -n 1000000 --format json`.
Compared shallow symbol sizes after removing crate hashes from names and
excluding debug/name sections. These are **pre-bindgen raw bytes**, not
gzip savings; bindgen prunes code and metadata, and gzip is not additive.

| Class, following `attribute-wasm.mjs` (all data segments grouped together) | Base B | Round 0 B | Final B |
|---|---:|---:|---:|
| Device code | 177,326 | 202,380 | 202,996 |
| Core code | 509,986 | 520,873 | 511,322 |
| Serde deserialization | 474,537 | 481,217 | 481,217 |
| Serde serialization | 78,817 | 80,907 | 80,459 |
| JSON code and generics mentioning JSON values | 59,885 | 67,947 | 67,025 |
| Standard-library generics over Snapback types | 472,303 | 476,396 | 473,522 |
| B-trees over standard-library types | 164,311 | 165,133 | 165,119 |
| Data segments | 90,658 | 94,266 | 92,234 |
| Other code and non-debug metadata | 462,972 | 471,440 | 464,381 |
| Total attributed | 2,490,795 | 2,560,559 | 2,538,275 |

Largest new contributors, relative to base; grouped rows can overlap the
classes above and must not be summed with that table:

| Symbol / family | Round 0 raw B | Final raw B |
|---|---:|---:|
| Newly retained `fmt::Debug` implementations | **11,738** | **0** |
| `Device<MemoryStore>::delivery` | 6,253 | 6,370 |
| `delivery::collect` | 5,901 | 5,946 |
| Interval-pair introsort / smallsort / heapsort family | **4,871** | **0** |
| `DeliveryBinding`'s main text-deserializer visitor | 3,511 | 3,511 |
| `delivery::publish<MemoryTx>` | 3,094 | 3,012 |
| B-tree retention instantiated for delivery predicates | 2,970 | 1,654 |
| `delivery::reconcile` | 1,708 | 1,527 |
| Membership-map clone implementations | **1,291** | **0** |
| `delivery::stage_left<MemoryTx>` | 935 | 935 |
| `delivery::load` | 899 | 899 |
| Publication entry-point growth | 860 | 860 |
| Replacement `BinaryHeap<(i64,i64)>` sorting functions | 0 | 586 |

The surprising root was **two `expect` calls**, in `binding_key` and
`group_key`. Their error type is `RuntimeError`, whose derived `Debug`
reaches the IR. Newly retained formatters included `Stmt` (1,502 B),
`RuntimeError` (1,319 B), `Builtin` (1,002 B), `Expr` (912 B), and
`ColumnType` (812 B). Removing only those roots saved **4,450 B gzip**.
The final artifact has exactly the base's 6,603 B of `Debug` implementations.

There was also a codec-funnel escape hidden in `json!(merged)`: the macro
serialized `Vec<(i64,i64)>` through serde's owned-tree writer. The source
census passed, but the **artifact family census failed on `i64 serialize`**,
which had both an owned-tree writer and the normal text writer. Constructing
JSON arrays and integer scalars directly removes that family. There is no
new content-buffer decoder or second reader for `DeliveryBinding`.

## Files and behavior

- `crates/snapback4-device/src/device/delivery.rs`: propagate key codec errors
  with `?`; use one borrowed predicate for JSON-map retention; move the
  already-loaded membership map into `history::Reading`; remove an unused
  generic transaction argument from eligibility; build interval JSON from
  scalars; sort interval pairs using `BinaryHeap::from(Vec).into_sorted_vec()`.
  The heap reuses the vector allocation, returns the same ascending tuple
  order and retains O(n log n) worst-case work. The existing merge,
  saturating endpoint arithmetic and lowest-interval eviction remain intact.
- This report records attribution, measurements and verification.
- `JOURNAL.md` receives one append-only dated entry after verification.

No schema, durable metadata format, collection hook, public API, authorization,
disclosure, engine meter or budget changes. No new forms. The round-0 fixture
still consumes, for example,
`{"delivery":[{"table":"messages","group":"room","position":"ordinal","mutation":"delivered","args":["conversation","from","through"]}]}`
inside `backend.schema`; fetched positions 41, 42 and 44 still produce
`[[41,42],[44,44]]`. DS's Quarry producer remains outside this lane.

The governing constraints are LLP 3000.022 §3 (eligibility, publication and
activation), §4 (debt bounds), and LLP 3000.002's
`proposed-device-representation-and-codec-redesign` (codec families and measured
attribution). No new design decision or LLP amendment is needed.

## Verification

One new test,
`interval_union_matches_round_zero_for_order_gaps_bounds_and_extremes`,
compares the new path against the exact round-0 sorting/merging algorithm on
**621 cases**: 69 inputs × nine inserted positions. It covers unordered and
duplicate intervals, gaps and bridging, the 256 cap, input beyond the cap,
ignored malformed entries, negative coordinates and both i64 extremes.

Focused client/census run: **74 passed, 0 failed** — all 26 source census
tests and all 48 delivery queue/client/wasm/crash/outbox tests. The delivery
integration tests pass **16/16** on the final code in the full suite; the final
device library passes **48/48**, including the new differential test.

Artifact checks using the existing `collectFamilies`, `checkFamilies` and
`checkAbsent` functions pass: **264 type/direction entries**, one text-reader
family for the binding, no extra i64 writer, no forbidden server code or
Unicode tables, and no `RuntimeError` debug graph.

A separate side-by-side wasm witness ran the round-0 and final symbol-bearing
builds through their matching wasm-bindgen glue: **1,203 commands**, 601
published rows, 256 surviving disjoint debt intervals. Every reply and every
persistence batch was **byte-identical**. Loaded-host call totals were
414.1 ms before and 415.5 ms after; this single diagnostic run makes no
performance claim.

The full Rust inventory passes **3,853 tests / 0 failed / 24 existing ignores**,
including **1,336 device passes / 0 failed / 3 existing ignores**. It ran 238
test binaries as 951 executions, plus doctests, in 910 seconds.

The full ordinary client phase passes **2,595 main tests / 0 failed / 10 existing
skips**, plus **56/56** across the seven additional shards, in 195 seconds.

Required `scripts/test.sh` ran **exactly once**, with eight Cargo jobs,
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`,
`CARGO_PROFILE_TEST_DEBUG=0`, and fd limit 65,536. Exact summary, exit **1**:

```text
== 1 failure(s) in 1443 s
   wasm build
```

The **only failure is lane-owned**: 585,362 B gzip exceeds 572,841 B by
12,521 B. There are **no baseline or environmental failures**. All **78/78**
seeded-model tests pass (274 seconds), as do all **86 guide tests**, the **9
fixture tests**, native build, release guard, docs budget, package build and
typecheck, and both app typechecks. Every round-0 test passes; no test was
removed or weakened. The suite still exceeds its inherited 60-second time
budget; no time or byte budget was raised. No second full run was needed.

Reference audit: **516 LLP docs, 9,602 refs, 0 errors, 0 unchecked**.
Whitespace check passes. The changed Rust file is below 1,500 lines.

## Remainder and reproduction

The remaining **13,309 B gzip over base** pays for the actual collector and
its durable queue interface: publication and replay hooks, held/unexpired
eligibility, bounded exact intervals, retained refusal tombstones, binding
reconciliation, viewer metadata and CAS, and per-binding resumable activation.
It also pays for the agreed binding decoder and the JSON/B-tree/iterator
support those operations use. The largest remaining functions are shown
above. The new binding derive is small and uses the existing codec family;
it did not recursively duplicate the schema/IR readers.

This is the measured remainder after removing the identified unnecessary
formatting graph and generic duplication, **not a proof of a global minimum**.
I stopped the size pass after these local, behavior-preserving reductions.
Getting below the budget would require recovering almost all of the remaining
feature cost, changing its representation or offsetting it with another
device diet. I have not silently changed the delivery design or raised the
budget. This is the requested escalation to the supervisor.

Reproduce the remaining lane-owned failure from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 bash scripts/build-wasm.sh
```

Reproduce a symbol-bearing artifact and its census:

```sh
CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 \
  node scripts/attribute-wasm.mjs --families --check-families --check-absent
```

Evidence is under ignored `target/lane-dc-round1/`: production and symbol
build logs, all three `.wasm` files and `*-sym.wasm` files, `*-symbols.json`,
`base-to-round0.*`, `base-to-final.*`, `round0-to-final.*`, the same-path
baseline driver, parity driver/results, focused checks and the full suite
log/exit. Round-0 review findings and its other open integration limitations
remain in `REPORT.md`; this round does not answer or close them.
