# Clique custom-client API

Clique's backend is Snapback 4. Third-party clients use the native Snapback protocol over HTTP. REST is not required.

## Base URL and identity

- Development: `http://127.0.0.1:56400`
- Identity: `use identity password`. Sessions last seven days.

Signup and login:

```js
import { signup, login } from "snapback4/auth";
const result = await login(url, email, password);
// result.ok ? result.session : result.why
```

`session` is `{ principal, kind, token, expiresAt }`. Send `Authorization: Bearer <token>` on every request. Logout revokes the token server-side (`auth.logout()` / `POST` session revocation). Tokens are scoped to one user.

Issue a session with `signup` or `login`. It expires at `session.expiresAt`. Logout or `logoutAll` revokes it. There is no separate API-key type: the session token is the third-party credential.

## Client

```js
import { createClient, mintId } from "snapback4/client";
const client = createClient({ url, session });
```

Operations:

| Need | Call |
|---|---|
| Authenticate | `login` / `signup` then `createClient({ session })` |
| List conversations | `client.query({ kind: "query", name: "inbox" }, {})` |
| Page history | `client.query({ kind: "query", name: "history" }, { conversation, c })` |
| Send text | `client.mutate({ kind: "mutation", name: "send" }, { conversation, messageId, text }, { id: mintId() })` |
| Receive new messages | `client.observe({ kind: "query", name: "history" }, { conversation })` (live watch / long-poll `/changes`). Polling `query` also works. |

`query` returns `{ data, complete, next }` or `{ denied }` or `{ loading: true }`. Pass `next` as `c` to page.

## Message field manifest

Each history row includes:

- `id`
- `conversation`
- `sender`
- `at` (server timestamp, ms)
- `text` (text or caption)
- `photo` / `viewOncePhoto` / `video` (media reference `{ id }` or null)
- `editedAt` (edited flag when non-null)
- `tombstone`
- `quote` (reply-to id)
- reactions via `messageReactions` / `myReaction` (emoji, count, caller's own state)
- receipt state via `messageReceipts` for the caller's own messages (`sent` / `delivered` / `read`)

Type is implied by which media column is set; text-only messages have those columns null.

## Idempotency

Pass `{ id }` minted with `mintId()` or `idFrom(label)` (26 Crockford base32 characters starting with 0–7). Retries with the same id and arguments replay; changed arguments refuse `E_ID_REUSED`.
