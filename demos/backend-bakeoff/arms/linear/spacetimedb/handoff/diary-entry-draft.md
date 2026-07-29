## 2026-07-28 — Linear deep arm on SpacetimeDB 2.7.0

I built the frozen Linear workload on an isolated SpacetimeDB standalone target on the Minisforum Linux worker. The final local arm passed seed, authority, indexed filters, stable cursor pagination under an intervening insert, composed issue detail, optimistic reconciliation, two-actor conflict settlement, native realtime comments/activity, an in-place indexed-field migration, and all frozen performance paths. Full-text search and persistent offline/queue behavior are honest GAPs. Hosted Maincloud evidence was unavailable because the authorized credential sources contained no SpacetimeDB credential; I did not relabel the local server as hosted.

What felt good:

- The reducer + subscription model is unusually coherent. Writes are serialized server-side, actor identity is available in the reducer context, and the same committed rows flow back through generated bindings. The two-actor expected-revision conflict test was easy to reason about and produced exactly one winner.
- Generated TypeScript bindings were excellent. Once the module compiled, reducer and view names, row types, bigint revisions, and timestamps arrived directly in the client and harness without hand-maintained API types.
- Caller-dependent views over private tables made the positive and negative authority story legible. Alice and Bob saw the protected rows, Mallory saw none, and a direct private-table subscription was rejected.
- Native WebSocket row callbacks made the second-client comment/activity test direct and attributable. No polling loop was needed.
- The additive migration was a high point. The CLI printed a concrete migration plan, added a defaulted indexed column in place, retained all 500 seeded issues, and made the client-disconnect consequence explicit.
- Local publish, schema inspection, logs, and exact database deletion were fast. Nine module builds were consistently around half a second after warmup.

What felt bad or surprising:

- Parameterized views are not available. Stable filtered pagination required an identity-scoped durable `page_result` table and a reducer to materialize each page. It works, but it is substantial application glue and creates lifecycle/cleanup work that a normal parameterized backend query would avoid.
- Caller-dependent views were easy to author but our straightforward implementation scans memberships and issue collections in JavaScript. It is easy to create a secure but expensive view without an obvious query planner explaining the cost.
- There is no ordinary native full-text issue-search path in 2.7.0. B-tree/direct indexes cover exact filters, but the central Linear search experience is simply missing.
- Offline behavior is far behind Firebase/Instant-style expectations. A disconnected object keeps its in-memory rows, a cold object has none, and the reducer promise on an explicitly disconnected connection remained pending during the first harness attempt. There is no provider-backed persistent cache or mutation queue to rely on.
- The development identity story required custom persona registration and careful token custody. The server identity is useful, but ordinary app auth/profile flows need more scaffolding than the core reducer model suggests.
- A schema field with a migration default is still required by the TypeScript insert type for new rows. The distinction is logical, but it surprised me during V2 compilation.
- CLI ergonomics had several papercuts: exact version selection after installation, global-versus-command flag placement, an unstable SQL command, limited aggregate syntax, a codegen stale-file prompt, and a `prepare` npm lifecycle collision in the harness package.
- Hosted operational confidence could not be tested without Maincloud credentials, so the attractive local workflow remains only partial evidence for deploy/rollback/export operations.

Failed attempts retained:

- Naming the harness command `prepare` caused `npm install` to execute it before generated bindings existed.
- Two initial module-build invocations exposed the CLI's exact `-p` syntax and the need to preserve the resolved Node toolchain path.
- V2 inserts failed to typecheck until the defaulted field was supplied explicitly for new rows.
- The first acceptance run hung on the disconnected reducer promise; the corrected probe records its bounded outcome and makes no queueing claim.
- A combined PostgreSQL-style filtered aggregate and a misplaced `generate --server` flag were rejected; two simple counts and module-local codegen worked.

What Snapback should learn:

- Match the end-to-end typed loop: schema/functions to generated client types to authoritative live reconciliation should feel like one system.
- Provide a first-class, server-side parameterized query and stable cursor API so users do not need durable page-materialization tables.
- Add an inspectable migration preflight that names added/removed fields and indexes, identifies client-disconnect impact, and defaults to data-preserving execution.
- Make conflict policy and server settlement easy to express and observe; expected-revision CAS plus authoritative subscription convergence is a good end result.
- Make target identity, logs, exact cleanup, and rollback/export receipts explicit product concepts.
- Be uncompromisingly honest about offline semantics. If Snapback offers persistent views and queued edits, prove cold-start and settlement behavior; otherwise label warm memory and reconnect separately.
- Improve auth onboarding so deterministic development personas and production principals do not require ad hoc registration glue.
- Treat full-text search as part of the normal backend surface for an app like Linear, not an optional afterthought.

Trajectory judgment from this arm: SpacetimeDB is compelling where authoritative realtime state and typed reducers dominate, but the missing full-text/offline paths and pagination glue keep it from being my default general backend for this workload. Snapback can beat this result without changing its core approach if it matches the typed realtime confidence while making ordinary query, migration, auth, search, and lifecycle work substantially easier. A fundamental change would only be necessary if Snapback cannot make those guarantees and workflows native to its current architecture.
