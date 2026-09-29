# EA round 3 — wait for identity before ordinary admission

Implemented the supervisor's narrower design for calibration #26 d-01.
`mutate()` waits in memory for up to **15 seconds** to identify its store.
Its promise remains pending, including with `waitSeconds: 0`; pending-write
views say the call is not yet admitted. Once identified, calls enter ordinary
admission in call order within that client. Prediction, durable custody,
authorization, ordinary outbox delivery and server deduplication then apply.

No pre-identity call is acknowledged as queued or persisted. Reload loses that
unadmitted call. Close resolves a live waiting caller with `E_CLOSED`. Timeout
returns `E_ADMISSION_TIMEOUT`; adoption, restore or an incompatible incarnation
returns `E_ADMISSION_STORE`. Both identity refusals are public and actionable,
remain visible through `write(id)`/`onWrite`, and permit a new attempt after
repair. The mounted-form tests exercise a second click without remounting.

The governing decision and rationale replace the three previous EA amendments
in [LLP 3000.007 §20.4](../../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#204-a-queued-web-write-survives-navigation-s29).
The guide client/writes/refusal cards and client operations manual describe the
same boundary and honestly state the reload loss. This is not a new durable
write state or a cross-owner ordering promise before admission.

## Integration and scope

First command: `git fetch origin && git merge origin/main`, exit 0, **Already
up to date**. Starting HEAD was `04f8ef489e8519109e763906b9e08b8f5c38e8be`;
`origin/main` was `398552255dab53ad9aa2e347f47bded11d65aad0`. RL, AG, AQ and
the other merged lanes remain. No conflict needed resolution. Removal of
handoff-only additions used the current merged main versions, preserving
other lanes' fixes. No push or publication was performed.

Read all EA prompts and prior reports, Astra's complete round-2 NOT READY
review, and Grok's complete review when it arrived. Review snapshots are
[Astra](astra-r2.md) and [Grok](grok-r2.md); Grok's earlier progress snapshot
is also retained. [CONTEXT.md](CONTEXT.md) records the LLP orientation.

## What was removed

- Durable `identity-admissions` records, their persisted deadlines, freeze
  saves, outcome copies, promotion/expiry reconciliation and queue overlays.
- Native deferred binding, compare tokens, durable CAS/FIFO arbitration,
  native request interception, and deferred settlement interception:
  `native-admission.ts` and `device/identity_admission.rs` are deleted.
- Identity-publication wall timestamps and their restore/adoption plumbing.
- Deferred-intent capture/replay and orphan transfer in web and Worker
  adapters. Ordinary admitted orphan recovery remains.
- Online pre-identity journal custody, deadline recovery and per-ID dispatch
  claims. New online app writes identify before the ordinary journal append.
  Already admitted journal recovery retains its ordinary behavior.
- Handoff-only tests and their extended model schedules:
  `identity-custody-races`, `identity-handoffs`, `identity-publication` and
  their helper modules. Their old logs/reports remain historical evidence.
  The deleted native-wrapper clock parameterization has no remaining subject;
  ordinary native/web clock-floor and orphan-recovery tests remain.

The engine's unrelated deferred **sync publication** machinery remains. It
stages incoming pages and has no role in pre-identity mutation custody.

## What was kept

- Public `E_ADMISSION_STORE` and `E_ADMISSION_TIMEOUT` codes and repair cards,
  with the new 15-second, not-admitted semantics. Immediate storage/auth
  refusals retain their ordinary behavior.
- The authenticated `/schema` store identity and backend/generation checks.
  A final recheck precedes admission; the ordinary capture/admit boundary
  also fences a replacement in that gap, without storing a deferred record.
- Single-owner first-save coverage on process, wasm, Worker and online app,
  adapted to a pending promise and empty durable queues before identification.
  Calls retain argument snapshots and existing same-ID comparison rules.
- Two genuine ordinary lifecycle fixes from round 2: close drains local work
  and resolves callers from a known receipt or qualified correlation; explicit
  sync reserves its follow-up transport turn so a later held send cannot
  overtake it. Close/delayed-response/lost-response, increment-model and
  sync-coalescing tests cover them. Two stale native close assertions now
  require a replayed `sent` receipt with a positive sequence after a peer's
  durable correlation; separate-device wasm still requires pending. The delivery matrix keeps transient
  and persistent faults at both added close-custody reads.
- Ordinary prediction, outbox/recovery, web synchronous journal, native
  settlement, online receipt retention and server exact-input deduplication.
  Ordinary outbox adoption still wakes recovery; its navigation test passes.
- The delivery fixture's use of the same instrumented package for its web
  device and client; clock fixtures' complete microtask-turn drain, preserving
  all deadlines and frame-budget assertions.

## Review findings under the new decision

| Round-2 finding | Resolution in this round |
| --- | --- |
| Astra High: failed receipt save releases a pre-identity dispatch claim and a late originator clobbers known success | No pre-identity journal entry or dispatch claim exists. Ordinary online known-outcome retention is unchanged; its receipt-failure and retirement tests remain. |
| Astra High: two owners reorder durable pre-identity intent | Neither owner can durably accept before identity. Per-client waiting calls have FIFO admission; no ordering is promised between different clients' unadmitted calls. Ordinary journal behavior is retained. |
| Astra Medium: orphan transfer loses timely-publication proof | No deferred intent or timestamp is transferred. Reload/reopen cannot recover an unadmitted call. Both web hosts test this loss and a successful new call. |
| Astra Medium: reopened online custody bypasses expired deadline | There is no deadline or pre-identity intent to reopen. A live wait owns its original deadline and public refusal; process and online use real 15-second timeout tests. |
| Grok High: native history-before-outbox comparison suppresses real settlement | Deleted comparison and settle interception. A new direct native regression performs `keep_write` then `settle`, asserts both `sent_seq` and `receipt_store.success_seq`, then asserts retirement after replacement. |

These are implementation resolutions, not new independent reviewer verdicts.
The prior NOT READY reviews remain unchanged.

## Bound and measurements

The supplied calibration reproduced the refusal 3/3 with no settling delay and
0/3 after at least 1.5 seconds. Fifteen seconds gives ten times that observed
settling interval while bounding an interactive submission. Controlled fresh
fixtures below measured release of held startup through settlement. They are
single runs, not a latency distribution or an acquisition performance claim.

| Host | Startup release through first settlement/burst | Real missing-identity refusal |
| --- | ---: | ---: |
| wasm | 82.997 ms, first save | browser clock advanced past 15 s |
| Worker | 193.118 ms, first save | browser clock advanced past 15 s |
| process | 138.206 ms, three-save burst | 15,000.94 ms |
| online app | 24.735 ms, three-save burst | 15,011.73 ms |

Evidence: [identity-first-real.log](identity-first-real.log). A suspended JS
runtime handles its timer on its next turn and rejects late identity against
the original deadline. Timely identity stops the identification timer; the
ordinary admission behind an earlier call then has its ordinary lifetime.
A fake-clock test holds that earlier admission beyond 15 seconds and verifies
both calls still admit in order. Close still interrupts a waiting lane.

The online case covers `createApp`'s durable online wrapper, which has the
analogous first-store probe. The bare online client's existing in-memory
transport behavior remains unchanged.

## Verification

Product source was frozen before the one requested full-suite invocation.
[full-suite-inputs.json](full-suite-inputs.json) records its modified-source
hashes. All intermediate failures and corrections are listed individually in
[FAILURES.md](FAILURES.md), with original logs retained. No failing test is
silently counted as a later pass.

| Check | Result | Evidence |
| --- | --- | --- |
| Final admission, online intent store and web startup | 61/61, including all 26 new identity cases | [final-admission.log](final-admission.log) |
| Delivery matrix | 321/321 | [delivery-matrix.log](delivery-matrix.log) |
| Whole guide | 99/99 | [guide-pass.log](guide-pass.log) |
| Acquisition and ordinary receipt recovery corrections | 4/4 | [acquisition-corrected.log](acquisition-corrected.log) |
| Unidentified startup and ordinary orphan wake regressions | 2/2 | [navigation-fixed.log](navigation-fixed.log) |
| Full-suite storage/logout fixture corrections | 9/9 | [full-fixtures-corrected.log](full-fixtures-corrected.log) |
| Lifecycle fixture/close corrections, with delayed/lost replies | 9/9 | [lifecycle-corrected.log](lifecycle-corrected.log) |
| Complete browser admission/session review after instrumentation correction | 55/55 | [web-review-corrected.log](web-review-corrected.log) |
| Session model smoke | 52/52; 100 generated sequences per tier | [model-smoke.log](model-smoke.log) |
| Full-count models in the full suite | 79/79; 10,000 session sequences plus 3,000 online-client sequences | [full-suite.log](full-suite.log) |
| Package typecheck/build | pass | [build-final.log](build-final.log) |
| Final root LLP reference check | 523 LLPs, 9,882 refs, zero errors/unchecked | [ref-check-final.log](ref-check-final.log) |
| `scripts/test.sh`, exactly once | exit 1: client tests; all other stages pass | [full-suite.log](full-suite.log) |

Delivery coverage removes only the retired deferred-refusal await (two fault
cases); both ordinary close-read sites remain. Await/site manifests are
regenerated. The original session model and I1–I13 are restored unchanged from
merged main; all 5,000 online and 5,000 local sequences remain enabled. The
separate online-client model retains its 3,000 sequences. Wait-specific tests
are separate from those models.

Exact full-suite summary:

```text
== 1 failure(s) in 1386 s
   client tests
```

The client stage reports **4,797 tests: 4,764 pass, 20 fail, three cancelled,
ten existing skips**. All 23 unsuccessful results are **ours**: nine
storage/logout fixtures, two unidentified mock-device timeouts, two stale
native close expectations, and ten results from obsolete sync instrumentation
and its parent-timeout cascade. Every name, cause and correction is listed in
[FAILURES.md](FAILURES.md). The corrected scoped runs pass 9/9, 9/9 and 55/55.
No full-suite failure is assigned to baseline or environment. The full run
remains red evidence; it was not invoked again.

Rust passed in 546 seconds, including the whole guide again (99/99). All
5,000 online and 5,000 local session sequences passed I1–I13; the separate
3,000 online-client interleavings passed R1–R6. Models took 297 seconds and
reported 79/79. The inherited 60-second total-suite budget is still missed,
as in prior reports; no timeout, count or ceiling was raised.

The full run uses the original storage/logout/lifecycle/browser fixtures; each of those
files was corrected only after its full-run results had been emitted, then
rerun by name. [full-suite-original-fixtures.json](full-suite-original-fixtures.json)
records those original bytes. Product source did not change during this work.
Final source/artifact hashes are in [final-state.json](final-state.json).

## Wasm and delivery

Canonical wasm: **2,040,529 B raw; 592,974 B gzip**, **745 B below** the
unchanged 593,719 B cap. SHA-256:
`c5ef5e618918176ef74c65f1424ba40fd054aa4c73cd7983bd6ceff1f590c4d9`.
[wasm.log](wasm.log) records the canonical build. The small native boundary
guard is excluded from wasm; no cap was raised.

One append-only journal entry and a local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` accompany this report.
Nothing pushed or published.
