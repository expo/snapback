# Lane NS, round 2 — startup listener and filesystem ownership

This round addresses both P2s in Astra's round-1 NOT READY review. Both earlier
prompts/reports, both round-0 reviews and Astra's full round-1 review were read;
Grok's round-1 review is
reserved for the later round, as instructed. Merged `origin/main` at
`e05cec8e0a` first, preserving both sides without conflicts in `795f82f218`.
Nothing is pushed or published.

The llp-orient context is LLP 3000#4 (the Snapback 4 fence),
3000.030#3/#5/#13 (preparation, process/record ownership and starter smoke),
3000.007#20.10 (installed-app assertions), 3000.019#3.4 (backend ownership)
and 2000.000#12 (the measured loop). The skill was read from the sibling
checkout's `vendor/llp/skills/llp-orient/SKILL.md`; this lane's symlink remains
uninitialized. The existing LLP 3000.030 is updated in place. No new design
number or gate is introduced. Application scenarios remain necessary for
pending-write replay, populated history, media and M6/M8; an empty starter
establishes installed Release, local-store and native lifecycle behavior only.

## Changes and detecting controls

The inherited listening descriptor is adopted at CLI entry, before command
dispatch can spawn any child, including the server-handler checker. It becomes
an owned descriptor immediately, restores `FD_CLOEXEC` while preserving flags,
and clears the inherited-descriptor environment variable before descendants
are created. Validation failures drop the owned descriptor. The same listener
then moves through dev startup and into the HTTP server without a rebind.
Every earlier startup error drops it; interruption/timeout cannot leave a
checker holding the socket. Connection limits and the deliberately closed
listener during the offline segment are unchanged.

Automatic reuse now opens the ownership directory without following its final
symlink, checks its UID and group/other write bits, and retains that directory
handle. Reads and exclusive writes are relative to that handle. Record opens
also refuse symlinks, then require a regular file owned by the current effective
UID with neither group nor other write permission. Invalid records grant no
reuse and emit one warning per invocation. An unsafe directory grants no reuse
and refuses new persistence before creating a simulator. New directories use
mode 0700 and records 0600; safe existing 0755 directories remain valid.
Explicit `--udid` behavior remains unchanged.

Both package READMEs now say **NS round 0 cohort (2026-09-30)** immediately
before 221.7 / 83.5 / 186.2 seconds and the original host/load facts. Those
figures are historical cohort observations, not this round's timing. Their
“Guidance, not a promise” qualification remains. The witness guide states the
filesystem requirements and single warning; its existing line budget is kept.

Seven new driver controls pass on this revision and fail against the saved
round-1 CLI whose hash matches the round-1 provenance record. The test binary
is unchanged between positive and negative runs; the CLI is temporarily swapped
and restored in a `finally` block. `regression-provenance.json` identifies both
binaries and the test executable. Individual negative logs retain each failure.

| Control | Round-1 failure |
| --- | --- |
| SIGINT during a real stalled Node checker | Exit 1 / `E_WITNESS_INTERRUPTED`, but the checker still held the port. |
| Startup timeout during a real stalled Node checker | Exit 1 / `E_WITNESS_BACKEND: dev did not become ready before the step timeout`, but the checker still held the port. |
| Symlinked record | Foreign UDID selected as `reused`. |
| Mode-0666 record | Foreign UDID selected as `reused`. |
| Group-writable record | Foreign UDID selected as `reused`. |
| Symlinked directory | Foreign UDID selected as `reused`. |
| Writable directory | Foreign UDID selected as `reused`. |

Port assertions run **before** cleaning up the exact recorded checker PID, so
cleanup cannot hide the leak. The ownership controls check both the receipt and
the complete fake-simctl call log: the foreign device must never be targeted,
and exactly one warning must appear. Safe record controls proceed to a newly
created device; unsafe-directory controls refuse before creation. New-record
mode is asserted as 0600. A unit control separately verifies that the shared
metadata predicate rejects a different UID. No actual second-UID execution is
claimed. These driver tests use fake simctl and establish process/filesystem
behavior, not native execution.

Two existing package README checks now also require the cohort label. Both
fail against actual round-1 README bytes and pass after restoration. No failing
negative control is counted as a development or full-suite failure.

## Validation and failures

Final affected checks: **47 witness driver/protocol**, **22 starter**,
**11 witness unit**, **36 helper/preparation/smoke**, **21 periphery**, and
**106 whole-guide** tests pass. Client build, ref-check and diff check pass.
The final guide wording was polished after the full-suite snapshot; it was
checked again with the whole-guide test. No product logic changed after
that snapshot; the guide is embedded text, and its wording-only delta is explicit.
The UID unit fixture was also corrected after the suite exposed its assumption
about Cargo executable permissions, as recorded below. The final LLP/report/journal result text was also written later.
`affected-summary.json` retains every final result; the README, client and
witness card stay at 300, 114 and 399 lines respectively (client 1,198 words).
No assertion, timeout, model count, source-file budget or wasm budget was relaxed.

Development failures, all retained or described in `development-failures.json`:

- **Ours:** the first startup-timeout test expected `E_WITNESS_TIMEOUT`; the
  actual documented startup error is `E_WITNESS_BACKEND` with the step-timeout
  message. Corrected the expected code/message while retaining the port-free
  assertion. The initial affected run is 42 passed / 1 failed; final is 47/47
  after splitting the five filesystem cases into individually detectable tests.
- **Ours, command setup:** two edits were first invoked from `snapback4/` with
  repository-root-relative paths, producing FileNotFound errors. Corrected the
  working directory. The first also attempted the wrong report/copy paths;
  only empty directories were created and were removed.
- **Environmental:** initial dependency installation received an npm registry
  404 for `source-map-js-1.2.2.tgz`. The newly generated package manifest is
  byte-equivalent as JSON to round 1. Its qualified lockfile was copied and
  `npm ci --offline` succeeded, installing 507 packages. No dependency version
  was loosened. The two Snapback packages were then replaced by locally packed
  unpublished candidates; `host-and-inputs.json` binds those tarballs and lock.

The initial staged diff check also flagged three Markdown hard-break trailing
spaces in the verbatim review copy. That evidence is now retained losslessly as
`review-astra.md.gz` with its original hash in `review-provenance.json`; no review
text was changed. The final staged diff check passes.

Baseline development failures before the full suite: none. Compiler dead-code and npm deprecation
warnings remain warnings, not failed checks. Full-suite failures are listed
separately below, without relabeling a red run after focused fixes.

## Native warm requalification

The fresh `init --expo` project is `~/sb4-np/ns-r2-starter`. Its source is
unchanged between runs. The exact measured command is `npm run native:smoke`
with no arguments, using the branch CLI through `SNAPBACK4_BIN` and locally
packed unpublished 0.4.9 candidates. The client was rebuilt; native source
remains unchanged and the prior qualified XCFramework is reused. Dependency
installation is outside timing. The registry lock alone does not describe the
candidate package bytes; their hashes and the toolchain are retained in
`host-and-inputs.json`.

All Mac commands used `~/np-tools/node/bin:~/np-tools/bun/bin` on PATH and
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Host: shared
Apartment Apple M5 Pro mini, 18 cores / 64 GiB, Xcode 27.0 (27A266a), iOS 27.0,
Node 24.18.0, npm 11.16.0, CocoaPods 1.17.0. One-minute host load was sampled
every five seconds and includes other sessions. Global caches were not flushed.

| Invocation | Seconds | Load min / median / max | Native result |
| --- | ---: | --- | --- |
| Fresh starter cache warmup | 232.016 | 11.41 / 30.53 / 85.15 | All three segments passed |
| Requested warm run | **83.756** | 7.81 / 8.67 / 10.08 | All three segments passed |

The first invocation had no generated iOS tree or private native cache; its
successful build/smoke warmed the cache for the requested measurement. The warm
invocation reused generated iOS, Pods, DerivedData and the tool-created simulator.
This is **one warm observation**, not a new median/p95 or quiet-host promise.
No native invocation failed or was discarded. Pods took 112.638 / 12.531 s;
Xcode took 45.414 / 30.891 s. Both ran Xcode with 82 native compile log entries.
Their origins and emitted JavaScript hashes differ. Native behavior remains
prime acquisition, offline cold reopen and restart; no queued mutation is
claimed. The retained warm offline screenshot visibly shows the native starter
offline with its restored guest account and empty conversation list.

`collect.py` verified all run artifact hashes, proof/build bindings, complete
app inventories (100 entries per app), and complete Xcode result inventories
(eight entries each), including links, modes, lengths and hashes. The receipt
index locates **128 retained files** across both runs: full receipts/logs,
helper bytes, screenshots and videos. Text is losslessly gzip-compressed;
recorded hashes describe original bytes. Larger app and xcresult directories
remain at the original paths recorded in `receipt-index.json`.

The warmup created `sb4-ns-1790777647371-91422`, UDID
`7CA91203-C914-497F-AFD9-C6C94CE957A9`, on iOS 27.0. The warm run reused it
through its mode-0600 creation file, UID 501, inside the existing safe UID-501
mode-0755 directory. These facts are retained in `ownership-record.json`.
After evidence collection, only that exact simulator was shut down and deleted,
and its exact creation record removed. Before/after inventories and successful
cleanup commands are retained. It was absent before and after this round.
`mini-verify-iphone` and every other session's devices were never targeted;
xcode-select and system settings were unchanged.

## Complete suite and wasm

Ran `scripts/test.sh` **once** on eb1000 in the existing isolated
`/home/ccheever/sb4-intent/lane-ns-verify` worktree. The preceding round-1
verification snapshot was checkpointed there before installing this round's
source. All **2,274** source files in `suite-source.json` were hash-verified
before and after the run; both verification logs report zero mismatches.
The inventory identifies local merge `795f82f218`; the remote checkpoint's
Git HEAD is not represented as that merge. The final guide prose, corrected
UID unit fixture, and result documents are explicitly subsequent changes.
There is no subsequent product-logic change.

Host: 96 CPUs, Node 24.13.1, Bun 1.3.14, Cargo 1.97.0. Initial host load was
2.74 / 8.19 / 14.49. Exact summary, exit **1**:

```text
== 2 failure(s) in 1290 s
   cargo test
   client tests
```

Every full-suite failure: **ours 1, baseline 1, environmental 0**.

1. **Ours — UID unit fixture.**
   `verbs::witness::ownership::tests::ownership_predicate_requires_the_current_uid`
   assumed the Cargo executable was not group-writable. eb1000 builds it mode
   0775; the new permissions predicate correctly rejected it, so the positive
   UID assertion failed. The test now creates its own mode-0600 file. The same
   positive and negative UID assertions remain. The corrected complete witness
   unit group passes **11/11 on the Mac and 11/11 on eb1000**.
2. **Baseline — asynchronous worker-log observation.**
   `dev declares two workers, injects usable secret seats, restarts independently
   and stops both` (`supervised-workers.test.mjs:68`) failed after 205 ms because
   `[worker:push] authenticated:push` had not reached the test's stderr callback.
   The test waits for two startup files, a separate observation channel, then
   immediately asserts relayed log contents. All worker/test source is identical
   to round 1; `worker-baseline-source.json` binds it. The unchanged focused
   round-1 test passes. A scratch control that holds only that log delivery for
   250 ms, leaving product code and startup files unchanged, reproduces the same
   assertion on both round-1 and round-2 binaries. The log must be awaited on its
   own channel. The baseline test is unchanged in this patch; the open follow-up
   is [the supervised-workers log-race ticket](../../../../issues/20260930-snapback4-supervised-workers-log-race.md).

`worker-race-control.py` and its retained generated test/logs record the causal
control; their intentional failures are expected evidence. The complete focused
worker file subsequently passes **5/5 on eb1000**. Neither this focused pass nor
the corrected UID unit group relabels the single full run green. No full rerun
was performed. The source-bound full result remains red exactly as shown.

Rust: **4,366 passed, 1 failed, 33 declared ignored**. Client pool:
**5,311 passed, 1 failed, 10 existing skipped**. Fixture wrapper: **9 passed**.
Serial models: **79 passed**, with both full 5,000-sequence session walks and
the full 3,000-sequence online-client walk. No cancelled tests, reduced counts,
changed timeouts or loosened assertions. The inherited nominal 60-second bar
is exceeded; it is not claimed as met.

Mac wasm: **1,977,951 B raw / 593,592 B gzip**, 127 B below the unchanged
**593,719 B** ratchet. Linux: **1,978,828 B raw / 593,225 B gzip**, 494 B below
that ratchet. No wasm budget increase or cross-host byte-identity claim.

`full-suite.log.gz`, `full-suite.exit`, `full-suite-host.txt`,
`suite-summary.json` and both source-verification logs preserve the original
run. `check-logs.json` binds the original bytes of all retained top-level logs.
`final-source.json` identifies the final source and its documented differences
from the full-suite snapshot. The implementation, docs, report, baseline ticket
and one appended journal entry are committed locally with the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer. Nothing is pushed
or published.
