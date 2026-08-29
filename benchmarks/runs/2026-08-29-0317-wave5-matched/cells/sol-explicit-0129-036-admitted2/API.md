# Clique custom-client API

Clique exposes Snapback's generated native protocol through the published `@expo/snapback-client` package. The runnable reference is `scripts/custom-client-demo.mjs`.

Authenticate by constructing `createSnapbackAppClient({ app, binding, platform })` with `app` from `snapback/generated/app.mjs`, then call `appClient.auth.signInWithPassword({ email, password })`. Snapback owns the bearer credential internally: it is scoped to that user, has server-controlled expiry, and is invalidated by `appClient.auth.signOut()` or server-side session revocation. The app deliberately does not print or place session credentials in URLs. A deployed third-party integration should receive its credential through the same authenticated session issuance flow, never copy browser storage.

Use the generated exact refs from `snapback/generated/api.mjs`:

- `myInbox` lists the caller's conversations.
- `messagesForConversation({ conversationExternalId })` returns ordered history, up to the current 500-row page. Poll this operation to receive new messages; the demo states `receiveMode: "polling"`.
- `sendMessage({ externalId, conversationExternalId, text, mediaUri, mediaKind, viewOnce, replyToExternalId })` sends text or media. Choose a globally unique `externalId`; retries with the same value are idempotent.

Each history row includes `externalId` (id), `conversationExternalId`, `senderId`, `sentAt` (server timestamp), `type`, `text`/caption, `mediaUri` reference, `edited`, `tombstone`, `replyToExternalId`, `reactionsJson` (emoji/count/caller-state), and the caller-projected `receipt`. Rows come from an authenticated owner-filtered projection; a caller cannot select another user's projection.

Run against an application-ready local backend:

```sh
npm run custom-client
```
