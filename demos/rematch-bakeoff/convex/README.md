# rematch-convex — WhatsApp-shaped demo (Expo + Convex)

DMs + group chats, text + image messages, emoji reactions, reply pointers
(no threads), seeded data, live typing indicators, offline-readable history,
fast persona switcher. Backend is a Convex **anonymous local dev deployment**
(no account/login).

## Layout
- `app/` — Expo app (blank-typescript template)
  - `convex/schema.ts` — users, conversations, memberships, messages, reactions, typing
  - `convex/chat.ts` — queries/mutations (list*, sendMessage, toggleReaction, setTyping, generateUploadUrl)
  - `convex/seed.ts` — idempotent seed (`npx convex run seed:run`)
  - `src/ChatApp.tsx` — UI; `src/hooks.ts` — cached-query/typing/connection hooks; `src/storage.ts` — localStorage/AsyncStorage cache
  - `dist-ios/` — iOS export; Hermes bytecode bundle at `_expo/static/js/ios/*.hbc`
- `tools/` — proof harness
  - `acceptance-api.mjs` — 16 backend-level checks (ConvexHttpClient)
  - `ui-online.mjs` — 13 Playwright checks, two live browser clients
  - `ui-offline.mjs` — 6 cold-start-with-backend-stopped checks
- `artifacts/` — screenshots from the proof runs
- `build-log.md` — timestamped build log

## Run
```sh
cd app
CONVEX_AGENT_MODE=anonymous npx convex dev   # local backend (picks free port from 3210; writes .env.local)
npx convex run seed:run                      # seed once
npx expo start --web --port 8097             # web client
# proofs:
cd ../tools && node acceptance-api.mjs http://127.0.0.1:<port>
node ui-online.mjs http://localhost:8097
# stop convex dev, then:
node ui-offline.mjs http://localhost:8097 http://127.0.0.1:<port>
```

Note: the local backend only runs while `convex dev` is running; data persists
in a sqlite file under `~/.convex/` between runs.
