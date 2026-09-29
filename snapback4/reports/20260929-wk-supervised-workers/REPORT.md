# WK round 0 — supervised workers and effect completion ledger

Base: `4fd338de5`, branch `sb4-intent/wk-supervised-workers`.
Implementation: Node 24.13.1 on Linux, in the assigned lane. No push or publication.

## Delivered surface

- Declare each worker once as `snapback/workers/<service>.mjs`, `.mts` or `.ts`.
  Dev and serve discover these entries; deploy snapshots the source subtree.
  Helpers belong in subdirectories, and the deployment host installs npm dependencies.
- The existing supervisor now owns multiple children, with independent service
  sessions/revocation families, name-prefixed redacted logs, 250 ms–5 s restart
  backoff, one-day token rotation and shutdown with the server. Automatic tokens
  are never printed, including the historical conventional dev entry. Doctor
  reports every declaration and its last recorded state, PID and restart counts.
- `meta.idempotencyKey` is the existing effect id, stable across redelivery and
  restarts. `runWorker({ ledger: true, ... })` uses the supervisor's durable local
  SQLite completion file beside the backend store. Standalone workers use an
  explicit path. Successful JSON results commit before settlement and replay
  without repeating the handler after a lost acknowledgement.
- The effects/worker guide, guide listing and aliases, package introduction,
  service/action cards and social starter expose this surface. The starter
  contains a declared worker with the ledger enabled and a provider placeholder;
  it does not falsely claim to send notifications before a provider is connected.
- LLP 3000.009 §5.2/§5.3 records the design and tradeoff. A source convention was
  chosen to extend the existing entry convention without a configuration format
  or repeated flags. Existing conventional workers, `serve --worker` and
  standalone `runWorker` remain available.

## Semantics and limits

The engine's admission, ordering, lease/settlement wire, retries, meters and rules
are unchanged. The only core change is a host-only lookup preserving the existing
supervisor revision fence for each named service family. Manually minted seats
keep their prior behavior. Service credentials remain deployment-trusted; naming
seats is not a new per-effect ACL. Generated `ctx.step` reconciliation and native
wasm jobs are unchanged. No edits to `contract.ts` or the wasm budget.

A local SQLite write transaction serializes opted-in handlers sharing one file,
including separate Node processes. Keep that file across restarts, releases and
backups; it has no automatic pruning. Separate disks do not share deduplication.
The supervised path belongs to the persistent store directory, not the active
release. The existing stopped-deployment backup copies it with the deployment.

Delivery is still at least once. A crash after provider I/O but before the ledger
write/commit can repeat the action, including an ambiguous provider outcome that
throws before returning a recordable result. Pass `meta.idempotencyKey` to providers
that support it. This is completion deduplication, not an exactly-once external
transaction. Provider tests here use doubles; no actual push-provider claim.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Two declared workers in real dev and deployed serve; usable injected tokens; split-chunk stdout/stderr redaction; independent restart and shutdown | pass | `supervision-final.log.gz` |
| SQLite ledger replay after lost acknowledgement, failed-handler rollback, two concurrent standalone processes and replay after exit | pass; combined new file 5/5 | `supervision-final.log.gz` |
| Real HTTP effect lease expiry and redelivery: attempt 2, original receipt, one handler call | 1/1 pass | `real-http-ledger.log.gz` |
| Existing worker, generated-effect-context and social-starter checks | 60/60 pass | `affected-final.log.gz` |
| Effect policies and named-seat revision fence/manual-seat independence | 13/13 pass | `effect-policy.log.gz` |
| Whole guide | 98/98 pass | `whole-guide-qualified.log.gz` (final prose); earlier `whole-guide-final.log.gz` |
| Package typecheck/build; docs budget | pass; README 300/300 lines | `typecheck-final.log.gz`, `package-build.log.gz`, `docs-budget.log.gz` |
| Repaired await inventory | 1/1 pass after the full-run finding; only worker entries changed | `await-boundary-repaired.log.gz` |
| Reference audit | 523 LLP docs, 9854 refs, zero errors/unchecked | `ref-check.log.gz` |

The final stopped-backup prose explicitly names automatic worker startup;
its executable copy recipe is unchanged.

### Full suite — one run, exit 1

Exact summary line:

```text
== 1 failure(s) in 1506 s
```

Every failed stage/test in that run:

| Stage | Failed test | Attribution | Final disposition |
| --- | --- | --- | --- |
| client tests | `every delivery await is explicitly classified` (`delivery-fault-matrix.test.mjs:41`) | **Ours**: the all-module await inventory lacked the new ledger module and worker awaits | Updated only `worker-ledger.ts` and `worker.ts` records after checking server-effect versus client-write reachability; exact failed check rerun **1/1 pass**. No runtime change was needed. |

The original full run is retained in `test-sh.log.gz`; `test-sh.exit` is `1`.
It was not rerun or relabeled green after the repair. The final tree has the
repaired inventory; its targeted rerun is `await-boundary-repaired.log.gz`.

All other stages passed: workspace build, canonical wasm build, docs budget,
release guard, package typecheck/build, chat compilation, Cargo tests (663 s),
both app typechecks, fixture wrapper tests, and client models (79/79, 339 s).
Client stage totals across its eight processes: **4,566 passed, 1 failed,
10 skipped, zero cancelled**. The new dev/serve supervision, concurrent-process
ledger, real HTTP redelivery and social starter tests all passed within this run.
The ten skips are declared suite skips, not passes.

No baseline or environmental **test failures** occurred in the full run.
The 60-second standing suite target remains missed (**baseline process-budget
issue**: the base journal already records 1,690 seconds). No timeout or ceiling
was raised. The earlier missing-generated-wasm typecheck failure was environmental
and repaired; all earlier failed attempts are listed in `FAILURES.md`.
Earlier failures and their repairs are exhaustively classified in `FAILURES.md`.
All `.log.gz` artifacts preserve the original log bytes; compression was verified
by byte-for-byte decompression.

## Wasm

Canonical `bash scripts/build-wasm.sh`: **2,040,529 B raw / 592,975 B gzip**.
Cap: **593,719 B gzip**, margin **744 B**. No cap increase.
Wasm SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
This is the lane build's measured size, not a claimed reduction against another
host's prior measurement. See `wasm.log.gz` and the full suite's wasm stage.
