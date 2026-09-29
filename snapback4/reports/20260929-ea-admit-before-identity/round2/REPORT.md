# EA round 2 — custody across native, peer and restore handoffs

Deferred custody must never lose, duplicate or misreport a write. This round
addresses every Astra round-1 finding and both High findings in Grok's final
round-1 review. The branch includes RL, AG and AQ from origin/main. Local
commits only; nothing pushed or published. See [context](CONTEXT.md), the
adjacent review snapshots and [environment](environment.json).

## Review findings and detecting controls

1. **Astra High: cached native emptiness bypasses binding/FIFO.** Removed the
   native cache bypass. Every SDK admission supplies its own compare token;
   SQLite admission checks the current deferred queue, exact input, captured
   backend/store, terminal status and earlier unadmitted intent. The admitted
   outbox retains its original store binding for transport. Two real clients
   against real servers reproduce FIRST/SECOND inversion and a replacement
   receiving the captured write. Raw-device admission independently refuses
   the incompatible deferred binding. `negative-public-final.log` has three
   expected failures (FIFO, replacement, executed-as-timeout), and
   `negative-handoffs.log` has six detecting failures against pre-fix production.

2. **Astra High: native expiry reports an executed write as unsent.** Native
   custody reads and compares reconcile current outbox and terminal history
   under SQLite's writer transaction. A stale expiry proposal reloads the
   winning custody/outcome. Durable fingerprints retain operation/arguments/
   viewer equality after the peer retires its ordinary row. Tests cover held
   response, completed receipt, fully retired outbox, and different arguments,
   viewer or operation against the retired receipt. A deferred terminal view
   only retires its handoff metadata; it cannot settle a peer's unrelated
   ordinary row. The existing metadata operation carries the native read check,
   preserving compatibility with device wrappers.

3. **Astra Medium: restore hides/strands deferred writes.** The restore fence
   still prevents transport. Flush may settle proven-unsent deferred refusals;
   pendingWrites retains them through held/failed receipt persistence and
   onWrite follows the durable terminal commit. Production wasm and Worker
   clients plus the model exercise private snapshot progress followed by a
   rewind. The detector fails on pre-fix code; no write POST occurs.

4. **Astra surviving mutation: removed freeze save.** The peer-expiry schedule
   pauses between the successful identity-freeze save and native admission.
   Removing that save produces E_ADMISSION_TIMEOUT in the peer and fails
   `mutant-freeze.log`. A final isolated copy again passes with production
   code (`freeze-final-control.log`) and fails with just the save deleted
   (`freeze-final-mutant.log`). The raw-device schedule also covers publication
   without the new optional SDK timestamp. The production save remains in place.

5. **Grok High: timely publication observed after the deadline.** The device
   atomically records SDK wall time when it publishes store identity. Admission
   accepts a matching timely publication even after a delayed poll/reopen,
   but refuses a first publication after the deadline. Freeze precedes a
   backend-required pause. Native expiry also rechecks publication inside the
   compare transaction: a separate detector pauses after the JS state read,
   lets a peer publish at 28 seconds, then resumes expiry at 33 seconds.
   `grok-negative.log` fails both timely-publication variants; genuinely late
   variants pass. `publication-overlap-negative.log` catches the narrower
   native race before its additional fix. Final coverage includes reopen on
   both native and wasm.

6. **Grok High: successful originator probe races peer dispatch.** Per-ID
   transport claims last through durable receipt settlement, separate from
   journal/session locks. A late same-store probe waits and recovers success;
   a replacement probe cannot retire the peer's in-flight success. Claims
   release on transport retry, completion or renderer death, preserving
   lost-response/reopen recovery. Auth retries within a send reuse the claim.
   Simply treating every durable `dispatched` bit as permanently pending would
   strand those recovery paths. `grok-negative.log` detects two POSTs on the
   same-store schedule and the clobbered success on replacement. Final tests
   assert one POST, one execution, retained in-flight custody and one truthful
   terminal notification.

## Integration corrections

- Reused the existing native metadata operation after the full run exposed
  wrappers that could not dispatch the proposed new read operation. Native
  reads still reconcile under the writer transaction; no cached admission
  bypass was restored.
- Preserved the restore fence's ordinary pending-argument hiding. The requested
  visibility exception applies to deferred custody only.
- Added per-ID transport claims made four store-retirement fixtures' assumed
  microtask ordering invalid. They now explicitly wait for the first POST
  before holding the second admission, with every retirement assertion retained.
  The React two-owner regression now requires one successful retry request and
  notification of both hooks from the shared receipt instead of requiring two
  simultaneous requests for that same ID.
- Additional native custody reads exposed two actual lifecycle races. Close
  drains local work and resolves remaining callers from known durable receipt
  or qualified correlation before returning pending. Explicit sync reserves
  its follow-up turn immediately, so a later held send cannot overtake it.
  Existing delayed/lost-response increment tests pass without altered assertions.
  The reserved sync round becomes current when it starts, keeping ten callers
  during the prior round coalesced into one follow-up. The matrix adds
  transient/persistent faults at both close-custody reads.
- The delivery fixture now imports its web device and client from the same
  instrumented package, preserving the internal capability symbols.
- Clock fixtures drain a complete microtask turn without advancing mocked
  time, instead of assuming 100 promise hops are enough for composition.
  Every deadline and frame-budget assertion remains unchanged.
- Condensed admission documentation to respect the merged guide's existing
  word budget; no ceiling or compiled example was removed.

## Model coverage

Every generated sequence retains one original round-1 schedule, adds one of
freeze/binding/FIFO/native-expiry/restore, and adds publication or a successful
late probe. Publication variants include native/wasm, before/after deadline,
reopen and the native publication/expiry overlap. Probe variants include held
or settled response and original/replacement store. The session model still
checks I1–I13 using production clients, native SQLite processes and wasm;
only transport/storage scheduling is controlled. No invariant, timeout,
sequence count or unrelated coverage assertion is relaxed.

The full-suite model stage passed **98/98** tests in **1,893 seconds**,
including **10,000 extended session sequences** (5,000 online + 5,000 local)
and the separate 3,000 online-client interleavings. Each tier records:

| Handoff schedule | Sequences per tier |
| --- | ---: |
| Native state-read overlap | 1,666 |
| Exact-input conflict | 1,667 |
| Peer execution before expiry | 1,667 |
| Freeze / binding / FIFO / native expiry / restore | 1,000 each |
| Publication / successful late probe | 2,500 each |

Counts and the complete I1–I13 coverage are in `full-model-coverage.json`.
The additional full-count session run passed **71/71**, including another
**10,000 extended sequences** with the same 5,000 seeds per tier, in
**1,852.527 seconds** (`session-model-final.log`, exit 0). Its complete
coverage is in `session-model-final-coverage.json`. These are two successful
full-count executions, not 20,000 distinct seeds.

## Verification and limits

The requested `bash scripts/test.sh` was invoked **once**, exit **1**.
Its exact summary is:

```text
== 2 failure(s) in 2924 s
   cargo test
   client tests
```

Both failed stages are **ours**. Cargo's sole failing target was the guide
word budget (98 passed, 1 failed); the client stage reported 4,813 tests,
4,556 pass, 246 fail, 1 cancelled and 10 existing skips. Every named failure
and its cause is listed in the ledger; none is assigned to baseline or
environment. The affected corrections passed subsequent checks below. Grok arrived during it,
so this is explicitly a development/full-inventory run, not a claim that every
stage tested one immutable final revision. Separate final affected checks
cover the fixes made after stages started. Every failure, including early
fixture/implementation mistakes, is retained in [the failure ledger](FAILURES.md).

Final scoped checks:

| Check | Result | Evidence |
| --- | --- | --- |
| Admission, all handoffs, publication/reopen, online custody, sync and clock | 149 passed | `affected-verified-final.log` |
| Delivery matrix, transient + persistent | 323 passed | `final-source-matrix.log` |
| Whole guide | 99 passed | `guide-complete-final.log` |
| Native device delivery + device integration | 30 + 436 passed; one existing ignored | `device-final.log` |
| Close lifecycle, including native delayed/lost-response correlation | 7 passed | `final-source-close.log` |
| Sync coalescing + clock deadlines | 29 passed | `sync-clock-complete-final.log` |
| React browser hooks | 50 passed | `react-final.log` |
| Nested failure families (overflow and round 9–12) | 48 passed | `nested-failures-recheck.log` |
| All full-run failing cases selected for recheck | 286 passed, 5 intermediate failures | `full-failures-recheck.log` |
| Those five corrected cases, within sync/clock suite | 29 passed | `sync-clock-complete-final.log` |
| Full-count session follow-up | 71 passed; 10,000 generated sequences | `session-model-final.log` |
| Session smoke after close/restore fixes | 71 passed; 100 generated sequences | `model-final-smoke-2.log` |
| Typecheck | passed | `typecheck-final-verified.log` |
| LLP refs | 523 docs / 9884 refs; zero errors or unchecked | `ref-check-final.log` |

The 291-case recheck includes the three process keep-model seeds and the
browser authority case that failed in the full run; they pass. Its only five
remaining failures were four clock fixtures' too-short microtask drain and
one introduced sync-burst coalescing error, both corrected above. It was an
affected-failure rerun, not a second invocation of scripts/test.sh.

Canonical wasm: **2,041,005 B raw / 592,929 B gzip**, **790 B below** the
unchanged **593,719 B** cap (`wasm-complete-final.log`). No size ceiling,
publication gate, test count or timeout was raised. No performance claim is
made from this shared host. The inherited 60-second complete-suite budget is
not met.

The full-count follow-up began after the close/restore fixes. Final sync-burst
coalescing, transparent native request-field forwarding and qualified close
receipt selection were checked in their affected suites while it ran; no
immutable-revision claim is made for that long run. The final source manifest
records the reviewable files, and the environment record binds the tested
native binary and wasm. Grok’s final review was checked again after the
follow-up completed and matches the adjacent review snapshot.
