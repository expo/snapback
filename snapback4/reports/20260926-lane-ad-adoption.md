# Lane AD: adding maintained views without blocking reads

## Governing context

Scope: store activation, aggregate rebuild/capture, HTTP query readers and sync.
LLP 3000.019 (current) owns P10; LLP 3000.015 (current), §3 owns pending
row-view recounts. LLP 3000.000#implementation-follow-up owns atomic candidate
activation and persisted identity guards. LLP 3000.007.003#3.2 owns historical
reference captures: an existing recorded path must never be re-resolved.
LLP 3000.007#20.24.1 owns metered stored-row admission; LLP 3000.015#1 and #2
own disclosure and bounded authorization. The guide's maintains card is the
current authoring surface. No syntax addition is needed.

The initial code already folds each aggregate into a map and writes one row per
group. The suspect work is whole-store index replacement and row validation,
plus activation-time capture. The availability question is whether independent
WAL readers can retain existing identity checks and serve the old generation
while the single writer builds an atomic candidate. Hand-off: none.

## Reproduction

From `snapback4/`, with Cargo on PATH:

```
CARGO_BUILD_JOBS=8 CARGO_PROFILE_TEST_DEBUG=0 SNAPBACK4_ADOPTION_SCALE=1 \
  cargo test -p snapback4-core --test adoption_scale -- --ignored --nocapture
```

The ignored fixture compiles calibration #22's actual schema and windows
module. Its M7 form omits the M8 views and subsequent queries/job. It builds
1,008 profiles, 5,921 follows, 48,224 originals, 2,004 replies, 5,008 likes,
1,004 reposts, 1,002 chats with two members each, and 99,105 messages. Twenty-three
followers of the prolific author reproduce per-reader Following materialization.
Mapped rows use the application's mutations because timeline imports refuse;
ordinary tables use engine seeds. This is a synthetic distribution at the
reported counts, not the unavailable original replay database. It omits
message delivery receipts and unrelated identity/effect history.

A reusable M7 database and working M8 copy live beneath the test crate's
`target/adoption-scale/` (override `SNAPBACK4_ADOPTION_DIR`). A ready marker is
written only after fixture construction and WAL checkpoint complete.

## Baseline, before optimization

Measured on `expose-builder-pixel` (96 logical CPUs), Rust 1.97.0, test profile
opt-level 1, eight Cargo build jobs, dev/test debug information disabled. `perf`
is absent. SQLite's normal cache and FULL durability apply to the measured
adoption; fixture generation alone uses a 128 MiB cache and longer delivery
slices, with the existing job meters unchanged.

The settled store has **1,447,960 rows and 8,863,718 index entries**. Adoption:
**171,946 ms**; the read waiting for the serving engine: **171,948 ms**.

| Phase | Milliseconds |
|---|---:|
| Preflight (including successor assessment and old-key checks) | 3,788.815 |
| Projection and index replacement | 142,046.153 |
| Cap counts | 0.145 |
| Derived rebuild, including captures below | 6,481.720 |
| Reference capture alone (included above) | 2,156.589 |
| Final validation | 12,850.041 |
| Generation metadata | 2.219 |
| Commit/checkpoint | 6,776.048 |

| View | Source rows | Milliseconds |
|---|---:|---:|
| dailyLikes | 5,008 | 12.670 |
| dailyPosts | 50,228 | 221.192 |
| originalTotals | 50,228 | 215.526 |
| receivedLikes | 5,008 | 12.147 |
| receivedReplies | 50,228 | 206.514 |
| receivedReposts | 1,004 | 2.907 |
| unread (also unnecessarily selected by M8's source index changes) | source counter not instrumented for row-keyed views | 3,612.381 |

The six new grouped folds total **670.957 ms**. Grouping and per-row evaluation
are already fast; reference hops are captured separately once per source/path.
The dominant cost is the SQLite delete/reinsert of unrelated indexes, with
repeated statement preparation. The existing folds already write each aggregate
row once and have no per-increment commit or log image. Aggregate metering is
included in fold times; this timer profile does not isolate its instruction cost
or count every SQLite statement. The one final commit includes checkpoint cost
from rewriting millions of entries. No aggregate algorithm change is justified
by this baseline.

Pristine lane-base wasm: 2,025,652 B raw / **582,552 B gzip**, **458 B over** the
unchanged 582,094 B budget. Instrumentation: same raw bytes / 582,554 B gzip.
The pristine measurement temporarily restored every modified core source from
5429a3d1f and restored the working files afterwards. Full output is retained.
