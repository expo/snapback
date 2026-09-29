# PQ round 1 — cancellation, conservative refresh and queued expiry

Branch: `sb4-intent/pq-per-row-hooks`. Round 0: `3e2961ee8`.
Fetched and merged `origin/main` first; merge commit `4d695813e` includes LV
round 11 (`f56e8048a`). Both sides of the journal and LLP conflicts were kept.
LV's local-evidence section remains §13; PQ's scheduling section is now §14,
with its production/test references updated. No push or publication.

## Review disposition

Both complete round-0 reviews are copied here: [Astra](astra-round0.md) and
[Grok](grok-round0.md). Grok was checked before work, during work and at completion;
it was initially progress-only and its final findings were incorporated when
available. Neither review is represented as approval of this revision.

| Finding | Repair and regression |
|---|---|
| Astra high / Grok medium: eight held reads starve later owners | `ReadWork` owns an abort controller and 30-second deadline for each active attempt. Cancellation/expiry immediately releases capacity; expired live owners rejoin the queue behind pending owners. Tests hold eight responses that ignore abort on online, wasm and process, close/expire them, and require the ninth read to complete before those responses settle. |
| Astra medium: unknown apply footprint withdraws without refreshing | An acquired apply with missing `touched` schedules all affected owners immediately. Real wasm/process adapters omit the field from both commit callback and return value. All three retention policies withdraw and obtain the committed edit; background timers are frozen so a later probe cannot mask the regression. |
| Astra low: concurrency claim includes timed presence | The card bounds **queued observation attempts**, explicitly excluding direct queries and timed presence refreshes. Guide assertions pin this qualification without raising its 130-line budget. |
| Astra low: fairness under continuing arrivals | New arrivals and duplicate invalidations interleave over successive turns. An existing queued owner runs after its original 16 predecessors, before later arrivals. Moving duplicate requests to the tail fails the test. Active cancellation, expiry, late settlement and clear/rejection recovery are covered separately. |
| Grok high: rollback republishes a withdrawn deadline | Raw and held expiry record a server-deadline floor on the live owner. Matching read keys consult it before publication and local server-memory admission. A real recovery response carrying the withdrawn deadline remains loading, without accept retries; later deadlines remain publishable. Nine cases cover every retention policy on all three tiers. Ordinary already-expired responses retain their paced retry, so a current empty answer can arrive. A non-expiry reset clears the floor for the new authority scope. |
| Grok low: React raw argument keys contradict sharing | `useQuery` and `usePage` memoize by canonical `readKey`. The browser test reorders nested object keys without another request, loading render or loss of page two; changing retention or array order still creates new work. |

Closing one of several subscribers preserves their shared attempt. Closing the
last subscriber cancels pending and active work, including `keep: true`.
Its existing linger interval still holds the answer, authority interest and
original deadlines; reacquisition resumes a cancelled evaluation. Closing during
expiry backoff also stops that attempt from queuing another retry. Cancellation
is propagated to HTTP and checked at local query continuations and publication.
An adapter that ignores abort may retain an obsolete physical request; it cannot
hold queue capacity or publish its late result. Eight is an **active-attempt**
bound, not a global physical-network bound. Existing bounded internal retries
remain inside an attempt; expiry recovery rejoins the queue.

LV's revision, credential, incarnation, dependency-cut, deadline and local
publication-order checks remain. No local reply becomes remote evidence; no
remote fence is cleared by a local answer. Withdrawals remain synchronous.
No Rust production code, contract, table-dependency granularity, meter or budget
changes. Round-0 timing tables remain historical measurements; this round
qualifies counts and correctness, not new wall-time/CPU or memory claims.

## Governing context

The affected-scope LLP orientation/audit covers 3000.029 §§10–14 (remote and
local evidence, attempt order, synchronous withdrawals and queue fairness),
3000.019 §3.3 (retention, linger and original deadlines), and 3000.016 §2.2
(withheld local reads and server fallback precedence), alongside the current
client/reads cards. The change preserves the LV fences and their publication
order. The new scheduling, cancellation and deadline-floor decisions are folded
into the existing 3000.029 §14; no separate proposal or authority gate is added.

## Verification

Verification ran from `snapback4/`; complete logs are alongside this report.

- Initial regressions: 17/17. Final owner-close/sharing follow-up: 87/87.
- Session/cancellation correction follow-up: 27/27; unchanged browser and
  direct-query terminal-boundary tests: 12/12.
- Grok expiry/key/count follow-up: 138/138. Final browser key test: 1/1.
- Final broad affected run: **1,406/1,406**, `affected-final.log`, including
  all 333 delivery fault cases. The last expiry-precedence correction is
  qualified by **61/61** in `full-failures-fixed.log`: the whole clock file,
  expired-response retries and all ten real-server typing trials. Final terminal
  boundary/count/browser checks: **35/35**, `terminal-final.log`.
- Whole guide: 98/98, including the client scope assertion. Typecheck, build,
  docs budget and reference validation: see final results below.
- One complete `bash scripts/test.sh` invocation, exit **1**. Exact summary:
  **`== 1 failure(s) in 1087 s`**, followed by `client tests`. The main client
  stage reports 4,890 tests: 4,872 pass, eight fail, ten declared skips.
  All other phases pass, including **79/79** model tests. All eight failures
  are **ours**, individually listed in [FAILURES.md](FAILURES.md), and pass in
  the 61-case follow-up. No baseline or environmental exemption and no second
  complete invocation.

The full run began while review follow-ups were still being incorporated;
final affected checks qualify the final source separately. No unchanged-file
or exact-commit full-suite claim is implied. Every unexpected failure and every
intentional red control is attributed in [FAILURES.md](FAILURES.md).

`controls.py` creates an isolated SDK copy inside this worktree. Removing
active cancellation fails nine close cases; removing attempt expiry fails
three cases; removing unknown-footprint scheduling fails two; moving duplicate
requests to the tail fails fairness; restoring React's raw keys fails the
browser witness (5 requests / 3 loading renders / one page, instead of
3 requests / zero loading renders / two pages). The nine rollback cases also
failed before the deadline-floor repair. No test timeout or assertion was relaxed.
The final cancellation audit also
adds `close watch` coverage for every retention policy to the expiry-backoff
fixture. `keep: true` issued an extra request before its fix
(`cancel-backoff-before.log`); the final close/expiry/liveness run passes
**26/26** in `cancel-backoff-fixed.log`.

The delivery await census still has 166 sites with the same classifications and
fault recipes. Two existing awaited expressions wrap the same work with signal
composition/cancellation; [the delta](await-delta.json) identifies both. The
full 333-case fault matrix is included in affected/full verification.

## Wasm

The canonical full-suite rebuild reports exactly:

```text
wasm 2042203 B raw, 593573 B gzip (budget 593719: ok)
```

**593,573 B gzip**, **146 B headroom**, **0 B growth** versus the local round-0
and LV round-11 artifact. Cap unchanged at **593,719 B**. SHA-256:
`75104fe4882479ef2bfd8796df9d655853739084640c11457cffbb50309a6e2c`.
Node 24.13.1 / Bun 1.3.14 on the existing Linux worktree; no tool installation.

## Final record

The SDK build and typecheck pass. Whole guide: **98/98**, with its line budgets
unchanged. Reference audit: **523 LLP docs, 9,900 refs, zero errors and zero
unchecked** (`ref-check-final.log`). The final source and evidence are committed
locally with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`; the journal has
one appended entry for this round. Nothing is pushed or published.
