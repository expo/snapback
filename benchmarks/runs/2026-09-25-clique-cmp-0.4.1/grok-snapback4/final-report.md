# Final report — grok-clique-snapback4-20260925

lane id: grok-clique-snapback4-20260925  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.4.1 + snapback4-expo@0.4.1  
host: Linux x86_64, node v24.13.1 (`/home/ccheever/.local/bin/node`; ENVIRONMENT named 24.18.0)  
SNAPBACK4_BIN: `/home/ccheever/.cache/clique/snapback4-0.4.1/snapback4`  
ports: 56400 (app snapback4), 56401 (Expo web), 56402 (scale replay, isolated)

start=1790309524

## Wall clocks (epoch seconds)

| Clock | start | end | seconds |
|---|---|---|---|
| Lane | 1790309524 | see `end=` below | (end − start) |
| Scale replay (own clock) | 1790327215 | 1790328473 | 1258 |
| M7 | n/a | n/a | not-run (orchestrator session) |

Approximate milestone walls from `run-log.md` (orientation included in M1; later milestones overlap because M3 stayed open while M4–M8 ran):

| Milestone | first suite pass (epoch) | choreography green? | notes |
|---|---|---|---|
| M1 | 1790311015 | yes | first green proof |
| M2 | before 1790315463 | yes | |
| M3 | suite pass by 1790315463 | no | capability-failure (choreography) |
| M4 | suite pass by 1790315463 | 1790322500 | |
| M5 | suite pass by 1790315463 | 1790324300 | |
| M6 | suite pass recorded | yes (offline flush) + scale replay 1790327215–1790328473 | |
| M7 | — | — | not-run |
| M8 | suite pass recorded | 1790328016 | |

first-green (M1 suite): 1790311015

Tokens: source=null (harness does not expose a per-lane meter for grok). input=null output=null.

## Milestone status

| Milestone | status | suite | choreography | native |
|---|---|---|---|---|
| M1 | green | pass | pass (3/3) | Hermes iOS bundle in `artifacts/ios-hermes-m1/` (real export) |
| M2 | green | pass | pass (9/9) | Hermes iOS bundle `artifacts/ios-hermes-m2/` (real export) |
| M3 | capability-failure | pass | fail (dm-live pass; typing, delivered, group live, member live-cutoff fail; quote optional fail) | placeholder copy of m1 bundle |
| M4 | green | pass | pass (photo, video, reaction, edit, delete) | placeholder copy of m1 bundle |
| M5 | green | pass | pass (color/background, view-once, warm-offline search, disappearing) | placeholder copy of m1 bundle |
| M6 | green | pass | pass (offline-message-queue-flush-in-order) | placeholder copy; iOS simulator not-run |
| M7 | not-run | — | — | separate session |
| M8 | green | pass | pass (insights like refresh, same-account live, cross-device read, dual-offline) | placeholder copy; iOS simulator not-run |

Green bar definition used: `npm run acceptance -- --milestone mN` plus choreography with `CHOREO_BASE_URL=http://127.0.0.1:56401`. Both required. M3 suite alone is not green.

## Choreography receipts

- `artifacts/receipts-m1.jsonl` … `receipts-m8.jsonl`
- `artifacts/suite-status.json` — m1–m6 and m8 suite pass
- `artifacts/coverage.json` — merged m1–m6 and m8 assertion ids
- `artifacts/setup-identity.json`
- `artifacts/simulator-status.json` — iOS simulators unavailable on Linux x86_64; not faked
- `artifacts/scale-replay-receipt.json` — pass, settledPrefix=167157, failedActions=0

## Scale replay

Isolated instance: snapback4 `--port 56402 --replay --no-watch` in `scale-run/`.  
Adapter: `scripts/scale-replay.mjs` (do not pass fixture mutation ids; `mintId()`).  
Checkpoints: 10% settledPrefix=24777, 50% settledPrefix=88057, bound to combined manifest prefix SHAs.  
`snapback4 sql` counts vs `fixtures/invariant-manifest-combined.json`: profiles 1008, follows 5921, posts 50228, likes 5008, reposts 1004, conversations 1002, memberships 2054, messages 100015, reactions 2000. Match.

## Correction loops (selected)

| attribution | summary | evidence |
|---|---|---|
| agent-error | CHOREO_PASSWORD missing; per-persona env required | run-log 1790316400 |
| agent-error | markRead interval starved send/typing | run-log 1790316900 |
| agent-error | ConversationScreen broken ternary; no bubbles | expo-web TransformError:425 |
| agent-error | Dave overlay faked `dave:member` before add landed | receipts-m3 member-add |
| agent-error | scale seed passed fixture mutation ids → E_WRITE_ID | scale-replay.log |
| agent-error | FeedItem `liked` undeclared; insights 3→3 | receipts-m8 m8-a02 |
| agent-error | document input listener wiped controlled composer | receipts-m3 sm-convo-send timeout |
| agent-error | `typingNames` used before initialization | expo-web ReferenceError |
| ambiguous | membersOf not invalidating on peer watermark | chatFocus workaround |
| environment | Linux, no Xcode/iOS simulator | simulator-status.json |
| environment | servers SIGTERM across compaction | run-log 1790320276 |

## Resolved pins

- snapback4@0.4.1 (sha256 in setup-identity.json)
- snapback4-expo@0.4.1
- expo 57.0.22, react 19.2.3, react-native 0.86.3
- playwright 1.62.1 chromium
- choreography 0.3.6-m8, UI kit 0.3.2-m8

## Hand-authored lines (generated `snapback/generated/**` excluded)

44 files, 4074 lines. Largest: `src/ConversationScreen.tsx` 683, `snapback/schema.q` 640, `scripts/acceptance.mjs` 426, `src/ChatSettingsScreen.tsx` 317, `scripts/seed.mjs` 290, `src/FeedScreen.tsx` 259. Shared UI kit under `kit/` not counted as lane-authored.

## Builder dimension scores (after essay; B8 null because M7 not-run)

Holistic (recorded before any weighted total): **68**. Moments: (1) unique likes + count views + expire-at compiled on first check; (2) scale replay sql counts matched the manifest exactly; (3) two-client typing/receipts/new-member live send never stayed inside the harness windows despite the node client proving `setTyping`/`typingNow`.

| dim | score | note |
|---|---|---|
| B1 schema | 80 | Quarry expressed chats, feeds, aggregates, expiry |
| B2 auth | 85 | password identity + unique handle |
| B3 realtime | 55 | live DMs yes; typing/receipts/presence costly |
| B4 offline authoring | 80 | replica + replay, little queue code |
| B5 media | 75 | upload/`once`; RN-web preview hacks |
| B6 search | 70 | matching + warm-offline |
| B7 push/digest | 65 | `emit notify`; digest schema present |
| B8 day-2 | null | M7 not in this session |
| B9 DX | 70 | guide cards good; receipt recipe missing |
| B10 diagnostics | 65 | `why` codes; live invalidation opaque |
| B11 operations | 75 | `sql`/`data`/`dev --replay` |

No overall weighted total: B8 is null (applicability).

## Native artifacts

- Real Hermes iOS export for M1 and M2 under `artifacts/ios-hermes-m{1,2}/`
- M3–M6 and M8 directories are copies of the M1 bundle (Linux; no iOS toolchain). Not claimed as simulator proofs.
- Simulator assertions: not-run, reason recorded, `requiredForGreen: false`

## Gap list

1. M3 choreography not green: typing 2s/5s, DM delivered watermark after Playwright offline, group live bubble for Bob, live send to a newly added Dave, optional quote jump.
2. `connected[p]` observed false for HTTP clients; web replica presence was not a reliable “delivered” signal.
3. Kit member row ids are principals; handle-level `dave:member` needed overlays that then raced the real add.
4. Insights like increment required `likedByMe` plus committed toggle; feed `liked` field from the page query was easy to leave unwired.
5. No iOS simulator; M8 durable-queue-after-relaunch native assertion not run.
6. Coverage file had been last-write for m5/m6/m8 only; restored merged m1–m8 mapping at finalization.
7. Expo RN-web file inputs and `aria-valuetext` needed DOM shims the kit README does not mention.

end=1790331460
