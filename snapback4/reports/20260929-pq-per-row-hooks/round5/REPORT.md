# PQ round 5 — resubscription and in-flight read boundaries

Implemented Astra's resubscription fix and isolated cancellation coverage, plus
Grok's in-flight change/episode findings and selective-memory ordering repair.
The report preserves the one full run's red result separately from final
affected qualification. No push or publication.

Branch `sb4-intent/pq2-per-row-hooks`, starting at `6369b9012`. Initial fetch/merge
was current at `7f540f094`; before final runs, DX through `b7d05baff` merged as
`58e22c75b`. Both append-only journal conflict sides were preserved. RL had not
landed at the last merge. [CONTEXT.md](CONTEXT.md) records LLP orientation.

## Changes and detecting evidence

Read every prior lane prompt/report and both complete round-4 reviews:
[Astra](astra-round4.md), [Grok](grok-round4.md). Grok was progress-only at
startup and completed during the full suite. Neither review is represented
as approval of this revision.

- **Raw local resubscription:** the start callback now uses `scheduleRead`.
  It applies the policy before queueing: default retention marks the answer
  `revalidating`, while `keep:false` withdraws. A new episode starts at attempt
  execution; an existing deadline resumes without renewal. Expiry sweeps retain
  `acquireRead`. The old unit test's manual `owner.reload()` is gone. Real
  wasm/process clients close an owned-row handle, transfer ownership, sync and
  verify a direct null before resubscribing with the replacement device reply
  held. The real timer withdraws and notifies; releasing the reply obtains null.
  Two more cases start an episode through a real edit before closing and require
  the same deadline after resubscription. No frozen clock in these four cases.
- **Final cancellation:** six cases span wasm/process and all retention policies.
  The existing retry-counter setter cancels the actual attempt after
  `checkRead(signal)` and the early guards, before the publication callback.
  Registration, reset version and authority remain unchanged. No `publish`,
  subscriber notification or recorded answer/table/deadline/incarnation/server/
  presence/reset field update occurs. Only `signal.aborted ||` is deleted in
  the detecting control: all six fail. The production cancellation guard itself
  remains unchanged.
- **Grok A, a body held across `/changes`:** relevant newer change evidence
  advances the affected local watch's change version. Evaluation checkpoints
  reject the old body before it can enter remembered answers; the outer
  continuation and final callback also check that version. Ordinary local
  commits retain their authority revision. Six real wasm/process cases hold
  the pre-change server reply, transfer ownership, process the change while
  sync is held, then release the old reply with the replacement held. The old
  completed body never returns. Six additional late-boundary cases independently
  detect removal of only the final callback's version comparison.
- **Grok B, an acquisition already running at invalidation:** invalidation marks
  retention as queued even if a prior attempt runs. Observed local authority
  retries return to the queue; direct-query retry behavior stays intact.
  The replacement starts any new episode. Online keeps its existing sequence
  retry and starts the deferred episode at that retry after backoff. Established
  unrelated blockers fill capacity in wasm/process/online tests; advancing host
  time beyond one second of queue wait preserves the marked answer with no new
  deadline, then service arms the episode. Existing deadlines never renew.
- **Grok C, selective memory clearing:** removed entries retain a ticket barrier.
  Three controls cover replies with no cut, the same cut, and a later cut,
  preserving disjoint memory and accepting reads begun after the clear.

An intermediate implementation cancelled every scheduled refresh. Broader tests
rejected it: slow cadence reads could keep restarting, and early online schema
work could progress before installation. The final version advances only on
actual relevant change evidence; cadence refreshes keep their running attempt.
Every failed intermediate case is listed in [FAILURES.md](FAILURES.md).

Updated LLP 3000.023 §7. No public contract, Rust runtime, retention duration,
queue bound, attempt lifetime, meter, cap or LV subsystem changes. `local.ts`
remains 1,500 lines. No new await or delivery classification is introduced.

## Verification

- Initial requested regression files: **68/68**, `regressions-qualified.log`.
- Initial broad run before Grok fixes: **708/708**, `affected.log`.
- Final in-flight/version cases: **15/15**, `inflight-final.log`.
- Full-failure file follow-up: **205/205**, `full-failures-followup.log`, covering
  complete expiry-retry, retention-lifecycle and React files.
- Whole guide: **98/98**, `cargo test -p snapback4-lang --test guide`, `guide.log`.
- SDK build/typecheck pass. Reference audit: **523 LLPs, 9,866 refs, zero errors
  and zero unchecked**, `ref-check-qualified.log`.
- Nine isolated removal variants: **29 intended detecting failures** in
  `controls-complete.log` and `final-change-control.log`. The script copies the
  SDK inside this worktree; qualification artifacts are never mutated.
- Final broad run: **954/954**, zero failures, skips or cancellations,
  `affected-qualified.log`. This includes all per-row files, raw deadlines,
  remembered answers, lifecycle/expiry, scope resets, membership-change
  withdrawal, server clocks, presence, ephemeral reads and the delivery matrix.
  Its real-clock 1,000-hook cases again report zero loading renders and 2,000
  evaluations on wasm, Worker and process. This is retention/count evidence,
  not a new latency benchmark.

The **one** `bash scripts/test.sh` invocation exited **1**, exactly:

```text
== 1 failure(s) in 1249 s
   client tests
```

Main client phase: **4,723 tests, 4,709 pass, four fail, ten declared skips**.
Final models: **79/79**. Every other phase passed. The full run began before
Grok's review completed and loaded intermediate sources; final affected results
qualify the subsequent changes. It is not relabelled a final-source green run.

| Every full-run failure | Attribution |
|---|---|
| `expiry retry remembered branch timer watch wasm` | Ours: old revalidation/notification expectation for an acquisition-only wakeup |
| `expiry retry remembered branch timer watch process` | Ours: same obsolete expectation |
| `wasm: resubscription delivers saved row expiry without an accessor, keep=false` | Ours: old saved-data expectation contradicts the requested resubscription policy |
| `useQuery and usePage keep canonical arguments across renders, preserving loaded pages` | Environmental: Vite startup failed with `Port 39387 is already in use`, before browser assertions |

All four pass in the 205-test follow-up. No full-run failure is classified
baseline. The ledger also names every development/diagnostic failure, its cause,
and its correction. No timeout, model count or size budget was relaxed. Expiry
and resubscription expectations were updated to the explicitly requested
behavior; the cursor fixture now parks change delivery from startup so its
exact request-count assertions measure only the intended expiry schedule.

No new performance or comparative claim. Existing Node 24.13.1 and Bun 1.3.14
were used; no tool installation.

## Wasm

Canonical rebuild in this round's full suite:

```text
wasm 2040529 B raw, 592975 B gzip (budget 593719: ok)
```

**592,975 B gzip**, **744 B** below the unchanged **593,719 B** cap;
zero growth from round 4. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.


Final main check: `origin/main` remains `b7d05baff`; already up to date.
Both complete review copies were rechecked at completion. One appended journal
entry and the local commit carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing is pushed or published.
