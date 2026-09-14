# Clique / Snapback 4 — final report

lane id: grok-clique-snapback4-full-20260913  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.2.6  
host: macOS arm64  

## Clock

| event | epoch (unix seconds) |
| --- | --- |
| start | 1789333935 |
| M1 verification start | 1789336011 |
| M1 first green (suite+choreo) | 1789336500 |
| M2 start | 1789336800 |
| M2 first green (suite+choreo) | 1789337500 |
| M3 start (after M2 green) | 1789337500 |
| M4 suite pass | ~1789345800 |
| M5/M6/M8 suite pass | ~1789345850 |
| scale replay start | 1789346150 |
| report close | 1789346317 |

Wall (approx., from those epochs):

| milestone | wall | first-green | status |
| --- | --- | --- | --- |
| M1 | ~500s verification after setup | 1789336500 | green |
| M2 | ~700s | 1789337500 | green |
| M3 | >2h correction on live DM/choreo | suite only | capability-failure (choreography not green; suite passed) |
| M4 | suite minutes | suite 1789345800 | blocked-by-M3 (web choreo shares live conversation shell) |
| M5 | suite minutes | suite pass | blocked-by-M3 |
| M6 | suite minutes; scale replay started 1789346150 | suite pass | blocked-by-M3 for web choreo; scale replay incomplete |
| M8 | suite minutes | suite pass | blocked-by-M3 |
| M7 | — | — | not-run (separate fresh session) |

M3 was not a platform “cannot express” failure: HTTP `send` works, and one earlier choreography pass delivered live DM text and typing. Required Playwright checks later stayed red (live bubble visibility, typing render, delivered receipts, group receipts). Suite remained green.

## Package pins

- snapback4@0.2.6  
- snapback4-expo@0.2.1  
- Expo 54.0.37 / expo-router ~6.0.21 / React 19.1.0 / RN 0.81.5  
- instrument social-messenger@0.3.8-m8, UI kit vendored 0.3.3-m8, choreography 0.3.8-m8  

## Correction loops (attribution)

| loop | attribution | evidence |
| --- | --- | --- |
| M1 FeedScreen `usePage` without provider | agent-error | choreo miss; RequireAuth + AuthForm on `/` |
| M1 logout left `/settings` without auth/tabs | agent-error | RequireAuth on settings; `router.replace('/')` after login |
| digestAcc insert `E_RULE` | agent-error | follower could not read followee accumulator; `read <- allow` |
| M2 tabs missing on profile | agent-error | AppChrome persistent FeedTabs |
| M2 thread used `sm-convo-input` | agent-error | Composer `variant="post"` on thread |
| send `E_RULE` on unreads unique clash | agent-error | writer cannot read counterpart unread; membership-scoped read/sync |
| digestHits / digestMsgHits / digestChatHits hidden unique | agent-error | `read <- allow` so `insert if absent` works |
| client minted extra DM ids | agent-error | `useDmId` + `dmByPair`; ignore `createDm` HTTP result (`Write` has no payload) |
| pingTyping 5s TTL vs 5s choreo ceiling | agent-error | TTL 2500ms |
| Dave already admin in Weekend Plans | agent-error | prior partial membership check; removeMember before addable |
| ConversationView JSX / Metro overlay | agent-error | ScrollView/View mismatch; live DMs timed out on stale bundle |
| iOS Hermes private fields | environment / platform gap | hermesc `private properties are not supported` (`#x/#y/#width/#height`) |
| `createDm` reused id not on `useMutation` Write | snapback4-defect (API shape) | `Write` is pending/sent/failed only; HTTP `result.id` exists |

## Suite and choreography

| milestone | suite | coverage | choreography |
| --- | --- | --- | --- |
| M1 | pass `receipts/suite-m1.json` | `coverage-m1.json` | green `choreo-m1.jsonl` |
| M2 | pass `suite-m2.json` | `coverage-m2.json` | green `choreo-m2.jsonl` |
| M3 | pass `suite-m3.json` (m3-a03,a04,a05,a10,a11,a14,a15) | `coverage-m3.json` | not green; last summary 1/6 implemented passed (`member-add-…`); required live DM/typing/receipts failed. `choreo-m3.jsonl` |
| M4 | pass `suite-m4.json` | `coverage-m4.json` | not-run (blocked-by-M3 live conversation) |
| M5 | pass `suite-m5.json` | `coverage-m5.json` | not-run |
| M6 | pass `suite-m6.json` (incl. custom-client demo, sample-50 replay) | `coverage-m6.json` | not-run |
| M8 | pass `suite-m8.json` (insights, trending) | `coverage-m8.json` | not-run |

Choreography env: `CHOREO_BASE_URL=http://127.0.0.1:49301`, `CHOREO_LANE_RUN_ID=grok-clique-snapback4-full-20260913`.

## Native artifacts

- Attempted `expo export --platform ios` into `dist/ios-m1` and `dist/ios-m8`.  
- Hermes compile fails on private class fields in the RN/DOM graph.  
- Assets copied (`clique-logo.png`, `snapback4_device_bg.wasm`, `video-poster.png`) are not a valid iOS Hermes bytecode bundle.  
- Simulator proofs not required; native usage settlement is this failed export, recorded as platform gap.  
- `snapback4-expo@0.2.1` is imported only on native via `require` in `lib/client.tsx`; `snapback4/web` is lazy-imported on web.

## Scale replay

- Fresh instance: `npx snapback4 dev --port 49302 --no-watch --fresh` (PID 84767).  
- Adapter: `scripts/scale-replay.mjs` + `scripts/replay-actions.mjs` against `fixtures/scale.log` (167157 actions, sha in `fixtures/scale-log.sha256`).  
- Clock: start=1789346150.  
- Identity rate limit is 30/socket/min; register is paced ~2.1s. Full log cannot finish inside remaining session wall (registers alone ~35 minutes, then 166k mutations).  
- Verification against `fixtures/invariant-manifest-combined.json` (1008 users, 100015 messages, …): **not completed**. No passing fixture-bound receipt at report close.  
- First unpaced attempt hit `E_RATE_LIMIT` on `register` (lines 31, 62, 93); attribution environment + adapter (need backoff).  

## Ports and PIDs (this lane only)

| role | port | PID |
| --- | --- | --- |
| snapback4 live | 49300 | 89010 |
| Expo web | 49301 | 66487 |
| push-worker | — | 19481 |
| snapback4 scale `--fresh` | 49302 | 84767 |
| scale-replay node | — | (child of scale-replay start 1789346150) |

Killed at end: only these PIDs (no pkill/killall). Occupied ports outside 49300–49319 were not used.

## Hand-authored line counts (approx., excluding generated, node_modules, instrument, choreography vendor, UI kit)

| file | lines |
| --- | --- |
| snapback/schema.q | 926 |
| scripts/acceptance.mjs | 579 |
| components/ConversationView.tsx | 577 |
| lib/client.tsx | 203 |
| scripts/replay-actions.mjs | 209 |
| app/(tabs)/index.tsx | 185 |
| components/ChatSettingsScreen.tsx | 152 |
| scripts/api.mjs | 129 |
| components/WebConvoSurface.tsx | 125 |
| others (app routes, lib, scripts) | ~1600 |
| **schema + app/lib/components/scripts (deduped ~)** | **~4600–4750** |

`snapback/generated/api.ts` is compiler output (not hand-authored). UI kit under `ui/` is vendored instrument.

## Candid gaps

1. Required M3 (and thus M4–M8) web choreography not green: live `sm-convo-bubble` visibility after send, typing within 2s, delivered receipts, group aggregate read. HTTP send and suite assertions pass.  
2. `Write` from `useMutation` has no mutation result; DM reuse must be queried.  
3. Unique clash on unreadable rows is `E_RULE` (documented); unread/digest hit tables need member-visible or public read.  
4. Auth rate limits vs four-persona Playwright + HTTP suite + 1000-user scale log.  
5. iOS Hermes export blocked by private fields.  
6. Scale replay not finished; invariant manifest not checked.  
7. Digest job is scheduled every 2m from shortened config; push-worker consumes `emit push`; not fully proven in choreography.  
8. Conversation replica can fork a second DM if `dmIndex` is not yet local; `useDmId` delays create but existing dirty replicas remain.

end=1789346383
