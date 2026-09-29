# PQ round 4 — remembered dependencies and queued retention

Implemented the two requested changes, detecting tests for each, and Grok's
sweep/sign-out findings. The final publication-callback reset guard now has
six tests that fail when only that comparison is removed. No push or publication.

Branch `sb4-intent/pq2-per-row-hooks`, starting commit `b8cd041ee`. Main was
initially current at `4fd338de5`; subsequent main advances were merged:
BP (`f9620c815`, merge `cadf4485d`), MT (`29db70739`, merge `a2e94d366`), and
the calibration report (`17f06ef0c`, merge `9d7ebcd64`), and scheduled
backstop tickets (`7f540f094`, merge `b5803c3d7`). The only conflict was
the append-only journal in the BP merge; both entries remain. RL had not landed
at the final main check. MT's current suite scheduling instructions were read.
The last two merges change only benchmark/ticket records, with no changed
runtime or test inputs. [CONTEXT.md](CONTEXT.md) records the LLP orientation.

## Changes

Known local commit footprints now reach remembered-answer invalidation. An
entry with recorded dependencies disjoint from the footprint survives, along
with its ordering metadata. A known empty footprint preserves memory. Unknown
dependencies remain conservative for nonempty footprints; unknown footprints
and scope resets clear all memory. Unrelated watches do no replacement work.

Queueing immediately applies the observation policy and notifies. A retaining
watch marks its answer `revalidating`; a new bounded episode starts when its
attempt starts. An already-started absolute deadline never renews on later
queueing, invalidation or retry. Starting the hidden timestamp preserves the
snapshot object and shares that timestamp with facade holds. Pure local reads
start it before entering device work; HTTP fallback joins the same episode.
`keep:false`, row expiry and scope resets keep their immediate withdrawals.

Clock sweeps now enqueue acquisition without applying invalidation again. A
held-only expiry or local wakeup preserves a newer raw answer whose own
deadline is still in the future. Its server fetch also skips revalidation;
explicit expiry-retry withdrawal still wins. Dirty work requeues acquisition,
since any actual invalidation has already applied its policy. Local sign-out
preserves the denial and queues no further evaluation.

LLP 3000.023 and the client card record these rules. Six production TypeScript
files change. No public contract, Rust code, episode duration, queue bound,
active-attempt lifetime, meter or byte cap changes. No LV subsystem is restored.
`local.ts` remains 1,500 lines. Await fingerprints change at two existing calls;
no new await or delivery classification (158 sites; 317 matrix checks).

## Reviews and detecting evidence

Read both full reviews; copies are [astra-round3.md](astra-round3.md) and
[grok-round3.md](grok-round3.md). Grok was still progress-only at startup, then
completed NOT READY. It was rechecked before completion and is unchanged.
These reviews address round 3, not approval of this revision.

- Astra's unrelated-write case runs on real wasm/process devices: observe
  `exists remoteRows['r']` with `keep:true`, apply an unrelated replicated
  notes write, confirm no replacement query, then go offline. The completed
  observation and a direct read remain true. Omitting the footprint fails both.
- Queued policy tests cover all policies, facade timestamp inheritance,
  repeated queueing/retry non-renewal, row expiry and resets. Held local
  wasm/process attempts withdraw at their active deadline and accept later
  success. Removing attempt-start timing fails both substrate cases.
- Six tests reset between the early reset comparison and the final synchronous
  publication callback, then hold the replacement. Removing only the callback
  comparison fails every case while the early guard remains intact.
- Grok's queued floor tests now require value 8, including after a full second
  of host time, rather than merely rejecting value 7. The online held-only
  sweep is covered under all policies. Reverting either sweep fix fails.
- Six local sign-out tests inspect the raw owner during notifications. This
  avoids `getSnapshot()` repairing an intermediate loading state and masking
  the bug. Removing the guard fails all six.

Nine isolated removal variants produce **39 expected failing cases**. See
[controls.py](controls.py), [controls-final.log](controls-final.log), and the
final heartbeat-equipped browser control [react-control-qualified.log](react-control-qualified.log).
Qualified source and built artifacts are never mutated by these controls.

Grok's remaining non-blocking lows are explicitly left:

- An unconditional success identity check would also reject a valid late
  success after episode withdrawal, which must still publish. This round
  keeps the existing sequence/authority/reset checks and the narrower due-body
  identity guard; it does not introduce a new success-ordering policy.
- The early reset comparison remains redundant with the final check for the
  old test's interleaving. The requested final callback boundary is now
  independently detecting; no code removal is needed.
- A floor-discarded completion preserves its existing retry-backoff count.
  Backoff is capped at one second and resets on an accepted non-expiry result;
  that scheduling detail is unchanged.
- `ReadWork.clear()` is used for permanent client close. Its pending microtask
  and per-turn start counter settle on the next turn. Resetting the counter
  during reuse could break the eight-start bound; no reuse behavior is added.

## Real-clock 1,000-hook proof

Each local tier mounts 1,000 actual React hooks over point reads, performs a
real relevant server write and syncs the device. Each replacement device query
has 15 ms controlled service time, forcing later observations to wait beyond
the one-second episode bound. Neither clock nor episode length is mocked.
The original online 1,000-hook test also no longer freezes `Date.now`.

The controlled `/changes` response sends real whitespace heartbeats while
withholding change evidence, so explicit sync owns the replacement. Earlier
fixture versions omitted heartbeat bytes and correctly triggered the real
four-second offline watchdog; tracing found that cause and the ledger retains
all resulting failures. The final test also asserts the link remains online.

Wasm and Worker use their browser devices and IndexedDB. The process case runs
React and the SDK in Chromium with Playwright bindings to the unmodified Node
`processDevice` adapter and its SQLite process. This proves retention/counts;
it is not a latency benchmark or an Expo qualification.

Final values from [affected-qualified.log](affected-qualified.log):

| Tier | Loading renders | Query calls | Revalidating rows | Span of replacement starts |
|---|---:|---:|---:|---:|
| wasm | 0 | 2,000 | 1,000 | 2,030 ms |
| Worker | 0 | 2,000 | 1,000 | 2,114 ms |
| process | 0 | 2,000 | 1,000 | 2,257 ms |

All links remain online. The mutated queue-start implementation produces
loading on all three tiers at the explicit zero-loading assertion.

## Verification

Final affected run: **684/684**, zero skips or cancellations, in
`affected-qualified.log`. It covers all per-row tests, membership-change
withdrawal, scope reset, server clocks, presence, ephemeral reads and the
delivery matrix. Command (from `snapback4/`):

```sh
node --test --test-concurrency=2 packages/snapback4/test/per-row*.test.mjs packages/snapback4/test/keep-reset.test.mjs packages/snapback4/test/answer-withdrawal.test.mjs packages/snapback4/test/server-clock*.test.mjs packages/snapback4/test/presence*.test.mjs packages/snapback4/test/ephemeral*.test.mjs packages/snapback4/test/delivery-fault-matrix.test.mjs
```

Other checks:

- Grok/new regressions, floor boundaries and delivery matrix: **379/379** in
  `grok-qualified.log` (44 new regressions, 18 boundaries, 317 matrix checks).
- All **18 full-count keep-app property sequences** pass in
  `full-failures-followup.log`; its separate fixture failures are retained.
- The unchanged two authority React cases pass in `notification-followup.log`.
- SDK build/typecheck and docs budget pass (`build-grok-fixed.log`,
  `typecheck-final.log`, `docs-budget-final.log`).
- Whole guide: **98/98**, `cargo test -p snapback4-lang --test guide`,
  `guide-qualified.log`. Reference audit: **523 LLPs, 9,863 refs, zero errors
  or unchecked**, `ref-check-final.log`. Whitespace checks pass.

`scripts/test.sh` ran **exactly once**, exiting 1 with the exact summary:

```text
== 1 failure(s) in 1138 s
   client tests
```

Its main client phase: **4,649 tests / 4,622 pass / 17 fail / 10 skipped**;
separate helper shards passed; complete model phase **79/79**. All other suite
phases passed. The invocation began before MT's scheduler merge and before
all round-4 corrections. It remains a red full-run record; final affected
qualification does not relabel it green. [FAILURES.md](FAILURES.md) enumerates
every failure, all classified **ours**, with corrections and follow-up results.
No baseline or environmental exemption is claimed. Counts, timeouts and size
caps were not relaxed. The deadline and wakeup assertions were updated for
the explicitly requested timing and preservation behavior.

## Wasm and completion

Canonical build from that full run:

```text
wasm 2040529 B raw, 592975 B gzip (budget 593719: ok)
```

**592,975 B gzip**, **744 B** below the unchanged **593,719 B** cap, equal to
round 3 on this toolchain. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No Rust input changed in this round or subsequent main merges.
Existing Node 24.13.1 / Bun 1.3.14 and local tools were used; none installed.

The report, tests, guide/LLP update and one appended journal entry are committed
locally with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
No push or publication is performed.
