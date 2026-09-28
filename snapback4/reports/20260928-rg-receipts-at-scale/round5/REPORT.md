# RG round 5 — housekeeping cannot gate healthy outbox work

2026-09-28, `sb4-intent/rg-receipts-at-scale`. First fetched and merged
origin/main **e0568c2ec7** into round 4, without conflicts. Merge **58b3b2d07**
retains both sides and carries the co-author trailer (message-only amendment
of b7e429dd6). Read the binding prompts, reports and RG journal entries for
rounds 0–4 and [Grok's full round-3 review](rg-r3.grok.md).
[Scoped LLP context](CONTEXT.md).

## Findings and fixes

**Grok's Medium is fixed.** A failed reconciliation at the head of `flushOnce`
keeps `reconcileNeeded`, calls the existing `retryFlush()` and continues into
the protected FIFO snapshot. Repeated media errors no longer gate dispatch.
A successful attempt clears the flag. Nothing changes the retryable-head hold,
receipt qualification, dispatch order or notification ownership from round 4.

The real-wasm regression admits a second send while the first POST is held,
then makes `MediaCache.prototype.reconcile` throw on every call. The first
outcome is `sent`; before the fix, advancing the retry still leaves exactly
one POST. With the fix the second write posts and completes. Eight subsequent
5-second advances exercise repeated failure without reposts or duplicate events.
The test checks no work at 249 ms, one timer per attempt, exponential delays
from 250 ms through the 5-second cap, and bounded reconciliation calls. After
recovery it checks one successful repair, no further retry, and no extra
reconciliation at the next flush. [Pre-fix failures](regressions-before.log),
[final audit](audit.log), [restored-throw control](media-gate-throws.log).

**Grok's Low now has an independent oracle.** The new observation-catch test
fails the queue read after a durable tail refusal and records the retry timer
at terminal notification. It also fails the post-loop sync by making the
transport unavailable at that notification. That round returns false without
scheduling another flush. `/changes` stays held. The first success is absent
locally until transport recovery and the exact 250 ms retry deadline; 249 ms
cannot publish it. Caller, lookup and event still agree on the tail's refusal,
once. Emptying only the catch fails the timer assertion. The existing catch
already had the correct implementation; this finding required a test only.
[Empty-catch control](observation-catch-empty.log).

**The audit found two additional gates, both fixed and reproduced.**

- `admit` could commit successfully and then throw from media reconciliation.
  The admission handler treated this as a local `E_STORE` failure and never
  started that invocation's flush. It now uses the existing committed-reply
  wrapper, schedules outstanding media work and proceeds to normal settlement.
  With media failing persistently, caller, event and lookup all report `sent`,
  with one POST and no duplicate event through further retries. This fails
  the pre-fix tree and [raw-admission mutation](admission-raw-call.log).
- `keep_write` could commit the terminal receipt and then reject during host
  bookkeeping. The raw save call kept treating that receipt as unpersisted;
  repeated recovery re-entered the failed save instead of advancing the tail.
  It now preserves a non-denied committed reply too. `keep_write` performs no
  media reconciliation, so this use has no separate media retry: the immediately
  following settlement re-enters the host's normal restoration/call path.
  The test fails the host after every real receipt save, admits a tail behind
  a held POST, and advances eight retries. Before the fix only one POST occurs;
  afterward both writes complete once and agree with raw durable receipt
  storage and public lookup. [Before](receipt-save-before.log),
  [raw-save mutation](receipt-save-raw-call.log).

Absent commits and denied replies still fail. Actual receipt-persistence
failures still preserve known summaries and outbox custody; the fix never
skips their barrier. The changes are three call/catch sites in `local.ts`,
plus a governing reference. It stays at **1,500 lines**. LLP 3000.019 §3.3
records the decisions. There is no new public API, durable format, receipt
window, wasm ABI, authorization rule, disclosure rule or meter change.

## Housekeeping audit

Scope: an open, authorized local client with a working device/outbox, including
post-commit host failures, ordinary/recovered/acknowledged receipts, replacement
and keepalive delivery. Startup ownership/authority validation and actual
pre-commit storage failure remain prerequisites, not evidence of a healthy
usable device. Throwing application callbacks and never-resolving host promises
are not claimed to be repaired by catching repeated housekeeping rejection.

| Checked path | Disposition |
|---|---|
| `flushOnce` reconciliation before queue acquisition | Fixed: keep the flag, schedule bounded retry and fall through. Recovery clears it. Timer/flag controls independently pin both properties. |
| Admission → post-commit media/host work → `flush` | Fixed: a committed admission proceeds to dispatch; only unknown/pre-commit failure takes the local admission-error path. Synchronous capture and session authority are unchanged. |
| Receipt save → host bookkeeping → settlement | Fixed: a committed `keep_write` is a saved receipt. No callback or a denied reply still rejects. The repeated-failure test verifies the actual device history, not just memory. |
| Receipt reads, `keep`, `persistPending`, pre-dispatch recovery | Required custody work. Reads distinguish authored refusal from success and local history from shared lookup; uncommitted receipt saves cannot be bypassed before retirement. Their failures retain the outbox and existing backoff. The receipt-abort suites remain required and green. |
| Ordinary, recovered and qualified-success `settle`; keepalive `settle_exit` | The existing committed-reply wrapper preserves durable replies and schedules reconciliation. Exclusive settlement and reference-counted emission owners are unchanged. The 58-test audit and round-4 controls cover recovery, overlap, reset and duplicate boundaries. |
| Observation after ordinary completion, known-success delivery and final-loop sync | The ordinary observation catch schedules retry and still resolves/emits. Known-success delivery precedes its observation await. Sync is eligible only without another unresolved entry; a new tail can progress on the next flush. Final-loop failure is caught by `flush`; it cannot consume a terminal notification. The new test isolates the catch's timer from that final-loop path. |
| `observe_store`, replacement/reset, adoption, `apply`, synced-time metadata | Committed invalidation and retired-success notifications run before later media/state/metadata work. Failure cannot restore an old approved answer or erase delivery. The serialized network tail catches rejection so later outbox work can run. Backend/store/restore validation remains mandatory. |
| Pending lists, emission pruning, receipt-window eviction | `readQueued` pruning and marker retention are synchronous in-memory work after the authoritative queue read. All snapshot and overlapping-delivery guards remain intact. Device receipt-window changes occur in the receipt transaction; the new save wrapper respects its commit boundary. No new pruning await precedes delivery. |
| Web host journal cleanup, residency bookkeeping, Worker/native calls | Before-commit journal cleanup belongs to the atomic persistence boundary. After-commit host rejection now preserves replies for admission, receipt save and terminal retirement. Hosts without a committed callback still must return success before it is trusted. Normal next-call restoration remains in the host, not a second SDK store. |
| Delivery debt, pruning/activation enumeration, `onDeliveryRefused` | Separate scheduling/serialization; ordinary outbox/network work wins the readiness gate. `published`/`available` schedule rather than await debt work. Enumeration/storage failures back off separately. Refusal notification follows its required conditional durable edit, with no later housekeeping await. Delivery/publication/CAS/activation tests remain green. |
| Clock and meters | Offset persistence before timestamped device calls preserves the existing clock/admission contract; settlement/keep_write do not introduce a timestamp-save gate. Changed clocks schedule media separately with a rejection handler. Runtime meters and prediction/authorization limits remain transactional Rust decisions; no metering/telemetry flush runs before the SDK outbox loop or terminal emission. |
| Media reads, expiry, sign-out, startup and close | Retained-media reads still revalidate their home/expiry and may fail themselves; they do not hold the network chain. Media's serial tail catches rejection. Startup still must open the device/cache and validate authority before returning a client. Sign-out fences dispatch before clearing media; close intentionally stops it. Those lifecycle fences are not bypassed. |
| Raw online and app custody facade | Raw online resolution/emission has no housekeeping await after classification. The app wrapper retains and notifies known outcomes on journal-save rejection. These use independent custody and remain covered by the receipt/delivery/transport tests. |

No further optional housekeeping gate on healthy open-client dispatch or durable
terminal delivery was identified. Round 4's exactly-once claim and its explicit
runtime/receipt-window limits remain; this is not cross-process event delivery.

## Validation

Final check counts and complete logs are recorded in [test-summary.json](test-summary.json)
and [check-exits.txt](check-exits.txt); commands are in [commands.sh](commands.sh).
The affected client groups were repeated after the additional receipt-save fix.
Initial passing logs are retained under `initial/`; they are not added to the
final totals. Rust implementation inputs did not change during those reruns.

| Check | Final result |
|---|---:|
| Audit module | 58 passed |
| Clock, React and pending writes | 141 passed |
| Client receipts and delivery | 212 passed |
| Settlement, outcomes, replacement, reconnect and generation | 90 passed; 1 legacy-server skip |
| Media lifecycle, asset lists and native adapter | 72 passed; 1 macOS-only skip |
| HTTP transport/receipt-window recovery | 12 passed |
| Chromium admission/session boundaries | 55 passed |
| Whole guide | 93 passed |
| Rust receipt gaps and delivery | 42 passed; 1 opt-in measurement ignored |
| Native/client builds, typecheck, references, whitespace and source limits | passed |

Total: **640 client tests and 135 Rust tests passed**. The two client skips
require the historical 0.2.32 binary and macOS Foundation/AVFoundation,
respectively. The ignored Rust test is an opt-in measurement.

[Round-5 controls](controls.py) reruns round 4's exact `controls.py` after the
build, archives its five killed mutants under [round4-controls/](round4-controls/controls.json),
and restores the historical round-4 evidence files unchanged. Six new isolated
built-client mutants are killed at the intended assertion: restored media throw,
empty observation catch, raw admission, raw receipt save, uncleared media flag,
and reset backoff. [Results](controls.json). No live source or build is mutated.

## Failures and disposition

| Classification | Failure | Disposition |
|---|---|---|
| Ours, expected pre-fix regressions | Repeating media error strands the tail; committed admission becomes failed | Both fail the merged round-4 build; fixed and covered by the final audit |
| Ours, audit finding / expected pre-fix regression | Repeated post-commit receipt-save host failure strands the tail | `receipt-save-before.log`; committed save now advances normally |
| Ours, expected mutation failures | Five round-4 controls and six round-5 controls | All fail their intended assertions; final unmutated tests pass |
| Ours, test fixture | Initial media backoff test counted the held `/changes` watchdog's 1-second recovery timer as another flush retry | Initial fixed run interrupted; two diagnostic runs retain the assertion. Wait for the held `/changes` request before freezing retry timers; final backoff/recovery and control tests pass |
| Ours, setup | First report-directory creation used an extra `snapback4/` prefix, so build-log redirection failed before the build ran | Removed the empty mistaken directories, created the correct directory and built successfully. No installation or product failure |
| Ours, discovery | Initial report lookup and proposed media filename used incorrect paths | Corrected from file discovery before validation; no missing-file check counted as a pass |

No baseline or environmental check failure was observed. The native build's
existing vendored `tiny_http` dead-code warning is not a failing check.
Earlier rounds' complete-suite failures retain their historical dispositions;
these affected checks do not rewrite those full-suite results.

**Did not run `scripts/test.sh`.** The supervisor owns the next landing suite.
No tools installed, push or publication. No calibration-store access and no
new scale-latency claim in this round.

[Wasm measurement](wasm.json): **2,019,815 B raw / 585,381 B gzip**,
SHA-256 `2e12e4657211129dfe80e58ff8ef88a23d52ad19885ed5d461c30a68d47e68a0`.
Byte-identical to round 4; **812 B** below the unchanged **586,193 B** cap.
Remeasured the existing client artifact with GNU `gzip -9 -c` file input;
not rebuilt. This round changes TypeScript, tests and documentation; the merge
brought release/package metadata and evidence, with no Rust implementation delta.
