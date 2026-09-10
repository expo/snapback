# Day-2 final report

Lane astra-day2-snapback2 · gpt-6-astra · medium · snapback2 0.0.21

All three change requests passed in order. The original live store remains in place. No database drops, store rollovers, fill jobs, destructive migration plans, or backend restarts occurred. All 39 captured original messages retained their original fields.

| Change | Status | Wall seconds | Correction loops | Platform steps | Forced resets |
|---|---|---:|---:|---|---:|
| Nullable editedAt | PASS | 125.605 | 3 | 2 checks + 1 successor install | 0 |
| Member-only live pins | PASS | 206.128 | 1 | 1 check + 1 successor install | 0 |
| Internal function rename + doc comment | PASS | 397.477 | 4 | 3 checks + 1 identical-generation watcher report | 0 |

Wall time includes implementation, diagnostics, and verification. CR3 includes a real 180-second expiry test and a fresh-fixture rerun. Correction loops count root causes, not every downstream assertion or diagnostic repetition.

## Migration procedure and timing

- CR1: add optional time field and server-time edit writer; check refused in 8.165 s on global-search closure budget; reduce paginated search page 20 → 19, retaining all 100 conversation lanes; check passed in 2.412 s; watcher installed messages.editedAt. No backfill. Install observed by epoch 1789068269.999.
- CR2: add pins table, indexes, rules, and pin/list/unpin operations; check passed in 0.910 s; watcher installed the additive table/indexes. Install observed by epoch 1789068373.320.
- CR3: rename isMember → isConversationMember and update imports/calls; add a -- documentation comment. Checks took 1.349 s and 0.828 s on invalid comment guesses, then passed in 1.779 s. Watcher reported empty migration delta, same from/to generation. Ready observed by epoch 1789068597.474.

Owner reports do not emit exact installation execution durations. These are check durations and observed completion bounds, not invented install timings. See [migration-timing.json](migration-timing.json) and [successor-events.json](successor-events.json). Six check attempts and three applied watcher reports in total; no explicit apply-migration commands.

## Evidence

- Original data: [baseline-history.json](baseline-history.json), [cr1-proof.json](cr1-proof.json), [cr1-ui.json](cr1-ui.json), [history screenshot](cr1-history.png). 13 Alice-visible conversations, 39 messages preserved; 22 original DM rows rendered; new edit has editedAt.
- Pins: [cr2-proof.json](cr2-proof.json), [Alice screenshot](cr2-client-1.png), [Bob screenshot](cr2-client-2.png). Two live browser clients and two headless subscriptions; member pin/unpin, outsider denial, scoped lists, duplicate idempotence, revocation.
- Refactor: [installed status](cr3-installed-status.json), [typecheck](cr3-typecheck-final.log), [before acceptance](pre-refactor-acceptance.json), [after acceptance](cr3-final-acceptance.json), [M1 receipt](../evidence/m1-suite.json), [fresh M7 assertions](cr3-m7-fresh-acceptance.json), [history/poll/count/send/edit/pin regression](cr3-extra-proof.json). 36 existing acceptance cases passed, excluding three explicitly skipped historical-artifact callbacks.
- Generation before/after refactor: 07e086b237ec37340dd118f0617e4d64695464b2a3c74d2a20c3409c097935d9.

## Restarts, reloads, and limits

One frontend restart occurred during setup to recover copied missing package assets and remove my CI/no-watch configuration. The backend started once on the existing store. Actual listeners: backend 52444 on 52200; initial Expo 53374 on 52201; replacement Expo 64432 on 52201. Expo launcher PIDs 53373 and 64431 are also tracked. Failed launch attempts 58181 (occupied port) and 61549 (wrong executable path) never became listeners. All started PIDs and stop outcomes are in [run-log.md](run-log.md) and [server-pids.json](server-pids.json). No per-change full restarts, forced browser full reloads, database resets, or rollovers. Source Fast Refresh and normal test navigations are recorded separately.

The initial broad extra M7 run exposed a pre-existing first-20-memberships limitation in group-route resolution after repeated fixture creation. The same functional assertions passed with fresh accounts. No product workaround was folded into the pure refactor. Three old-snapshot/old-report M7 checks were excluded because prior benchmark artifacts are prohibited; fresh day2 history and regression checks replace that evidence. snapback2 test was not invoked because its documented isolated-owner launch has no advertised fixed-port option; all acceptance traffic used ports 52200–52201. No two consecutive unsupported backend capabilities were encountered; recorded syntax/hook/invocation mistakes were corrected.

See [diary.md](diary.md) for the per-change experience and SQL/ORM comparison.

Shutdown verified: all recorded PIDs exited and no listeners remain in 52200–52219. Total session wall time: 1038 seconds. See [shutdown.json](shutdown.json) and [final-listeners.txt](final-listeners.txt).
