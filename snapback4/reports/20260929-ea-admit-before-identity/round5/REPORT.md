# EA round 5 — browser transaction pins and the identity deadline

The browser admission transaction now checks the first identified backend, and
a queued call's deadline counts time spent behind another call's identity I/O.
Round 3's memory-only wait remains: no durable pre-identity queue, prediction,
row IDs, or acknowledged custody. Nine added tests exercise the two browser
adapters and the distinction between identity work and ordinary admission.

## Integration and review

Read rounds 0–4's prompts/reports and Astra's full round-4 NOT READY review.
Grok's file contained progress notes at entry; that snapshot is preserved in
`grok-r4-initial.md`. Its completed **READY** review arrived during the full
client stage and is preserved in `grok-r4.md`. It reports one Low and one
surviving mutation; the additional controls and repair are described below.
These are dispositions of round-4 reviews, not new round-5 reviewer verdicts.
Used llp-orient; the scoped constraints are in [CONTEXT.md](CONTEXT.md).

Fetched `origin/main` at `b9a4051494eae2d437eb1b0534cdd4c3f5277013` and merged
before editing, in `c815da6450957542d6ad831529a5c900f2097dc4`. It added only
the Node runtime evaluation issue; no conflicts occurred and both histories
remain. Existing client work from other lanes is preserved. No delegation,
push, publication, or calibration-app modification.

## Repairs and detecting controls

1. **Astra High: backend fingerprint dropped after synchronous capture.**
   Both wasm and Worker adapters pass `expected_backend` into the shared
   journal admission plan. The plan compares it with
   `adoption_capture['device:backend-identity']` from `sync_state`, inside the
   serialized transaction, before allocating a submission or admitting.
   The existing store, generation, adoption-readiness and restore checks remain.

   Adapted both browser reproductions from Astra's temporary test copy. A real
   waiting mutation identifies A, then the device wrapper queues an adoption
   immediately before invoking ordinary admission. Capture still succeeds
   synchronously under A. The adoption changes the fingerprint while retaining
   store ID and generation. Each test proves that exact setup, then requires
   public E_ADMISSION_STORE, one matching onWrite/lookup result, no pending
   caller, an empty outbox, cleaned journal, and zero mutation POSTs.

2. **Astra Medium: FIFO waiting pauses behind identity I/O.**
   IdentityWait now distinguishes active ordinary admission from queued identity
   work. A ready caller pauses only during actual predecessor admission; identity
   intervals before, between, and after admissions share its remaining 15 seconds.
   Release is idempotent: an earlier call's eventual receipt/finally cannot end
   the next call's admission interval. Timer and admission listeners are removed
   when a call reaches ordinary admission or ends its wait.

   Astra's fake-clock schedule now refuses both A and B at exactly 15 seconds,
   with zero admissions; resolving the stalled read later admits nothing.
   A second three-call schedule spends two seconds on A's final identity read,
   pauses for 60 seconds of A's admission, spends three seconds on B's read,
   pauses for 60 seconds of B's admission, then gives C exactly ten seconds
   for its final read. A's receipt completes while B admits. Existing long
   ordinary-admission and remaining-budget controls still pass unchanged.

3. **Astra coverage gap: generation forwarding could be deleted.**
   A backend fingerprint includes generation, so merely adopting a changed
   generation would allow the backend guard to mask this omission. Separate
   real-browser adapter tests submit an otherwise valid admission with matching
   store/backend pins and only a mismatching generation. Capture succeeds;
   the serialized transaction must refuse without custody or a POST.
   This tests the adapter contract independently on wasm and Worker.

4. **Grok Low: native descriptor enrichment falsely changes identity.**
   A device-restored backend may omit the server-only native descriptor.
   The production nativeInstaller later fetches it and calls setBackend without
   changing the store, generation, schema, programs or pinned device digest.
   Including `native` in the JS comparison then wrongly refuses a waiting write.
   The small repair removes `native` from that comparison. Schema/program
   comparison, generation, store and pinned device digest checks remain.

   Three deterministic composition tests drive the real IdentityWait,
   localAdmissionIdentity and nativeInstaller, with device/network fixture I/O.
   They hold the final identity read, let the installer refresh the cached
   backend, then resume: descriptor-only enrichment must admit the original ID;
   a changed schema or program must refuse before admission. These test the
   installer callback boundary; they do not claim an additional real-device
   native-wasm installation witness. The descriptor case fails on production
   round-4 comparison (`grok-negative.log`) and all three pass with the isolated
   fix (`grok-fixed-isolated.log`). Removing the remaining JS comparison now
   fails both replacement controls (`grok-mutant-backend-key.log`), addressing
   Grok's surviving mutation too.

The merged round-4 control fails both backend reproductions and Astra's deadline
case (`negative-baseline.log`: 2 pass, 3 fail). Both FIFO controls fail with
only the round-4 generated identity-wait module restored
(`negative-deadline.log`: 0 pass, 2 fail). Removing generation forwarding from
both adapters fails both generation tests (`mutant-expected_generation.log`);
removing backend forwarding fails both backend tests
(`mutant-expected_backend.log`). All negative assertions fail on behavior;
production files and generated modules were restored before positive checks.
[FAILURES.md](FAILURES.md) identifies every unsuccessful control and development
command correction. No assertion, timeout, seed count, or budget was relaxed.

LLP 3000.007 §20.4 and the operations manual now state the transaction check
and the exact deadline exemption. The existing guide's ordinary-admission,
no-custody and reload-loss contract is preserved. The await inventory was
regenerated with `awaitBoundary()`; only the Worker await's argument hash
changed. All 160 delivery sites remain: 49 required and 111 optional, with
no missing or removed sites. The identity waits remain before custody and are
covered by explicit first/final-read, refusal, timeout, mixed-queue and
late-completion tests.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Focused repairs and existing deadline controls | 12/12 | `fixes-focused.log` |
| Broad affected admission, lifecycle, IDs, online journal, sync and web recovery | 202/202 (including all 45 identity tests) | `affected.log` |
| Final identity, online journal and write-ID checks after Grok repair | 83/83 (including all 48 identity tests) | `affected-final.log` |
| Delivery matrix | 321/321 before and after final Grok repair | `delivery-matrix.log`, `delivery-matrix-final.log` |
| Whole guide | 99/99 | `guide.log` |
| Package build and typecheck | pass before and after final Grok repair | `build.log`, `typecheck.log`, `build-final.log`, `typecheck-final.log` |
| LLP reference check | 523 LLPs / 9,916 refs, zero errors or unchecked | `ref-check.log`, `ref-check-final.log` |

`full-suite-inputs.json` binds the modified source/test/doc inputs to the merged
commit before the single full-suite invocation. `full-suite-completion.json` verifies those inputs
remained unchanged throughout that run. The final Grok delta is distinguished below.

## Full run and wasm

Ran `bash scripts/test.sh` **exactly once**, exit **0**. Its exact summary is:

```text
== 0 failure(s) in 1232 s
```

| Full-run scope | Result |
| --- | --- |
| Rust, including doctests | 4,331 passed, 0 failed, 33 declared ignores; 505 s |
| Whole guide within Rust | 99/99 |
| Clients | 5,152 passed, 0 failed, 0 cancelled, 10 declared skips; 411 s |
| Fixture wrappers | 9/9 |
| Client models | 79/79; 304 s |
| Build, wasm, docs budget, release guard, package build/typecheck, chat check and app typechecks | pass |

The model stage retains all **10,000 session sequences** (5,000 per tier,
I1–I13) and **3,000 online-client sequences** (R1–R6). The session coverage is
saved in `session-model-coverage.json`; the complete output is `full-suite.log`.
Full-run failures: **ours 0; baseline 0; environmental 0**. Expected refusal
messages from fault-injection fixtures are not failed tests. The existing
60-second suite budget remains exceeded; no budget or timeout was raised.

**Qualification scope:** Grok's completed review arrived during the client
stage. The full run kept its frozen inputs unchanged. After it completed,
the final patch removed `native` from the JS backend key, added its explanatory comment and
three detecting tests, and clarified the governing docs. Thus the single full
run includes every Astra round-5 repair but predates this final Grok Low fix.
The final 83/83 identity/online/ID run, 321/321 delivery matrix and package checks
above validate that final source; the full script was not rerun. This is not a claim
that the full inventory tested the final one-line comparator change.

Canonical full-script wasm build: **2,040,531 B raw / 592,979 B gzip**,
**740 B below** the unchanged **593,719 B** cap. Independent `gzip -9 -c`
agrees. SHA-256:
`76ffca354815401fdf2f29ed59d9a4a2b14d3abbbdf76cda9bc8c4f4efaefc95`.
See `wasm.json` and `full-suite.log`. This is the whole artifact; the round-5
production changes are TypeScript. Generated wasm is not committed.

One append-only journal entry and a local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` accompany this report.
Both reviews were checked again at completion and match their saved snapshots
(`review-final-check.json`). `final-state.json` records the final input hashes and
the four files changed after the full run (the comparator, tests and two docs).
Nothing pushed or published.
