# Read-only: read as a user without acting as their device

Read as a user without acting as their device. A server-enforced read session keeps application state unchanged while preserving the user's visibility.

```ts
import { login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "./snapback/generated/api";
const signedIn = await login(url, bobEmail, bobPassword, { scope: "read" });
if (!signedIn.ok) throw new Error(signedIn.why.message);
const client = createClient({ url, session: signedIn.session, readOnly: true });
try {
  let c: string | null = null;
  do {
    const page = await client.query(api.history, { conversation, c });
    if ("denied" in page) throw new Error(page.denied.message);
    console.log(page.data);
    c = page.next ?? null;
  } while (c);
} finally { await client.close(); }
```

A read session changes no application-visible state. It cannot mutate, upload,
run actions or routes, claim work, report delivery, appear connected, move a
presence-gated effect deadline, consume view-once media, or alter other sessions.
Rules, query semantics and cursors are unchanged under the same data, clock and
presence snapshot. Four exceptions to answer identity: delivery manifests and
`meter.delivery` are absent; a full observer contributes its own presence;
view-once grants refuse; writes refuse.

Session creation, refresh, expiry and logout change the reader's own auth family.
Sign-in collects expired full and read sessions; read refresh deletes only its own family. Request logs and read meters still run.
Unauthenticated development doors/personas are outside this promise. A read
bearer on a development write door is refused too, with any capitalization of
`Bearer`. Malformed or invalid credentials cannot become anonymous dev writes.

Only these routes are allowed: `POST /q/<op>`, `GET /changes`, `POST /sync`,
`GET /assets/<id>`, `GET` or `POST /probe`, `GET /schema`, `POST /auth/refresh`,
and `POST /auth/logout`. Everything else returns 403 `E_READ_ONLY`, without a
head or store identity. Use a full session for writes. `/schema` enables live-query discovery on ephemeral
backends. The SDK does not sync or open a device in this mode.

`signup` and `guest` accept the same `{ scope: "read" }` option. Ordinary
sign-in defaults to full. A read-only online `createApp` signs in with read
scope and stores sessions under `sessionKey(url) + ".read"`; it never opens
an interactive write journal. Its `.read.revocations` queue retires only verified
read credentials. In both full and read modes, explicit app logout signs this
user out of that shared storage: it tombstones and retires every same-principal
credential, whatever its epoch, including peer rotations, pending successors and
newer deliberate logins, and fences same-principal sign-ins already in flight.
It never deletes or revokes a different principal's later login: a stale Bob
facade cannot sign Alice out. Logout completes while a refresh response is held;
its late successor is retired, never adopted. Rejected predecessors preserve
pending successors.

## Dashboard: narrow the interactive credential

```ts
import { narrowSession } from "snapback4/auth";
import { createClient } from "snapback4/client";
const result = await narrowSession(url, interactiveSession);
if (!result.ok) throw new Error(result.why.message);
const dashboard = createClient({ url, session: result.session, readOnly: true });
```

The sibling is a new family capped at the parent's expiry when minted. Either
family can log out independently. Full-session logoutAll revokes both;
read-session logoutAll refuses. Service, action and supervised-worker sessions
cannot narrow. Ordinary app-defined kinds such as `member` can.

## SSR: one authorized fetch

```ts
const result = await narrowSession(url, requestSession);
if (!result.ok) throw new Error(result.why.message);
const reader = createClient({ url, session: result.session, readOnly: true });
try { return await reader.query(api.history, { conversation, c: null }); }
finally { await reader.close(); }
```

The SDK probes scope before any read, refresh or exported asset credential.
A full credential or persona refuses `E_READ_ONLY_CREDENTIAL`; an older server
refuses `E_READ_ONLY_UNSUPPORTED`. Caller-edited Session.scope is never trusted.
Supply a read session and upgrade older servers. Legacy sessions without scope remain valid persisted data.

`E_READ_ONLY_DEVICE`: a read session cannot open any device. A `ro.` token is
refused even offline, regardless of its scope field. Use an online read-only
client without a device.

Refresh rotates only this read family, never extending its immutable
`capExpiresAt`. Automatic refresh stops when `expiresAt` reaches that cap;
a missing cap on a verified read credential means `expiresAt`. Explicit refresh
can rotate a live at-cap token. At expiry, sign in again (`E_AUTH`).

Active `useSeen` throws `E_READ_ONLY` during render, before subscribing. With
`active: false`, it may observe the receipt row but never posts.

## Assets

Authorization, placement, expiry and release checks run in the full-session
order. Hidden/missing/expired/released assets still return `E_ASSET_UNKNOWN`
(404). A view-once range returns `E_ASSET_RANGE` (416), even if already viewed.
An already viewed non-range returns `E_ASSET_VIEWED` (410). An otherwise
successful non-ranged view-once grant returns `E_ASSET_READ_ONLY` (403), before
opening bytes or recording a view. Fetch ordinary assets or use a full session.

`E_ASSET_READ_ONLY` reveals one bit: the full non-ranged GET would have returned
bytes and consumed this viewer's view. It reveals nothing about hidden assets.
`client.asset()` and `useAsset` return the ordinary refusal arm. `assetSource`
exports nothing until verification; afterward it supplies URI/headers, so the
platform image loader receives the 403 itself.
