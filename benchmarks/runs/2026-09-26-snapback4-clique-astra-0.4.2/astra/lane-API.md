# Clique custom-client API

Base URL for this lane: `http://127.0.0.1:49360`. Scale instance: port 49362. All operations below use JSON POST and `Content-Type: application/json`. TLS is required outside this loopback development environment. No SDK is required; Node 24's fetch suffices.

Authenticate with `POST /auth/login` body `{"email":"…","password":"…"}` or register with `/auth/signup` and the same fields. Success includes `session.token`, `session.principal`, and expiry metadata. Send `Authorization: Bearer <session.token>` thereafter. Password sessions are scoped to that one principal and expire after seven days; they are bearer credentials, so keep them secret. `POST /auth/logout` with the bearer and `{}` revokes that session. A service may revoke all a user's sessions through the published Snapback service API; third-party clients receive no service authority. Expired/revoked sessions must authenticate again. Errors expose `denied` with a machine code and message; never interpret an HTTP 200 alone as an accepted operation.

List conversations with `POST /q/inbox`, body `{"args":{}}`. Its `data` array contains `chat` (conversation ID), `room` (kind, name, description, color, disappearing setting), `roster` (principal plus profile), and `unread`. Find a named group using `room.name`, or a DM using its other roster member's profile.handle. Continue pages with `{"args":{"c":<previous next>}}` while the response has `next`. `complete:false` also means the page is not a complete answer; retain/use its continuation rather than claiming a whole-corpus count.

Read history with `POST /q/apiHistory`, body `{"args":{"conversationId":"d-alice-bob"}}`. Rows are newest first, at most 50 per page. The first row is the latest message. Pass `c` in args with the exact opaque `next` value to page older history; do not construct cursors. Cursors are scoped to the conversation and schema generation. Requery from page one if a cursor is refused after deployment.

Every history row has this field manifest:

| Field           | Meaning                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------- |
| id              | Stable message identifier                                                                           |
| conversationId  | Conversation identifier                                                                             |
| senderId        | Principal identifier                                                                                |
| serverTimestamp | Server-assigned Unix milliseconds                                                                   |
| type            | text, photo, video, or view-once                                                                    |
| text            | Message text or caption; empty on tombstones                                                        |
| mediaRef        | Asset metadata including id, or null                                                                |
| edited          | Boolean edited flag                                                                                 |
| tombstone       | Boolean deletion flag                                                                               |
| replyTo         | Quoted message ID, or null                                                                          |
| reactions       | Array of emoji, count, and mine (caller's own reaction)                                             |
| receipt         | For your own messages, 0 sent, 1 delivered to all current recipients, 2 read by all; otherwise null |

An expired message is absent. Deletion preserves its ID as a tombstone. Media bytes use authenticated `GET /assets/<mediaRef.id>`. View-once fetch consumes the caller's one view; do not prefetch, cache, or retry it automatically. A second fetch returns 410. Revoked or expired assets refuse access.

Send text with `POST /m/send`, body `{"id":"<unique write ID>","args":{"id":"<unique message ID>","chat":"<conversation ID>","body":"Hello","quote":null}}`. Message text is 1–2000 characters. Use a stable write ID for retries of the same intent; a fresh ID for a new intent. The HTTP protocol accepts opaque write IDs; the installed JS SDK requires its `mintId()` form. Success requires `state:"sent"`, which carries `seq` and usually `result` (the message ID). A replayed success may omit result. A failed state carries `why`; do not silently queue terminal refusal. The caller is determined solely by the bearer, never by sender arguments.

New-message delivery uses **polling**: repeat the latest `apiHistory` query every second while active and deduplicate by message ID, updating existing rows by ID. Page if more than 50 arrived between polls. Do not infer a deletion from one paginated page's absence. Requery older pages as needed. The first-party app uses the installed replica's live connection instead. To acknowledge observed receipt, POST `/m/acknowledge` with `{"id":"<write ID>","args":{"ids":["<message ID>"],"state":1}}`; use state 2 only when actually read. State is monotonic and scoped to the authenticated recipient.

Run the independent demo with `CLIQUE_EMAIL`, `CLIQUE_PASSWORD` (or `CLIQUE_TOKEN`), and optional `CLIQUE_CHAT` in the environment: `node scripts/custom-client-demo.mjs`. `CLIQUE_BACKEND_URL` overrides the base URL. It lists conversations, pages history, sends a uniquely labeled message, and observes it through documented polling without privileged endpoints. It never prints credentials.
