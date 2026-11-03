# Progressive history — fix round 4

Date: 2026-11-03. Worktree: `snapback-ph-20261102`, branch `sb4/progressive-history`.
Changes are uncommitted for the supervisor. No agents, remote commands, cloning,
other checkouts, git commits, stash, checkout, rebase, push, or wasm build were used.
Changes are confined to `snapback4/`; no LLP was added or changed.

## Result

All six complete reported red client files pass: delivery matrix 447, lifecycle 57,
asset lists 42, HTTP bounds 12, column recovery 1, bounded following 39. The complete
device command passed: **1605 passed, 0 failed, 4 ignored** (sum of its individual harness summaries,
which are reproduced verbatim below). Core/device/simulator progressive suites,
JavaScript typecheck/build, native binary build, and all 139 guide tests passed.

The additional progressive-client run has an infrastructure failure: the ephemeral
file cannot initialize its Darwin identity inspector because sandboxed `ps` gets
`spawn EPERM`. Its product cases did not run. The other three files produced 43
passes and one declared browser skip. The final strengthened recovery file also
passed all six cases separately. This is not a claim that the entire additional
four-file command passed.

## Product changes and evidence

Paths below are relative to `snapback4/`.

- `packages/snapback4/src/local.ts:1210`: awaited opening now drives the existing
  acquisition scheduler through completion, instead of awaiting one network turn.
  Explicit `sync()` already used that scheduler. `waitSeconds` is the change-poll
  setting in the existing implementation, not a startup deadline. No new timer
  or readiness marker was introduced.
- `packages/snapback4/src/local-runtime.ts:293`: an already-required replacement
  can discover restore evidence through `/sync` without first requiring a new
  `/schema` capability fetch. The existing upgrade restore witness can make only
  the sync evidence reachable; capability discovery had prevented the restore
  refusal from being observed, leaving follow/flush without the required fence.
- `packages/snapback4/src/local-runtime.ts:277`, `:309`, `:420`: retain an acquire
  request's cursor/hint/skip while reducing its HTTP page limit. An indivisible
  acquisition `E_BOUND` enters the existing staged replacement path. HTTP response
  overflow first shrinks the same acquire request; at limit one it can also try
  replacement. A replacement that still cannot deliver one row surfaces the typed
  refusal once and does not spin. Identity/adoption changes clear the cached
  request. This is bounded error recovery, not a staged cold progressive walk.
- `crates/snapback4-device/src/device.rs:135`,
  `crates/snapback4-device/src/device/store_identity.rs:80`, and
  `packages/snapback4/src/local-runtime.ts:324`: a transient local capture checks
  the existing acquisition cursor, replacement flag, acquired marker and snapshot
  owner before store observation and again inside apply. Two owners can otherwise
  complete or replace a walk at the same watermark, so watermark comparison alone
  misses the superseded response. The client overwrites the field after decoding
  the wire. It adds no durable fact, owner token, extent, receipt, watermark or cut.
- `crates/snapback4-device/src/device/progressive_tests.rs:252`: both MemoryStore
  and SQLite reject a delayed progressive page after another walk completes,
  another owner stages a replacement, or a replacement publishes at the same cut.
  Both observation and apply return `E_GENERATION`; current state and restore
  status remain intact.
- `packages/snapback4/test/progressive-recovery.test.mjs:1`: first/later scheduler
  rejection, false/stopped rounds, shrinking the same acquire request while the
  foreground conversation changes, eventual acquisition/catch-up and correct
  offline history, and permanent failure only after one-row replacement fails.
  `test/helpers/progressive-acquisition.mjs:124` supports injected HTTP responses.
- `packages/snapback4/test/progressive-budget.test.mjs:27`: the existing compact
  million-cell row exceeds progressive retained-heap accounting but is deliverable
  by legacy staged replacement. The test now requires that recovery, the entire
  million-cell payload, ready state and acquired offline reopen. Its old permanent
  refusal expectation conflicts with this round's explicit fallback requirement;
  the new recovery file retains permanent-refusal/no-spin coverage when replacement
  itself really fails. This is an intentional recovery behavior change, not a
  relaxed readiness or answer assertion.

### Delivery census and required file split

`local.ts` started above the requested 1,500-line ceiling. Fourteen existing
sync/delivery functions moved into `packages/snapback4/src/local-runtime.ts:137`
through live state accessors constructed at `local.ts:231`; forwarding functions
retain the original owning promises. Final sizes are 1,487 and 862 lines.
No second client state, queue or network owner is created.

`test/delivery-fault-instrument.mjs:34` now instruments the physical runtime file
while retaining logical `local.ts` site IDs. `test/delivery-fault-recipes.mjs:33`
uses explicit semantic site-to-fixture mappings, so moving a function cannot
silently reassign fault recipes. The new capability-fetch await has its own
metadata recipe (`:6`) and fault injection (`delivery-fault-matrix.test.mjs:169`):
it is optional to durable write delivery, with FIFO/outcome recovery still checked.
The two `LocalAcquisition.sync` awaits sequence existing network owners; their
first/later rejection and stopped-round behavior is tested explicitly. The await
boundary seals include them and the moved runtime. No new I/O await was blindly
exempted. The regenerated seal is **216 classified delivery sites and recipes**.

`test/delivery-fault-sites.json:1` is compacted to one record per line to meet the
line ceiling. `test/upload-delivery-matrix.mjs:16` follows logical site IDs after the
split. `test/web-admission-review.test.mjs:77` and
`test/web-receipt-upgrade.test.mjs:44` point their source instrumentation at the
moved runtime; the former's unconditional sync-entry hook also includes the
existing acquisition-failure gate. Those browser files were syntax-checked only.

`crates/snapback4-lang/src/guide/sync.rs:173` is the only documentation change:
the forced acquisition card now describes staged fallback and one-row refusal.
No Quarry snippet, new refusal code, public contract shape, mutation admission,
ACQUIRED publication rule, server algorithm or row-version history was changed.

## Disposition of every reported red

| File / case | Product fix or wire-only test adaptation | Preserved behavior |
| --- | --- | --- |
| `delivery-fault-matrix.test.mjs`, await census | Honest classification, seals, metadata fault recipe and relocated instrumentation. Initial post-split run exposed six upload-fixture routing failures; logical-ID routing fixes those. | All 447 cases pass; required/optional recovery assertions remain. |
| `client-lifecycle.test.mjs`, write sending when snapshot starts | The test explicitly intercepts `snapshot` continuations and gates a write on those pages. Withhold only the capability advertisement in that witness (`:868`) to select the legacy path, just as the established acquisition tests do. The wasm regression was its snapshot gate never being reached under acquire, not evidence of broken receipt correlation. | Pending/outcome, acknowledgment/retirement, count and catch-up assertions are unchanged. Progressive in-flight writes remain covered by the existing interactive-send client test and real-server own-write device tests, both run. |
| `asset-lists.test.mjs`, paged upgrade restore (both tiers) | Product fix: bypass unnecessary capability discovery for required replacement. These tests were not changed. | Restore refusal, stopped follow and stopped flush assertions remain. |
| `asset-lists.test.mjs`, four overtaken legacy continuation cases | Withhold advertisement only in their shared fetch (`:649`), because the cases specifically fabricate legacy nonterminal/terminal continuations. Also fix the actual progressive same-watermark owner gap with the device capture fence and its both-store regression. | All original legacy publication/staging/stale-page assertions remain; progressive delayed pages are separately refused. |
| `http-bounds.test.mjs`, wide acquisition and outer admission suite | Product startup/fallback fixes. Wire assertions (`:259`) first require advertised acquire and its real `E_BOUND`, then verify the original exact 10000→39 shrink sequence on the staged replacement cursor. A separate injected HTTP-overflow test verifies shrinking acquire itself, including stable hints despite an observation change. | Acquired on awaited open, continuation, ordinary catch-up, correct count and all HTTP admission/encoding/reader/poll checks remain. |
| `column-stream-recovery.test.mjs` | Product startup fix; test file unchanged. Initial acquisition actually succeeds a unit at a time, but opening used to return after one unit. No server pagination patch was warranted. | Acquired after open, oversized parent-mirror recovery, row/answer correctness and both storage tiers remain. |
| `bounded-following.test.mjs` | Verified red after the supervisor's ephemeral fix: scalar-cut cases failed on both tiers. Product startup fix; test file unchanged. | Offline/local read fencing and scalar answer assertions remain; entire 39-case file passes. |

### Counterfactual regression checks

- Startup: remove only the new opening scheduler wait with `without-fix.mjs`;
  the unchanged column-recovery file fails its acquired assertion (0 pass, 1 fail).
- Required-replacement discovery: remove only the replacement check; both unchanged
  paged-upgrade cases fail their missing `E_STORE_RESTORE` behavior (0 pass, 2 fail).
- Fallback: disable only `acquireBound`; the full HTTP file fails acquisition
  (10 pass, 2 fail, including the failed parent suite).
- Same request during shrinking: remove only cached-request reuse; both process
  and wasm tests fail because the retry hint changes from conversation c to d
  (0 pass, 2 fail). With the fix the full recovery file passes all six cases.
- Progressive owner: temporarily disable only the new device capture guard in
  our edited source; the new test fails because stale observation returns `Ok`.
  Restore our guard; targeted test passes, and the full device suite includes it.
- Census: the previous 215-record seal lacks the new metadata await and new
  acquisition wrapper seals; the updated full matrix checks the complete boundary
  plus all 216 classified recipes. No pre-fix full matrix pass is claimed.

The JavaScript counterfactual loader changes only that test process's loaded code.
It refuses to run if its intended replacement does not match. Native guard
counterfactual restoration used our saved file content, never git checkout/restore.

## Specification and current-code findings

Read revision 1 of LLP 3000.001.001 in full first, then Snapback 4 AGENTS and
NOT-DOING and parent Repair A/B. Applied `llp-orient`, read the parent design and
relevant rules/current sync card, and inspected supervisor commit `b03f265d58` and
`progressive-ephemeral.test.mjs`. The same-watermark owner check and recovery stay
within the existing boundary/whole-table facts, Repair B deferral, one watermark,
global write gate and negotiated capability rules.

Current code resolves three hypotheses differently from the prompt: the HTTP
overflow matcher already recognizes the general HTTP message (no matcher change);
the oversized column seed was stopped by early opening, not indivisible server
pagination; and compact JSON can exceed progressive heap accounting while still
being deliverable by staged replacement. The actual HTTP wide-horizon fixture
does hit an indivisible acquisition bound, so its recovery uses replacement.

## Not run and remaining limitations

- Browser/React: **not run (sandbox)**. This includes `react.test.mjs`,
  `witness/idb.mjs`, and execution of the two adjusted browser instrumentation
  files. Node syntax checks do not claim browser behavior passed. The existing
  browser case in the progressive suite reports its declared skip verbatim.
- `progressive-ephemeral.test.mjs`: attempted but its fixture initialization was
  blocked before any product case by `TEST_SIGNAL_REFUSED: cannot build Darwin
  identity inspector: TEST_COMMAND_INSPECTION: ps failed: spawn EPERM`. No process
  inspection workaround or sandbox escalation was attempted. Other loopback
  suites ran; no repeated bind failure needed the requested single rerun.
- **No wasm build**, as instructed. Wasm client tests use the existing checked-in
  artifact. JavaScript build copies that artifact and does not compile it. The new
  Rust stale-owner guard is verified on MemoryStore and SQLite; execution of that
  guard in a freshly built wasm artifact remains with the supervisor.
- Did not rerun all 491 files or `affected.mjs`, which would exceed this round's
  requested scoped validation and include prohibited browser/wasm work. Every
  listed red file was run in full. Did not run or change the explicitly excluded
  base-red `dx12-serve` shutdown case.
- No product design question blocks this chunk. Supervisor follow-through is the
  fresh wasm/browser validation and the sandbox-blocked ephemeral fixture. The
  supervisor owns committing these changes. STOP after this report.

## Commands and verbatim summaries

All cargo and bun commands ran from `snapback4/`. Node was
`/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node` (`v24.18.0`), selected by
prepending that directory to PATH. Cargo used `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`. No install was needed.
An initial `volta run --node 24` attempt was refused because Volta could not write
its sandbox-excluded temporary directory; the pinned binary was then used directly.

Final invocations below were executed through
`python3 reports/20261102-progressive-history-reviews/fix-r4/run.py NAME COMMAND...`.
The runner retains exact argv, exit status and summaries in [commands.jsonl](commands.jsonl).
Counterfactual environment variables are shown explicitly below (they are inherited
by the runner). Raw logs retain diagnostics as well as the selected summaries.
An exit-zero command without output is labeled as such, not assigned a made-up
test summary. Full device output has multiple harness summaries; every one appears.

### build-final

`bun run --cwd packages/snapback4 build` — exit 0. [Raw output](logs/build-final.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

### seal-final

`node reports/20261102-progressive-history-reviews/fix-r4/seal.mjs` — exit 0. [Raw output](logs/seal-final.log).

```text
await seal: 216 classified delivery sites and recipes
```

### cargo-build-final

`cargo build -p snapback4` — exit 0. [Raw output](logs/cargo-build-final.log).

```text
    Finished `dev` profile [unoptimized] target(s) in 19.32s
```

### core-progressive

`cargo test -p snapback4-core --test progressive_acquisition` — exit 0. [Raw output](logs/core-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 29.18s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.43s
```

### fallback-counterfactual

`SB4_FIX_R4_WITHOUT=fallback node --import ./reports/20261102-progressive-history-reviews/fix-r4/without-fix.mjs --test packages/snapback4/test/http-bounds.test.mjs` — exit 1. [Raw output](logs/fallback-counterfactual.log).

```text
ℹ tests 12
ℹ suites 0
ℹ pass 10
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4055.117458
```

### sim-progressive

`cargo test -p snapback4-sim --test progressive_history` — exit 0. [Raw output](logs/sim-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 31.32s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
```

### restore-counterfactual

`SB4_FIX_R4_WITHOUT=restore node --import ./reports/20261102-progressive-history-reviews/fix-r4/without-fix.mjs --test '--test-name-pattern=paged upgrade' packages/snapback4/test/asset-lists.test.mjs` — exit 1. [Raw output](logs/restore-counterfactual.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2711.014667
```

### startup-counterfactual

`SB4_FIX_R4_WITHOUT=startup node --import ./reports/20261102-progressive-history-reviews/fix-r4/without-fix.mjs --test packages/snapback4/test/column-stream-recovery.test.mjs` — exit 1. [Raw output](logs/startup-counterfactual.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3315.369583
```

### device-progressive

`cargo test -p snapback4-device --test progressive_history` — exit 0. [Raw output](logs/device-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 9.93s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
```

### http-bounds-final

`node --test packages/snapback4/test/http-bounds.test.mjs` — exit 0. [Raw output](logs/http-bounds-final.log).

```text
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 21321.422125
```

### lifecycle-final

`node --test packages/snapback4/test/client-lifecycle.test.mjs` — exit 0. [Raw output](logs/lifecycle-final.log).

```text
ℹ tests 57
ℹ suites 0
ℹ pass 57
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47244.846833
```

### delivery-final

`node --test packages/snapback4/test/delivery-fault-matrix.test.mjs` — exit 0. [Raw output](logs/delivery-final.log).

```text
ℹ tests 447
ℹ suites 0
ℹ pass 447
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 149859.448167
```

### column-stream-final

`node --test packages/snapback4/test/column-stream-recovery.test.mjs` — exit 0. [Raw output](logs/column-stream-final.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 49800.583833
```

### typecheck-final

`bun run --cwd packages/snapback4 typecheck` — exit 0. [Raw output](logs/typecheck-final.log).

```text
$ tsc -p tsconfig.json --noEmit
```

### node-version

`node --version` — exit 0. [Raw output](logs/node-version.log).

```text
v24.18.0
```

### progressive-client-final

`node --test packages/snapback4/test/progressive-acquisition.test.mjs packages/snapback4/test/progressive-budget.test.mjs packages/snapback4/test/progressive-recovery.test.mjs packages/snapback4/test/progressive-ephemeral.test.mjs` — exit 1. [Raw output](logs/progressive-client-final.log).

```text
ℹ tests 45
ℹ suites 0
ℹ pass 43
ℹ fail 1
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 49777.56725
```

### asset-lists-final

`node --test packages/snapback4/test/asset-lists.test.mjs` — exit 0. [Raw output](logs/asset-lists-final.log).

```text
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 130243.7965
```

### legacy-acquisition-final

`node --test packages/snapback4/test/acquisition.test.mjs` — exit 0. [Raw output](logs/legacy-acquisition-final.log).

```text
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 153711.517042
```

### bounded-following-final

`node --test packages/snapback4/test/bounded-following.test.mjs` — exit 0. [Raw output](logs/bounded-following-final.log).

```text
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 321367.845792
```

### browser-hook-syntax

`node --check packages/snapback4/test/web-admission-review.test.mjs` — exit 0. [Raw output](logs/browser-hook-syntax.log).

No summary or other output emitted.

### browser-receipt-syntax

`node --check packages/snapback4/test/web-receipt-upgrade.test.mjs` — exit 0. [Raw output](logs/browser-receipt-syntax.log).

No summary or other output emitted.

### diff-check

`git diff --check` — exit 0. [Raw output](logs/diff-check.log).

No summary or other output emitted.

### guide

`cargo test -p snapback4-lang --test guide` — exit 0. [Raw output](logs/guide.log).

```text
    Finished `test` profile [optimized] target(s) in 4m 38s
test result: ok. 139 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.67s
```

### cursor-counterfactual

`SB4_FIX_R4_WITHOUT=cursor node --import ./reports/20261102-progressive-history-reviews/fix-r4/without-fix.mjs --test '--test-name-pattern=HTTP serialization overflow' packages/snapback4/test/progressive-recovery.test.mjs` — exit 1. [Raw output](logs/cursor-counterfactual.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 841.402125
```

### recovery-final

`node --test packages/snapback4/test/progressive-recovery.test.mjs` — exit 0. [Raw output](logs/recovery-final.log).

```text
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3322.482041
```

### device-full

`cargo test -p snapback4-device` — exit 0. [Raw output](logs/device-full.log).

```text
    Finished `test` profile [optimized] target(s) in 6m 41s
test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.49s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.78s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.05s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 440 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 70.69s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 158.38s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.47s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.56s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.43s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.24s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.71s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.03s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.45s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.15s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.38s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.31s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.94s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.09s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.25s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.40s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.38s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.46s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 227.98s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.53s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.60s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 43.67s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.79s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.71s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 142 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.97s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.62s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### Earlier diagnostic invocations

These logs predate the argv-recording runner. The executable/targets/filters are
identified below; shell redirects and the exact early Rust filter spelling were
not retained. Summaries are copied from the actual logs, including failed attempts.
The first split typecheck failed on missing imported types and refusal narrowing;
those were fixed before the successful rerun. The first split script invocation
had a TypeScript module path error; its successful rerun output is retained.
The first post-split matrix failed six upload fixture routes, subsequently fixed.
The first wide run had only the obsolete exact-wire sequence assertions remaining.

**cargo-build** — `cargo build -p snapback4`; exit 0. [Raw output](logs/cargo-build.log).

```text
    Finished `dev` profile [unoptimized] target(s) in 17.78s
```

**bounded-before** — `node --test packages/snapback4/test/bounded-following.test.mjs`; exit 1. [Raw output](logs/bounded-before.log).

```text
ℹ tests 39
ℹ suites 0
ℹ pass 37
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 310397.495417
```

**lifecycle-before** — `node --test --test-name-pattern='already sending' packages/snapback4/test/client-lifecycle.test.mjs`; exit 1. [Raw output](logs/lifecycle-before.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 867.515708
```

**asset-before** — `node --test --test-name-pattern='paged upgrade|overtaken' packages/snapback4/test/asset-lists.test.mjs`; exit 1. [Raw output](logs/asset-before.log).

```text
ℹ tests 6
ℹ suites 0
ℹ pass 0
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3707.028
```

**column-before** — `node --test packages/snapback4/test/column-stream-recovery.test.mjs`; exit 1. [Raw output](logs/column-before.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3650.171167
```

**http-before** — `node --test packages/snapback4/test/http-bounds.test.mjs`; exit 1. [Raw output](logs/http-before.log).

```text
ℹ tests 12
ℹ suites 0
ℹ pass 10
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4154.93225
```

**wide-first** — `node --test packages/snapback4/test/column-stream-recovery.test.mjs packages/snapback4/test/http-bounds.test.mjs`; exit 1. [Raw output](logs/wide-first.log).

```text
ℹ {"tier":"sqlite","source_moves":204,"parent_images":408,"parent_body_bytes":17136000,"ceiling":16777216,"generation":1,"watermark":16,"max_response_bytes":42507}
ℹ {"tier":"wasm","source_moves":204,"parent_images":408,"parent_body_bytes":17136000,"ceiling":16777216,"generation":1,"watermark":16,"max_response_bytes":42507}
ℹ tests 13
ℹ suites 0
ℹ pass 11
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 26734.125959
```

**upgrade-first** — `node --test --test-name-pattern='paged upgrade' packages/snapback4/test/asset-lists.test.mjs`; exit 0. [Raw output](logs/upgrade-first.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3534.878292
```

**bounded-startup** — `node --test --test-name-pattern='scalar cut' packages/snapback4/test/bounded-following.test.mjs`; exit 0. [Raw output](logs/bounded-startup.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 70465.521583
```

**owner-first** — `cargo test -p snapback4-device --lib [filter: superseded_progressive_owner]`; exit 0. [Raw output](logs/owner-first.log).

```text
    Finished `test` profile [optimized] target(s) in 18.34s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 72 filtered out; finished in 0.02s
```

**owner-counterfactual** — `cargo test -p snapback4-device --lib [filter: superseded_progressive_owner; guard disabled]`; exit 101. [Raw output](logs/owner-counterfactual.log).

```text
    Finished `test` profile [optimized] target(s) in 17.61s
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 72 filtered out; finished in 0.01s
```

**budget-first** — `node --test packages/snapback4/test/progressive-budget.test.mjs`; exit 1. [Raw output](logs/budget-first.log).

```text
ℹ tests 5
ℹ suites 0
ℹ pass 3
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13433.131917
```

**reds-first-full** — `node --test packages/snapback4/test/client-lifecycle.test.mjs packages/snapback4/test/asset-lists.test.mjs packages/snapback4/test/http-bounds.test.mjs`; exit 0. [Raw output](logs/reds-first-full.log).

```text
ℹ tests 111
ℹ suites 0
ℹ pass 111
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 128983.510083
```

**split** — `node reports/20261102-progressive-history-reviews/fix-r4/split-runtime.mjs`; exit 0. [Raw output](logs/split.log).

```text
split 14 functions, 96 live context fields; local.ts 1491 lines; local-runtime.ts 901 lines
```

**typecheck-split** — `bun run --cwd packages/snapback4 typecheck`; exit 2. [Raw output](logs/typecheck-split.log).

```text
$ tsc -p tsconfig.json --noEmit
```

**typecheck-split2** — `bun run --cwd packages/snapback4 typecheck`; exit 0. [Raw output](logs/typecheck-split2.log).

```text
$ tsc -p tsconfig.json --noEmit
```

**progressive-first** — `node --test packages/snapback4/test/progressive-acquisition.test.mjs packages/snapback4/test/progressive-budget.test.mjs packages/snapback4/test/progressive-recovery.test.mjs`; exit 0. [Raw output](logs/progressive-first.log).

```text
ℹ tests 44
ℹ suites 0
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 49722.250125
```

**delivery-first** — `node --test packages/snapback4/test/delivery-fault-matrix.test.mjs`; exit 1. [Raw output](logs/delivery-first.log).

```text
ℹ tests 447
ℹ suites 0
ℹ pass 441
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 147720.228208
```

**build-first** — `bun run --cwd packages/snapback4 build`; exit 0. [Raw output](logs/build-first.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

**build-second** — `bun run --cwd packages/snapback4 build`; exit 0. [Raw output](logs/build-second.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

**build-split** — `bun run --cwd packages/snapback4 build`; exit 0. [Raw output](logs/build-split.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

**build-recovery** — `bun run --cwd packages/snapback4 build`; exit 0. [Raw output](logs/build-recovery.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

### Inspection, editing and reporting commands

Read-only inspection used `cat`, `sed -n`, `rg` / `rg --files`, `head`, `tail`,
`wc -l`, `git status --short`, `git diff` (including `--stat`, `--numstat` and
`--check`), `git show b03f265d58`, and the Node/Volta path/version lookups. These
read the specified RFC, AGENTS/NOT-DOING, parent Repair A/B and governing context,
the supervisor's commit/test, scoped product and test sources, and the retained
logs. Repeated log reads are inspections, not additional test executions. They
emit no test summary. The final unwrapped `git diff --check` also exited zero
without output after the strengthened retry test.

The retained one-time editing helpers were invoked with Node:
`split-runtime.mjs`, `classify-awaits.mjs`, `tidy-imports.mjs`, and `seal.mjs` in
this report directory. They perform the extraction, classification mapping,
import cleanup and seal generation described above; they are provenance, not
repeatable migrations. Apply-patch and small Python file edits were used for the
other scoped edits. Python log-summary reads inspected the same retained logs.
No additional test pass is inferred from editing or inspection commands.

`python3 reports/20261102-progressive-history-reviews/fix-r4/write-report.py`
generated this report from the completed command manifest and retained logs.
Its summary is `report written; all recorded summaries included`.
