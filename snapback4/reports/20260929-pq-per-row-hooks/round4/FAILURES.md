# PQ round 4 failure ledger

All unexpected failures below are classified **ours**. No baseline or environmental exemption is claimed. Intentional isolated mutations are listed separately. Original logs retain complete test names, assertion details and timings.

## Required full run — ours

`scripts/test.sh` ran exactly once. Its exact final summary is:

```text
== 1 failure(s) in 1138 s
   client tests
```

Exit 1. The main client phase reported 4,649 tests: 4,622 pass, 17 fail, 10 skipped. Its separate helper shards passed. The subsequent complete model phase passed 79/79. Build, wasm budget, docs budget, release guard, package and app typechecks/builds, Cargo tests and fixture wrappers passed. This invocation began before main's MT scheduler update was merged and before all round-4 fixes were complete. It is retained as red, not claimed as final-tree full qualification.

Every one of its 17 failures (`test-sh.log`):

| File | Tier/policy and case | Classification and resolution |
|---|---|---|
| answer-withdrawal | wasm/default/apply/held | ours: deadline asserted at enqueue; now observed at held attempt |
| answer-withdrawal | wasm/default/transfer/held | same |
| answer-withdrawal | wasm/default/apply/throw | ours: obsolete enqueue deadline assumption; final withdrawal remains required |
| answer-withdrawal | wasm/default/transfer/throw | same |
| answer-withdrawal | wasm/default/apply/unavailable | same |
| answer-withdrawal | wasm/default/transfer/unavailable | same |
| answer-withdrawal | process/default/apply/held | ours: deadline asserted at enqueue; now observed at held attempt |
| answer-withdrawal | process/default/transfer/held | same |
| answer-withdrawal | process/default/apply/throw | ours: obsolete enqueue deadline assumption; final withdrawal remains required |
| answer-withdrawal | process/default/transfer/throw | same |
| answer-withdrawal | process/default/apply/unavailable | same |
| answer-withdrawal | process/default/transfer/unavailable | same |
| keep-app-model | wasm/default/seed 23/50 ms authority | ours: property recorder sampled hidden deadline before attempt started |
| keep-app-model | wasm/default/seed 44/50 ms authority | same |
| keep-app-model | wasm/default/seed 445/50 ms authority | same |
| per-row-react | wasm/1,000 hooks/real clock | ours: controlled feed sent no heartbeat; four-second watchdog took the link offline |
| per-row-react | Worker/1,000 hooks/real clock | same |

The property recorder now retains the last answer object and reads its absolute episode timestamp at withdrawal. The property still rejects any withdrawal lacking an allowed cause or an expired real deadline; counts and timeouts are unchanged. All 18 property sequences pass in `full-failures-followup.log` (that combined run remains red for the separate fixtures below).

The real-clock feed now emits whitespace heartbeats every second while withholding change evidence, so the explicit server write and `sync()` own the measured replacement. The real four-second watchdog, clock, episode length, queue and zero-loading assertion are unchanged. Temporary tracing in `react-diagnostic-3.log` and `withdrawal-react-final.log` shows `setLink` publishing loading during `waitForChange` failure, while the observed row's episode deadline is absent or still in the future. The earlier suggestion that ongoing source changes explained the failures was not established; the traced cause is the malformed controlled feed. Tracing was removed from the final test.

## Other unexpected failures — ours

- `affected-initial.log`: one `keep-authority-react` case, keep=true, timed out during 20 replacements. No assertion or timeout changed. Both cases in that unchanged file subsequently passed in `notification-followup.log`. Conservatively attributed to this lane; no baseline claim.
- `regressions-final.log`: process offline fallback checked after a fixed count of event-loop turns (34/35). It now waits for completed `data:true`, `fresh:false`, non-revalidating fallback; 35/35 in `regressions-qualified.log`. The removal control still fails both substrates.
- `delivery-clock-presence.log`: three remembered local-wakeup cases (deadline null/early=false, null/early=true, 600/early=false) saw an extra notification from starting the hidden attempt deadline. Preserve snapshot identity when starting that timestamp and avoid an extra raw notification. Grok's subsequent fix also makes these sweeps preserve the exact unexpired raw snapshot without revalidation; their assertions now require that stronger behavior.
- `build-grok.log`: TypeScript exact-optional-property checking rejected `revalidate: undefined`. The environment option now defaults explicitly to true; subsequent builds/typecheck pass.
- `grok-boundaries.log`: all three online held-only-expiry policy cases assumed an online clock fork. The online client uses the supplied clock directly; correcting the fixture clock reference gives the intended sweep. They pass in `grok-qualified.log`.
- `affected-final.log`: the delivery await-classification check found two changed source fingerprints. Only option arguments at the existing `watch.fetch` calls changed; the client/local-query entries were regenerated. No await count or fault-site classification changes (158 sites, 317 checks); `await-delta.json` and `grok-qualified.log` record the result.
- `full-failures-followup.log`: six default retryExhausted membership-change cases (wasm/process × apply/admit/transfer) waited for a device-attempt marker, but this scenario reads from HTTP. The marker covers HTTP too. The Worker real-clock case also hit the missing-heartbeat issue above. All 18 property sequences passed in this same run.
- `withdrawal-qualified.log`: two default admit/retryExhausted cases (wasm/process) expected the current snapshot to retain an episode despite an intervening ephemeral reset. Exact deadline assertions now apply to the held case, where no reset intervenes; every failure mode still must withdraw, with four rejected replies for retryExhausted. The Worker case again hit the missing heartbeat. Corrected withdrawal file: 42/42 in `withdrawal-final.log`.
- `react-diagnostic-3.log`: Worker missing-heartbeat failure, traced as above.
- `withdrawal-react-final.log`: process missing-heartbeat failure from the tracing version. Its misleading filename predates the corrected feed; it is diagnostic evidence, not final qualification.

## Detecting controls — ours, deliberate isolated mutations

| Removed behavior | Expected failing cases |
|---|---:|
| local sweep uses acquisition instead of invalidation | 4 (wasm/process × default/false; newer value remains 8 beyond one second) |
| online sweep uses acquisition instead of invalidation | 3 (all policies) |
| signed-out scheduling guard | 6 (wasm/process × all policies; raw notification snapshot) |
| footprint passed from local commit | 2 (wasm/process offline fallback) |
| selective remembered-answer clearing | 12 (known footprints over apply/admit/settle) |
| episode excludes queue wait | 1 (deadline/facade unit case) |
| episode excludes queue wait, real React | 3 (wasm/Worker/process loading assertions) |
| only final publication-callback resetVersion comparison | 6 (wasm/process × all policies) |
| local attempt starts its episode | 2 (wasm/process active-attempt deadlines) |

Nine variants produce **39 intended failures** in `controls-final.log`. The final heartbeat-equipped React removal control is repeated in `react-control-qualified.log` and `episode-at-enqueue-react.log`: all three tiers fail the explicit zero-loading assertion. `controls.py` mutates source and built modules only in isolated temporary copies inside this worktree.

Test-strength corrections are also retained: the first Worker mutation timed out before examining its loading render (`episode-at-enqueue-react-initial.log`); it now stops at loading or complete success before asserting. Initial sign-out tests called `getSnapshot`, which repaired the denial and masked the mutation; they now inspect the raw owner's snapshot during notification. The local sweep control initially killed only keep=false; the strengthened default case advances host time a full second after the settled sweep. No passing-case timeout or count was relaxed.

## Setup and lookup corrections

The first main merge conflicted only in the append-only journal; both entries were retained. An early lookup named absent `held-answer.ts` instead of `read-approval.ts`. Nonexistent `clock*.test.mjs`, `delivery-failures.test.mjs` and `keep-reset-boundary.test.mjs` paths ran no tests; their logs make no coverage claim for those files. Final commands name `server-clock*.test.mjs`, `delivery-fault-matrix.test.mjs` and `keep-reset.test.mjs`. A diagnostic edit used a root-relative path while already in `snapback4/`, failed before changing any file, and was immediately corrected. No tools were installed. The optional machine-fleet file is absent here.

Stored logs have trailing reporter whitespace stripped for the staged diff
check; test names, assertion details, timings and summary lines are preserved.
