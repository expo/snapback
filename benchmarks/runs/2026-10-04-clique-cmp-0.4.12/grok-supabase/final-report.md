# Final report — grok-clique-supabase-20260916

lane id: grok-clique-supabase-20260916  
model: grok-4.6  
effort: xhigh  
backend: supabase-2.112.4  
host: Linux x86_64 (Hetzner AMD EPYC)  
ports used: 55600 (Expo web), 55601 (API)  
tokens.source: null (grok advisory; token caps inapplicable)

start=1789590684

Essay (`essay.md`) and diary (`diary.md`) were written before this tally.

## Wall clock (unix epoch seconds)

Raw start: 1789590684.

| Milestone | start epoch | end epoch | wall seconds | firstGreenAt | status |
|---|---|---|---|---|---|
| M1 | 1789590684 | 1789592800 | 2116 | 1789592800 | green |
| M2 | 1789592800 | 1789594300 | 1500 | 1789594300 | green |
| M3 | 1789594481 | 1789598600 | 4119 | null | aborted |
| M4 | 1789594481 | 1789598600 | (overlap; suite during M3/M8) | null | blocked-by-M3 |
| M5 | 1789594481 | 1789598600 | overlap | null | blocked-by-M3 |
| M6 | 1789594481 | 1789598600 | overlap | null | blocked-by-M3 |
| M7 | — | — | — | null | not-run |
| M8 | 1789594481 | 1789598600 | overlap | null | blocked-by-M3 |
| Scale replay | 1789598676 | (see below) | own clock | n/a | attempted |

M1/M2 first-green times are the later of suitePassAt and choreoPassAt as recorded in `run-log.md` / receipts. M3–M8 clocks overlap because implementation was continuous; M3 authoring/verification consumed the bulk after M2 green. M3 was stopped before the 4-hour wall after repeated choreography failures (suite already green). Aborted counts as a capability-failure for proceed; M4+ are blocked-by-M3 per the prerequisite DAG even though their suites were executed as extra evidence.

## Suite and choreography

| Milestone | suite | choreography | notes |
|---|---|---|---|
| M1 | pass `artifacts/suite-m1.json` | green `artifacts/receipts-m1.jsonl` | coverage `artifacts/coverage-m1.json` |
| M2 | pass `artifacts/suite-m2.json` | green `artifacts/receipts-m2.jsonl` | |
| M3 | pass `artifacts/suite-m3.json` | not green `artifacts/receipts-m3.jsonl` | live bubbles/typing/settings under Playwright |
| M4 | pass `artifacts/suite-m4.json` | not green `artifacts/receipts-m4.jsonl` | blocked-by-M3; attempted anyway |
| M5 | pass `artifacts/suite-m5.json` | not run as green | blocked-by-M3 |
| M6 | pass `artifacts/suite-m6.json` (incl. sample-50 + custom-client-demo) | web offline segment not greened | blocked-by-M3 |
| M8 | pass `artifacts/suite-m8.json` | not greened | blocked-by-M3 |
| M7 | — | — | not-run |

CHOREO_BASE_URL=http://127.0.0.1:55600

## Correction loops (counted)

1. M1 duplicate-handle signup: `createUser` before handle check → Auth “Database error creating new user”. Attribution: **agent-error**. Evidence: `scripts/acceptance.mjs` m1-a03, `server/store.mjs` register reorder.
2. Missing `babel-preset-expo` at app root. Attribution: **agent-error**. Evidence: Metro UnableToResolveError.
3. Global feed SQL unused `$1` type error. Attribution: **agent-error**. Evidence: m2-a09 `could not determine data type of parameter $1`.
4. RN-web semantic values (`aria-valuetext` / `data-value`) for attachments, feed media, avatars, receipts, members. Attribution: **agent-error** (kit has accessibilityValue; web mapping needed patches). Evidence: choreography M2 misses then passes after `data-value`.
5. Client feed poll merged stale pages; unreposts stuck. Attribution: **agent-error**. Evidence: M2 `repost-toggle-live-attribution`.
6. Dual React (vendored UI `node_modules` vs app). Attribution: **agent-error**. Evidence: `TypingIndicator` invalid hook call / `useRef` of null.
7. Conversation `settings` nested route rendered parent. Attribution: **agent-error**. Evidence: Playwright body showed composer on `/.../settings`; fixed via `?settings=1`.
8. Load-on-mount before Auth session restored (401, stuck “Loading chat settings”). Attribution: **agent-error**. Evidence: debug script.
9. Duplicate `sm-convo-input` strict-mode violation. Attribution: **agent-error**. Evidence: M3 choreo miss text.
10. Hosted `pg` pooler `EMAXCONNSESSION`. Attribution: **environment** (tenancy limit) with agent-error (too-large pools). Evidence: m8-a05 during parallel suite+choreo.
11. Hermes `private properties are not supported` on iOS bytecode. Attribution: **environment** (RN/Expo on Linux hermesc). Evidence: `artifacts/hermes-export.err`.

SubAttribution: none of the loops is a clear supabase-defect (`snapback-defect` analogue). Auth error wrapping on handle collision is closest; still classified agent-error because checking the unique index first is the documented app-level approach.

## Native artifacts

- iOS Hermes bundle export: **attempted, failed** for M1/M2 (`artifacts/m1-ios-hermes`, `artifacts/m2-ios-hermes`, `artifacts/hermes-export.err`). hermesc rejected private fields in the RN bundle. Not native-simulator proof.
- M6/M8 iOS simulator: **unavailable/not-run**. `artifacts/simulator-status.json`. Apple simulators and Xcode are not on this host. A web build is not a substitute.

## Scale replay

- Own clock start epoch: 1789598676 (`artifacts/scale-start.epoch`)
- Adapter: `scripts/scale-replay.mjs` + `server/replay.mjs` (every action-schema verb, settle-before-next, `replay_mode` disables push/digest)
- Fresh instance: schema prefix `clq916g_s_`, bucket `clq916g_s_media`, starter m1–m3 applied (16+52+19) then `instrument/fixtures/scale.log`
- End epoch: 1789599096 (`artifacts/scale-end.epoch`)
- Result: **did not pass** invariant verification. Starter on the fresh `clq916g_s_` instance settled (16+52+19). `scale.log` had not reached the 10% checkpoint when the process was stopped so prefix cleanup could run. Receipt: `artifacts/scale-replay.json`.

## Resolved package pins

| package | version |
|---|---|
| @supabase/supabase-js | 2.112.4 |
| expo | 54.0.37 |
| expo-router | 6.0.24 |
| react | 19.1.0 |
| react-native | 0.81.4 |
| react-dom | 19.1.0 |
| pg | 8.16.3 |
| playwright (choreography) | 1.62.1 |
| Node | v24.13.1 (ENVIRONMENT.md asked 24.18.0; this is what was on PATH) |

## Hand-authored line counts (approx., excluding node_modules and frozen kit copy)

| path | lines |
|---|---|
| server/store.mjs | 1643 |
| scripts/acceptance.mjs | 679 |
| src/screens/ConversationScreen.tsx | 588 |
| server/http.mjs | 470 |
| server/schema.mjs | 223 |
| server/replay.mjs | 224 |
| app/index.tsx | 234 |
| src/lib/CliqueProvider.tsx | 189 |
| scripts/custom-client-demo.mjs | 101 |
| other app/src/server/scripts | remainder |
| **app+src+server+scripts** | **~5888** |
| API.md | 114 |
| diary.md / essay.md / this report | additional |

Vendored UI kit and copied choreography are instrument copies (plus small `data-value` / Composer patches) and are not counted as original product code.

## PIDs (recorded; killed only these at cleanup)

- API: see `artifacts/api.pid` (last: 1961299 on 55601)
- Expo/metro: `artifacts/web.pid` (1904169 / 1904182 on 55600)
- Scale replay: 2015997 / 2016003

Never used pkill/killall/pattern kills.

## Candid gap list

- M3+ two-client choreography never greened: conversation composer vs Playwright, typing <2s, group settings candidate semantics under the harness.
- Realtime under-used; polls instead of broadcast/postgres_changes for typing and messages.
- No durable official offline layer; localStorage queue is hand-rolled.
- iOS Hermes bytecode export failed; simulator proofs unavailable.
- Scale replay not verified to the combined invariant manifest before cleanup.
- Auth users created in the shared hosted project are not prefix-namespaced (cannot drop without touching other tenants’ auth); only `clq916g_` tables/functions/buckets/triggers were dropped.
- Digest worker runs in the API process interval, not pg_cron (no CLI). It is server-side and schedule-driven.
- Trending/insights are SQL and suite-covered; celebrity fan-out at 1000 users was not performance-probed (O5 incomplete without a finished replay).

## Cleanup

Prefixed database objects, Realtime publication members, and storage buckets under `clq916g_` / `clq916g_s_` dropped via `scripts/cleanup.mjs` (48 objects). Auth users are not prefix-namespaced and were left in the shared hosted project.

end=1789599113
