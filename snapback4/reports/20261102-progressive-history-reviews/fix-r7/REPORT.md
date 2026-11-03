# Progressive history — fix round 7

Date: 2026-11-03. Worktree: `snapback-ph-20261102`, branch
`sb4/progressive-history`, starting HEAD `05594aee8098078bb39dd9fd11ece8e79b9527fa`.
Changes are uncommitted for the supervisor and confined to `snapback4/`.
No agents, clones, remote commands, other checkouts, commit, stash, checkout,
restore, rebase, push, dependency installation or wasm build were used.

## Result

| Requested check | Observed result |
| --- | --- |
| Whole delivery-fault-matrix file | 447 passed, 0 failed |
| Whole progressive-acquisition file | 33 passed, 0 failed, 1 declared browser skip |
| Whole progressive-recovery file | 10 passed, 0 failed |
| Whole progressive-lifetimes file | 7 passed, 0 failed |
| Whole acquisition file | 47 passed, 0 failed |
| Typecheck | Exit 0 |
| JavaScript build | Exit 0 |

**216 classified delivery sites: 101 required, 115 optional.** No site was
removed, exempted, reclassified, or given a default recipe. Both seal files were
regenerated; their bytes are unchanged. The complete matrix passes its exact
boundary and site/recipe comparisons, plus every transient/persistent fault case.

## Diagnosis and classification

The supplied hypothesis differs from the code. Comparing round 4's commit
`f37bdfc0ae` with the current source using TypeScript's AST finds **zero new,
removed, moved-between-these-files or changed await expressions** in the three
named files. Their ordered expression lists are identical:

| Source | Round 4 | Current | Classification of this delta |
| --- | ---: | ---: | --- |
| `packages/snapback4/src/local.ts` | 134 | 134 | Startup condition and progress-reset logic changed synchronously; no new I/O or delivery site. |
| `packages/snapback4/src/local-runtime.ts` | 95 | 95 | Metadata reachability, overload handling and snapshot-restart state changed; the existing waits and delivery classes remain. Includes the existing async iterator. |
| `packages/snapback4/src/acquisition.ts` | 0 | 0 | Null-prototype progress maps are synchronous UI bookkeeping, not durable write delivery. |

The failing site is census index **16**, fixture recipe **166**, logical ID
`local.ts:syncRound:loadBackend(doFetch, base, requestCredentials().headers, aborter.signal)#1`,
physically `packages/snapback4/src/local-runtime.ts:295`. Round 5 (`918307c084`)
changed its guard to require `progressiveState(...).acquired === false`.
The old metadata recipe set compatibility unknown on an already-acquired device;
that device now correctly bypasses discovery. Consequently neither fault mode
reached the selected await. The focused before run reproduced exactly the two
reported injected-fault assertions, while the seal test passed.

This await remains **optional metadata I/O relative to durable write delivery**.
A failed capability fetch pauses sync; it cannot admit, dispatch, acknowledge,
settle, or persist a mutation itself. Its fixture now starts a negotiated cold
walk, durably publishes a real conversation unit into the wasm device, pauses
before the remaining units, and uses the existing unknown-compatibility hook.
The device's actual cursor, whole-table fact, `acquired=false`, and
`replacement_required=false` are asserted; no sync-state reply is forged.

Faults are thrown by the `/schema` transport below the selected await. The
transient case must experience exactly one such failure, and the persistent case
must experience repeated failures. Both retain all original delivery assertions:
three healthy unique sends, no repost, FIFO head/tail ordering, one terminal
notification per id, lookup agreement, bounded retries, successful caller
outcomes, and same-id outcome collection without another send. Acquisition stays
false during the paused walk even after sends succeed. Removing the fault and
resuming the remaining units must make explicit sync finish acquired.

The existing required durable-write sites and their fault/recovery recipes are
unchanged; all 101 remain exercised by the full file. `LocalAcquisition.sync`'s
already-reviewed owner-sequencing awaits remain covered by progressive-recovery's
first/later rejection and stopped-round cases. No new metadata or durable-write
site was silently exempted.

## Changed files

Paths and line numbers below are relative to `snapback4/`.

- `packages/snapback4/test/delivery-fault-fixture.mjs:30`: opt-in unfinished
  acquisition transport, capability advertisement, first published unit,
  remaining packed units/floors and explicit resume (`:123`). All default fixture
  paths retain their previous behavior. This is scripted transport over the real
  wasm device, not a server implementation change.
- `packages/snapback4/test/delivery-fault-matrix.test.mjs:113`: select that fixture
  only for metadata; `:129` records actual schema transport faults; `:154` checks
  durable partial state; `:161` and `:175` probe the healthy write transport after
  intentional sync pauses; `:293` checks one/repeated faults and incomplete
  acquisition; `:307` verifies full recovery. Existing FIFO/outcome assertions
  are retained, without loosening required/optional failure semantics.
- `packages/snapback4/test/delivery-fault-recipes.mjs:6`: document the metadata
  recipe's reachability and its delivery/recovery obligations. Mapping unchanged.
- `packages/snapback4/test/delivery-fault-instrument.mjs:863`: record the honest
  rounds-5/6 await audit and the repaired fixture; instrumentation/scope unchanged.
- `reports/20261102-progressive-history-reviews/fix-r7/audit.mjs:1`: reproducible
  AST comparison with round 4 and complete seal/classification verification.
  `seal.mjs:1` regenerates both seal files; `run.py:1` records exact child argv,
  exits, raw logs and verbatim summaries. This report and command evidence live
  beside them.

`delivery-await-boundary.json` and `delivery-fault-sites.json` were regenerated
successfully but produce no diff because expressions, IDs and classifications
were already correct. `git diff --exit-code -- packages/snapback4/src
packages/snapback4/test/delivery-await-boundary.json
packages/snapback4/test/delivery-fault-sites.json` exited 0 with no output.
No product behavior, contract, Rust, guide, refusal code, LLP, journal or budget
was changed. Changed test files are 140/869/425/269 lines, all below 1,500.

## Earlier diagnostics, retained rather than counted as passes

- `metadata-before`: 1 passed (census), 2 failed, matching the reported
  unreachable-injected-fault assertions on the original recipe.
- `metadata-after`: first fixture attempt, 1 passed, 2 failed on the expected
  partial cursor. The synthetic page mistakenly used an array for
  `committed_above`; the device protocol uses a map, corrected to `{}`.
- `metadata-after-wire-fix`: 1 passed, 2 failed because the deliberate acquisition
  pause left the transport offline before the head write. Added a real probe.
- `metadata-after-probe`: 1 passed, 2 failed on successful caller outcomes because
  the head's follow-up observation again paused sync before tail admission.
  Reconnected before admitting the tail; no assertion was weakened.
- `metadata-after-reconnect`: all 3 passed. The final full matrix additionally
  includes the strengthened exact-schema-fault and acquisition-recovery assertions.

## Scope limits and open questions

- `react.test.mjs` and `witness/idb.mjs`: **not run (sandbox)**, as instructed.
  Progressive acquisition reports its existing explicit browser skip:
  `not run (sandbox): react.test.mjs and witness/idb.mjs SIGABRT; supervisor owns browser validation`.
  No browser/React pass is claimed.
- No wasm build. The JavaScript build copies the existing supervisor-built wasm;
  the matrix executes that artifact. No wasm budget was changed.
- No Rust suite, complete battery, affected runner, publication qualification,
  remote test or performance measurement was run; this is test infrastructure
  maintenance and the requested scoped checks only. Supervisor-provided Rust
  verification is not represented as this round's work.
- All requested loopback suites passed their first full invocation in this round;
  there was no loopback-binding failure requiring a rerun.
- No unresolved product/design question. The supervisor owns committing and
  landing. The current implementation, rather than the prompt's new-await
  hypothesis, governs the classification above. STOP after this report.

## Commands and verbatim summaries

All bun and validation commands ran from `snapback4/`. The recorder selects
`/Users/ccheever/.volta/tools/image/node/24.18.0/bin` first on PATH; the actual
runtime reports `v24.18.0`. No install was needed. For every recorded run below,
the shown wrapper is the actual shell command; `commands.jsonl` also contains
its child argv and exit. Raw logs are linked. All summary lines are copied
verbatim, including failed diagnostic runs. An exit-zero typecheck with only its
script line is not assigned an invented test count.

### typecheck

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py typecheck bun run --cwd packages/snapback4 typecheck` — exit 0. [Raw log](logs/typecheck.log).

```text
$ tsc -p tsconfig.json --noEmit
```

### build

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py build bun run --cwd packages/snapback4 build` — exit 0. [Raw log](logs/build.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

### metadata-before

`RG_MATRIX_SITE=16 python3 reports/20261102-progressive-history-reviews/fix-r7/run.py metadata-before node --test packages/snapback4/test/delivery-fault-matrix.test.mjs` — exit 1. [Raw log](logs/metadata-before.log).

```text
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5171.736334
```

### metadata-after

`RG_MATRIX_SITE=16 python3 reports/20261102-progressive-history-reviews/fix-r7/run.py metadata-after node --test packages/snapback4/test/delivery-fault-matrix.test.mjs` — exit 1. [Raw log](logs/metadata-after.log).

```text
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1071.34825
```

### metadata-after-wire-fix

`RG_MATRIX_SITE=16 python3 reports/20261102-progressive-history-reviews/fix-r7/run.py metadata-after-wire-fix node --test packages/snapback4/test/delivery-fault-matrix.test.mjs` — exit 1. [Raw log](logs/metadata-after-wire-fix.log).

```text
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1084.545125
```

### metadata-after-probe

`RG_MATRIX_SITE=16 python3 reports/20261102-progressive-history-reviews/fix-r7/run.py metadata-after-probe node --test packages/snapback4/test/delivery-fault-matrix.test.mjs` — exit 1. [Raw log](logs/metadata-after-probe.log).

```text
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3128.752375
```

### metadata-after-reconnect

`RG_MATRIX_SITE=16 python3 reports/20261102-progressive-history-reviews/fix-r7/run.py metadata-after-reconnect node --test packages/snapback4/test/delivery-fault-matrix.test.mjs` — exit 0. [Raw log](logs/metadata-after-reconnect.log).

```text
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3134.70825
```

### audit

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py audit node reports/20261102-progressive-history-reviews/fix-r7/audit.mjs` — exit 0. [Raw log](logs/audit.log).

```text
await audit: local.ts: 134 -> 134; 0 new, 0 removed, 0 changed expressions
await audit: local-runtime.ts: 95 -> 95; 0 new, 0 removed, 0 changed expressions
await audit: acquisition.ts: 0 -> 0; 0 new, 0 removed, 0 changed expressions
await audit: 216 classified sites; 101 required, 115 optional; seals match
```

### seal

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py seal node reports/20261102-progressive-history-reviews/fix-r7/seal.mjs` — exit 0. [Raw log](logs/seal.log).

```text
await seal: 216 classified delivery sites and recipes
```

### progressive-lifetimes

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py progressive-lifetimes node --test packages/snapback4/test/progressive-lifetimes.test.mjs` — exit 0. [Raw log](logs/progressive-lifetimes.log).

```text
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12313.186
```

### progressive-recovery

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py progressive-recovery node --test packages/snapback4/test/progressive-recovery.test.mjs` — exit 0. [Raw log](logs/progressive-recovery.log).

```text
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16978.77525
```

### progressive-acquisition

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py progressive-acquisition node --test packages/snapback4/test/progressive-acquisition.test.mjs` — exit 0. [Raw log](logs/progressive-acquisition.log).

```text
ℹ tests 34
ℹ suites 0
ℹ pass 33
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 48447.6165
```

### delivery-fault-matrix

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py delivery-fault-matrix node --test packages/snapback4/test/delivery-fault-matrix.test.mjs` — exit 0. [Raw log](logs/delivery-fault-matrix.log).

```text
ℹ tests 447
ℹ suites 0
ℹ pass 447
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 149545.283542
```

### acquisition

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py acquisition node --test packages/snapback4/test/acquisition.test.mjs` — exit 0. [Raw log](logs/acquisition.log).

```text
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 138755.200792
```

### node-version

`python3 reports/20261102-progressive-history-reviews/fix-r7/run.py node-version node --version` — exit 0. [Raw log](logs/node-version.log).

```text
v24.18.0
```

## Inspection and preparation commands

These commands inspect files, diffs, or running logs; they are not test passes.
Ordinary `cat`/`sed`/`rg`/Git reads emit source or inspection output, not a test
summary line. Their exact shell text and exit status follow in execution order;
the machine-readable copy is [shell-commands.json](shell-commands.json).
The first broad reads were output-truncated and followed by smaller reads.
Two mistyped inspection paths failed (listed as exit 1); neither ran a test.
Edits used apply_patch, not additional shell commands. Tool waits only collected
already-running processes and are not reruns.

Directory: `repository root`; exit 0; no test summary.

```sh
cat llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '1,240p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '241,480p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '481,720p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '721,980p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '241,480p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '481,720p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
cat snapback4/AGENTS.md snapback4/NOT-DOING.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '981,1180p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
rg -n 'Repair [ABC]|^##' llp/3000.001-durable-replica-and-write-lifecycle.research.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '230,440p' snapback4/AGENTS.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '1,170p' snapback4/NOT-DOING.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '650,885p' llp/3000.001-durable-replica-and-write-lifecycle.research.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
cat snapback4/reports/20261102-progressive-history-reviews/fix-r4/REPORT.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
cat snapback4/reports/20261102-progressive-history-reviews/fix-r6/REPORT.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
git status --short --branch
```

Directory: `repository root`; exit 0; no test summary.

```sh
rg --files snapback4 | rg 'delivery-(await|fault)|AGENTS.md$|package.json$'
```

Directory: `repository root`; exit 0; no test summary.

```sh
sed -n '200,235p' snapback4/AGENTS.md
```

Directory: `repository root`; exit 0; no test summary.

```sh
tail -n 65 snapback4/JOURNAL.md
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat packages/snapback4/test/delivery-fault-instrument.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat packages/snapback4/test/delivery-fault-recipes.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat reports/20261102-progressive-history-reviews/fix-r4/seal.mjs reports/20261102-progressive-history-reviews/fix-r6/run.py
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat packages/snapback4/test/delivery-await-boundary.json
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,240p' packages/snapback4/test/delivery-fault-matrix.test.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat packages/snapback4/test/delivery-fault-recipes.mjs reports/20261102-progressive-history-reviews/fix-r4/seal.mjs reports/20261102-progressive-history-reviews/fix-r6/run.py
```

Directory: `snapback4`; exit 0; no test summary.

```sh
tail -n 100 packages/snapback4/test/delivery-fault-instrument.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '230,345p' packages/snapback4/test/delivery-fault-matrix.test.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '240,340p' packages/snapback4/src/local-runtime.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat packages/snapback4/src/acquisition.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git log -6 --oneline -- packages/snapback4/src/local.ts packages/snapback4/src/local-runtime.ts packages/snapback4/src/acquisition.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git diff f37bdfc0ae -- packages/snapback4/src/local.ts packages/snapback4/src/local-runtime.ts packages/snapback4/src/acquisition.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,250p' packages/snapback4/test/delivery-fault-fixture.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n 'awaitBoundary|metadata|syncRound.*loadBackend|acquired' packages/snapback4/test/delivery-fault-instrument.mjs packages/snapback4/test/delivery-fault-sites.json
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat package.json packages/snapback4/package.json
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat packages/snapback4/src/local-acquisition.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,220p' packages/snapback4/test/helpers/progressive-acquisition.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n 'acquire:|pinned|pin:|cursor:|acquisition' packages/snapback4/test/progressive-lifetimes.test.mjs packages/snapback4/test/progressive-recovery.test.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '215,250p' packages/snapback4/test/delivery-fault-instrument.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '305,340p' packages/snapback4/test/delivery-fault-instrument.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '585,680p' packages/snapback4/src/local-runtime.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '430,510p' packages/snapback4/src/local-runtime.ts
```

Directory: `snapback4`; exit 1; no test summary.

```sh
sed -n '1,150p' packages/snapback4/crates/snapback4-device/src/device/acquisition.rs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,140p' packages/snapback4/test/progressive-recovery.test.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,185p' crates/snapback4-device/src/device/acquisition.rs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '700,760p' packages/snapback4/src/local-runtime.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,60p' packages/snapback4/test/chat-schema.json
```

Directory: `snapback4`; exit 1; no test summary.

```sh
wc -l llp/3000-snapback4.explainer.md llp/2000.000-keep-the-core-flip-two-substrates.rfc.md
```

Directory: `snapback4`; exit 0; no test summary.

```sh
python3 - <<'PY'
from pathlib import Path
import shutil
p=Path('reports/20261102-progressive-history-reviews/fix-r7')
p.mkdir(exist_ok=True)
shutil.copyfile(p.parent/'fix-r6/run.py',p/'run.py')
shutil.copyfile(p.parent/'fix-r4/seal.mjs',p/'seal.mjs')
print('prepared fix-r7 command recorder and seal generator')
PY
```

Directory: `snapback4`; exit 0; no test summary.

```sh
cat packages/snapback4/src/device-version.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n 'floor.*whole|acquisitions:|acquire:.*unit' packages/snapback4/test/progressive-acquisition.test.mjs packages/snapback4/test/*.mjs | head -n 45
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n 'sync_state|snapshot_catchup|loadBackend' packages/snapback4/src/local.ts | tail -n 22
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,145p' ../llp/3000-snapback4.explainer.md
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '1,180p' ../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md
```

Directory: `snapback4`; exit 0; no test summary.

```sh
sed -n '510,575p' packages/snapback4/src/local-runtime.ts
```

Directory: `snapback4`; exit 0; no test summary.

```sh
head -n 35 reports/20261102-progressive-history-reviews/fix-r7/logs/metadata-after.log
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n 'committed_above' crates/snapback4-core/src/partition.rs crates/snapback4-device/src/device.rs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n -A3 '"(local.ts|local-runtime.ts|acquisition.ts)"' packages/snapback4/test/delivery-await-boundary.json
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git diff --check
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git diff --stat
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git diff -- packages/snapback4/test/delivery-fault-fixture.mjs packages/snapback4/test/delivery-fault-matrix.test.mjs packages/snapback4/test/delivery-fault-recipes.mjs packages/snapback4/test/delivery-fault-instrument.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
wc -l packages/snapback4/test/delivery-fault-{fixture,instrument,matrix.test,recipes}.mjs packages/snapback4/test/delivery-{await-boundary,fault-sites}.json
```

Directory: `snapback4`; exit 0; no test summary.

```sh
tail -n 5 reports/20261102-progressive-history-reviews/fix-r7/logs/delivery-fault-matrix.log
```

Directory: `snapback4`; exit 0; no test summary.

```sh
tail -n 32 packages/snapback4/test/delivery-fault-matrix.test.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
tail -n 12 reports/20261102-progressive-history-reviews/fix-r7/logs/delivery-fault-matrix.log
```

Directory: `snapback4`; exit 0; no test summary.

```sh
tail -n 8 reports/20261102-progressive-history-reviews/fix-r7/logs/progressive-acquisition.log
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git diff --exit-code -- packages/snapback4/src packages/snapback4/test/delivery-await-boundary.json packages/snapback4/test/delivery-fault-sites.json
```

Directory: `snapback4`; exit 0; no test summary.

```sh
python3 - <<'PY'
from pathlib import Path
import json
p=Path('reports/20261102-progressive-history-reviews/fix-r7/commands.jsonl')
for line in p.read_text().splitlines():
    r=json.loads(line)
    print(f"{r['name']}: exit {r['exit']}")
PY
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git rev-parse HEAD
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n 'partialAcquisition|resumeAcquisition|6.2-the|metadataFaults|scenario === .metadata.|fix-r7|metadata:|export function awaitBoundary' packages/snapback4/test/delivery-fault-{fixture,matrix.test,instrument,recipes}.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
tail -n 12 reports/20261102-progressive-history-reviews/fix-r7/logs/delivery-fault-matrix.log
```

Directory: `snapback4`; exit 0; no test summary.

```sh
tail -n 10 reports/20261102-progressive-history-reviews/fix-r7/logs/acquisition.log
```

Directory: `snapback4`; exit 0; no test summary.

```sh
rg -n 'skip|browser' packages/snapback4/test/progressive-acquisition.test.mjs
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git diff --check
```

Directory: `snapback4`; exit 0; no test summary.

```sh
git status --short
```

Preparation command output:

```text
prepared fix-r7 command recorder and seal generator
```

`git diff --check` passed twice (exit 0, no output). The source-and-seal no-diff
check passed (exit 0, no output). No source file was restored from Git.

Final reporting command (from `snapback4/`):

```sh
python3 reports/20261102-progressive-history-reviews/fix-r7/write-report.py
```

It verifies the required successful exits and copied summary lines against their
logs, includes every diagnostic summary, and enforces this report's line limit.
Its success summary is:

```text
report written and verified; all command summaries retained; 216 classified sites
```
