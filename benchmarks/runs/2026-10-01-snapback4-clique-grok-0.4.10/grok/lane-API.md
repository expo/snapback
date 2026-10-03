# Clique custom-client API (Snapback 4)

Backend: `snapback4@0.4.10`. Protocol is Snapback's native HTTP + replica, not REST.

## Base URL

Local development: `http://127.0.0.1:49360` (this lane). Set `SNAPBACK_URL`.

## Authentication

Password identity (`use identity`).

```js
import { login, signup, logout } from "snapback4/auth";
import { createClient } from "snapback4/client";

const result = await login(url, email, password);
// result.session = { principal, kind: "user", token, expiresAt }
const client = createClient({ url, session: result.session });
```

Sessions last seven days. `logout(url, token)` revokes the current session; `logoutAll` revokes every session for the principal. Tokens are per-user, expire, and die with logout.

## Operations

Generated handles live in `snapback/generated/api.ts` after `npx snapback4 check`.

| Need | Handle |
|---|---|
| Who am I | `api.whoAmI` |
| List conversations | `api.inbox` `{ c }` |
| Page history | `api.history` `{ conversation, c }` |
| Send text | `api.send` `{ id, conversation, text }` |
| Live receive | `client.observe(api.history, { conversation, c: null })` |

Receive is streaming via Snapback `/changes` (observe). Polling is `client.query` on an interval.

## Message object (history rows)

Each history row includes: `id`, `conversation`, `sender`, `at` (server timestamp), `text` / `caption`, `photo` / `oncePhoto` / `video` media references, `editedAt` (edited flag), `tombstone`, `quote` (reply-to id). Receipts: `api.messageReceipts`. Reactions: `api.messageReactions` / `api.reactionChips`.

## Demo

```
SNAPBACK_URL=http://127.0.0.1:49360 node scripts/custom-client-demo.mjs
```
