//! Identity and developer inspection.
pub(super) const CARD: &str = r##"# Personas

Password accounts work headlessly in Node and browsers; personas are named development users. Both exercise
application rules with their own principal.

```quarry
use personas alice, bob
use identity password

query whoAmI():
  return viewer
```

An email-and-password product declares `use identity password`; plain `use identity` also mints guest sessions.
`use identity guests` admits only guests; without `use identity`, both methods are disabled.

## Seed accounts headlessly

Run `snapback4 check` then `snapback4 dev` with the schema above. Save as `seed.mjs` beside `snapback/`.
Set `SEED_PASSWORD` privately and run `node seed.mjs` (Node 24). Signup returns a session; use `SEED_AUTH=login` for existing accounts (duplicate signup refuses).

```js
import { signup, login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "./snapback/generated/api.ts";
const url = process.env.SNAPBACK_URL ?? "http://127.0.0.1:4400";
const password = process.env.SEED_PASSWORD;
if (!password) throw Error("Set SEED_PASSWORD");
const mode = process.env.SEED_AUTH ?? "signup";
if (mode !== "signup" && mode !== "login") throw Error("SEED_AUTH must be signup or login");
const authenticate = mode === "signup" ? signup : login;
const result = await authenticate(url, "seed1@example.test", password);
if (!result.ok) throw Error(result.why.message);
const client = createClient({ url, session: result.session });
try {
  const me = await client.query(api.whoAmI, {});
  if ("denied" in me) throw Error(me.denied.message);
  console.log(client.viewer()); // Only the principal, never the bearer.
} finally { await client.signOut(); }
```

Use `client.mutate(api.operation, args)` for writes; require `state: "sent"` or handle `"failed"` with `why`;
`"pending"` is not success. Use one client per account. The social starter's `scripts/seed.mjs` creates N users
and profiles; replay adapters use the same path. No browser, borrowed token, persona or `/seed` is needed.
SDK calls POST `{email, password}` to `/auth/signup` or `/auth/login`: `{ok: true, session}` or `{ok: false, why}`
(wire: `{session}` or `{denied}`). Use HTTPS off loopback. There is no `snapback4 auth create`; `run --as` and `/seed` do not create password credentials.

Ordinary guest and password sessions last seven days. `refreshSession` atomically exchanges a live token;
`logoutAll` revokes every session for the principal. The client refreshes near expiry and uses an in-memory
session store by default. Both online and local clients expose `session()`, `onSession`, `refreshSession()` and
`logoutAll()`: rotation adopts the bearer before notification, and sign-out or a current-session refusal clears
it. Local `signOut()` fences late refresh responses and completes only after persisted credentials are removed.
Remote logout is best effort and does not gate that local boundary. An in-flight rotation may return its
successor for logout, but cannot adopt or persist it after sign-out. Storage failure rejects sign-out for retry;
`close()` alone preserves the session. Neither operation erases the outbox. Personas have no session; a
bare-token online client has none until refresh returns one. Only the local client has `sync()`.
`localStorageSessionStore()` is an explicit compatibility choice whose token can be read by same-origin script;
native apps should pass their secure store.

Trusted dev E_AUTH explains expiry or possible causes for unknown tokens; the SDK keeps the message.
Sign in again and discard earlier-store tokens. Serve and untrusted dev requests keep causes generic.
See `guide services` for diagnostic limits and `guide jobs` for isolated time-travel tests.

## Operations
`use personas alice, bob` declares a development cast. `snapback4 run send '{..}' --as alice` (the default
persona is alice) and the `x-snapback-persona: alice` header in development act as `dev:alice`; `persona: "alice"` on the client sends the header. A React/Expo dev UI keeps `AppProvider` and `useAuth` with
`createApp({ url, persona: "alice", device })` (a `?as=` picker: "Personas in a React UI" in CLIENT-AND-OPERATIONS.md);
it has no session, so `app.auth` sign-in refuses `E_AUTH`.
The declaration is the cast: dev refuses a persona it does not name with 401 E_AUTH, naming the line to extend, so
an acceptance test can expect an outsider to be refused (a schema without `use personas` admits any name). Personas are a development door: the socket peer, `Host`, and optional
browser `Origin` must all be literal loopback/local http(s) values. Foreign, opaque, malformed and duplicate
Origins are refused before routing, and CORS reflects only an admitted local Origin. `snapback4 dev` is
development only: it admits loopback personas and an unauthenticated `POST /seed` as the system principal;
deploy with `snapback4 deploy` + `snapback4 serve`. A deployed server (`snapback4 serve`) refuses personas and
seed, defaults to `127.0.0.1`, and requires `--i-understand-cleartext` for a non-loopback HTTP bind. Put a TLS
terminator in front, preserve `Authorization` and `Origin`, strip persona headers, and rate-limit there by the
actual client address; the binary trusts only its socket peer.

`GET /auth/config` is the small public advertisement for guest/password support. Catalog, schema, generated API,
native module and changes require a live principal. Signup requires at least 8 characters (Unicode scalar
values) and at most 1,024 UTF-8 bytes; login accepts at most 1,024 UTF-8 bytes. Password hashing runs in bounded
concurrent slots outside the engine mutex. Under `serve`, guest, login and signup share 30 attempts per socket
peer per minute, while login and signup also share 10 per normalized email per minute (E_RATE_LIMIT). Under
`dev`, loopback peers have neither minute counter; their Argon2 slots equal the host's available cores, capped
at 16 and never below 2. Startup prints the slot count and the lifted counters once. `serve` and non-loopback
peers keep two slots and the minute counters; full slots refuse with retryable E_RATE_LIMIT. Connection/worker
caps remain. Unknown emails perform the same Argon2 verification work. Retry after the minute counter or
concurrent-slot pressure clears; do not retry in a tight loop.

Use `snapback4 dev --replay` when new effects must be never delivered: writes and meters remain,
new effects are counted as suppressed, and schedule admission is held. Previously queued effects remain.
`--hold-effects` instead keeps effects claimable after restarting without the flag; `--hold-schedules`
only holds schedule admission. Both schedule holds skip missed periods; a restart without `--replay` restores normal emission for new writes and keeps the count.
The policy persists for local `run` until the next host start; suppressed effects never return.
`serve` and release commands refuse `--replay` with E_REPLAY_DEV_ONLY; production always emits normally.
See `guide jobs` for full replay semantics and the disposable-store recipe.

`snapback4 sql "SELECT * FROM messages" [--limit N] [--json]` inspects the developer's own dev store; `--release
dir` selects a deployment. It opens read-only alongside the running server and is never rule-filtered. Only
application-table views are exposed; internal tables and raw r/i are refused. Views and `data` include absent
required literal defaults; optional columns stay null. Device persistence exports retain raw storage images. The
default SELECT limit is 200, with a notice when more rows exist. `snapback4 sql '\dt'` (or `'.tables'`) lists
application tables and maintained views; `sql '\d messages'` (or `'.schema messages'`) describes Quarry
columns/nullability, indexes and unique keys. Both report the active schema generation and bounded stored row
counts: exact through 10,000, otherwise >=10,001; ephemeral counts are unavailable. `--json` returns
`generation`, `tables` and `ruleFiltered: false`. These catalog commands use the active schema, even with broken
local source.

## Refusals
E_SQL_READ_ONLY means inspection received something other than one read-only `SELECT` or `WITH ... SELECT`. For
example, `snapback4 sql "DELETE FROM messages"` cannot delete rows. Use `snapback4 sql "SELECT * FROM messages"`
to inspect them, and a declared mutation for an application write. Do not combine statements or use attachment,
pragmas or side-effect functions through this inspection verb.

E_SQL_INTERNAL means inspection tried to read engine-private storage. For example, `SELECT * FROM r` or `SELECT
* FROM sqlite_master` is not an application-table view. `\dt` lists tables; `\d messages` describes one: use
`snapback4 sql '\dt'` or `snapback4 sql '\d messages'`. These views expose the developer's store, including
interpreted defaults, and are not an application authorization boundary. Use Quarry for application reads."##;
