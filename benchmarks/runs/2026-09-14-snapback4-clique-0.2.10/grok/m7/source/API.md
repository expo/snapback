# Clique custom-client API

Clique's third-party API is Snapback 4's native protocol. There is no REST
surface. A client with a user access token talks to the same HTTP server the
app uses.

## Issuance, expiry, revocation

- **Issue:** `POST /auth/signup` and `POST /auth/login` (see `snapback4/auth`:
  `signup(url, email, password)`, `login(url, email, password)`). The session
  is `{ principal, kind, token, expiresAt }`.
- **Expiry:** ordinary password sessions last seven days. Call
  `refreshSession(url, token)` before expiry; the presented token is
  invalidated and the returned session must be adopted.
- **Revocation:** `logout(url, token)` ends one session; `logoutAll(url, token)`
  ends every session for that principal. Tokens are scoped to one user.

## Minimum operations

Install `snapback4@0.2.10` and:

```js
import { login } from "snapback4/auth";
import { createClient } from "snapback4/client";

const { session } = await login(url, email, password);
const client = createClient({ url, session });
```

| Need | Operation |
| --- | --- |
| Authenticate | `login` / `signup` / pass `session` into `createClient` |
| List conversations | `client.query({ kind:"query", name:"inbox" }, { c: null })` |
| Page history | `client.query({ kind:"query", name:"threadMessages" }, { conversationId, c })` |
| Send text | `client.mutate({ kind:"mutation", name:"sendMessage" }, { messageId, conversationId, body })` |
| Receive new messages | `client.observe({ kind:"query", name:"threadMessages" }, { conversationId })` (live) or poll `threadMessages` |

`observe` is streaming via the Snapback `/changes` long-poll. Polling the same
query is documented and sufficient.

## Message object field manifest

Each history row includes: `id`, `conversationId`, `authorId` (sender id),
`at` (server timestamp), media columns (`photo` / `clip` / `photoOnce`) as the
type, `body` (text/caption), `editedAt` (edited flag when non-null), `deleted`
(tombstone), `quoteId` (reply-to), plus `reactions` via `messageReactions` and
receipts via `receiptsOf` for the caller's own messages (`delivered`,
`readFlag`; UI maps them to sent/delivered/read).

See `scripts/custom-client-demo.mjs` for a runnable walkthrough.
