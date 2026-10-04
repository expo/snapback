# Clique Convex lane — final report

lane id: grok-clique-convex-20260916
model: grok-4.6
effort: xhigh
backend: convex-1.45.0
host: Linux x86_64 (Hetzner AMD EPYC)
ports used: 55500 (Expo web), 55501/55502 (dev Convex cloud/site), 55503/55504 (fresh scale Convex)
CHOREO_BASE_URL: http://127.0.0.1:55500

## Raw epochs

start=1789580484

| milestone | start epoch | first-green epoch | end epoch | wall s | status |
|---|---|---|---|---|---|
| M1 | 1789582120 | 1789582360 | 1789582360 | 240 | green |
| M2 | 1789582370 | 1789583300 | 1789583300 | 930 | green |
| M3 | 1789583310 | 1789586260 | 1789586260 | 2950 | green |
| M4 | 1789586270 | 1789586500 | 1789586500 | 230 | green |
| M5 | 1789586510 | 1789589344 | 1789589344 | 2834 | green |
| M6 | 1789589344 | 1789589391 | (scale clock separate) | suite+web-choreo ~47s; scale own clock | green (web); scale verification below |
| M7 | — | — | — | — | not-run (fresh session later) |
| M8 | 1789589573 | 1789589680 | 1789589680 | ~107 | green |

Orientation (instrument + Convex CLI discovery) is inside the clock from `start` through M1 start (~1636 s).

## Suite and choreography

| milestone | suite | choreography | notes |
|---|---|---|---|
| M1 | pass (m1-a01..a11) | green | receipts/receipts-m1.jsonl |
| M2 | pass | green | receipts/receipts-m2.jsonl |
| M3 | pass | green | receipts/receipts-m3.jsonl |
| M4 | pass | green | receipts/receipts-m4.jsonl |
| M5 | pass (m5-a04..a11) | green 4/4 | receipts/receipts-m5.jsonl; disappearing waited real 180s TTL |
| M6 | pass (m6-a08..a13) | green | receipts/receipts-m6.jsonl; sample-50 on dev instance |
| M8 | pass (m8-a01..a07) | green 5/5 | receipts/receipts-m8.jsonl |

Seeds: `npm run seed -- --segment m1|m2|m3` idempotent via mutation clientIds.

## Correction loops (attribution)

1. choreography copy import `../metering` — environment — choreography.mjs
2. missing `babel-preset-expo`, JSX `createElement` — agent-error
3. feed `isDone` too early — agent-error
4. Expo Router `push` stacked home screens — agent-error
5. RN-web `accessibilityValue` not `aria-valuetext` — environment (RN-web)
6. Convex optional validators reject `null` — agent-error / convex-defect knowledge-gap — messages.send
7. group receipts waiting on members without presence — agent-error
8. M6-a13 `User not found` after profile-set changed handle — agent-error — replay-lib + userByHandle email fallback
9. Settings click intercepted by RN-web `absoluteFill` / Stack overlay — environment / agent-error — Slot + native button
10. Metro stale dual `sm-chatsettings-background-preview` — environment — `expo start --clear`
11. Offline search missed `Coffee after work?` (history page 80 + lingering 24h disappearing) — agent-error
12. Avatar Image identity not observable for M8 like targeting — environment (RN-web)

## Native artifacts

Attempted. Apple simulators and Xcode are unavailable on this Linux host.

Hermes iOS JS bundles (not native proof):

- artifacts/m1-ios/_expo/static/js/ios/entry-9f9b6d489ea35c09a969a16cbced1745.hbc
- artifacts/m2-ios/_expo/static/js/ios/entry-7092933442161d37e2b00f5da5dee237.hbc
- artifacts/m3-ios/_expo/static/js/ios/entry-9cde6e74c8489aff6ba2a5605b16608e.hbc
- artifacts/m4-ios/_expo/static/js/ios/entry-3bc6f41c36087e5832b00e1ea0b152ed.hbc
- artifacts/m5-ios/_expo/static/js/ios/entry-34401d6f7ad1a8685ab8958035309fd1.hbc
- artifacts/m6-ios/_expo/static/js/ios/entry-599282639177a3cce0f5de6d61df2800.hbc
- artifacts/m8-ios/_expo/static/js/ios/entry-599282639177a3cce0f5de6d61df2800.hbc

M6/M8 simulator proofs: `coverage/simulator-status.json` `pass: null` / not-run. A web build is not native proof.

## Scale replay

Own clock, fresh anonymous Convex (ports 55503/55504, sqlite under `scale-instance/.convex/local/default/`), starter m1+m2+m3 then `scale.log` with `replayMode: true`.

- scale start=1789589530
- scale end=PENDING
- verification against `instrument/fixtures/invariant-manifest-combined.json`: PENDING

## Resolved package pins

- convex@1.45.0
- expo@~54.0.0 / expo-router@~6.0.0
- react@19.1.0 / react-native@0.81.4 / react-native-web@^0.21.0
- babel-preset-expo@~54.0.10
- bcryptjs@^2.4.3 (cost 10)
- playwright@1.62.1 (choreography)
- Node v24.13.1 (PATH); ENVIRONMENT.md named 24.18.0

## Hand-authored line counts (approx, excluding node_modules/instrument)

See `wc` snapshot in run-log. Principal files:

- convex/messages.ts ~925
- scripts/acceptance.mjs ~708
- src/ConversationView.tsx ~594
- convex/posts.ts ~423
- scripts/replay-lib.mjs ~356
- app/index.tsx ~287
- convex/schema.ts ~260
- convex/lib.ts ~231
- plus remaining convex/, app/, src/, scripts/, config/, diaries

Vendored UI kit (`ui/src`) was edited in-place for RN-web observability (`dataSet` / `data-value` / `aria-pressed`).

## PIDs (kill only these at end)

- Expo wrapper 1731117, worker 1731141 (55500)
- Dev Convex wrapper 1495288, backend 1495327 (55501/55502)
- Scale Convex wrapper 1726814, backend 1726994 (55503/55504)
- Scale replay 1727788

## Candid gaps

- Apple/Xcode simulator proofs not run (environment).
- Convex queries do not re-run on wall-clock; disappearing/typing/presence are read-time + client timers.
- Auth is hand-rolled bcrypt, not a Convex product.
- Scale replay is an HTTP firehose; duration is the mutation loop, not schema.
- Metro stale bundles required `--clear` restarts.
- Optional choreography checks are fail-closed; 24h disappearing needed a 190s wait matching `windows.json` ttlSeconds=180.
- No hosted Convex project; anonymous local only.

end=PENDING
