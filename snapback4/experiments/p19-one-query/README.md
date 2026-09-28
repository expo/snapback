# P19: one query, online or offline

Research for [LLP 3000.028](../../../llp/3000.028-one-query-online-or-offline.rfc.md).
No product code changes. All databases, devices and package installations live
in ignored `.work/`. Only the supplied source files are read; the original
SQLite store is copied as bytes and never opened by an engine.

The results compare the published npm 0.4.6 client/server/process device with
the native engine and TypeScript client built from main-source commit
`3a8360db12be50a984b6da50d3634cc4f4cf2467`. That is the lane's initial HEAD and
`origin/main` at orientation, not the older local `main` ref. Versions alone
do not distinguish the arms: [runtime.json](results/runtime.json) records
package integrity/toolchain and each observation file records its binary hash.

## What reproduced

| Finding | Published and main result |
| --- | --- |
| Bare ordinary history after a completed leave sync | Retained row locally, online and offline, no query fallback. Server history empty; guarded progress refuses NOT_MEMBER. **The old UI failure did not reproduce.** |
| Builder's current-membership search | 20 coffee hits, complete on the server; same query returns 20 incomplete device hits offline. |
| Bare held search made ordinary | Online fallback replaces 20 device hits with an empty incomplete server answer. Offline still has 20 hits. |
| Retained chat search | Current-membership predicate excludes its token; held/bare device search finds it. |
| Original windowed raw interaction miss | Online false/false; offline loading, including the composed post, despite empty pending writes. |
| Final public aggregate workaround | Complete false/false offline; all users' key groups replicated. |
| Narrow maintained audience and viewer digest preview | Same E_QUARRY_SYNTAX, E_SYNC and E_QUARRY_BOUND as the historical diagnostics. |
| Horizon-free owner-key pilot | Complete offline presence and absence; remote deletion remains stale until sync, then proves absence. |

The raw device answers and query request paths are in
[published.jsonl](results/published.jsonl) and [main.jsonl](results/main.jsonl).
The first line identifies the runtime; subsequent lines are observations.
History uses two experiment personas and real builder mutations over the
full store. Search uses the existing fixture `u0500` account. No credential
or session token is written to results.

The builder's final `history` already is the ordinary, bare P12 query.
The historical failure says “lost or duplicated”; it does not record a
server answer replacing that query. Earlier builder process/browser probes
passed. Do not turn this reproduction's passing history into a diagnosis
of the old React interleaving. [Historical excerpts](results/historical.json)
retain exact source lines and hashes; the supplied evidence keeps the full logs.

## Files and scope

- `builder.q`: byte-for-byte copy of the final builder program; its hash is
  in [inputs.json](results/inputs.json). No claims about an earlier checkpoint.
- `probes.q`: extra operations used only in the experiment. Reconstructs the
  original direct raw-key existence reads while leaving source windows and
  final summary views intact. The raw queries do not read those views.
- `prepare.py`: hashes inputs, copies SQLite **and WAL** plus assets into
  independent app directories, and prepares three full-program compiler edits.
- `probe.mjs`: runs public clients and process devices, records raw device
  observations, toggles the public fetch hook, parks background change polls,
  applies explicit sync, and stops only child processes it owns.
- `diagnostics.py`: repeats the recorded M6/M8 invalid source changes through
  both compilers; exit 1 is expected for all six invocations.
- `census.py`: reads only P19's stopped main copy, excludes P19 principals,
  and measures extant source/owner keys. It never reads auth tables.
- `own-keys.q` and `own-keys.mjs`: add private, horizon-free experiment tables
  to the builder on each P19 copy; seed u0500's actual key set and test misses,
  hits and deletion. This does **not** implement compiler-generated projections
  or transactional maintenance from likes/reposts.
- `verify.mjs`: asserts the recorded observations and expected diagnostics.
  It validates current evidence, not the unimplemented RFC's acceptance tests.

The owner-key pilot's 568 B is logical stored row bytes for four keys. The
builder's public summaries initially cost 1,342,672 row bytes for 6,012 keys.
Neither number includes indexes, transport framing or standalone database
allocation. Full replica SQLite pages in the two pilot arms differ; they
include unrelated source tables and ongoing copied-store state, so subtracting
them would not measure the key projection's cost.

There is no wasm, browser, Expo, load, p95 or new planner qualification here.
`explicitSyncMs` starts **after** `createLocalClient` and excludes initial
creation/acquisition. It is retained for chronology only, not cold-sync latency.
The future mixed retained/live search merger and its cursor are deliberately
unimplemented. Ordinary-query route semantics, lower-level whole-owner
partition behavior and corpus sizes are the claims needing experiments.

## Reproduction

Run from `snapback4/` on Linux with Node 24 and Rust 1.97. The input directory
defaults to the supplied calibration evidence. Set `P19_EVIDENCE` if relocated.
`prepare.py` refuses an existing app copy; use a new experiment checkout or
explicitly remove only your prior P19-owned app/device directories first.
Do not rerun the probes on a store another lane is using.

```sh
mkdir -p experiments/p19-one-query/.work/published
npm install --prefix experiments/p19-one-query/.work/published --no-audit --no-fund --ignore-scripts snapback4@0.4.6
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build -p snapback4
mkdir -p packages/snapback4/src/wasm
cp experiments/p19-one-query/.work/published/node_modules/snapback4/dist/wasm/*.d.ts packages/snapback4/src/wasm/
./node_modules/.bin/tsc -p packages/snapback4/tsconfig.build.json
python3 experiments/p19-one-query/prepare.py
python3 experiments/p19-one-query/diagnostics.py
node experiments/p19-one-query/probe.mjs published
node experiments/p19-one-query/probe.mjs main
python3 experiments/p19-one-query/census.py
node experiments/p19-one-query/own-keys.mjs published
node experiments/p19-one-query/own-keys.mjs main
node experiments/p19-one-query/verify.mjs
```

The declaration-copy step supports TypeScript imports of the generated web
module in this fresh worktree; these experiments never import the web arm or
execute that module. Main uses its own newly built native device and server.
Do not use this recipe as a wasm build or publication qualification. Existing
worktree JS dependencies were already installed; a fresh checkout also needs
its ordinary workspace dependency install.

The experiments use real time, fresh IDs and ephemeral loopback ports. Byte
hashes and fixture counts should be compared at the same input snapshot;
timestamps, PIDs, device SQLite allocation and query IDs need not be identical.
The immutable input guard is [verify-inputs.py](verify-inputs.py); run it at
the end. It hashes original files as bytes and never opens their database.

## Validation and failure ledger

Both full probes and both owner-key pilots completed. `verify.mjs` passes
for both runtimes. Six compiler failures are expected reproductions, not
product regressions. Root `./ref-check` and `git diff --check` pass; the
reference receipt is retained under `results/`.

One build setup failure: the first main TypeScript build could not resolve
the absent generated wasm module declarations. After copying only the
published `.d.ts` files to the ignored generated directory, the build passed.
The first and corrected build logs are retained. The main Rust build passed
with the existing vendored tiny_http function-pointer warning. Exploratory
file discovery also encountered absent paths in this fresh worktree; no
experiment was skipped on their basis. No runtime assertion failure occurred.

No `scripts/test.sh`, push, package publish, tool installation or shared tool
path change. The local npm installation is an experiment dependency only.
No running P19 server/device is intentionally left behind.

## Orientation context

Applied `llp-orient` read-only from an initialized checkout because this lane's
skill symlink had no populated submodule. Scope: history, search, coverage,
maintained residency and helper bounds; no general corpus or Snapback 1 gates.

Governing documents are LLP 3000 (root), LLP 2000.000 (adopted design brief),
LLP 3000.021 §3.1 (ordinary history), LLP 3000.016 §2.2 (publication/fallback),
LLP 3000.001 (retained component composition), LLP 3000.015 §2 (disclosure and
physical bound), LLP 3000.024 (current search plan), and LLP 3000.007/3000.013
(residency/intent authoring). The .021, .016's related active work, .015, .024,
.007 and .013 constraints were resolved against actual code and current guide
cards; .021, .015, .024 and .013 are linked in `llp/current/`. No Snapback 4
document is linked in `llp/foundation/` in this checkout.

Active constraints: LLP 3000 §2's fixed read vocabulary and partition unit,
LLP 3000.021 §3.1's retained routing, LLP 3000.016 §2.2's speculative-answer
fence, LLP 3000.015 §2's bounded disclosure, and LLP 3000.024's ordered opening
proof. Relevant rationale: false negatives are worse than unavailable scalars;
retention cannot grant new server authority; a merged prefix needs every head.
Current `guide/{sync,search,search_all,maintains,jobs,bounds}` and the client
router were read before proposing changes. Open risks are the historical UI
interleaving, bounded mixed-page continuation, owner-key adoption/prediction,
and unmeasured device bytes. Hand-off: design review of LLP 3000.028, followed
by implementation with the specified guide/diagnostic changes if accepted.
