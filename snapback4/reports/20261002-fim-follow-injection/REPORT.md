# FIM round 0 — deterministic delivery fault injection

Base: `1687b58af2d4aa7483575e2421dff70e1d918925`, branch
`sb4-intent/fim-follow-injection`. Test infrastructure only. Product source,
the await boundary seal, fault classifications and recipes are unchanged.

## Resolution and why this tests the real path

The injector associates host/transport I/O with its classified await using
`AsyncLocalStorage`. `syncOnce()` can instead return an existing promise:
its I/O keeps its creator's context. Merely reaching `await syncOnce()`
therefore did not guarantee an opportunity to inject a fault.

This change takes the scheduling-barrier option. Immediately before evaluating
a classified shared-operation call, it drains the current promise and rechecks
for any replacement. The final idle check and the real call execute in the
same JavaScript turn. The returned promise must equal the client's newly
active operation. Consequently, the actual target call starts the actual
`syncRound`/native installation, and its real host/transport I/O inherits the
target context. No injected error is thrown directly at these awaits, no
operation body or result is replaced, and no product file receives hooks.
Read-only state getters exist only in the instrumented temporary package.

The competing-operation regression uses Astra's hook: start `syncOnce()` in
`stack.run([])` immediately before the target await. The old harness joins
that promise and misses the fault. The new barrier drains it before letting
the target start its own operation. Counters require an actual competitor,
its drainage, and a newly owned target operation. The same adversarial
schedule now covers all five identified shared-operation call sites and the
follow timer's failed-sync input, in transient and persistent modes: twelve
additional cases, for **333** total.

Follow also needs a reachability barrier. A write can invalidate the fixture's
earlier long poll before `changed(11)` resolves it. A fixed count of immediate
turns does not guarantee that the replacement poll's real timer has resumed.
The fixture now drives one change notification at a time, advancing the fake
clock until the actual follow sync await is reached. This happens before the
existing eight five-second retry epochs. It does not wait for or manufacture
an injected-fault count. The original no-spin, retry bound, recovery, FIFO,
exactly-once notification, caller-collection, reachability and strictly
positive injection assertions all remain. [The mechanical audit](./assertion-audit.json)
confirms all 40 original assertion-bearing lines are preserved verbatim.

## Attribution audit

| Await / mechanism | Disposition |
| --- | --- |
| `local.ts:follow:syncOnce()#1` (47 here) | Drain active sync immediately before real call. |
| Follow retry timer (48 here) | Apply same barrier to preceding sync; retain real `/sync` fault and nonrejecting timer. |
| `local.ts:flushOnce:syncOnce()#1` (55) | Same shared `syncing` promise; same barrier and competing regression. |
| `local-receipts.ts:syncSettledWrites:sync()#1` (84) | Callback is `syncOnce`; same barrier and competing regression. |
| `syncRound:installNative` (24), `local-query.ts:route:env.installNative` (150) | Native installer also shares an in-flight promise; drain it and add competing-install regressions. |
| `syncUnobserved` callers (64–69) | Classified outer awaits encounter their own `queued()` I/O before any shared sync; nested sync await is separately covered above. |
| `flush:flushOnce` (49) | `flushOnce` creates work; sharing is in the outer `flush` scheduler, outside this await. |
| Media reconcile, history reads/saves | Serial queues register a fresh callback in the caller's context; they do not return a previously created operation as these calls do. |
| Clock persistence | Sharing is outside the classified `save:core.call` await; that await directly owns the actual I/O. |
| `exitDone`, exit settlement `work`, changes `Promise.race`, local `call:work` | Existing explicit alias, failed-input, direct or postcommit recipes already cover pre-created work; these do not assume newly inherited target I/O. |

The unchanged census and `delivery-await-boundary.json` pass their exact
comparisons. Their source hashes and the unchanged product/wasm hashes are
in [source-custody.json](./source-custody.json).

## Qualification

Host: `expose-builder-pixel`, Linux x86_64, AMD EPYC 9454, 48 physical cores /
96 available logical CPUs, Node **24.13.1**. Each measured arm ran **200
complete matrix processes**, with **96 concurrent slots**, both fault modes,
the ordinary Node test runner, and no `--test-force-exit`, filtering or retries.
Each source arm was copied into a private ignored package snapshot before
launch; each copies `src/`, `dist/`, `test/` and `package.json`, with a
symlink to the built package's `node_modules`. Both use identical product
source, package dependencies and wasm.
The final arm additionally overlapped build/test work and a rejected development
batch. These are contention/failure-count measurements, not latency comparisons.

| Run | Result |
| --- | --- |
| Old full matrix × 200 | **3 failed runs / 200**; 64,197 passing cases and 3 failing cases. |
| Final full matrix × 200 | **0 failed runs / 200**; **66,600/66,600 cases pass**, 333 in every run. |
| Astra hook on unchanged old harness, follow sync in both modes | **2/2 fault cases fail** only the injection assertion; census passes. |
| Permanent competing-sync regression with only quiescence removed | **2/2 fail** injection, both reached, three writes and three terminal notifications each. |
| Final focused shared-operation tests | **25/25 pass**, including twelve adversarial cases. |
| Affected clients | **615 passed, 0 failed, 1 conditional legacy-binary skip** (616 total). |
| Guide | **110 passed, 0 failed**. |
| `scripts/test.sh` (one invocation) | **`== 0 failure(s) in 1661 s`**; exit 0. Client phase: 5,780 passed / 10 skipped; models: 79/79 passed. |

All three natural old failures report
`the classified await must actually experience an injected fault`:

- Run 006: `47 persistent: local.ts:850 follow`.
- Run 175: `47 persistent: local.ts:850 follow`.
- Run 200: `48 transient: local.ts:855 follow`.

They are **baseline harness failures**. Their individual interleavings were
not recorded. The forced old control independently proves the sharing hole:
the transient case reaches the target, injects zero faults and delivers all
three writes; the persistent case also misses target reachability. Both pass
all preceding FIFO, recovery and three-notification assertions. The separate
`without-quiescence` mutation control retains the final reachability driver
and removes only the idle-drain loop, to isolate attribution in both modes. See
[competing-old.json](./competing-old.json) and
[competing-old.log](./competing-old.log). The permanent new cases retain those
same delivery assertions, plus the competing-operation witnesses.

## Failure ledger

- **Baseline:** the three old-load coverage misses above; no product regression
  is attributed from these failures. The old smoke was 321/321.
- **Expected negative control / baseline:** Astra's old competing-sync hook,
  two coverage failures (transient and persistent), zero other failures.
- **Ours, corrected:** first focused candidate, two coverage failures:
  ordinary follow-sync transient and competing follow-sync persistent. Both
  recorded `reached: false`, identifying the additional poll reachability gap.
  Preserved in `focused.log` / `focused.json`.
- **Ours, corrected:** second focused candidate, eight
  `Cannot read properties of null (reading 'resolve')` failures: the ordinary
  and competing follow-sync and follow-timer cases in both modes. Two fixture
  change drivers could consume the same poll. Removed the earlier detached
  driver for these cases and serialized the remaining notifications.
  Preserved in `focused-final.log` / `focused-final.json` (historical filename;
  this is a rejected candidate). The actual final focused evidence is
  `focused-3.log` / `focused-3.json`.
- **Ours, excluded development batch:** `new-load` was mistakenly launched
  before inspecting that failed focused result and against the live working
  tree. Its source changed during execution. All its results are retained,
  but none count in either of the two sealed 200-run comparison arms.
  **104/200 runs fail** with all eight null-poll errors above (832 test
  failures). Runs 097 and 098 additionally fail the await seal while the
  overlapping wasm build has temporarily removed the two generated `.d.ts`
  leaves (834 failures total). This is **ours: test orchestration**, with
  direct missing-leaf evidence, not a product/seal change. The other 96 runs
  pass after the correction; no results from this mixed batch qualify the fix.
- **Expected negative control:** `without-quiescence.log` / `.json`, both
  permanent competing-sync modes fail only positive injection; target reached
  in both, zero injected faults, all three sends and terminal notifications.
- **Affected clients:** no failures; the one skip requires an external published
  0.2.32 binary (`SNAPBACK4_LEGACY_BIN`) and is explicitly reported.
- **Full suite: none.** Exact summary: `== 0 failure(s) in 1661 s`.
  Rust targets and doctests pass; all 5,780 ordinary client tests and 79 model
  tests pass. Ten conditional client skips comprise five macOS-only cases,
  three published-legacy-binary controls, and two managed-identity fixtures
  requiring external binary/scratch inputs. No test is manually disabled.
  There are no remaining introduced or baseline failures in this invocation,
  and no environmental test failures to attribute.

- **Ours, evidence formatting:** staged diff checking flagged the raw guide
  log's trailing blank line. It is archived byte-for-byte as `guide.log.gz`;
  the subsequent staged diff check passes.

No failure is called environmental solely because a rerun passed.

## Commands and evidence

From `snapback4/`:

```sh
bun install --frozen-lockfile
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test --workspace --no-run
python3 reports/20261002-fim-follow-injection/run-load.py target/fim-old reports/20261002-fim-follow-injection/old-load
python3 reports/20261002-fim-follow-injection/run-load.py target/fim-new reports/20261002-fim-follow-injection/final-load
RG_MATRIX_SITE=24,47,48,55,84,150 node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
ulimit -n 4096
node --test --test-reporter=tap --test-concurrency=8 packages/snapback4/test/delivery-*.test.mjs packages/snapback4/test/delivery.test.mjs packages/snapback4/test/sync-after-call.test.mjs packages/snapback4/test/sync-generation.test.mjs packages/snapback4/test/sync-overflow.test.mjs packages/snapback4/test/native-smoke.test.mjs packages/snapback4/test/legacy-receipts.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Each arm's `summary.json` enumerates all 200 exit statuses, test totals and
failure names; `load-logs.tar.gz` preserves each full `ARM/NNN.tap.gz`
log for all 600 measured and rejected development runs. Extract the archive
from this report directory to restore the per-arm log paths. The load runner's 1,800 s
outer guard diagnoses a hung process, not a product latency threshold.
The old competing control runs in `target/fim-old` with `RG_MATRIX_SITE=47`,
`RG_MATRIX_OUTPUT` pointing to `competing-old.json`, and
`node --import /absolute/path/to/competing-old-hook.mjs --test --test-reporter=tap
packages/snapback4/test/delivery-fault-matrix.test.mjs`.

`scripts/test.sh` was started while the fixture-only reachability correction
was finishing; its client phase loads the final harness. Product source was
unchanged throughout. It is not rerun to erase failures.

## Scoped LLP orientation and audit

Scope: the delivery matrix, its instrument and unchanged await seal.
Governing references: LLP 3000 §1/§7 (Snapback 4 fence, real client and
contention qualification), LLP 2000.000 §11 (simulation), and LLP 3000.019
§3.3 (durable terminal delivery, optional housekeeping, FIFO, fault census;
in `llp/current/`). Read the current compiler guide's client card as well.
The Snapback 4 root is not linked in this checkout's `foundation/`.
The repository's `llp-orient` symlink was missing; the installed skill at
`/home/ccheever/projects/ibex/skills/llp-orient/SKILL.md` supplied the read-only
orientation procedure. No product contract or LLP decision changes here;
the test scheduling resolution belongs in this report, ticket and journal.
No new corpus document or new gate is introduced. Hand-off: none.

Committed locally with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
