# EA round 0 — custody before backend store identification

Date: 2026-09-29. Branch: `sb4-intent/ea-admit-before-identity`.
Original base: `7f540f09467fcbdd73d4faa05db14fce696e9e85`.
Merged `origin/main` at `b7d05baff` before final runs (merge `4279b5b12`).
Implementation checkpoint: `876fc9349`; final corrections and evidence follow it.
Nothing was pushed or published. The calibration app was read as evidence, not edited.

## Result and reproduction

A ready replica now accepts durable custody before identifying its backend store.
Both immediate clicks on the same mounted form return pending, appear in
`usePendingWrites`, and settle through `onWrite` under their original IDs after
identification. No form acquisition gate or app retry is required.

`reproduction-valid.log` runs the original client sources against the controlled
fixture: two saves before identification both return `E_ADMISSION` with the
internal store-not-identified message, on wasm and Worker. Starting identification
then permits a third save on the same mounted form, without navigation.
The controlled form deliberately holds identification, rather than relying on a
1.5-second scheduling accident. The current implementation uses the same fixture.

The calibration narrative says remounting was required, but GRADER-TRACE.md's
six-trial table records successful same-form retries for all three immediate
failures. Profile.tsx sets `busy` false after the refused call; the SDK's old
synchronous journal guard rejects each new click while `storeId` is absent.
The rejected intent has no custody and cannot recover automatically when identity
arrives; the form retains the error until its next successful action. A permanent
post-identification latch was not reproduced and is not claimed. The fix removes
the two refused clicks and lets both complete without another interaction.

## Decision and implementation

Context pack: LLP 3000 is the Snapback 4 fence; LLP 3000.007 §20.4 governs browser
custody and §18.2 recovery; LLP 3000.013 §6 and §13.3 bind dispatch to a backend
incarnation; LLP 3000.019 §3.3 defines the pending outbox view. LLP 3000.001 supplies
the durable replica/write lifecycle. Read the client/write cards and E_ADMISSION
explanation before implementation; used the repository's llp-orient workflow.
The decision is recorded in LLP 3000.007 §20.4's dated EA amendment.

- The synchronous browser journal captures the original ID, input, minted row
  IDs, order, backend fingerprint, known store and deadline. Strict IndexedDB
  custody transfers that intent into bounded deferred metadata. Both page-wasm
  and Worker hosts use the same admission plan.
- Native hosts use the same plan with a native-only SQLite compare transaction.
  Concurrent owners cannot overwrite one another's metadata or reuse an ID with
  different input. That verb is excluded from the wasm compilation.
- `/schema` supplies the known store identity, fencing a replacement between
  schema fetch and first sync. Matching identity enables the existing admission
  interpreter, eligible prediction and ordinary FIFO sender. A recovery after
  interrupted native admission finds the original outbox entry.
- Custody survives own reload, same-turn navigation and closed-tab adoption.
  Earlier entries retain priority. Existing server deduplication and E_ID_REUSED
  semantics remain unchanged; transport retries may repeat a request under its
  original ID, as before. Normal-path tests assert exactly one POST per intent.
- The wall-clock identification bound is 30 seconds from capture, persisted
  across reload. Live timers wake settlement; closed/suspended runtimes check
  when resumed. No identified or possibly dispatched write expires under this
  rule. `E_ADMISSION_TIMEOUT` and `E_ADMISSION_STORE` are public actionable
  unsent refusals. A new attempt after repair needs a new ID.
- The online app journal now takes custody before the first probe and preserves
  submission order and the deadline. Its caller wait budget includes discovery.
  The bare online client's existing memory-custody behavior remains unchanged.
- Pending presentation includes “waiting for backend identification”; terminal
  refusal recovery preserves the safe public explanation. `onWrite` retains its
  existing terminal-only contract.

Scope stayed in admission/custody, plus the minimal local sender/pending-view
integration and the schema identity field. Observation queues, read-answer
retention and web acquisition scheduling were not changed.

The client card, write card, dedicated `why E_ADMISSION` card, diagnostic routing,
manual and MutateOptions comment now explain custody without an acquisition gate.
The paved starter already gates Send only on its call being in flight; its
acquisition indicator is informational. No starter gate needed removal.

## Validation

All commands below ran inside `snapback4` after merging main, except ref-check
which ran from the repository root. No configured test timeout or budget was raised; the hung full-run matrix process
was explicitly terminated as recorded below.

- Baseline reproduction: 2/2 passing assertions of the original double refusal
  and same-mounted-form recovery (`reproduction-valid.log`).
- New regression coverage: page-wasm, Worker, process and online custody;
  immediate mounted saves, several queued writes, same-ID overlap/conflict,
  eligible prediction with preserved minted IDs, reload and same-turn navigation,
  closed-tab transfer, timeout and adoption/incarnation mismatch, terminal
  visibility, native concurrent owners and persisted expiry on reopen.
  The dedicated identity suite contains 20 tests, including a process adoption
  interleaving immediately before native admission.
- Existing admission/recovery suite: 55/55 pass (`admission-review-final.log`).
  Its two isolated server-binding cases also passed (`orphan-binding-focus.log`).
- New custody plus existing online receipt tests: 21/21 pass
  (`identity-and-online-final-2.log`).
- Whole guide: `cargo test -p snapback4-lang --test guide`:
  `test result: ok. 98 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.52s`
  (`guide-final-3.log`).
- CLI diagnostic excerpt and why routing: 1/1 each (`doctor-final-3.log`,
  `why-cli-final-2.log`).
- TypeScript build and full package typecheck pass (`client-final-build-13.log`,
  `typecheck-final.log`). Docs budget and final await-boundary checks also pass
  (`docs-budget-final.log`, `await-boundary-final.log`).
- `./ref-check --verbose`: `ref-check: ok — 523 LLP docs, 9857 refs in 28997 files, 0 errors, 0 unchecked` (`ref-check-final.log`).
- Combined affected run: 112 passes, 8 failures and 1 cancellation. The failures
  belong to web-admission-review: two response timeouts under concurrent load,
  then the parent timeout and six closed-browser descendants. All 55 tests pass
  on the unchanged web implementation when rerun separately. Every unsuccessful
  exploratory run is itemized in [FAILURES.md](./FAILURES.md).

## Whole suite and wasm

Ran `bash scripts/test.sh` exactly once; raw output is `full-suite.log` and exit
status is saved in `full-suite.exit`. The run began before the guide corrections,
so it includes their original failures. Affected guide and CLI tests were rerun
on corrected content; the full suite is not presented as a final green snapshot.

Exact final summary (exit 1):

```text
== 3 failure(s) in 1967 s
   cargo test
   client tests
   client models
```

- **Cargo tests — ours:** six assertions in three targets: four guide assertions
  (definition pins, card word budget, moved-fact pin, dedicated why section),
  CLI why routing, and doctor excerpt routing. Corrected; whole guide 98/98,
  CLI why 1/1 and doctor 1/1 pass.
- **Client tests — ours:** `4298 tests; 4203 pass; 80 fail; 5 cancelled;
  10 skipped`. Includes obsolete pre-identity expectations and bugs introduced
  by my initial native serialization/callback handling and online discovery.
  Raw-device wasm calls were incorrectly treated as SDK deferred admission;
  the SDK now explicitly opts into that handoff. The native wrapper now preserves
  commit callbacks, does not serialize apply/observation/adoption behind custody,
  and bypasses handoff bookkeeping on ordinary same-store calls after it drains.
  Online dispatch no longer rereads its journal behind a held later admission.
  All named failures and their disposition are in [FAILURES.md](./FAILURES.md).
- The client stage stalled in delivery-fault-matrix for over 15 minutes. I sent
  SIGTERM to that test process only so the script could finish its remaining
  stages. This intervention and incomplete matrix traversal belong to this lane,
  not a baseline or environmental excuse. The corrected complete matrix passes
  **319/319**, including both fault modes at the new pre-transport refusal await.
- **Client models — ours:** `79 tests; 78 pass; 1 fail`. Online session model
  seed 1807 assumed a live unbounded-wait caller could never return pending when
  another runtime had executed the same ID. Pre-identity custody now legitimately
  returns pending after an offline probe. The revised oracle permits that only
  with the explicit identity-wait reason, durable same-ID custody/receipt, and
  no outcome delivered to this runtime. Known outcome equality remains strict.
  Added the minimized sequence; the corrected session model passes **53/53**,
  including 5,000 online and 5,000 local sequences (`session-model-final.log`).
  The original full run's separate 3,000-sequence online client model passed.

No full-run failure is classified as baseline. A merged-main control for the
clock regressions passed 19/19 (`clock-baseline.log`); corrected lane code also
passes 19/19 (`clock-final-2.log`). The only environmental exploratory failures
were missing generated wasm prerequisites and concurrent browser response timeouts;
those are separately named in the failure ledger. The full script was not rerun,
so its red result remains the recorded full-suite result.

Corrected affected results:

| Scope | Result | Evidence |
| --- | --- | --- |
| Delivery await matrix | 319/319 | `matrix-final.log` |
| Session model, both tiers and regressions | 53/53 | `session-model-final.log` |
| Native answer/retention authority and composed returns | 64/64 | `authority-final.log` |
| Native retained answers and transport | 43/43 | `keep-transport-final.log` |
| Raw wasm residency/events, clocks, navigation, startup | 151/154, then clock failures fixed (19/19) | `broad-corrected.log`, `clock-final-2.log` |
| Admission, acquisition, online custody/retirement/replacement, lifecycle | 170/171, then old-protocol diagnosis fixed | `final-admission-regressions.log` |
| Browser recovery/admission | 55/55 | `admission-review-final.log` |
| Native adoption between validation and admission | 1/1 | `native-adoption-race.log` |
| Final identity/lifecycle/clock run | 96/96 | `lifecycle-identity-final-2.log` |

The failed clock and old-protocol checks were real lane regressions, not tests
relaxed to accept changed timing. Their original assertions remain unchanged.
Existing acquisition tests now inspect public deferred custody instead of assuming
an ordinary engine outbox row already exists; receipt-injection tests explicitly
identify the store first. Raw device prediction/dedup tests retain their original
semantics. The online replacement test now verifies an unsent incompatible intent
fails and a deliberate new ID succeeds; known-store admission storage failures
still refuse before any dispatch.

Await-boundary review: new shared identity plans yield through the existing host
commit boundary; their queue read is covered by the identity and recovery tests.
Native host calls/CAS are covered by process reload, concurrent-owner and adoption
interleaving tests. Online discovery/wait/dispatch is covered by held-probe reload,
persisted expiry, and session/client models. Worker/page admission and orphan
handoffs are covered on both real browser hosts. The new local refusal settlement
await is a required delivery site with an explicit fault recipe; all prior site
IDs retain their semantic recipes after the inserted ordinal. No classification
or required fault assertion was removed.

Canonical `bash scripts/build-wasm.sh` reports:
`wasm 2040529 B raw, 592974 B gzip (budget 593719: ok)`.
745 B remain under the unchanged cap. See `wasm-final-2.log`; the full suite's own
wasm build reports the same size. No generated wasm asset is committed.

## Limits

The 30-second bound requires a running host to emit at that instant; a closed
browser cannot execute a callback and instead adjudicates persisted intent on
reopen. Durable custody depends on the existing persistence contract: clearing
browser storage can still erase writes. Genuine storage, session/authority,
operation, input and admission refusals retain their prior paths. This work
makes no blanket no-retry network claim and no claim of a permanent original
form latch beyond the evidence above.
