# Clique on Snapback 4 — final report

lane id: grok-clique-snapback4-full-20260913  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.2.10  
pins: snapback4@0.2.10, snapback4-expo@0.2.3  

start=1789392533  
end=1789404423  

Wall from start to this report: 11750 s (~196 min). Token totals are harness-native and not estimated here (`tokens.source` inapplicable / advisory for this family).

## Ports and PIDs

| role | port | PID |
| --- | ---: | ---: |
| snapback4 dev (main Clique, later restart) | 49340 | 94075 python `sb4.py`; 94077 snapback4; 94079 worker |
| Expo web | 49341 | 19455 (`npx expo`); 19488 metro |
| snapback4 dev (scale, `--fresh`) | 49342 | 67090 (worker 67099) |
| earlier main backend (killed) | 49340 | 81016 / 81019 then 59899 / 59916 / 59918 then 77147 / 77149 / 77152 |

Kill only recorded PIDs at lane end. Never pkill / killall / pattern kill.

## Wall and first-green by milestone

| milestone | status | suite | choreography | firstGreenAt | notes |
| --- | --- | --- | --- | ---: | --- |
| M1 | green | pass `acceptance/m1.json` | pass `receipts/m1.jsonl` | 1789395038 | both bars |
| M2 | green | pass `acceptance/m2.json` | pass `receipts/m2.jsonl` 9/9 | 1789400073 | recordedAt 2026-09-14T15:34:33.853Z |
| M3 | aborted | pass `acceptance/m3.json` | fail (latest `receipts/m3.jsonl`) | null | suite + partial choreo; some runs had all required except one |
| M4 | aborted | pass `acceptance/m4.json` | fail `receipts/m4.jsonl` (photo pass) | null | not wall-capped |
| M5 | aborted | pass `acceptance/m5.json` | fail `receipts/m5.jsonl` (color/background pass) | null | |
| M6 | aborted | pass `acceptance/m6.json` | fail `receipts/m6.jsonl` (offline queue) | null | scale replay extra, pass |
| M8 | aborted | pass `acceptance/m8.json` | fail `receipts/m8.jsonl` (m8-a13 pass) | null | |
| M7 | not-run | — | — | null | separate session |

No milestone hit the four-hour wall cap. Statuses are `green` / `aborted` (choreography not green) / `not-run`. Two consecutive *capability-failure* (4h) did not occur.

## Correction loops

| # | attribution | evidence |
| --- | --- | --- |
| 1 | environment | snapback4 darwin-arm64 stalled at `_dyld_start`; Apple Development re-sign + `start_new_session` |
| 2 | agent-error | Metro hid gitignored `snapback/generated/api.ts`; copy to `src/api.generated.ts` |
| 3 | agent-error | default wasm URL served HTML; `public/snapback4_device_bg.wasm` |
| 4 | agent-error | logout did not `forgetSession`; AuthForm in root layout |
| 5 | agent-error | following feed fan-out missed post-follow history; merge-on-read |
| 6 | snapback-defect | `insert if absent` on `read <- deny` intents → `E_RULE`; intents public |
| 7 | agent-error | RN Web FlatList `onEndReached` loop; ScrollView |
| 8 | agent-error | file input not a real DOM control; `WebFile.tsx` |
| 9 | agent-error | video compose used video blob as Image poster; `/poster.png` |
| 10 | snapback-defect | unsynced likes → `likesOf` horizon none; `sync public last 2000 by byTime` |
| 11 | agent-error | `setLike` `bumpDailyLikes` collided on unread `dailyActivity`; table made public. Diagnostic `E_RULE` |
| 12 | agent-error | RN composer send disabled under Playwright `fill`; native `<textarea>` |
| 13 | agent-error | 29× `receiptsOf` poll starved `mutate`; sendMessage hung |
| 14 | agent-error | removing a member unmounted group Thread via `groupsNamed`; cache conversationId |

## Suite and choreography per milestone

- **M1** suite pass, coverage `acceptance/m1-coverage.json`. Choreo green.
- **M2** suite pass. Choreo green: text/image/video live, follow/unfollow, avatars, like/unlike, repost attribution+removal, following-feed repost, reply thread (`receipts/m2.jsonl`).
- **M3** suite pass. Choreo not green. Latest file: DM live pass, typing fail, 1:1 receipts pass, group read fail, member-add fail, quoted pass. Earlier isolated runs had typing+group-read+member-add pass on a short thread.
- **M4** suite pass. Choreo: photo-message pass; video viewer, reactions, edit, delete fail.
- **M5** suite pass. Choreo: chat-color-background-sync pass; view-once, offline search, disappearing fail.
- **M6** suite pass (push log, custom-client-demo, sample-50). Choreo: offline queue fail (`createClient` has no outbox).
- **M8** suite pass. Choreo: m8-a13 same-account live message pass; insights refresh, cross-device, dual-offline fail.
- Coverage: `acceptance/mN-coverage.json`, `acceptance/suite-status-mN.json`.

## Native artifacts

iOS Hermes export: `dist/ios-hermes/_expo/static/js/ios/entry-1d206c4a7d03c06d6832d5afbbeefefa.hbc`, copied under `dist/ios-hermes-m{1,2,3,4,5,6,8}/`. Simulator proofs not run (do not gate web green).

## Scale replay

- start=1789397301  
- end=1789397754  
- wall=453 s  
- actions=167157, actors=1008  
- instance: `snapback4 dev --port 49342 --fresh` (PID 67090)  
- verification (`replay/scale-verification.json`): **pass** named O5 — u0500 following=500 conversations=100; u0005 following=5; u0900 followers=900 posts=200; u0901 following=5.

## Package pins

- snapback4@0.2.10 (optional snapback4-darwin-arm64@0.2.10)  
- snapback4-expo@0.2.3  
- Expo 57.0.22, React 19.2.3, RN 0.86.3  

## Hand-authored line counts (approx., excluding generated `api.ts`)

| file | lines |
| --- | ---: |
| snapback/schema.q | 826 |
| scripts/acceptance.mjs | 574 |
| src/ConversationThread.tsx | 488 |
| scripts/lib/replay-core.mjs | 315 |
| app/conversation/group/[group]/settings.tsx | 197 |
| app/feed.tsx | 163 |
| src/FeedItem.tsx | 125 |
| src/client.ts | 121 |
| src/AppProviders.tsx | 99 |
| app/profile/[handle].tsx | 86 |
| app/profile/edit.tsx | 75 |
| scripts/seed.mjs | 75 |
| app/post/[id].tsx | 70 |
| src/WebFile.tsx | 69 |
| app/_layout.tsx | 68 |
| app/chats.tsx | 64 |
| app/new-chat.tsx | 63 |
| src/ops.ts | 57 |
| scripts/scale-replay.mjs | 56 |
| app/search.tsx | 50 |
| scripts/custom-client-demo.mjs | 51 |
| src/DeliverySync.tsx | 40 |
| others (index, me, insights, settings, dm screen, group screen, sb4.py, export, API.md) | ~400 |
| **hand-authored total (order of)** | **~3700** |

`src/api.generated.ts` / `snapback/generated/api.ts` are compiler output.

## Candid gap list

1. Web uses `createClient` (online), not wasm local replica — M6/M8 offline choreography cannot queue; warm-offline search cannot read a local copy.
2. M3 choreography never produced a single green JSONL despite isolated passes of every required check.
3. M4 video inline/viewer, reaction chips, edit/delete tombstone not observed green.
4. M5 view-once media viewer and disappearing control not observed green.
5. M8 Insights kit totals (`sm-insights-total-likes-received`) not wired to the frozen Insights IDs.
6. Chat list `sm-chats-item` identity `dm:bob` not reliable for M8 cross-device.
7. Per-bubble live queries on a long thread starve mutations (documented, mitigated, not gone).
8. `dailyActivity` had to be public so likes could increment another user’s tally.
9. Host Gatekeeper stall on the published darwin-arm64 binary.
10. Corpus-wide SQL vs `invariant-manifest-combined.json` not fully enumerated; named O5 HTTP checks passed.

end=1789404423
