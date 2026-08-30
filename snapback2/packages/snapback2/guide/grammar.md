# Snapback 2 grammar

Layout: `snapback/schema.ts`, named programs in `snapback/*.ts`, optional
`seed.ts`, and journeys in `snapback/tests/*.test.ts`.

Schema: `schema`, `table`, `channel`; types `t.id/text/int/bool/time/ref/json/
optional/list/enum/decimal/money`; rules `public/allow/deny/eq/ne/and/or/not/
exists/principal/viewerIs`.

Programs: `query(args, ({ db, ctx, args }) => value)` and
`mutation(args, (...) => value)`. Reads are `get`, `exists`, and bounded
`scan(index, prefix, { take, order? })`. Writes are `insert`, `update`,
`upsert`, `delete`; guards are `require`; effects enter only through `emit`.

`ctx.viewer`, `ctx.now()`, and `ctx.newId()` are the authority, clock, and id
inputs. Authentication is always on; development identities are personas.
Every scan names `take`. Query states are `complete`, `capped`, `partial`, or
`denied`; writes are `committed` or `rejected`. Generated facts live only in
`.snapback/build/`.

Loop: `snapback2 check` → `snapback2 dev` → `snapback2 test`; use `why` before
guessing at a rule and `trace` before polling a live query.
