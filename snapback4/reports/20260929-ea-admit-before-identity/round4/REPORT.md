# EA round 4 — bind and bound the wait through ordinary admission

Round 3's simplified design stands: identity waiting is memory-only, with no
new custody, outbox, row IDs or prediction until ordinary admission. This round
addresses all three Astra findings, the surviving final-recheck mutation, and
all four findings in Grok's completed round-3 review. These are implementation
dispositions, not new reviewer verdicts; both NOT READY reviews are preserved.

## Integration and constraints

First command: `git fetch origin && git merge origin/main`. Fetched main was
`6234118df866b67b47eb4724e61771d4ba511391`. Merge commit `57e90132f4` retains
both parents. Kept both append-only journal sides, resolved local.ts's three
comment-only conflicts with the current main descriptions, and regenerated the
conflicted await-boundary inventory with `awaitBoundary()` on merged sources.
PQ observations, AV assets and WK workers are preserved. All prior lane prompts
and reports were read; the scope/rationale is in [CONTEXT.md](CONTEXT.md).

The initial Grok file contained progress notes. Its completed review arrived
before the full run; the complete file is [grok-r3.md](grok-r3.md), alongside
[Astra](astra-r3.md) and the initial Grok snapshot. No sub-agents, pushes or
publications were used. The calibration app was not modified.

## Fixes and detecting tests

1. **Astra High — a call switches stores after identification.** Each call pins
   its first successful store ID and backend fingerprint, even when reopening
   offline from a never-identified cached backend. Subsequent checks compare
   against those immutable pins, and the admission request carries them rather
   than the client's mutable shared identity. The process tests hold the first
   admission after two calls observe A, then replace the store or same-generation
   backend. Both calls refuse E_ADMISSION_STORE with no custody or POST. The
   second is refused by the final check before it reaches ordinary admission.

2. **Astra Medium — final identity I/O hangs or rejects raw.** Initial and final
   identity reads share the 15-second budget. Only waiting behind an earlier
   ordinary admission pauses that budget. A stalled final read times out;
   a rejected read returns the public E_ADMISSION_STORE refusal through lookup
   and onWrite. No raw private device error escapes. Tests verify no admission,
   no late-completion admission, one terminal notification and no pending entry.
   Two fake-clock cases spend ten seconds before first identification, optionally
   wait sixty seconds behind an earlier admission, then require timeout exactly
   five seconds into the final read. The existing long ordinary-admission/FIFO
   test remains and passes.

3. **Astra Medium — asynchronous E_ADMISSION breaks same-ID retry.** MutationIds
   releases an unadmitted reservation when the fulfilled asynchronous result is
   E_ADMISSION, as it already did for the synchronous promise marker. Real wasm
   and Worker browsers submit before identity, reject the ordinary localStorage
   journal write, repair storage, and retry the original ID. Each sends once and
   obtains a sent receipt. Conflicting input still returns E_WRITE_ID_REUSE.

4. **Astra test-strength finding.** Removing just the final check now fails both
   store/backend replacement schedules at a behavioral assertion: a second
   ordinary admission occurred. The final admission guard still independently
   prevents retargeting, but the test requires the earlier final-check refusal.
   [mutant-delete-final-recheck-detecting.log](mutant-delete-final-recheck-detecting.log)
   records both failures, with the production check restored afterward.

5. **Grok High — published store ID bypasses adoption readiness.** Opening and
   all three sync publication/observation assignments now require a store ID
   AND no backend-required flag. Tests drive the actual legacy watermark-rewind
   transition, preserving store/generation/backend while requiring adoption,
   then hold the next sync POST or reopen offline. The caller remains pending
   without journal/outbox custody until adoption completes.

6. **Grok Medium — temporary final unreadiness is a false store change.** A
   boolean false resumes polling under the same remaining deadline; a real
   refusal still fails publicly. The test observes first-ready, final-not-ready,
   fourteen seconds of pending state, then a successful admission. Rejected
   reads are covered by Astra's process onWrite/lookup regression above.

7. **Grok Medium — native admission ignores backend-required.** The native
   waited-admission path checks that flag under the admission writer transaction,
   after the SDK's last read. This also closes a peer write between the earlier
   in-memory identity comparison and custody. The detecting process test injects
   a real same-store legacy rewind at that boundary and requires E_ADMISSION_STORE,
   an empty outbox and zero POSTs. The guard is excluded from wasm; the web
   admission plan already checks the flag. Ordinary raw-device admission and
   replay keep their existing path.

8. **Grok Low — stale public/internal wording.** The code card describes a
   pre-admission identity refusal, without deferred custody language. Empty
   browser capture now uses public E_ADMISSION_STORE instead of the calibration's
   internal sentence. A direct browser-capture test checks code and repair fields.

The eight corrected Astra controls all fail on the merged round-3 sources
([negative-merged-baseline.log](negative-merged-baseline.log)). The five corrected
Grok controls likewise all fail with its five relevant JS/native files restored
from that merge and the native binary rebuilt; the independent asynchronous
ID-release fix remains present
([grok-negative-detecting.log](grok-negative-detecting.log)). Both source and build
artifacts were restored after each control. Early fixture mistakes and weaker
controls are retained and distinguished in [FAILURES.md](FAILURES.md).

The per-call identity helper and ordinary entry construction live in existing
admission modules. Moving that unchanged construction and combining adjacent
state declarations brings merged local.ts from 1,514 to **1,500 lines**, without
removing PQ/AV behavior or raising the source cap. Minting remains after waiting;
ordinary prediction eligibility, authorization, exact input comparison, server
deduplication and admitted custody stay on the existing paths. No durable
pre-identity machinery was reintroduced.

LLP 3000.007 §20.4, the client/refusal cards, their defining-sentence test pins,
and the operations manual now agree about first-identity binding, adoption,
final-read budget, same-ID storage retry and loss of an unadmitted call on reload.
The manual's leftover instruction to retry before initial identity was removed.

## Validation

Source and test inputs are frozen in [full-suite-inputs.json](full-suite-inputs.json).
The one full run started after both reviews' repairs and the HTTP fixture repair.
All frozen inputs remained byte-identical through completion, as recorded in
[final-state.json](final-state.json). Both review files were checked again after
the run and match the complete reviews addressed here
([review-final-check.json](review-final-check.json)).

| Check | Result | Evidence |
| --- | --- | --- |
| Final complete identity suite | 39/39 | `identity-pinned-fetch.log` |
| Delivery matrix, final source | 321/321 | `delivery-matrix-final.log` |
| Whole guide | 99/99 | `guide-corrected.log` |
| Earlier broad affected admission/lifecycle/IDs/online/web review | 180/180, before complete Grok repair | `affected.log` |
| Final affected identity/IDs/online/lifecycle | 130 individual passes; one environmental test-file error | `affected-final.log` |
| TypeScript build and typecheck | pass; also required in full run | `build-qualified.log`, `typecheck.log` |
| Root LLP references, repeated after report and journal | 523 LLPs / 9,916 refs; no errors or unchecked refs | `ref-check-final.log` |

The environmental test-file error was an asynchronous Node 24.13.1 bundled HTTP
parser timer dereferencing a collected parser. It repeated in `identity-final.log`
with all 39 assertions passing. `node-parser-timer.json` records the actual
unguarded host code and the guard already present in the pinned dependency.
The fixture now uses the SDK's existing defaultFetch dispatcher. The corrected
complete identity suite passes 39/39, without changing a product assertion or
clock/deadline budget. All other exploratory failures are ours, as enumerated
in the ledger and `development-failures.json`.

Await audit: all **160** delivery sites retain their classifications (**49
required, 111 optional**), with zero missing or removed sites. The changed final
identity-check await is before custody/transport and has explicit held-read,
rejection, replacement, timeout and late-completion coverage. The instrument
file records that boundary; existing delivery recipes and assertions remain.
The I1–I13 session model and its 5,000 seeds per tier are unchanged, as is the
separate 3,000-sequence online-client model. No timeout, seed count or ceiling
was increased.

## Full run and wasm

Ran `scripts/test.sh` **exactly once**, exit **0**. Its exact summary line is:

```text
== 0 failure(s) in 1297 s
```

The complete output is [full-suite.log](full-suite.log). Every stage passed:

| Full-run scope | Result |
| --- | --- |
| Rust, including doctests | 4,331 passed, 0 failed, 33 declared ignores; 555 s |
| Whole guide within Rust | 99/99 |
| Clients | 5,146 passed, 0 failed, 0 cancelled, 10 existing skips; 410 s |
| Fixture wrappers | 9/9 |
| Final client models | 79/79; 297 s |
| Build, wasm, docs budget, release guard, package build/typecheck, chatcheck and app typechecks | pass |

The final models include all **10,000 session sequences** (5,000 online and
5,000 local, I1–I13) and **3,000 online-client sequences** (R1–R6); see
`session-model-coverage.json` and `model-summary.json`. Full-run failures by
attribution: **ours 0; baseline 0; environmental 0**. The earlier exploratory
failures, including the repaired HTTP fixture's environmental exception, remain
in [FAILURES.md](FAILURES.md). The inherited 60-second process budget remains
missed; no timeout, model count or budget was relaxed to obtain this result.

Canonical wasm is **2,040,531 B raw / 592,979 B gzip**, **740 B below** the
unchanged **593,719 B** cap. SHA-256:
`76ffca354815401fdf2f29ed59d9a4a2b14d3abbbdf76cda9bc8c4f4efaefc95`.
The full script's build and a separate `gzip -9 -c` measurement agree; see
`wasm.json`. This is a whole-artifact measurement, with no per-component size
claim. Generated wasm is not committed.

One append-only round-4 journal entry accompanies this report. The local repair
commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing was pushed or published.
