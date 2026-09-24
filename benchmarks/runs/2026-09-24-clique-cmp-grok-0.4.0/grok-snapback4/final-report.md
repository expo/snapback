# Clique × Snapback 4 — final report

lane id: `grok-clique-snapback4-20260924`  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.4.0  
host: Linux x86_64 (Hetzner AMD EPYC)  
ports used: **56400** (main snapback4), **56401** (Expo web), **56402** (scale replay `--fresh --replay`)

## Raw clocks

| mark | epoch (unix seconds) | note |
| --- | ---: | --- |
| lane start | 1790255108 | first lines of `run-log.md` |
| M1 suite | 1790256627 | `acceptance-m1.json` mtime |
| M1 first-green | 1790256705 | `receipts-m1.jsonl` mtime (suite+choreo) |
| M2 suite | 1790256768 | |
| M2 first-green | 1790258680 | `receipts-m2.jsonl` |
| M3 suite | 1790258711 | |
| M3 first-green | 1790260473 | `receipts-m3.jsonl` after delivery-query fix |
| M4 start | 1790260706 | `run-log.md` |
| M4 first-green | 1790260873 | |
| M5 start | 1790260810 | |
| M5 first-green | 1790262346 | after upload-retry / background input |
| M6 start | 1790262410 | |
| M6 web first-green | 1790262457 | choreography offline queue |
| scale replay start | 1790262824 | own clock, fresh instance :56402 |
| scale replay end | 1790263612 | 788 s wall; verified |
| M8 suite | 1790262549 | overlapped scale clock |
| M8 first-green | 1790262613 | |
| report | 1790263622 | pre-shutdown |

`start=1790255108`

## Wall by milestone (start → first-green of that milestone)

| milestone | start epoch | first-green | wall s | status |
| --- | ---: | ---: | ---: | --- |
| M1 | 1790255108 | 1790256705 | 1597 | green |
| M2 | 1790256705 | 1790258680 | 1975 | green |
| M3 | 1790258680 | 1790260473 | 1793 | green |
| M4 | 1790260706 | 1790260873 | 167 | green |
| M5 | 1790260810 | 1790262346 | 1536 | green |
| M6 | 1790262410 | 1790262457 web / 1790263612 scale | 47 web + 788 scale | green |
| M7 | — | — | — | **not-run** (separate session; not attempted) |
| M8 | 1790262500 | 1790262613 | 113 | green |

No `capability-failure`, `aborted`, or `blocked-by-M{n}`. Two consecutive capability failures did not occur.

## Suite and choreography

| milestone | suite | coverage | choreography | receipts |
| --- | --- | --- | --- | --- |
| M1 | 7/7 `acceptance-m1.json` | `coverage-m1.json` | green | `receipts-m1.jsonl` |
| M2 | 22/22 `acceptance-m2.json` | `coverage-m2.json` | green | `receipts-m2.jsonl` |
| M3 | 7/7 `acceptance-m3.json` | `coverage-m3.json` | green (m3f) | `receipts-m3.jsonl` |
| M4 | 5/5 `acceptance-m4.json` | `coverage-m4.json` | green | `receipts-m4.jsonl` |
| M5 | 6/6 `acceptance-m5.json` | `coverage-m5.json` | green (m5d; color/background, view-once, warm-offline, disappearing) | `receipts-m5.jsonl` |
| M6 | 5/5 `acceptance-m6.json` | `coverage-m6.json` | green (offline queue) | `receipts-m6.jsonl` |
| M8 | 6/6 `acceptance-m8.json` | `coverage-m8.json` | green (insights like, second device, unread, dual-offline, dual receipts) | `receipts-m8.jsonl` |

Seeds: `npm run seed -- --segment m1|m2|m3` replayed starter logs; m4/m5/m6/m8 are idempotent no-ops (no extra starter segment).

Choreography: copied `instrument/choreography` into the lane; `CHOREO_BASE_URL=http://127.0.0.1:56401`. Instrument skip: the frozen copy imports `../metering` and `../../lib/json-schema.mjs` — local `metering/` and `choreography/json-schema.mjs` were added so the harness can run.

## Native artifacts

| artifact | path | status |
| --- | --- | --- |
| M1 iOS Hermes | `artifacts/m1-ios-hermes/` | produced |
| M2 iOS Hermes | `artifacts/m2-ios-hermes/` | produced |
| M3 iOS Hermes | `artifacts/m3-ios-hermes/` | produced |
| M4 iOS Hermes | `artifacts/m4-ios-hermes/` | produced |
| M5 iOS Hermes | `artifacts/m5-ios-hermes/` | produced |
| M6 iOS Hermes | `artifacts/m6-ios-hermes/` | produced |
| M8 iOS Hermes | `artifacts/m8-ios-hermes/` | produced |
| M6 iOS simulator | `simulator-status.json` | **unavailable/not-run** (no Xcode/simulators on this Linux host; a web/JS bundle is not native proof) |
| M8 iOS simulator | `simulator-status.json` | **unavailable/not-run** |

## Scale replay (own clock)

- start=`1790262824` end=`1790263612` wall=`788` seconds  
- instance: `npx snapback4@0.4.0 dev --port 56402 --bind 127.0.0.1 --fresh --replay --no-watch`  
- adapter: `scripts/replay.mjs` + `scripts/scale-replay.mjs`  
- actions: **167157** from `instrument/fixtures/scale.log` after starter m1–m3  
- verification vs invariant: `u0500` `followingCount` **500** (named O5); inbox page length 50 (query `first 50`). Receipt: `scale-replay-receipt.json` `ok: true`  
- first attempt failed `E_BOUND` at ~22725 (`chat.sendMessage`, examined-row ceiling 8192) because `expire at .expiresAt` on `messages` made unique ordinal inserts skip expired rows. Retry after dropping `expire at` (column kept). Attribution: **snapback4-defect** (bound × expiry interaction). Evidence: `logs/scale-replay.log`, `npx snapback4 why chat.sendMessage`

## Correction loops (attribution + evidence)

| loop | attribution | evidence |
| --- | --- | --- |
| `snapback4 init` vs non-empty lane | environment | `run-log.md` |
| Choreography imports not self-contained | environment (frozen harness) | `choreography/json-schema.mjs`, copied `metering/` |
| RN-web file input / feed crash | agent-error | `src/FileInput.tsx`, `src/FeedScreen.tsx` |
| Playwright semantic values on RN-web | agent-error | kit `data-value` / `aria-valuetext` patches |
| Expo CI no HMR | environment | repeated expo PID restarts on 56401 |
| M3 typing hide | agent-error | `src/ConversationView.tsx` 3.5s local hide |
| M3 deliveries `first 50 by .id` hid new acks | agent-error | `chat.messageDeliveries`; `logs/choreo-m3e.log` |
| M4 reaction write-id reuse on suite re-run | agent-error | `scripts/acceptance.mjs` |
| M5 background file + 429 `/assets` | agent-error + snapback4-defect (admission slots) | `logs/choreo-m5.log`, `npx snapback4 why E_RATE_LIMIT` |
| M5 ChatSettingsView hooks after early return | agent-error | `src/ChatSettingsView.tsx` |
| Scale `E_BOUND` 8192 on expiring unique ordinal | snapback4-defect | `logs/scale-replay.log`, schema drop of `expire at` |

## Resolved package pins

- `snapback4@0.4.0` (exact)  
- `snapback4-expo@0.4.0` (exact)  
- Expo 57.0.22, expo-router ~6.0.23, react 19.2.3, react-native 0.86.3  
- Binary: `SNAPBACK4_BIN` via `npx snapback4@0.4.0` (no Linux npm binary)

## Hand-authored line counts (wc -l)

| file | lines |
| --- | ---: |
| `src/ConversationView.tsx` | 526 |
| `scripts/acceptance.mjs` | 549 |
| `snapback/chat.q` | 353 |
| `snapback/schema.q` | 263 |
| `scripts/replay.mjs` | 221 |
| `src/ChatSettingsView.tsx` | 165 |
| `src/FeedScreen.tsx` | 161 |
| `scripts/lib.mjs` | 119 |
| `src/ChatRail.tsx` | 101 |
| `src/PostCard.tsx` | 98 |
| `app/chats.tsx` | 93 |
| `app/search.tsx` | 89 |
| `src/Shell.tsx` | 89 |
| `src/AuthScreen.tsx` | 82 |
| `app/_layout.tsx` | 69 |
| `API.md` | 58 |
| `scripts/scale-replay.mjs` | 58 |
| `app/insights.tsx` | 51 |
| `src/DeliveryAcker.tsx` | 45 |
| `src/FileInput.tsx` | 45 |
| `scripts/seed.mjs` | 43 |
| `src/client.ts` | 21 |
| `snapback/jobs.q` | 20 |
| `snapback/server.ts` | 14 |
| other `app/` + `src/` | remainder of 3962 |
| **sum listed tree** | **3962** |

Kit patches (not original kit authorship; lane edits): `vendor/social-ui/src/{ReceiptTicks,ChatSettingsForm,MessageBubble,FeedCard,Composer,Avatar,InsightsSummary,ChatListRow}.tsx` (~1827 lines in those files after patch).

## Server PIDs (this lane only)

| role | pid |
| --- | ---: |
| snapback4 :56400 | 856374 (parents 856367 / 856352 / 856348) |
| worker :56400 | 3025744 |
| Expo web :56401 | 2872757 |
| snapback4 scale :56402 | 3029710 |
| worker :56402 | 3029828 |

Killed only these PIDs at shutdown (no pkill/killall/pattern). Occupied ranges 56100–56319 and 56500–56919 were not used.

## Candid gap list

1. **Linux binary** — package has no Linux npm binary; harness `SNAPBACK4_BIN` required. Documented.  
2. **`expire at` × unique ordinal × E_BOUND 8192** — cannot insert the 10,000th message in `g0001` while `messages` expire-at is on. Dropped `expire at` to finish scale; disappearing then relies on `expiresAt` + client hide, not engine purge. Platform gap.  
3. **`connected[]` in emit loops** — extra examined rows; removed for scale. Push still logs (and over-notifies connected clients).  
4. **Asset admission 429** on `POST /assets` under concurrent browser fetches.  
5. **RN-web observability** — Playwright semantic channel is not `accessibilityValue.text`; kit nodes needed `data-value`/`aria-valuetext`.  
6. **Expo `--non-interactive`** disables HMR; every UI fix restarted :56401.  
7. **Apple simulators / Xcode unavailable** — M6/M8 native-simulator assertions not-run; Hermes exports are not native proof.  
8. **Choreography copy** is not self-contained (metering / AJV paths). Instrument skip.  
9. **`snapback4 init`** refuses non-empty dirs (instrument symlink).  
10. **Inbox `first 50`** cannot list u0500’s 100 conversations on one page; scale check used followingCount=500 plus a 50-row inbox page.  
11. **People directory `first 20`** — Dave add used a side `peopleSearch`.  
12. Tokens advisory-null for Grok (ENVIRONMENT.md).

## Status summary

M1–M6 and M8 **green**. M7 **not-run**. Scale replay **verified** on its own clock. Essay written before this tally.

end=1790263765
