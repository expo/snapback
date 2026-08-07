# Rematch — WhatsApp-shaped messaging demo on Snapback (published npm packages only)

DMs + group chats, text + image messages, emoji reactions, reply pointers
(no threads), seeded data, live typing indicators, offline-readable history,
fast test-persona switcher. Expo (React Native) client; backend is Snapback
`@expo/snapback-*@0.1.10` from npm — no framework source checkout used.

## Layout

- `backend/rematch/snapback/` — schema.mjs / functions.mjs / seed.json (sessions auth mode,
  5 tables, 5 live queries, 2 JS mutations, 1 image upload intent, 1 typing ephemeral collection)
- `backend/rematch/rematch-acceptance.mjs` — headless scripted acceptance (9 checks)
- `app/` — Expo app (web + native from one codebase). `app/sync-api.mjs` copies the
  generated client artifacts from the backend (strips JSON import attributes for Metro).
- `broker.mjs` — trusted-local dev persona broker (mints sessions via `snapback session mint`)
  + a CORS-permissive dev relay on :8789 (browser TUS uploads are CORS-blocked against the
  server directly; this plays the same role as `@expo/snapback-vite`'s relay).
- `ui-proof.mjs` — 10-step Playwright/Chrome interaction proof (two clients).
- `offline-prime.mjs` / `offline-verify.mjs` — offline cold-start proof.
- `artifacts/` — screenshots + test image; `build-log.md` — timed build log.
- `app/dist-ios/` — iOS Hermes bytecode export (`expo export --platform ios`).

## Run

```sh
# 1. backend (sqlite db + ready file under run/)
cd backend/rematch && npx snapback dev snapback \
  --ready-file ../../run/dev.ready.json --db ../../run/dev.sqlite3

# 2. persona broker + relay
node broker.mjs

# 3. Expo client (web)
cd app && npx expo start --web --port 8095

# proofs
node backend/rematch/rematch-acceptance.mjs
node ui-proof.mjs
node offline-prime.mjs && <stop backend> && node offline-verify.mjs
```

Personas: Ada / Grace / Kai (top bar chips; each switch mints a fresh ordinary
session through the broker — never embed broker/admin material in a real bundle).
