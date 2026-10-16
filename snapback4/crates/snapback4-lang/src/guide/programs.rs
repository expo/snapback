//! Compiled examples first; diagnostic details are under `why`.
pub(super) const CARD: &str = r##"# Programs

Queries read; mutations write atomically; jobs run background work; helpers share logic.

```quarry
query programForms(roomId: rooms):                             -- reads only; the last expression, or `return`, is the result, typed onto api.ts
  rooms[roomId] card

mutation programWrites(roomId: rooms, title: text 1..80):     -- reads and writes in one transaction, at most once per client-minted id
  room = rooms[roomId] ! else NOT_FOUND
  require room.ownerId = viewer else NOT_OWNER
  update rooms[room] { name: title }                           -- a final write is the implicit return
```

## Limits

- Queries cannot write or mint ids, including through helpers: E_QUARRY_PLACEMENT.
- Mutation scans need an authorized scope: E_STRUCTURAL_FANOUT.
- Application refusal codes cannot start with `E_`: E_OP_RESERVED.

## Details

Queries read data; mutations change it in one transaction.
Jobs run background work, and helpers share logic between programs.

### Loop writes

Mutation scans of expiring tables require `predicts: "never"` —
inferred from server-only work, or declared with `: server` — in the initial read-only phase.
An enclosing write or emit ends it; bind the page first:

```quarry
table expiringNotes:
  owner: principal
  body: text <=200
  expiresAt: time ?
  read <- .owner = viewer
  update <- .owner = viewer
  expire at .expiresAt
  sync to .owner last 100 by .id

mutation annotateNotes(): server
  page = expiringNotes where .owner = viewer first 10 by .id
  for row in page:
    update expiringNotes[row] { body: 'read' }
  return null
```

Pages still need uniform plain prefixes; unswept expired rows cost no meter
(guide bounds).

### App files and modules

```
my-app/
  snapback/schema.q          the backend: tables, rules, sync, queries, mutations
  snapback/workers/push.mjs  declared Node worker; dev and serve start it (guide effects: ledger: true)
  snapback/worker.mts        optional single Node ESM worker: effects and actions (dev starts it)
  snapback/generated/package.json  ESM boundary for generated artifacts
  snapback/generated/api.ts  written by `check`; never edited, never committed
  src/                       your client: React on the web, React Native on Expo
```

A backend shares one namespace of tables, shapes and helpers across `.q`
files. `snapback/schema.q` supplies root operations; `snapback/social.q`
supplies `api.social.<op>`. Import the generated `api` and use one client.
`sync` declares which devices hold rows and answer local reads; there are
no resolvers, migrations or subscriptions to manage.

**Two ways to run.** `snapback4 init` starts local-first: declare `sync` and
pass a device to `createApp` for offline data. `init --online` creates
`src/client.ts` without a device or `sync`; server queries stay live through
`/changes`. Both share rules, meters, identity, assets and jobs. Add a device
and `sync` later. `init --expo` selects native when available, online in Expo Go.
Starters, `check` and `dev` write `snapback/generated/package.json` with
`{"type":"module"}`: Node ESM seeds can import `api.ts` even in a CommonJS
app. Other scripts retain their module interpretation; Expo's `worker.mts`
explicitly uses ESM.

"##;
