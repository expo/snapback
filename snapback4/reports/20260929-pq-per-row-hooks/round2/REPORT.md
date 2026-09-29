# PQ round 2 — port onto pre-LV main

Branch: `sb4-intent/pq2-per-row-hooks`, created by the requested fetch/switch
from `origin/main` at `ac5c4e21c86c7d54552cfd0316e66d06ba69d492`.
The source delta is the PQ-only work in `git diff f56e8048a 6f1d75c16`,
adapted to main. No merge or cherry-pick carries LV into this branch. Earlier
reports and measurements are preserved as historical evidence, not round-2
qualification. Nothing is pushed or published.

## Port and constraints

Applied `llp-orient`. Scope: observation scheduling, local commit selection,
expiry, hook keys and publication tests. Governing context: LLP 3000 §4 and
Snapback 4's fence, LLP 2000.000 §7 (partition authority), LLP 3000.016 §2.2
(local publication), LLP 3000.019 §3.3 (deadlines), LLP 3000.023 §§3.1–3.6
(the restored observation/episode model), and LLP 3000.029 §0 (revert).
Read the current client/reads cards, prior prompts, reports, journal entries
and both reviews. No skill hand-off, contract change, new gate or tool install.

- The per-client FIFO queue coalesces each owner, starts at most eight attempts
  per turn and keeps at most eight active. Cancelling or reaching the 30-second
  attempt deadline releases the slot despite an ignored abort. Dirty/expired
  attempts rejoin the queue; duplicate arrivals preserve FIFO position.
- Last-owner close cancels pending/active work. Lingering observations keep
  their answer and deadlines and resume cancelled work on reacquisition.
  Cancellation cannot adopt a late reply or overwrite transport diagnostics.
- Ordinary commits retain their previous answer through `reload()`, including
  while queued, under main's existing policy. `read-episode.ts` is untouched;
  the only `read-observation.ts` changes are the server-deadline floor field
  and clearing it on a scope reset. RL retains custody of retention policy.
- Warm applies select dependency tables and drain once after the watermark.
  Known empty/unrelated applies do zero evaluations; unknown footprints select
  every owner. Hard resets retain main's immediate behavior. No LV dependency
  fences, shared answer-order mechanism or peer reconciliation are reinstated.
- Clock corrections sweep all raw/held deadlines and queue only due owners.
  The withdrawn server-deadline floor survives rollback. Rejected bodies are
  discarded without replacing newer answers with synthetic loading results.
- Canonical wire keys preserve shared observations and React page chains.
  Object-key order is irrelevant; array order and retention policy remain
  distinct. A separate key helper avoids edits to RL's episode implementation.
- The client guide carries both row-hook and list idioms and explicitly limits
  the eight-active claim to queued attempts. Prior timing samples are labelled
  pre-port. LLP 3000.023 §7 records scheduling without changing §3's policy.
  Local deadline helpers were extracted unchanged to keep `local.ts` below
  the 1,500-line ceiling.

## Review findings and counterfactuals

Astra's unknown-footprint scenario passes on unmodified pre-LV main, on wasm
and process (`baseline-unknown.log`). Main has no LV dependency fence. The port
still carries an explicit unknown-footprint bit into its deferred final drain:
removing that bit fails both tests, with a current direct query but an owner
still loading (`no-unknown-drain.log`).

The reset tests stop after `ReadObservation.fetch` has passed its own revision
check, reset the owner before the client's final continuation, and hold the
replacement attempt. No credential/store/commit revision changes or abort can
mask the reset fence. All three retention policies are exercised on online,
wasm and process. Removing the client comparison publishes the old data in
three cases; removing the local comparisons does so in six.

Grok's completed review additionally identifies a floor-rejected body's
synthetic loading publication and cancellation contaminating transport failure
state. Both are fixed. Main's direct queries keep their independent publication behavior; the tests do
not restore LV's cross-owner reconciliation. Nine controlled publication-gap
cases keep a newer answer after a floor rejection, with `resetVersion` unchanged. Reintroducing
synthetic loading fails three online and six local cases. Catch handlers ignore
aborted attempts before recording any transport failure.

Eleven isolated mutations fail as intended: online/local reset fences, unknown
final drain, online/local synthetic loading, duplicate-to-tail FIFO, active
cancellation, attempt lifetime, raw React argument keys, queued loading, and suppressing normal due-deadline retries.
The baseline control uses all of main's SDK source transpiled in an isolated
worktree-local copy; it does not borrow LV code. See `controls.py`, `controls.log`,
`baseline-control.log`, and individual logs. These are expected red controls,
not product test failures or independent review approval.

## Verification

Whole guide: **98/98** (`guide.log`). Final correction run: **287/287** (`full-fixes.log`), including both full-run
failing files and all per-row/clock regressions. Earlier targeted tests: **203/203**
(`regressions-final.log`); publication cases: **20/20** (`publication-final.log`).
The earlier broad affected run was **883/884**, including all **317** delivery
checks (158 transient/persistent pairs plus their classification check). Its
one browser failure is ours and passes in the stable-source follow-up; the
failure ledger gives the exact evidence and limits. SDK build/typecheck,
reference validation and whitespace checks pass. The delivery census stays at
158 sites; only the signal-composed `sendPost` await expression changes
(`await-delta.json`). New scheduling/key/deadline helpers add zero await sites.

The full client phase reports **4,560 pass / two fail / ten declared skips**
(4,572 tests; separate shards pass). Both failures are ours and corrected:
local `keep:false` resubscription must preserve main's saved-answer behavior;
normal expiry replies must use paced retries instead of rollback-floor
suppression. Their unchanged assertions and all affected regressions pass in
the final 287-case run. Full source changed after those failures; no final-tree
green full qualification is claimed. See `FAILURES.md` for each failure,
negative control and correction. The **one** `scripts/test.sh` invocation exited **1** with exactly:

```text
== 1 failure(s) in 1331 s
   client tests
```

All other phases passed, including all **79/79** models. No full-run failure is
classified baseline or environmental. The cancellation-diagnostic guard was
finished and rebuilt during the Rust phase, before the full client phase; the
two later product corrections are qualified by `full-fixes.log`, not by a
second full invocation. The final guide, typecheck, references and source
ceiling remain satisfied. Grok was checked at the start, when its report
completed, and again before completion; the final copied review is unchanged.

One appended journal entry and one local commit carry this port, with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push/publication were not run.
Every observed failure and setup correction is attributed in `FAILURES.md`.
No test timeout, sequence count, expectation about visibility after membership
removal, or byte cap is relaxed.

The actual React browser witness mounts 1,000 distinct per-row `useQuery` hooks,
processes a relevant table change, and records **zero loading renders** and
**2,000 total query evaluations** (1,000 mount plus 1,000 replacements). It also
observes the `revalidating` mark. Host `Date.now` is fixed for this count test so
it pins queue transitions independently of RL's concurrent retention-policy
work; it does not claim unbounded retention on this branch. Separate tests
retain main's real episode-deadline behavior.

## Round-2 measurements

Fresh N=1,000 point/list cells on wasm, Worker, online and process completed
without errors. All eight cells perform zero unrelated-write query evaluations;
point cells perform exactly 1,000 evaluations per relevant write, list cells one.
Online concurrency peaks at eight for points and one for lists. Browser mounts
use actual React hooks; process mounts observations without React. The online
initial mount also includes eight startup retries (one for the list).

| Tier | Point mount ms | List mount ms | Relevant evaluations, point/list | Unrelated evaluations |
|---|---:|---:|---:|---:|
| wasm | 653.4 | 20.9 | 1000/1 | 0/0 |
| worker | 795.0 | 20.5 | 1000/1 | 0/0 |
| online | 917.4 | 34.6 | 1000/1 | 0/0 |
| process | 241.8 | 9.6 | 1000/1 | 0/0 |

`port-measurements.jsonl` retains CPU, heap/RSS, mount/write timing and task/lag
samples. These are single samples on a shared host while the full suite ran;
they are not a latency comparison with prior rounds. No browser task of at
least 50 ms was recorded. Process records event-loop lag, not browser tasks.
Write elapsed time includes the harness's 200 ms settlement wait. N=100/500 and
the copied three-hook ChatRail remain historical round-0 measurements; this
round's fresh measurements are the eight cells above. The witness runner's
`PQ_BASELINE=1` now selects pre-LV `ac5c4e21c` and restores all changed read/key
modules; historical round-0 commands refer to that round's recorded checkout.

## Wasm

Canonical build on the restored main runtime:

```text
wasm 2040529 B raw, 592975 B gzip (budget 593719: ok)
```

**592,975 B gzip**, **744 B below** the unchanged **593,719 B** cap.
No Rust/runtime source or build-input change in PQ: zero growth relative to
this base. Prior LV-based rounds measured different runtime bytes and are not
the size baseline for this port. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
