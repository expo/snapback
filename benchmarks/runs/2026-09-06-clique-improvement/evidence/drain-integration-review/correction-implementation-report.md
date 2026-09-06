# Drain owner regression — concrete runtime red and focused repair

The clean local candidate is **df68f3cf9e1edbc6f6a490884b8469b28e8aab78** on
**s2/clique-drain-owner-regression**, parent
**d5e1664496b7a1a2f8272dc136cddbea1c458046**. Work occurred only in PRIMARY
`/Users/ccheever/projects/snapback-worktrees/clique-release-next`, with Astra
xhigh as sole writer and no subagents. The prior composition and drain review
branches still name d5e166449 and 680b68716 respectively.

The reviewer-inferred stale owner assertion is now an **actual reproduced Rust
failure**, followed by an actual passing execution of the corrected complete
test. All three refused operations and the later 52-row/large-envelope exercise
remain. The directly affected client file passes all 3 tests at its original 10s
bound. No product implementation changed. Exactly three tracked files changed:
the owner test, existing canonical client list, and one word clarification in
the offline guide.

**Widening and publication remain unqualified.** The inherited corrected
successor ecb has a new actual runtime ordering defect: a retired maintained
`aTotals` becomes the source for `zTotals`; admission predicts an ID before
sequential rebuilding clears the retired source, leaving an invalid zTotals
survivor. The separate ordering lane's retained native log is **0 pass / 2
fail**, for additive and mixed-drop cases. That log was read; its tests were
not rerun here, and no widening source was mutated. Its repair belongs to the
separate sole writer. This owner-test result does not clear that defect or
confer independent review, overall release, package, publication or Clique
qualification. Root owns same-content dual-review followup and integration.

No remote command, fetch, merge of moving main/version 12, push, npm operation,
version change, publication/dry-run, benchmark authoring/input/DB change, broad
workspace/public-asset/runtime test rerun, new baseline outside the requested
owner reproduction, v1 bootstrap/inventory, or Root goal-state edit occurred.
No live blind Grok review content was read. Other remote processes and the
paused publisher remain UNKNOWN and untouched.

## Review and source binding

Read the entire 17,994-byte Astra report at
`/Users/ccheever/clique-improvement/reviews/drain-local-integration-r1/astra/review-evidence/review.md`
and its `root-verification.json`. The report SHA256 is
`17618427b0a473b2b8fda8ab7b3286010c008dcd13f3e330e95b0127fdda40aa`, matching
Root's receipt. Root verified 950 leaves for the reviewed 680b export and recorded
the actual gpt-6-astra/xhigh reviewer exit 0. The review's 14 focused source-client
passes and source audit are independent review evidence; it explicitly ran no
Rust owner. They are not represented as reviewer Rust execution here.

[inputs.json](inputs.json) binds that report, Root's verification, the separate
actual widening-ordering red log, and the prior d5 handoff/phase. Scoped
Snapback2 AGENTS/rules/LLP 1000/1012 orientation from the same session was retained;
the current testing/offline guides, LLP 1012 §8, actual owner test, boot/compiler
fixture support, HTTP/SSE/shutdown helpers, producer and returned-page shape
logic were inspected before the repair. No v1 workflow was invoked.

[baseline-manifest.json](baseline-manifest.json) freezes 935 tracked source
leaves at d5 before test edits. The exact relevant baseline files and failing
test executable remain under `baseline-source/` and `baseline-owner-test`.
[source-manifest.json](source-manifest.json) binds the committed candidate.
[source-correspondence.json](source-correspondence.json) proves 932 leaves
unchanged and only the three requested paths changed. It also compares complete
Git source subtrees for owner, core, client, compiler, evaluator and corpus;
all are identical to d5. Lockfiles, versions and governing LLPs are unchanged.
[candidate.patch](candidate.patch) and [commit-receipt.json](commit-receipt.json)
bind the exact three-file commit and clean state.

## Actual baseline failures, before assertion changes

The existing owner test has no port-selection hook: its ChildGuard invokes
`snapback2 dev --project ... --foreground`, which normally selects port 0. To
honor the allocated 52020–52029 range without editing baseline source or changing
the product, two **external evidence helpers** were used:

- `rustc-owner-wrapper.py` changes only the owner test target's compile-time
  `CARGO_BIN_EXE_snapback2` launch path to `owner-launch.py`. Other rustc commands
  pass through unchanged. Exact compiler argv and the original native path are
  recorded in `compiler-adapter.jsonl`.
- `owner-launch.py` checks the real binary SHA256, checks the selected port is
  free, records its PID/argv, adds only `--port 52020`, and execs the unchanged
  native binary under that same PID. It does not alter requests, responses,
  assertions, source, populations, compiler results or deadlines. The original
  test's ChildGuard retains custody of the actual owner PID.

The baseline owner test target was separately compiled from unchanged d5
source with `cargo test --offline --locked -j2 -p snapback2 --test owner --no-run`
under the existing 300s native build bound. The warm target was reused; this was
one named test target, not a fresh workspace build. Baseline executable SHA256
is `df20ab180bff9b1402fd7e271a18cff3b778c4356827d9bc1797fe30c9fb4ea5`.
The production-source development owner remained byte-identical to d5.

**First actual execution: setup failure, retained.** `owner-baseline` exited 101
before readiness at owner_support/mod.rs:71: its isolated compiler could not
import TypeScript. The actual source helper links the fixture's TypeScript to
`snapback2/packages/snapback2/node_modules/typescript`; that package-local path
was absent in the prepared cache even though workspace-root TypeScript 5.9.2 was
already present. This failure did not reach the stale cap assertion.

[typescript-link-before.json](typescript-link-before.json) preserves the absent
paths and broken fixture symlink. The only environment repair created the
ignored package-local link to `../../../node_modules/typescript`, resolving to
the existing warm copy. No install, network access, version/source change or
test change occurred. [typescript-link-repair.json](typescript-link-repair.json)
binds the target/version/hash. The original failed fixture is retained; its
previously broken link can now resolve through the repaired shared cache, so
the before-state receipt is authoritative for that setup failure.

**Second execution: actual R1 failure on the same source/test binary.** After
that dependency repair, `owner-baseline-ready` exited 101 at the original
offline_resume.rs:497:

```text
assertion `left == right` failed: last 50
  left: Null
 right: 50
```

It was not a timeout. The first descending-log case booted and reached the
expected missing-cap assertion. Only then were the test assertions edited.
Both baseline attempts retain separate logs/receipts and private fixtures;
neither is relabeled as a pass. The setup retry was necessary to obtain the
requested actual assertion failure; no unrelated baseline was rerun.

The unchanged fixture's `ensure_package` hook refreshed its private package
setup when its marker was missing/stale, including after the dependency link
and later guide input changed. Those existing setup calls used the same warm
source graph; no broad package tests or production build was run. Their child
processes are recorded in the enclosing execution receipts. Runtime/client/
compiler artifact equality was checked after these setup builds.

## Exact correction and preserved populations

`owner_cases::offline_resume::offline_resume_log_is_the_ascending_page_measured_against_the_budget`
now asserts the actual structured contract:

| Refused case, unchanged request | Exact expected shape |
|---|---|
| `messages.thread`, descending last 50 | `descending` |
| `profiles.mine`, unpaged point result | `cursor-binding` |
| `messages.members`, ascending first 60 | `page-bound` |

For every case, HTTP 413, E_OFFLINE_RESUME, `which: log`, `/api/resume.log` site
and unchanged execution count remain asserted. The test now checks exact
`reason: unsupported-log`, requested `op`, derived `shape`, and absence of the
old cap field. The rewrite must teach all five intended meanings: ascending
delivery log, `after c first N`, `N <= 50`, ordinary `c: null` subscription for
newest-first data, and kept queued writes. No producer/admission change was
made to satisfy obsolete expectations.

The entire later population and budget tail is **byte-identical** to d5:
52 committed notes, each 5100 four-byte characters; a 50-row ascending log with
51 pooled page/halo rows; serialized response greater than 1,048,576 bytes;
`more: 1`; no mounted answers; exactly one execution for the log and no mounted
execution. Its byte hash is
`dfc9b390a9560b24008304a8ddd3bbaa6140b55394eefad0cf5f96c70e85bb66`.
The surrounding owner test file also remains byte-identical outside this one
function. [changed-input-proof.json](changed-input-proof.json) records these
comparisons and preserved assertion/population checks.

`snapback2/scripts/test.sh` adds exactly one existing file,
`tests/drain-admission.test.ts`, to its existing explicit client command. Removing
that one token reproduces the original script exactly. All other entries,
test populations and timeout options remain unchanged; no new gate was added.

The offline guide changes `Media can expire` to **`Unclaimed media can expire`**.
The page is **4342 bytes <=4352**, and the served dist guide matches it exactly.
No other guide text, expiry/grace policy or byte cap changed. No diary, LLP,
benchmark, product or widening file was changed.

[runtime-size-source-proof.json](runtime-size-source-proof.json) rechecks all
26 inputs, including the fixed entry, and the retained measured bundle against
the prior d5 proof. All hashes match. The existing complete artifact remains
39,971 gzip bytes with the unchanged 66,000-byte ceiling. No measurement was
rerun, entry narrowed, benchmark scope changed or runtime qualification added.

## Targeted verification and deadlines

[verification-index.json](verification-index.json) indexes exact argv, cwd,
PID, elapsed time, exit and timeout status; full output is retained beside each
`logs/<name>.json`. The exact selected owner name is shown above; each runtime
execution uses `--exact ... --nocapture --test-threads=1`, with 87 other owner
tests filtered. Compilation is separate from execution.

| Receipt | Result | Bound / elapsed |
|---|---|---|
| `owner-test-build-baseline` | Pass; unchanged-source owner test executable prepared |300s /35.061s |
| `owner-baseline` | **Fail101**, missing package-local TypeScript before owner readiness |60s outer /18.877s |
| `owner-baseline-ready` | **Fail101**, actual Null-vs50 assertion on unchanged source |60s outer /22.747s |
| `owner-test-build-fixed` | Pass; only the affected owner test target recompiles |300s /6.528s |
| `owner-fixed` | **1 pass**,0 fail; all three refusals and full 52-row budget exercise complete |60s outer /23.646s; Rust test21.87s |
| `client-drain` | **3 pass**,0 fail/cancelled/skipped |10000ms Node file and10s command /1.499s |
| `caps` | Pass, all 7 budget categories |60s /4.002s |
| `refs` | Pass: 411 LLPs, 7676 refs, 0 errors, 0 unchecked |60s /14.953s |
| `script-syntax` | `bash -n snapback2/scripts/test.sh` passes |10s /0.894s |
| diff/source/commit audit | Pass; only requested 3 files, clean commit, product byte equality | recorded source/commit receipts |

The real owner test's original HTTP read timeout stays 5s; its stop wait stays 5s.
The shared 6s SSE timeout remains unchanged (the selected case does not use SSE).
Package lock and product compiler limits remain their existing 30s. The original
ready-line reader is unchanged; the external runtime wrapper adds a 60s total
ceiling rather than extending an internal deadline. Node's file deadline remains
10000ms, including 500ms waiter assertions in drain-admission. No population,
request/socket timeout, test deadline or quota was increased to claim a pass.

The client file covers typed unsupported callback/current/future waiters;
legacy resume refusal across reopen with coverage/queue/grant/IDs preserved;
legitimate explicit replay under independent trust; and React refusal field
reduction. It runs against the prepared real package dist, not a substituted
source bundle. No broader client, native runtime, public-asset, browser,
declaration, twin, compiler corpus, benchmark or full battery was repeated for
this test/guide change. No additional product repair proved necessary.

## Artifact correspondence and actual custody

[prepared-artifacts.json](prepared-artifacts.json),
[baseline-execution-binding.json](baseline-execution-binding.json),
[fixed-execution-binding.json](fixed-execution-binding.json) and
[artifact-correspondence.json](artifact-correspondence.json) bind the actual
test sources, native executable, external adapter and package artifacts.
The committed test source hash equals the hash used by the passing execution.
The final test executable remains at the recorded private warm target path;
the failing baseline test executable is separately retained.

The real development owner SHA256 remained
`4710d5a1ab842ec56505f7426983c2e5bb7cab616f51d7c1fbc8f586b9ec69e4`, exactly d5.
Client bundle remained
`05102cbc258aaf15ecd17e896532d1ca8d679416bc34ffe171fa481c23204f5e`.
Compiler worker/core remained
`9c93d2adc425eab14d977a2a8b0d1228a0a5c8c27c4e59bc889efe9863490a78` /
`49e6fa63fdeb01977d11c569617074e2a0f60ad132a3ecbdc28345ea4a4fdcd6`.
Test and React-core package bundles are also unchanged. Only the dist offline
guide changes to match the source clarification. There is no claimed production
Hermes, published-package, native-device or full-package qualification.

`owner-launches.jsonl` records each actual owner PID before exec, binary hash,
original/forwarded argv and free-port check. The unchanged test still owns
shutdown and panic cleanup; there is no process-name/pattern kill or shared
owner stop. [owner-cleanup.json](owner-cleanup.json) records:

| Owner PID | Attempt | Final custody |
|---|---|---|
|54245 | Setup failure | PID absent; failed private fixture retained. |
|55723 | Actual stale-assertion failure | PID absent after original ChildGuard panic cleanup; private fixture/store retained. |
|60580 | Corrected complete test | Control-stop and successful owner wait asserted by the passing test; PID absent; original success cleanup removed its disposable fixture. |

[cleanup-receipt.json](cleanup-receipt.json) checks 36 observed command/child PIDs,
with none remaining, and all 52020–52029 ports free. Only 52020 was bound, after
free-port checks at each launch. The ignored TypeScript link and isolated warm
cache are retained for reuse; no install or dependency version changed. The
baseline failure fixtures, logs, sources, adapter records and executable are
preserved. Cleanup sent no additional signals. No remote state was inspected or
modified.

## Retained findings and handoff

[first-failures.json](first-failures.json) keeps this task's setup failure and
actual stale assertion distinct from the later pass. The reviewer source audit
remains source-only evidence; the new Rust logs establish actual execution.
Exploratory missing-path/unmatched-glob lookups remain in the session transcript
and are not product checks.

All prior d5/drain/asset failure records remain unchanged. In particular, both
original 10s public asset file failures from the d5 composition remain actual
failures; declaration-export and whole-twin 10s limits remain unqualified. The
prior 127-client/42-core and public successor/browser passes are historical
receipts, not a full Clique claim or a reason to dismiss the newly discovered
widening ordering defect. The original survivor fix and this owner correction
do not qualify that ordering scenario. Asset physical-custody/GC and broader
publication/benchmark limits remain as recorded in the original reports.

Root owns the separate widening repair, same-content dual-review followup,
integration and any later qualification/publication. The sole writer releases
only after this full report, exact source/verification/cleanup receipts and
clean commit are frozen in terminal `phase.json`. `final-answer.md` is the
separate short CLI handoff. **Writer release is not review, widening, overall
release or publication clearance.**
