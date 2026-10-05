# PW — per-row browser navigation

Date: 2026-10-05. Branch: `sb4-intent/pw-per-row-navigation`.
Base: see [base.txt](evidence/base.txt). Work on eb1000; Darwin qualification
uses only `ccheever@100.64.36.16` and the owned `/tmp/sb4-pw.5NqQOL` scratch.
No push or publication. No SDK, engine, wasm source, clock, workload, hang
budget, or zero-loading assertion changes.

## Finding and attribution limit

A Vite dependency-optimizer reload can destroy this fixture's execution context
while its 1,000-hook test is evaluating. A controlled late `react-dom` import
reproduces the exact exception **60/60 under CPU hogs on Linux and 30/30 on
Darwin**. The recorded causal chain is:

1. Vite logs `dependency optimized: react-dom` and `optimized dependencies changed. reloading`.
2. Its hot channel sends `{type:"full-reload",path:"*"}`; the browser receives it.
3. CDP records a scheduled/requested navigation with `reason:"reload"`.
4. `page.evaluate` rejects with `Execution context was destroyed, most likely because of a navigation`.
5. The page closes and browser disconnects only after the test enters teardown.

No page crash, watcher event or server restart precedes those failures. The
controlled import is **deliberate dependency discovery**, not an injected
`location.reload`, synthetic hot-channel message, or simulated SDK error.
The control waits one second inside the evaluation solely to expose the
navigation; this delay is absent from qualification and the committed regression.
The failing original per-row test does not start a Snapback server: its HTTP
backend is mocked. SDK source contains no location navigation/reload or service
worker registration. The observed control is a Vite fixture failure, not an SDK
retention or memory defect.

**The uninstrumented M5 attempt cannot be attributed conclusively.** Its stack
line numbers match the fixture before `7e03a5cea9` (NZ round 8). That commit,
already present in this worktree's base, disables HMR and file watching. NZ's
[report](../20261003-nz-native-proof-zero-cost/REPORT.md) explicitly leaves its
own original event unattributed. Both current main's fixture and a reconstruction
removing just those two options passed 60 isolated target-test invocations on
each host. The old fixture used 32 CPU hogs on four Linux CPUs. No M5 logs or
processes were accessed. These controls establish a real matching mechanism;
they do not retroactively turn missing telemetry into evidence.

## Change

`test/helpers/browser-server.mjs` creates immutable Vite fixtures with all five
React entry points explicitly prebundled, dependency discovery disabled, HMR
disabled, and no file watcher. Each root owns its `.vite` cache. Supplied aliases,
plugins, backend routing and explicit Playwright reloads remain. Darwin filesystem
allow lists use canonical paths.

The per-row fixture records monotonic event times for server logs/hot-channel
messages, websocket messages, frame navigation and CDP navigation reasons,
console/page errors, crashes, closes and browser disconnection. Teardown is
explicitly marked. Unexpected lifecycle loss and any optimizer full-reload
request fail the fixture, including requests HMR suppression would hide.
The new regression imports a React entry that the HTML scanner cannot see after
the application has mounted, checks the same mounted state, and requires no
optimizer invalidation. Removing up-front prebundling makes that regression
fail on the actual reload request even with HMR still disabled. Original seven
tests, 1,000 rows, 2,000-call comparisons, revalidating checks and real-clock
wasm/worker/process assertions remain unchanged. No whole-test retry.

A Darwin probe also found two setup hazards. `/var` and `/private/var` spellings
made a lazy module fail the Vite allow list; canonical paths remove the mismatch.
More significantly, placing TMPDIR below the scratch package lets Vite inherit
that package's shared `node_modules/.vite`. Concurrent old/fixed probes then
replace one another's optimized modules. The intermediate Darwin run retains
its `504 Outdated Optimize Dep` failure (two failed cases in one file invocation),
including the consequent readiness timeout. A two-server control below one package reproduces that 504 when the second
optimizer drops an entry the first page has not requested yet; an already-loaded
entry is an explicit passing control. The same unused-entry control passes with
private caches. Per-root cache ownership prevents this interference. The final Darwin qualification follows that correction.

## Browser audit

Audited live browser construction, dynamic import, navigation and server setup
under `snapback4/`; historical report scripts are evidence, not maintained tests.
Seventeen Vite construction sites now use the shared immutable fixture:

| Scope | Disposition |
| --- | --- |
| `per-row-react` | Prebundling, private cache, lifecycle/optimizer regression and diagnostics |
| `react`, `keep-authority-react`, `asset-avatars`, `asset-buffered`, `ordinary-search`, `page-observation` | Mutable Vite optimizer/watcher replaced by immutable setup |
| `social-browser` (three servers) | Same correction; intentional persistence reloads remain |
| `answers-stay-react`, `live-margin-browser`, `read-presentation-react`, `subscription-pressure-e2e`, `helpers/screen-lifetimes` | HMR-only suppression extended to prevent optimizer invalidation and cache collision |
| `experiments/p19-one-query/equality/browser` | Same actual vulnerability; corrected and run independently |
| `typing-expiry` | Already explicit `noDiscovery`/include, HMR off, watcher off; shared helper also isolates its cache |
| `witness/lib.mjs` consumers, including web-start, admission and session-authority | Vite production build followed by static HTTP serving; no live optimizer/watcher |
| `overload-browser` | Static HTTP page; no bundler reload channel |

The audit does not forbid intentional `page.reload()` or navigations between
origins/tabs. No product authoring/HMR behavior changes.

## Runs and evidence

The repeat driver launches a new native `node --test` invocation each time and
records every exit, duration and owned hog PID. A failed invocation is never
replaced or counted as a pass. Linux uses Node 24.13.1, Bun 1.3.14 and locked
Vite 8.3.0 / Playwright 1.55.1. Darwin uses a scratch copy of Node 24.13.1,
locally compiled arm64 CLI, the same JS sources and the same Linux-built portable
wasm artifact. No independent Darwin wasm rebuild is claimed. No other mini worktree,
process, simulator or device was touched. Darwin has no `taskset`: its file
runs have no synthetic hog. All Linux hogs and test descendants inherit the
explicit CPU affinity; CPUs were sampled before allocation.

| Phase | Linux | Darwin |
| --- | --- | --- |
| Instrumented main, reported target only | 60/60 pass; eight hogs, CPUs 0–3 | 60/60 pass |
| Historical fixture options, target only | 60/60 pass; 32 hogs, CPUs 0–3 | 60/60 pass |
| Controlled late import with historical HMR | 60/60 exact context-destruction failures; eight hogs, CPUs 4–7 | 30/30 exact context-destruction failures |
| Remove new prebundling, retain HMR suppression | Regression fails on recorded optimizer full-reload request | Not needed |
| Final complete per-row file | **60/60 pass, 480 subtests**; eight hogs per four CPUs | **30/30 pass, 240 subtests** |
| Other affected files | 223/223; screen React 16/16; expiry 2/2; equality experiment 1/1 | Only the authorized per-row file |
| Complete canonical suite | **0 failures in 2,247 s**; Rust 5,049 + 17 doctests pass (33 ignores); client pool 321/321, 6,433 pass / 47 skips; models 79/79 | Not authorized/run |

Negative reload controls use `--test-force-exit` on Linux because an initial
failing run completed teardown but Vite left Node alive. This flag is absent
from all baseline, final-file and full-suite qualification. The initial cancelled
control and its trace remain separate. An exploratory late JSX-runtime import
passed 60/60 because that entry was already discovered; it is not reproduction.
An initial command used the wrong cwd and ran no tests; its 60 immediate path
errors are retained as setup errors. The initial Darwin `/var` spelling control
also failed at module loading, not at context destruction. None supplies a
qualification or reproduction count.

Memory pressure was not indicated: the loaded Linux host had over 200 GiB
available, no crash/disconnect event preceded the failures, and one mounted
1,000-hook sample used 26,527,925 JS heap bytes against a 4,395,630,592-byte limit.
This is a sample, not a leak proof. Deliberate host-wide memory exhaustion was
unnecessary to explain the witnessed navigation and was not performed.

The 60-file Linux batch began before explicit cache ownership was added; on
eb1000 its external `/tmp` roots already resolved to the same per-root `.vite`
directory. The correction changes the package-nested TMPDIR case, which has
separate controls and a fresh Darwin batch.

Commands (from `snapback4/`):

```sh
# Linux full-file phases: two independent sets of 30, eight hogs per four CPUs.
taskset -c 24-27 python3 /tmp/pw-repeat.py <out-a> 30 8 node --test packages/snapback4/test/per-row-react.test.mjs
taskset -c 28-31 python3 /tmp/pw-repeat.py <out-b> 30 8 node --test packages/snapback4/test/per-row-react.test.mjs
# Darwin: same file, no other suite/test file.
TMPDIR=/private/tmp/sb4-pw.5NqQOL/tmp PATH=<scratch-node24>:<tool-path> python3 repeat.py final-full 30 0 node --test packages/snapback4/test/per-row-react.test.mjs
# Private target and stripped debug info keep the complete build below 40 GB.
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT taskset -c <sampled-idle-cpus> bash scripts/test.sh
```

Wasm baseline: **2,117,335 B raw / 639,807 B gzip**, under the unchanged
639,941 B cap (the recorded Linux cap plus 130 B Darwin allowance). No wasm
source changes. The suite rebuild is byte-identical to the baseline: SHA-256
`ab844763d82cdaa287599e1fc4ff9eb7c67f1c2099d1950f5a3636f38c799e5d`.
No budget increase. The 47 client skips are existing platform/opt-in guards,
including native macOS tools and optional pinned historical binaries; no new
skip or reduced workload was introduced.

## Completion

Final stress receipts and all per-invocation subtest counts are verified. Linux
logs each contain exactly nine main-frame navigations: eight initial pages and
the intentional process-tier reload. No crash or optimizer reload occurred.
All owned hog PIDs have exited. The mini archive is retrieved and source hashes
match; its scratch directory is deleted ([cleanup receipt](evidence/mini-cleanup.log)).
The [fixture ticket](../../../issues/closed/20261005-snapback4-browser-fixture-navigation.md)
records the attribution boundary. The canonical suite passed on the unchanged
source hashes: `== 0 failure(s) in 2247 s` (native exit 0).
Its [receipt](evidence/full-suite.json) records command/affinity/build flags;
the [complete log](evidence/full-suite.log.gz) preserves all results and skips.
The highest detailed disk sample was 14.10 GB for this worktree plus active
owned temporary roots; the earlier mini scratch was about 1.5 GiB and is removed.
No other worktree, simulator or device was touched. JOURNAL and the resolved
fixture ticket land with the code. Local commit only; nothing pushed or published.
Raw evidence: [Linux runs](evidence/linux-runs.tar.gz),
[Darwin runs](evidence/mini-runs.tar.gz), [control sources](evidence/controls.tar.gz),
[stress summary](evidence/stress-summary.json),
[auxiliary logs](evidence/auxiliary-logs.tar.gz), and
[evidence checksums](evidence/SHA256.json).

## Orientation and affected-document audit

- **Scope:** browser fixture servers and per-row React assertions; no client contract or interpreter edits.
- **Governing LLPs:** LLP 3000 (root, in `current`), LLP 2000.000 (design brief, in `current`), LLP 3000.023 §10 (retention/publication rationale, in `current`). Snapback 4's fence excludes the Snapback 1–3 gate/bootstrap corpus.
- **Active constraints:** [LLP 3000 §publication suite under contention](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention) preserves workloads, outcome assertions and independent hang guards; [LLP 3000.023 §10](../../../llp/3000.023-answers-stay-on-screen.rfc.md#10-revalidation-change-evidence-and-queued-reads-rl-and-pq-2026-09-29) governs the unchanged retention and queued-read assertions.
- **Rationale:** the test must keep one mounted browser context while observing publication; backend retention cannot be assessed after the fixture itself discards that context.
- **Open risk:** absent telemetry prevents exact attribution of the original M5 event; controlled reproduction establishes the matching fixture mechanism only.
- **Documentation:** the existing root's contention section records immutable fixture/cache ownership; JOURNAL is append-only. Existing per-row `@ref` remains applicable. No new LLP number, authoring surface, guide claim or wasm budget change.
- **Hand-off:** none. Repository reference audit and delta whitespace checks pass; canonical suite result is separately reported above.
