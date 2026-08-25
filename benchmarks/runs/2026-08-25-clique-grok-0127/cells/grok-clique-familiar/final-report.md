# Final report — grok-clique-familiar

lane id: grok-clique-familiar  
model: grok-4.6  
effort: xhigh  
backend: snapback-familiar-0.1.27  
instrument: social-messenger@0.3.3-m8  
authoringProfile: snapback-familiar-ts-v1  

## Raw epochs

| mark | epoch (unix s) | UTC |
| --- | --- | --- |
| start | 1787656057 | 2026-08-25T11:07:37Z |
| first-product-edit | 1787656359 | 2026-08-25T11:12:39.000Z |
| M1 start | 1787656359 | 2026-08-25T11:12:39Z |
| M1 green | 1787658472 | 2026-08-25T11:47:52Z |
| M2 start | 1787658472 | 2026-08-25T11:47:52Z |
| M2 green | 1787660019 | 2026-08-25T12:13:39Z |
| M3 start | 1787660200 | 2026-08-25T12:16:40Z |
| M3 suite first-green | 1787660835 | 2026-08-25T12:27:15Z |
| M3 green (suite+choreo) | 1787662000 | 2026-08-25T12:46:40.787Z |

Orientation closed by `first-product-edit.json` (`at=2026-08-25T11:12:39.000Z`, `orientationBytes=14893`, `selectedSkills=[snapback-authoring]`).

## Wall by milestone

| milestone | start epoch | green epoch | wall (s) | notes |
| --- | --- | --- | --- | --- |
| M1 | 1787656359 | 1787658472 | 2113 | includes first generate + first lifecycle owner |
| M2 | 1787658472 | 1787660019 | 1547 | includes Metro restart after generate |
| M3 | 1787660200 | 1787662000 | 1800 | includes Metro restart + typing correction loop |
| M1–M3 inclusive | 1787656359 | 1787662000 | 5641 | from first-product-edit to M3 green |
| lane start→M3 green | 1787656057 | 1787662000 | 5943 | includes orientation |

## First-green times

- M1 first-green (suite + required choreography): 1787658472
- M2 first-green (suite + required choreography): 1787660019
- M3 suite first-green: 1787660835 (`receipts/m3/suite.json`)
- M3 choreography first-green: 1787662000 (`receipts/m3/choreography.jsonl` runId `eea4eabf-b2be-4a8c-87d8-e1eecdc1415b`)
- M3 milestone first-green (conjunction): 1787662000

## Schema successor identities (one additive chain, no reseed)

M1 schema `snapback.v1:sessions:schema:sha256:4969b7142ec9fbec19aa4f71f48b183cb611d222dbeb2f78e4b5fdff02f608bf`  
functions `sha256:a70acf078c8ca935224bf5decdc3ee8139049569db7ac5a273209bf5e6305f1d`

M1→M2 schema `…4969b714…` → `snapback.v1:sessions:schema:sha256:2000d509c58f2a1d4ffa7bb5d2a88787ec9bd6e115d316208464edb474b33337`  
functions `…a70acf07…` → `sha256:cb2724f9fc702d8fac15078e7ae78d647a32936f1f1a2acd0c847ba8a9376dda`

M2→M3 schema `…2000d509…` → `snapback.v1:sessions:schema:sha256:77ba0eacd96b42f6e0e5db3789d62547c4076c838296ebd697afe8ebb2d153c1`  
functions `snapback.v1:sessions:function:sha256:51f07610751d2b64567eb75859b7496099177a2aba2484e7f84521facfe14127`

Same `clique/.snapback/dev.sqlite3` across restarts. Original account / session / application rows retained.

## Suite and choreography

Entrypoint: `npm run acceptance -- --milestone mN` (lane `package.json` → `node clique/scripts/acceptance.mjs`). Starter logs replayed through app write path (`clique/scripts/replay.mjs`). Choreography: `CHOREO_BASE_URL=http://127.0.0.1:48119` via `scripts/run-choreography.mjs` (realpath of instrument harness + ESM alias; instrument dir is not writable for npm install).

| milestone | suite | choreography | green | nonGreenCause |
| --- | --- | --- | --- | --- |
| M1 | pass `receipts/m1/suite.json` required m1-a01,a02,a03,a04,a08,a10,a11 | `receipts/m1/choreography.jsonl` green=true | true | null |
| M2 | pass `receipts/m2/suite.json` required 22 ids in coverage-manifest | `receipts/m2/choreography.jsonl` required 7/7 passed, 2 optional skipped (image/video compose) | true | null |
| M3 | pass `receipts/m3/suite.json` required m3-a03,a04,a05,a10,a11,a14,a15 | `receipts/m3/choreography.jsonl` required 2/2 passed (dm-live-messages, typing); quoted-reply optional passed; 4 skipped unimplemented (avatar, receipts, group-receipt, member-removal) | true | null |

Frozen harness skips (not required): M2 image/video compose; M3 sender-avatar, semantic receipts, group aggregate receipt, member-removal/history. Not relabeled.

Native iOS Simulator / Xcode / Hermes: **environment-null** on this Linux x86_64 host (out of scope; not a failed product proof).

## Correction loops

| window | attribution | evidence | what |
| --- | --- | --- | --- |
| M1 | snapback-defect | supervised mint; `EXPO_PUBLIC_SNAPBACK_URL` absent | SessionGate signOut → `SNAPBACK_AUTH_SESSION_EXPIRED`. Workaround: URL-first `SnapbackProvider` from supervisor bootstrap origin. |
| M1 | agent-error | choreography saved empty handle | Profile editor mounted before `getMine`. Wait for profile then init form. |
| M1 | environment | `import.meta.url !== argv[1]` on instrument symlink | `scripts/run-choreography.mjs` realpath + ESM alias for playwright. |
| M1 | environment | inherited `CI=true` | Unset for lifecycle owner (`env -u CI`). |
| M2 | snapback-defect | expo-dev log `SNAPBACK_EXPO_METRO_EXITED` | Metro watch ENOENT on codegen `.tmp-*`. Restart same `snapback dev` on existing sqlite. |
| M2 | agent-error | thread compose fill timeout; 54 stacked feeds | FlatList hidden on RN-web; `router.push`; FeedTabs missing off feed. ScrollView+map, `router.replace`, tabs in AppChrome. |
| M2 | agent-error | m2-a11 | Bob still followed Dave from seed; suite uses Frank as unfollowed author. |
| M3 | snapback-defect | Metro exit after M3 generate | Same owner restart, no reseed. |
| M3 | agent-error | package types vs `@expo/snapback-expo` facade | Activity presence requires Expo lifecycle; URL-first provider does not provide it. Use `@expo/snapback-react`. |
| M3 | agent-error | disabled `sm-convo-send` | Document listeners + `touch()` force-rendered controlled composer. Isolated `TypingLayer`. |
| M3 | agent-error | typing visibleMs 2.3–2.7s vs 2000ms | Every `touch()` bumped presence generation (canceled in-flight publish); ConversationScreen setState rerendered AppChrome so `pressSequentially` of a 45-char run id took ~2722ms (already over ceiling). Publish-once + isolated `MessageComposer` (~1431ms type, visibleMs ~1261ms). |

## Package / runtime pins

- `@expo/snapback-cli` 0.1.27 (public npm)
- `@expo/snapback-client` / `codegen` / `react` / `expo` / `acceptance` 0.1.27
- `@expo/snapback-runtime-linux-x64` 0.1.27 (`sha256:8477a11d404b504321821f1d026212102efaf4a15afb965866c808732aa6fc3a` from application-ready receipt)
- Expo SDK ~57.0.7, expo-router ~57.0.16, react 19.2.3, react-native-web ^0.21.2
- `@snapback-bench/social-ui` file: instrument UI kit 0.3.1-m8 (contracts unchanged)
- playwright 1.62.1 (lane `node_modules`, not instrument dir)
- `clique/snapback/codegen.policy.json`: `"authoringProfile": "snapback-familiar-ts-v1"`
- Generated output: `clique/snapback/generated/` (not `_generated/`)
- Ports: backend 48100, metro 48117, supervisor bootstrap 48118, expo web 48119 (block 48100–48119)
- Lifecycle owner (final): pid 2118533, command `env -u CI snapback dev snapback --expo --expo-platform web --port 48100 --port-range 48100-48119 --json`, backend 2118625, metro 2118790, `formatVersion: snapback.application-ready.v1`

No wrapper/environment script, no `snapback start --startup-artifacts` from the agent, no hand-authored binding `.env`, no custom relay, no destructive reseed.

## Source-inspection events

No Snapback/Exact repository checkout and no sibling-lane inspection.

Read published package shipped files (allowed; recorded):

- `@expo/snapback-react` `familiar.mjs`, `index.d.mts`, `implementation.mjs` (`useSnapbackActivityPresence` generation fence, `touch`/`idleMs`)
- `@expo/snapback-expo` `activity-presence.mjs` (gated lifecycle; rejected for URL-first provider)
- runtime-readiness / application-ready receipts from the running published binary

Served guide + packaged expo-chat start packet + CONTRACT.md / assertions.json / choreography README used as primary docs (see run-log knowledge-lookup lines).

## Candid gap list

1. Supervised Expo web does not inject `EXPO_PUBLIC_SNAPBACK_URL` but does mint a session; familiar + SnapbackExpoProvider is a footgun for password UI.
2. `snapback generate` under `snapback dev --expo` can kill Metro (`SNAPBACK_EXPO_METRO_EXITED` on codegen tmp ENOENT). Owner must be restarted; not documented as a normal successor step.
3. Guide/start packet still mention `_generated/`; 0.1.27 refuses it.
4. Activity presence is split across `@expo/snapback-expo` (gated) and `@expo/snapback-react` (ungated). Familiar page does not say which to import for URL-first web.
5. `touch()` is generation-fenced; per-keystroke publish cancels the previous wire attempt.
6. Frozen typing choreography measures appearance from the start of `pressSequentially(\`typing-${uuid}-n\`)`. A full-tree React re-render per key makes that interval exceed 2s even if the indicator is already on screen. The check is implementable only if the composer is cheap to update.
7. No contract test ID for navigating to chats; the app keeps `sm-chats-item` visible in chrome so the harness can find Bob/Alice from the feed.
8. Conversations/members/messages are `public-read` for query reachability; not a production ACL.
9. Receipt ticks, group aggregate receipts, and admin remove-member are skipped by the frozen web harness (no honest selectors); suite covers non-admin `NOT_ADMIN` only.
10. Native Simulator/Xcode/Hermes: environment-null on this host.

## Lifecycle close

Owner pid 2118533 closed with SIGINT to that process only (no pkill/killall/pattern kills). Children (runtime 2118625, Metro 2118790) exited; ports 48100–48119 clear.

end=1787662178
