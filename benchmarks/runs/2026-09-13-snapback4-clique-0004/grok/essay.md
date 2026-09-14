# Clique on Snapback 4: a cold-build comparison

This lane built Clique, the social-messenger benchmark, as a Quarry schema plus an Expo Router client on **snapback4@0.2.6** and **snapback4-expo@0.2.1**. The comparison below is from this session only: published README and `npx snapback4 guide`, compiler diagnostics, and the work of authoring `snapback/schema.q` against a frozen UI kit and choreography harness. It is not inferred from older Snapback trees.

## Where the backend reduced friction

The unit of backend work is one file. Tables, read/insert/update/delete rules, `sync` lines, `maintain` counts, queries, mutations, jobs, and schedules live together. That is a smaller surface than Convex’s functions-plus-schema-plus-auth split, and much smaller than Supabase’s Postgres + RLS + triggers + generated types + edge functions. Clique’s follow graph, fan-out feed, DM index, receipts, typing expiry, disappearing messages, and digest accumulators are all ordinary table rows. Disappearing messages in particular collapsed to `expire at .expiresAt` with a shortened TTL from the fixture pack — no sweeper job to write, no client “open to start the clock.”

Password identity (`use identity`) removed KDF and session plumbing. The local-first client (`createLocalClient` + `webDevice`) plus `localStorageSessionStore` made reload-persistence a one-liner. Uploads are column types (`image`, `video`, `once`) rather than a separate storage product. `npx snapback4 check` is fast and names a rewrite; `npx snapback4 why <CODE>` is the rest of the manual. When a form is illegal, the compiler says so in milliseconds. That loop is tighter than waiting on a SQL migration in a shared staging database.

Jobs as `chunk` over a work table (`fanOut`, `dailyDigest` every 2m under the shortened digest config) are in the same language as mutations. Push is an `emit` effect, not a second vendor. For a messenger, “sync to memberships[.conversationId]” plus `retain delivered-history` is the entire delivery story on paper.

## Where it added friction

Rules and sync must pair exactly. `sync to .principal` is only sound when the read rule is `.principal = viewer`. Clique’s unread bump has to write the *other* member’s row; if that row is unreadable, a unique clash becomes generic `E_RULE` instead of a named constraint. The same class of bug hit `digestAcc` and the digest hit tables (`insert if absent` on a hidden unique key). Convex would have returned a clearer unique-violation; Postgres would have named the index. Snapback 4 is protecting the partition, but the author pays in “why did send fail with auth?”

Locals bind once. Nested conditionals replace reassignment. `windows['editMs']` is ambiguous until `by byK`. Jobs must start with `chunk`. `public` is documentation-plus-read, not a synonym for `read <- allow` on maintains. None of this is hard after the first diagnostic; all of it is a cold-start tax.

The React `Write` type is `pending | sent | failed` with no result payload. `createDm` returns `{ id, reused }` on the HTTP API and not on `useMutation().run()`. The client cannot trust a minted conversation id when the mutation reused `dmIndex`. That is a real platform gap relative to Convex mutations, which return values into the UI. The workaround is a point query (`dmByPair`) and waiting for the replica.

Auth rate limits (10/email/min, 30/socket/min) are correct for a product and painful for a four-persona Playwright harness plus an HTTP suite on one host. Replica cold-start (wasm open) is seconds, not milliseconds; four parallel logins plus live queries on a conversation that has accumulated hundreds of messages saturates the web client. That is not Snapback inventing a new problem — local-first always has a hydrate — but the published client does not give the app a “replica caught up” signal beyond `complete`/`fresh` on each read.

Hermes iOS export of this Expo 54 app fails on private class fields (`#x`, `#y`, `#width`, `#height`) in the RN/DOM graph. Lazy-importing `snapback4/web` on web only was not enough; the bundle still contains the private-field shape. That is recorded as a platform/environment gap: the native Expo arm is `snapback4-expo@0.2.1`, and the iOS Hermes artifact this host can produce is blocked by hermesc, not by missing Quarry.

## How the shape of the work changed

On Convex, Clique would have been “write the schema, then write a dozen Node mutations, then wire `useQuery`.” The interesting work would have been in JavaScript: fan-out loops, receipt aggregation, digest jobs as cron. On Supabase it would have been SQL + RLS + a Realtime channel per conversation, with the client as a thin cache. On Snapback 4 the interesting work moved *into the schema*. Fan-out is a mutation plus a `fanouts` work table plus a scheduled job. Receipts are a table the other device inserts. Typing is `upsert` + `expire at`. Search is a words index. Once those compile, the Expo app is mostly routing, testIDs, and not fighting React Native Web.

That inversion is the product. It also means the client is where the benchmark’s choreography lives, and that is where this lane spent its blood. The harness observes `sm-convo-bubble` visibility, 2s typing render, 5s typing expiry, and semantic receipt tokens. A schema that can send is not a UI that Playwright will call green. Controlled RN Web `TextInput`s, ScrollView clipping, stack screens keeping a feed composer mounted, and a conversation replica that has not yet learned `dmIndex` are all “the app,” not Quarry. Snapback 4 did not prevent those; it also did not provide a first-party chat widget.

Relative to earlier Snapback generations as described in the published 0.2.6 README (not from reading old trees): the language card is the whole surface, diagnostics carry rewrites, and optional platform binaries make `npx snapback4` work after install. That is a calmer authoring loop than hunting across repos. The remaining sharp edges are the ones that only appear when you build a messenger: unread rows the writer cannot see, mutation results that do not round-trip through `useMutation`, and a native Hermes pipeline that does not like private fields.

## Verdict for this benchmark

Snapback 4 is the right shape for Clique’s *backend*: one schema, rules, sync, expire, jobs. It is not yet the path of least resistance for Clique’s *web choreography* on Expo Router. Convex would have returned mutation results and a more familiar React story; Supabase would have given SQL and a battle-tested Realtime client, at the cost of assembling a product from four products. This backend changed the work from “glue three systems” to “get the rule and the sync line to say the same thing, then spend the rest of the time on the Expo shell.” That is a real reduction in backend friction and a real transfer of remaining friction to the client.
