//! Compiled examples first; diagnostic details are under `why`.
pub(super) const CARD: &str = r##"# Programs

Queries read data; mutations change it in one transaction.
Jobs run background work, and helpers share logic between programs.

```quarry
query programForms(roomId: rooms):                             -- reads only; the last expression, or `return`, is the result, typed onto api.ts
  rooms[roomId] card

mutation programWrites(roomId: rooms, title: text 1..80):     -- reads and writes in one transaction, at most once per client-minted id
  room = rooms[roomId] ! else NOT_FOUND
  require room.ownerId = viewer else NOT_OWNER
  update rooms[room] { name: title }                           -- a final write is the implicit return
```

`programForms` returns a room through the reusable `card` shape.
`programWrites` requires a visible room and its owner, then changes its name.
Helpers share one namespace; a helper from `m.q` accepts both `helper(x)` and `m.helper(x)`.
A different module name is refused with the declaring file and the correct call.

## Limits

- Queries cannot write or mint ids, including through helpers: E_QUARRY_PLACEMENT.
- Mutation scans need an authorized scope: E_STRUCTURAL_FANOUT.
- Application refusal codes cannot start with `E_`: E_OP_RESERVED.

## Details

Queries read data; mutations change it in one transaction.
Jobs run background work, and helpers share logic between programs.

### App files and modules

```
my-app/
  snapback/schema.q          the backend: tables, rules, sync, queries, mutations
  snapback/worker.mts        optional Node ESM worker: effects and actions (dev starts it)
  snapback/generated/package.json  ESM boundary for generated artifacts
  snapback/generated/api.ts  written by `check`; never edited, never committed
  src/                       your client: React on the web, React Native on Expo
```

The backend is one file (more `.q` files beside it hold modules; their
operations are named `<module>.<op>`, and every file shares one namespace
of tables, shapes and helpers); generated operations group under `api.<module>`
(`api.social.follow`, not `api.follow`). The client imports `api` from the generated
file and talks to the server through one client object. There are no
resolvers, no migrations to write, no subscriptions to manage: a table's
`sync` line says which devices hold its rows, and the client's reads run
over what the device holds.

**Two ways to run.** `snapback4 init` starts local-first: declare `sync`
and pass a device to `createApp` so the client holds its partition and works
offline. `snapback4 init --online` writes a schema with no `sync` lines
and a `src/client.ts` on `createApp` without a device. Its queries run on the server and
stay live through `/changes`, with no replica. Both tiers use the same
rules, meter, identity, assets and jobs. Add `sync` and open a local-first
client when the app needs offline data. `init --expo` adds the phone
starter, selecting the native tier when available and online in Expo Go.
Every starter writes `snapback/generated/package.json` with `{"type":"module"}`,
so Node ESM seed scripts can import `api` from `snapback/generated/api.ts`
even when the app's package.json says `"type":"commonjs"`. Existing scripts
under `snapback/` keep their module interpretation. The Expo starter uses
`worker.mts` so its generated worker is explicitly ESM in a CommonJS app.
`check` and `dev` rebuild the generated package boundary alongside `api.ts`.

"##;
