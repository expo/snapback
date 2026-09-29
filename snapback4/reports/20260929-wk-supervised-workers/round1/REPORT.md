# WK round 1 — worker review repairs

Branch: `sb4-intent/wk-supervised-workers`; round 0 `c3efc87b0`.
First action: fetch and merge `origin/main`; merge `aab7acbbc` preserves both
append-only journal entries. No push or publication. Linux / Node 24.13.1.

## Changes

All five Astra findings have regression coverage and fixes:

1. Retirement retains the prior family/expiry until its transaction commits.
   The worker stops first; no replacement token is minted while retirement
   fails. Real HTTP tests retry the retired bearer after a locked-writer
   restart and after rotation. Removing the named-family session DELETE makes
   both tests fail with **200 rather than 401**.
2. Descriptor-relative, no-follow traversal checks the schema directory,
   workers root and every nested entry. Discovery/deploy reject links and
   non-regular files, and copying uses opened regular files with their modes.
3. Ledger placement follows the **opened** SQLite store, including temporary
   stores, with a filename namespace derived from `store_id`. Two successive
   fresh stores and two persistent-store incarnations each perform their own
   effect despite reusing the exact effect ID.
4. Each Node worker has a process group and a pipe-owned watchdog. Worker exit
   kills remaining group members; server death closes the pipe even on SIGKILL.
   Shutdown begins all groups' grace periods together before waiting. Public
   status PID remains the Node worker's PID.
5. Ledger creation/schema/receipt validation happens before any claim.
   Initialization failure reports once and suspends until abort/restart.
   Subsequent storage/commit/rollback failure closes storage and stops polling,
   leaving claimed effects to their normal lease recovery rather than recording
   a handler failure.

Grok's complete streamed review was read and addressed too. Named workers now
start with no schema secrets and opt into a declared subset using a source line
such as `// snapback4 secrets: PUSH_API_KEY`. Conventional generated runtimes
retain their full registry environment; the redactor still knows every declared
secret. Mint/secret/retirement/spawn failure backoff increases to its existing
five-second cap. Added simultaneous-shutdown, bounded-retry, corrupt-receipt,
real SQLite page-exhaustion and injected commit/rollback-failure witnesses.
The concurrent-process test now requires all original receipts, and a
deterministic contention test kills Grok's surviving SQLITE_BUSY mutation.

The shared-ledger lock remains deliberate. As Grok allowed, documentation now
states explicitly that one hung provider stalls every handler sharing that
file and shows a provider timeout. Unlocking around the provider call would
allow simultaneous duplicate calls for one key. Provider-call/commit ambiguity
still requires provider idempotency; this is not exactly-once external delivery.
Every review item and its disposition is in [REVIEWS.md](REVIEWS.md).

No changes to effect admission, ordering, retries, meters or authorization.
Standalone runWorker remains supported; native jobs and generated ctx.step
reconciliation are unchanged. This is trusted-process supervision, not a
sandbox against deliberate process-group escape. Execution evidence is Linux;
no macOS or real-provider execution is claimed.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Final regressions, named dev/serve workers and existing worker HTTP/context suite | **62/62 pass** | `affected-qualified.log.gz` |
| Exact three worker/adoption failures repaired after the full-suite finding | **3/3 pass** | `adoption-worker-repaired.log.gz` |
| Whole guide after final guide/manual changes | **98/98 pass** | `guide-final.log.gz` |
| Package build and typecheck | pass | `grok-package-build.log.gz`, `typecheck-final.log.gz` |
| Final host build | pass | `build-qualified.log.gz` |
| Await reachability census: only worker/ledger entries changed | **1/1 pass** | `await-inventory-final.log.gz` |
| Named-family DELETE mutation | **2/2 killed** | `mutant-revocation.log.gz` |
| Run-path SQLITE_BUSY retry mutation, copied module | **1/1 killed** | `mutant-busy.log.gz`; fixed `busy-fixed.log.gz` |
| Reference audit | zero errors / unchecked | `ref-check-qualified.log.gz` |

Before repair, the initial regression control was **2 pass / 11 fail** on
round 0: entry/helper-link refusals already worked, while every reported Astra
finding reproduced. Later Grok controls failed **2/2** for secret exposure and
sequential shutdown, and **2/2** for runtime storage failures. All expected
controls and intermediate authoring failures are classified in
[FAILURES.md](FAILURES.md), including two stale ledger-path assertions.

## Full suite: one invocation

Exit **1**; exact summary:

```text
== 1 failure(s) in 1319 s
```

Every failed test in the run (all in the `cargo test` stage):

| Failed test | Attribution | Final disposition |
| --- | --- | --- |
| `serve::tests::adoption_tests::worker::production_accept_loop_reads_after_delayed_worker_exit` | **Ours**: optional missing schema directory was rejected | Repaired; exact three-test rerun **3/3 pass** |
| `serve::tests::adoption_tests::worker::production_accept_loop_reads_while_exited_worker_waits_for_adoption` | **Ours**, same regression | Same repair/rerun |
| `serve::tests::adoption_tests::worker::production_accept_loop_waits_for_complete_worker_readiness` | **Ours**, same regression | Same repair/rerun |

The failing Rust target reported **196 passed / 3 failed / 4 ignored**.
Discovery again treats an absent schema directory as no declarations, while
refusing linked paths. Unit fixtures also launch the built production watchdog
CLI, since Rust's test-runner main cannot dispatch the internal CLI verb.

Every other full-suite stage passed: build, canonical wasm, docs budget, release
guard, package typecheck/build, chat compilation, both application typechecks,
fixture wrappers, clients and models. Client totals: **4,587 passed / 0 failed /
10 declared skips** across the eight runner processes. Models: **79/79 pass**.
No baseline or environmental test failure occurred in this run. The standing
60-second full-suite target remains a **baseline process-budget miss** (round 0
already recorded 1,506 seconds); no ceiling or timeout changed.
See `test-sh.log.gz` and `test-sh.exit`.

The original full run is retained, not rerun or relabeled after targeted
repairs. Its initial build/Rust stage preceded Grok's completed streamed review;
final affected/guide/typecheck evidence above covers the resulting final changes.
This is not a claim of one atomic final-source full-battery snapshot.

## Wasm

Canonical full-suite build and final measurement:
**2,040,529 B raw / 592,975 B gzip**, against **593,719 B gzip**.
Margin: **744 B**. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See `wasm.json` and the original full-run build stage. No ceiling was raised.

LLP 3000.009 §5.2/§5.3, the effects guide and operations manual record the
current contract. One round-1 journal entry accompanies the local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
