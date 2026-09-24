//! Programs and the placement of writes and effects. Compiled by tests/guide.rs.
// @ref LLP 3000.007#20.19 — repeated refusals carry the card paragraph naming their code.
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

A mutation with `predicts: "never"` (a server site or `: server`) may pass
over a bounded plain prefix page whose read rule is uniform over its prefix,
without a complete schema-capped group. `matching`, merges and tables with
expiry are refused for every mutation page, predicting or not, looped or bound (`E_STRUCTURAL_FANOUT`). A predicting mutation
keeps the complete-group requirement for page loops: `for row in t where .owner = viewer:`
uses the schema cap, without restating it. An explicit `first N` remains legal;
an explicit bound below the cap still fails that proof. A job's inner loop may
also read a capped group this way. A bounded list loop whose
body only reads, computes and emits may use a list column, alias, helper result,
or filtered/shaped list derived from a page; it need not preserve the whole group.
A row write anywhere in that body, including an inlined helper or nested loop,
keeps the original structural-fanout check and its capped-group rewrite.
Every page a mutation reads, even just
binding it, must be uniformly decided by its prefix (`E_STRUCTURAL_FANOUT`):
the rewrite names the missing rule columns and a capped loop that supplies
their values. Pinning `.readerId` decides visibility; it grants no read
authority over another reader's inbox. See `guide feeds` for removal limits.
The pass is atomic and still aborts above 1,024 rows written. `check --cost`
prints "a pass over the first N rows of <prefix>; examined ceiling <n>".
For structural fanout, compiling and serving refuse it, and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there.

The table names are the language card's; a `job` is `for row in table where predicate:` sweeps (guide jobs), or `native`: the app's
own Rust, hosted as wasm; a `query` may be `native` too, run on the server
as the viewer and on a device over its rows (guide native). Operations in `schema.q`
are called by name (`api.thread`); operations in `snapback/feed.q` are
`api.feed.<name>`; jobs are not on api.ts. `require cond else CODE` refuses
with the program's own code, which reaches the client as `{ code, family:
"rule", .. }`; `CODE` is UPPER_SNAKE and never starts with `E_`. Statements
are `x = expr` (bind or reassign a local), `(a, b) = divmod(..)`, `require`, `if:`/`else if:`/`else:`, `for x in
domain:`, `break`, `continue`, `return`, a helper `fn` call, and a write; every other
expression must be bound or returned. `fn` takes one expression or a body ending
in `return expr` or a bare `return`; calls work in statements and expressions.
A helper return exits only the helper, and its locals cannot capture the caller's.
It never repositions or reclassifies an enclosing page.
Queries cannot write or mint ids, including through a helper; the call site names
the write that does not belong.

## Operations

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

## Refusals

E_INTERNAL means the interpreter reached an undefined compiler temporary.
It names the operation and statement site, without exposing the generated
variable name as an input error. Recompile with `snapback4 check`; if it
recurs, report the operation and site as a compiler defect.

### Calling and naming operations

E_OP means the requested operation or route does not exist, or was called
through the wrong door. For example, `client.mutate(api.thread, args)`
cannot run a query; use `client.query(api.thread, args)`. Run
`snapback4 check` and use the generated API's module-qualified names.
Call actions with `client.act`; run jobs with `snapback4 run <job> '{}'`
or a schedule, since jobs are not client operations. Check the HTTP path
when the message instead names an unknown route.

E_OP_RESERVED means an application's refusal code starts with the
platform's reserved `E_` prefix. For example,
`require allowed else E_AUTH` must use
`require allowed else NOT_MEMBER`. Pick an UPPER_SNAKE application code
at the use site and handle that code on the client. The same rule applies
to a unique index's `else` hook; it does not require adding the code to the
platform registry.

E_QUARRY_PLACEMENT means a statement is valid only in another context.
For example, `query add():` cannot contain `insert notes { body: 'hello' }`;
make that operation `mutation add():` so the write runs in its transaction.
Queries cannot insert, update, delete or mint ids, even through a helper.
Keep read-only work in a query, put writes in a mutation or job, and put
`break` or `continue` inside the loop they control. The rewrite names the
misplaced statement and where it belongs.

E_EMIT_IN_QUERY means a query tried to enqueue an external effect.
For example, `query send():` cannot contain `emit notify { body: 'hello' }`;
declare `effect notify` and change the operation to `mutation send():`.
Call that mutation for the send intent. Queries may rerun to refresh a
screen, so they only read; mutations and jobs keep emitted effects in
their commit for a worker with a service token to perform (guide effects).
Moving the emit into a helper called by the query does not make it legal."##;
