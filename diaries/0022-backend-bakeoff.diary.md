# Diary 0022: Signal Desk backend bake-off

**Application:** one React incident-response workspace on Snapback, Convex, and Supabase  
**Started:** 2026-07-27  
**Systems:** Snapback, React, Convex, Supabase, Realtime, Ephemeral, Developer experience  
**Related:** LLP 0015, LLP 0016, LLP 0061, LLP 0063, LLP 0074,
`demos/backend-bakeoff/COMPARISON.md`

## 2026-07-27 — choosing a wide-band product slice

I chose a collaborative incident room (“Signal Desk”) because it puts pressure
on more than CRUD without requiring backend-specific product compromises. The
shared surface needs four related tables, multi-table writes, validation,
ordering, search, server-derived aggregation, optimistic UI, cross-client
durable updates, and ephemeral presence.

The comparison boundary is one React component and one `BackendAdapter`
interface. Each arm must use the backend's native client and realtime path.
Personas are a demo identity picker, not authentication. This deliberately
keeps auth out of the ranking rather than pretending three very different
identity systems are equivalent.

### What felt good

- The product shape exposed meaningful differences quickly. Durable task and
  comment updates looked similar at the UI boundary, while presence forced each
  backend to reveal whether it distinguishes ephemeral and durable state.
- A shared adapter contract prevented each implementation from improving its
  score by quietly dropping a feature.
- Writing native-client acceptance before relying on the GUI kept “live” from
  meaning “the page eventually refetched.”

### What felt bad or surprising

- A four-feed neutral snapshot contract is intentionally somewhat unnatural for
  all three products. It makes the shared React code honest, but each backend
  could be leaner with a product-specific UI/cache.
- Auth is too large to bolt onto a comparison late. Excluding it makes the
  scope defensible, but a production-oriented follow-up should compare real
  identity, row visibility, and revocation separately.

## 2026-07-27 — Snapback arm

I read the root explainer, guide index/capabilities, and the authoring, React,
live-query, ephemeral, auth, and acceptance pages before starting. I also
oriented through the governing LLPs.

The implementation used four durable tables, seven targeted operations, three
all-row live feeds for the neutral workspace contract, two JS derived queries,
five JS mutations, and one TTL-bounded ephemeral presence collection.

### What felt good

- Presence was the cleanest backend implementation in the comparison. The
  collection owns TTL and disconnect behavior, and the test proved presence
  does not increment durable storage version. This is a real semantic
  advantage, not UI sugar.
- Multi-table mutation code was straightforward. `addTask`, for example, reads
  incident/tasks and atomically writes incident/task/activity.
- Live queries worked natively with polling disabled. A mutation through one
  client was observed on a second live-query connection.
- The generated artifacts are unusually inspectable: schema, functions,
  capability facts, operation schemas, provider bindings, Contract bindings,
  and a freshness identity all exist as machine-readable evidence.
- The acceptance harness made six exact claims and reported all six passing.

### What felt bad or surprising

- The app still imports authoring helpers and the client through monorepo-relative
  paths. It felt like developing Snapback itself, not installing Snapback.
- Declaring operations in `functions.mjs` and implementing them in
  `handlers.mjs` duplicated names, source/export wiring, and navigation.
- Codegen produced 58 files / 162 KB for this small app. Downstream evidence is
  valuable, but ordinary React review becomes generated-file heavy.
- Codegen warned that result types degraded for arbitrary JS result shapes,
  including the handoff brief and search. The adapter therefore casts the API
  and normalizes unknown rows.
- There was no indexed full-text primitive to match the other two arms. Search
  loads incidents through an index and filters in JS, which is acceptable for
  the sample but not scalable.
- The React adapter required manual aggregation of four subscriptions, cleanup,
  and normalization. During hardening, React Strict Mode exposed an async
  cleanup race that a first-party hook/provider should own.

### Runtime/toolchain incident

`scripts/bootstrap-ibex-runtime` initially reported that prepared Hermes
artifacts were usable and validated the binary. Once the checkout was dirty,
the demo harness stopped reusing the prebuilt binary and attempted a new Cargo
link. That link failed on:

- `ex_hermes_create_no_eval`
- `ex_hermes_watch_time_limit`
- `ex_hermes_unwatch_time_limit`

`scripts/ibex-doctor` still reported every diagnostic as healthy. A direct
`cargo build --bin snapback` reproduced the missing-symbol link failure. The
older bootstrap-validated `target/debug/snapback` remained runnable, so the
acceptance suite explicitly selected it. The harness correctly reported
`stamp-mismatch` between that binary and the current checkout and then passed
all six app checks.

The underlying compatibility-ABI state is already tracked in
`issues/20260727-vendor-ibex-advance-blocked-on-compat-abi.md`. The missing
doctor/guide path is recorded separately in
`issues/20260727-guide-gap-runtime-link-smoke.md`.

This incident is Snapback tooling friction, not a failure of the app's data or
realtime semantics. It still materially affects developer experience because
the happy-path command could not produce the binary it intended to run.

## 2026-07-27 — Convex arm

The Convex arm used TypeScript schema/functions, native generated references,
a local deployment, a declared search index, and reactive subscriptions.
Presence used a durable table because this implementation found no equivalent
separate ephemeral collection in the chosen surface.

### What felt good

- Schema, functions, and client references formed the most coherent TypeScript
  loop. There was little translation between database operation and React call.
- Mutation transactions naturally covered primary rows plus activity.
- Search indexing took one schema declaration and one query builder call.
- Cross-client realtime worked with the ordinary `ConvexClient.onUpdate`
  surface.
- The local deployment required no Docker and hot-redeployed functions after
  edits.

### What felt bad or surprising

- `convex dev --configure new --once` entered an interactive login flow. The
  successful agent path was
  `CONVEX_AGENT_MODE=anonymous bunx convex dev --once`, which was discoverable
  from installed source/CLI diagnostics rather than the first command shape.
- The first run downloaded the local backend; the long-running dev command
  also downloaded the dashboard. This worked, but added opaque startup work.
- Presence was the sharpest mismatch. It required a table, connection key,
  heartbeat mutation, time window, leave mutation, and stale-row cleanup. I
  initially used a fixed `after` argument; hardening found that old viewers
  could remain in the subscription, so heartbeat now deletes rows older than
  20 seconds.
- Convex's best-in-class coherence also means accepting its integrated runtime
  and deployment model. That tradeoff did not hurt this local app, but it
  matters to a platform choice.

## 2026-07-27 — Supabase arm

The Supabase arm used an existing hosted project because no Docker-compatible
local runtime was installed. One idempotent migration creates namespaced
tables, indexes, RLS policies, grants, transactional RPCs, publication
membership, and seed rows.

### What felt good

- Postgres was the strongest data-modeling environment: foreign keys, cascades,
  check constraints, generated `tsvector`, and a GIN index are concise and
  operationally familiar.
- Transactional RPCs made mutation-plus-activity behavior explicit.
- Realtime Presence fit the product cleanly and avoided durable heartbeat rows.
- The native Postgres Changes subscription delivered the second-client comment
  in acceptance.
- Reapplying the migration was safe and exposed only expected “already exists”
  notices.

### What felt bad or surprising

- The secure write surface spanned RLS, table privileges, security-definer
  functions, per-function execute grants, validation, and an internal helper
  revocation. During review I caught that the helper function would otherwise
  retain default public execute authority.
- Realtime table events are not reactive queries. The adapter debounces every
  event and reloads all four tables. That is simple and correct for this demo,
  but not a production scaling strategy.
- The app must coordinate initial reads and channel subscription readiness.
  The acceptance test explicitly waits for `SUBSCRIBED` before mutating.
- SQL function and client RPC typing remained manual in this demo.
- Hosted credentials made this arm easy on this machine, but that is not an
  honest cold-start comparison. The diary records the dependency rather than
  assigning it a speed win.

## 2026-07-27 — hardening and evidence

The shared React implementation includes optimistic task completion and now
rolls back immediately when the backend rejects. Async subscriptions use a
disposed flag so a promise resolving after React Strict Mode cleanup is closed
instead of leaked.

Executable results:

- shared three-backend contract inventory: pass;
- Snapback native acceptance: 6/6;
- Convex native integration: pass;
- Supabase native integration: pass;
- TypeScript: pass;
- Vite production build: pass (182 modules, 1.04 seconds on the recorded run).

The in-app browser controller failed while importing its own client module
(`Cannot redefine property: process`) before session setup. I retried after
reset and obtained the same failure. Per the browser skill I did not substitute
another automation stack. Therefore this diary claims native integration,
typecheck, build, and HTTP serving evidence—not a visual/browser acceptance
pass.

## Ranking

For this product today:

1. **Convex** — best authoring and reactive client loop.
2. **Supabase** — best database/tool maturity, with the most security/realtime
   assembly.
3. **Snapback** — best ephemeral semantics and evidence, but the weakest
   first-hour product loop and hosted story.

Snapback's third place is useful precisely because it is not universal.
Snapback ranks first for ephemeral presence and inspectable claim evidence,
second for durable realtime, and last for initial setup, React integration,
indexed search, and operational maturity. The prioritized remediation is in
`demos/backend-bakeoff/COMPARISON.md`.

## 2026-07-27 — bounded relations and activity follow-up

The remediation pass added review-gated LLP 0104 declarations for all three
incident child collections and one task-write/activity flow. It also moved
Signal Desk's child indexes from the manual
`[incidentId, orderField]` shape to
`[incidentId, incidentIncarnation, orderField]`, with the middle field
framework-owned and stamped by every central writer.

### What became easier

- The parent visibility, relationship, exact index, order, bound, projection,
  deletion policy, and live class now fit in one declaration. The previous
  functions expressed only a child filter and left the parent authorization
  and deletion/recreate semantics elsewhere.
- Delete/recreate is mechanically safe. A stale task, comment, or activity row
  keeps its old incarnation and cannot become visible merely because a new
  incident reuses an application id.
- The write-plus-activity plan is much easier to inspect than the handwritten
  mutation. Its manifest shows the owner point read and guard, task insert,
  exact source-effect assertion, provenance-bearing activity insert, exact
  result, and quantitative ceiling.
- Activity idempotency now composes with Snapback's retained client-mutation
  result instead of relying on the handler author to remember a deduplication
  convention. The activity stores a digest of the canonical settlement
  identity rather than its cleartext opaque id.
- Compared with Convex, this costs more declaration but makes parent
  existence secrecy, deletion/recreate isolation, physical work bounds, and
  activity provenance reviewable. Compared with Supabase, it avoids manually
  coordinating a foreign-key policy, security-definer RPC, audit insert, and
  client result type, though Postgres still has the stronger generally
  available relational surface.

### What stayed hard or surprising

- The safe relationship needs an extra protected schema field and a precisely
  shaped compound index. That is useful security state, but is more ceremony
  than the original filter and more conceptually novel than a SQL foreign key.
- Provenance exposed a real mismatch in the existing demo: its shared browser
  persona is not backend-specific session custody and therefore cannot
  truthfully prove an actual activity actor. Signal Desk keeps its explicit JS
  mutation on the product path, while a direct session-authenticated
  acceptance path now drives `addTaskWithActivity` and
  `toggleTaskWithActivity`. The same check proves exact replay, a
  storage-equal no-op rollback, and refusal of an attempted development
  impersonation path.
- Existing handwritten activity inserts had to populate the now-required
  application-table fields. Their values are explicitly classified as
  `explicit-js-handler.v1`, not passed off as LLP 0104 settlement provenance.
- The relation page needed a new cursor protocol rather than reusing the
  older MAC-visible relational cursor: order keys and parent identity are
  encrypted in `sbbc1`, which is the right disclosure posture but a
  substantial framework implementation.
- The complete evidence gate is intentionally not met yet: paired-store,
  restore/backfill, cross-language cursor vectors, every fault cut and
  settlement-retention boundary, hosted parity, and first-party queue-owner
  coverage remain. Consequently the builders are unadvertised GAPs and this
  pass does not claim that the product migration is complete.

The repository-scoped relation/activity ticket is now resolved: its codegen,
provider-type, storage, cursor, diagnostic, direct Signal Desk acceptance
(7/7), TypeScript, contract-inventory, and production-build gates are green.
This is a better failure mode than the original surface. The capability index
still tells an agent not to depend on the profiles as a published target
guarantee until LLP 0104 completes its separate author-acceptance and
cross-target evidence lifecycle.

## 2026-07-27 — first-class React presence and optimistic follow-up

Signal Desk previously owned a manual ephemeral overlay and heartbeat interval,
four live-subscription aggregators, and optimistic rollback vulnerable to
newer authoritative delivery. It now uses the prepared first-party provider,
typed query group, managed presence observer, and the provider's sole
authoritative optimistic ledger.

The real receipt exposed integration seams that unit-only work would have
missed: session-mode `/inspect` needed the auth-client offer, public inspection
needed the result descriptor (not only its hash), the browser hash carrier had
to match codegen's canonical bytes, confirmed optimistic layers had to respect
response-first as well as query-first matching, provider startup needed an
independent grant before the auth barrier, and final cleanup needed an awaited
disconnect plus finite manager/grant/lane inspection. Those fixes now live in
the owners rather than in the demo.

The retained React receipt passes all ten required checks with zero skips, and
the package suites, typecheck, and production build pass. Compared with Convex,
Snapback now offers a similarly first-class reactive lifecycle while preserving
purpose-built nondurable TTL presence and more explicit evidence; Convex still
has the more cohesive first-hour loop. Compared with Supabase, Snapback avoids
application-owned channel/refresh coordination for this path, while Supabase
still has the more mature hosted presence and operational product. Hosted
Snapback presence remains an explicit unsupported no-work state.

## 2026-07-27 — generated groups and lifecycle closure

The remaining React friction was narrower but important: the group hook still
made Signal Desk repeat four generated refs, and the strongest lifecycle
claims were inherited from headless tests instead of witnessed at React's own
ownership boundary. Codegen now projects the existing route manifest as an
exact `queryGroupReference`; the adapter prepares that group before mount and
the provider adopts LLP 0090 register-mode child subscriptions from one commit
cut. Targets that explicitly refuse bundles fall back to the same generated
group with `boot: null`, so the UI remains usable without pretending it saw an
atomic initial cut.

The package proof distinguishes registered adoption from ordinary
subscriptions (two registered starts, zero ordinary starts), rejects a forged
group and wrong route params before work, and retains the existing individual
query/store sharing. Signal Desk's adapter now names one generated group
instead of maintaining its own four-entry map. Compared with Convex, this is a
more explicit route/boot protocol and a little more pre-mount ceremony; the
payoff is inspectable single-commit provenance and a fail-closed fallback
boundary.

A separate React lifecycle witness now drives disconnect, reconnect/resync,
auth-barrier blank/resume, and overlapping HMR-like provider replacement. The
successor stays live while predecessor handles, republishers, listeners,
barrier registrations, and timers drain to zero. That closed the last evidence
gap in the first-class React ticket rather than relying on a headless test as a
proxy.
