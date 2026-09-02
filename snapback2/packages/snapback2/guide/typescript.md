# TypeScript authoring

TypeScript is the explicit escape hatch. Its layout is `snapback/schema.ts`, named programs in `snapback/*.ts`, optional
`seed.ts`, and journeys in `snapback/tests/*.test.ts`.

Schema: `schema`, `table`, `channel`; types `t.id/principal/text/bytes/int/bool/time/
ref/json/optional/list/enum/decimal/money`; rules `public/allow/deny/eq/ne/and/
or/not/exists/created/system/viewerIs`; terms `field/oldField/nextField/viewer/
literal`. `oldField` and `nextField` are update-only; ordinary `field` is the
candidate/next image. `created` is insert-only and proves an exact indexed row
was inserted earlier in the same transaction. `Principal` is the nominal type of
`ctx.viewer`; it is not an application-row `ref` even though both currently
use an ID-shaped wire value. Table constraints include `unique`, `immutable`,
`text` with an optional minimum plus the closed `handle` and `url` formats,
and `finalExistsOnInsert`, an end-of-transaction indexed postcondition for each
inserted source row.

Programs: `query(args, ({ db, ctx, args }) => value)` and
`mutation(args, (...) => value)`. Reads are `get`, `exists`, and bounded
`scan(index, prefix, { take, order?, after?, before?, range? })`; a cursor is
the full post-prefix tuple in scan order (`after: [row.at, row.id]`). A cursored
index must be a total order: it ends in `id`, or it is unique; anything else is
refused at certify time because tied keys would be skipped between pages. Static
analysis refuses only a known wrong tuple arity—unknown helper, branch, loop,
destructured, or raw scalar facts are checked at runtime. `range` bounds stay
key-order. Writes are
`insert`, `update`, `upsert`, `delete`; guards are `require`; effects enter only
through `emit`.

`ctx.viewer`, `ctx.now()`, and `ctx.newId()` are the authority, clock, and id
inputs. `ctx.viewer` remains the authenticated authority when used directly or
through an alias; because its runtime value is an Id, it may also fill Id/Ref
read and write positions without becoming a caller argument. Authentication is
always on; development identities are personas.
`ctx.newId()` is mutation-only and draws from a durable per-store range:
rejected work may leave gaps, but reset and owner restart never repeat an
exposed id.
Every scan names `take`. Query states are `complete`, `capped`, `partial`, or
`denied`; writes are `committed` or `rejected`. Generated facts live only in
`.snapback/build/`.

Loop: `snapback2 check` → `snapback2 dev` → `snapback2 test`; use `why` before
guessing at a rule and `trace` before polling a live query.
