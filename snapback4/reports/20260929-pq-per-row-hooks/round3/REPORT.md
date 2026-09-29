# PQ round 3 — queue transitions and late publication floors

Branch: `sb4-intent/pq2-per-row-hooks`. Started at `b2e88c201`; the required
fetch/merge brought in `origin/main` at `4fd338de5` through `efd29e4a7`.
The journal was the only conflict; both entries were preserved. RL had not
landed at the latest fetch. No push, publication or tool installation.

## Review disposition

Read Astra's full round-2 review ([copy](astra-round2.md)); all three findings
are addressed. Grok was checked at startup and during qualification; it completed during the full suite's Rust phase. Its [completed review](grok-round2.md)
adds three Low findings, addressed below.
Neither review is represented as approval of this revision.

| Finding | Repair and detecting evidence |
|---|---|
| High: queued `keep: false` keeps an invalidated row visible | Every local invalidation calls `reload()` and notifies before enqueueing. A separate acquisition path preserves saved-answer resubscription. Six wasm/process cases fill all eight slots and transfer an online-only row to another owner: `keep: false` withdraws and notifies immediately; default/true retain with `revalidating`. Releasing capacity obtains the current null answer. Removing the withdrawing transition fails both `keep: false` cases. |
| Medium: evaluation captures a floor too early | Both queued and presence completions synchronously consult the current matching-observation floor after evaluation returns, before updating the watch. Rejected results are discarded. Twelve cases span wasm/process, all three policies, and both publication paths. Removing either final check fails its six cases. |
| Low: abort guards have no detecting test | Three tests preserve an earlier ECONNREFUSED diagnostic after a cancelled observation's adapter rejects with ABORT_ERR. A later public action reports the original failure. Removing the online guard fails one case; removing the local guard fails wasm and process. The production guards already existed. |

The floor tests intercept the remembered-answer write, which follows the
existing evaluation-time floor check. They register a held answer at D, give
the raw newer answer a later deadline, and use the real clock/sweep to record
D and then roll server time back from the held-withdrawal callback. No counted
microtask delay or direct floor assignment is used. The presence case expires
a matching policy peer so the target's snapshot fence cannot mask the floor
check; rejection preserves its exact newer snapshot. Scope reset counters
remain unchanged. This tests final publication, beyond round 2's earlier gap.

The cancellation adapter consumes the abort event and reports it by rejection.
This deliberately reaches `sendPost.catch`; normal local cancellation can
instead settle through `postForCaller`'s independent abort waiter and would not
test that guard. No production waiter or cancellation behavior is changed.

## Grok follow-up

Grok's round-2 verdict was READY with three Lows; Astra's two blockers above
still required the round-3 fixes. All three new Grok findings are addressed:

- A due completion preserves an answer whose identity changed after the attempt
  began, while scheduling the ordinary paced recovery. Nine cases cover all
  policies on online/wasm/process; removing the guards fails three online and
  six local cases. Ordinary expired-answer withdrawal/retry still passes.
- Local expiry backoff now uses `ReadWork.retry` timers outside active slots.
  Two device tests hold eight backoffs and require a ninth read before time
  advances. The awaited-backoff mutation fails both. Delayed work is cancelled
  on close/clear and replaced by invalidation; stale cancelled callbacks compare
  their timer identity before queueing. Unit controls and the unchanged
  `expired-server-watch` close case detect these protections.
- Three online cases raise the floor before `fetch.accept` and assert one query
  with no installed deadlines. Removing the early floor return fails all three.

Grok also observed that either one of the two local reset comparisons can cover
round 2's single interleaving. Both are retained as deliberate redundant checks:
the early comparison retires stale evaluation; the callback comparison protects
publication after its synchronous currentness predicate. The round-2 control
removes both to test the behavior, not each redundant expression separately.
There is no new reset defect demonstrated by those individual survivors. Round
3's tests separately exercise later floor publication and pre-acceptance floors.

## Scope and checks

Applied `llp-orient`; [CONTEXT.md](CONTEXT.md) records the governing documents.
Updated LLP 3000.023 §7 and the client card. Retention episode implementation,
RL policy, contract, interpreter, meters, queue bounds and LV's shelved status
remain unchanged. Four production TypeScript files change. One awaited expiry pause is removed;
no await is added. The reviewed await record changes only `local.ts` from 160
to 159 total awaits, outside the 158 classified delivery sites; all 317 delivery
matrix cases remain. `local.ts` is 1,499 lines, below the 1,500-line ceiling.

- Broad affected run: **339/339**, including per-row queue/publication/browser,
  retention, presence and clock suites (`affected.log`). The presence fixture
  was then strengthened; final regression files pass **35/35**
  (`regressions-final.log`).
- Unchanged saved-answer lifecycle and typing-expiry files: **188/188**
  (`retention-followup.log`), including the two round-2 full-run failures.
- Whole guide: **98/98** (`guide.log`).
- Expanded affected run: **915/916** (`affected-final.log`); its sole failure
  was the stale await record. Corrected delivery matrix plus Grok tests:
  **332/332** (`grok-final.log`). Final per-row/expiry-close run after the cancelled
  timer correction: **94/94** (`retry-close-final.log`), including both React tests.
- Twelve isolated mutations: **34 intended failures**, all detected
  (`controls.py`, `controls-final.log`, and individual logs). Source and full-suite
  artifacts were never mutated.
- Package build, typecheck, docs budget and reference audit pass. Reference
  audit: **523 LLP docs, 9,859 refs, zero errors and zero unchecked**.
- The main full-run client group reports **4,611 tests: 4,599 passed, two failed,
  ten declared skips**; all separate shards passed. Both failures are ours and
  corrected: the await record and cancelled retry callback, detailed in the
  failure ledger. Grok's source changes were built during the Rust phase; the
  callback correction followed the full client failure. Final affected checks
  qualify the correction; no final-tree green full-suite claim is made.
- The **one** `scripts/test.sh` invocation exited **1**. Exact summary:

  ```text
  == 1 failure(s) in 1255 s
     client tests
  ```

  All other phases pass, including **79/79** serial model tests. No full-run
  failure is baseline or environmental; both are ours and fixed as above.
  No second full invocation was run.

[FAILURES.md](FAILURES.md) records the fixture corrections, initially surviving
mutations, setup mistakes and each intentional negative control. No timeout,
assertion, sequence count or size cap was relaxed. No new throughput, timing,
CPU, memory, comparative score or independent-review approval is claimed.

## Wasm

The fresh canonical build inside the full suite reports:

```text
wasm 2040529 B raw, 592975 B gzip (budget 593719: ok)
```

**592,975 B gzip**, **744 B below** the unchanged **593,719 B** cap, **zero
growth** from round 2. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No PQ Rust or wasm input changed. Existing Node 24.13.1 and Bun 1.3.14 were used.

## Final record

Grok's completed review was checked again before completion and is byte-identical
with the retained copy. Final fetch still names `origin/main` at `4fd338de5`;
RL has not landed, so no retention-policy merge is required. One appended
round-3 journal entry accompanies the local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. No push or publication.
Final build, typecheck, references and whitespace checks pass. Every known
product failure in this round is corrected; the required full run remains
recorded as red, with final affected qualification separate.
