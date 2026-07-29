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

The remediation pass added review-gated LLP 0110 declarations for all three
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
  `explicit-js-handler.v1`, not passed off as LLP 0110 settlement provenance.
- The relation page needed a new cursor protocol rather than reusing the
  older MAC-visible relational cursor: order keys and parent identity are
  encrypted in `sbbc1`, which is the right disclosure posture but a
  substantial framework implementation.
- The complete evidence gate is intentionally not met yet: paired-store,
  restore/backfill, cross-language cursor vectors, every fault cut and
  settlement-retention boundary, hosted parity, and first-party queue-owner
  coverage remain. Consequently the builders are unadvertised GAPs and this
  pass does not claim that the product migration is complete.

The contributor-source relation/activity implementation is complete: its
codegen, provider-type, storage, cursor, diagnostic, direct Signal Desk
acceptance (7/7), TypeScript, contract-inventory, and production-build gates
are green. The repository ticket remains open because public-package and
cross-target publication evidence is intentionally absent. This is a better
failure mode than the original surface: the capability index tells an agent
not to depend on the profiles as a published target guarantee until LLP 0110
completes its separate evidence lifecycle.

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

## 2026-07-28 — first rerun exposed the author/comparator dev-loop split

The first rerun did useful damage before it reached UI acceptance. The
comparator started the sessions-mode Signal Desk backend by passing an
internal `bootstrapGeneratedAtStart` option. The ordinary `snapback dev`
command did not infer the same requirement from the generated schema, so the
product path attempted dev-only raw schema/function hot-load. That is exactly
the kind of benchmark accommodation that should become product behavior
rather than remain harness lore.

The corrected loop reads the generated auth mode. A managed sessions start
and restart carry the complete schema/functions pair before listener bind;
subsequent edits re-enter the coordinator-owned explicit provisioning path.
A package-level real-server test invokes ordinary `runDev` with no comparator
switch and observes a settled sessions deployment. The versioned seed remains
outside the legacy startup carrier: a newly created managed database receives
the named versioned install after activation, while restarts and watch reloads
match the identity without resetting user data.

The rerun also selected a native binary older than the newly generated route
manifest and received only “invalid JSON” for the
`registerGroupEligible` field. That diagnostic made a compatible product
boundary look like malformed application data. The CLI now classifies this as
`SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH`, reports the exact selected
binary and its build stamp, and gives safe rebuild/override instructions while
explicitly warning against deleting fields from generated artifacts.

The Guide had a related discoverability problem: it still led with the
Contract template and said public publication was pending even though the
original eight-package `0.1.0` closure has authoritative macOS/arm64 and
Linux/x64 public-install evidence. It now leads with the current React command
and its one backend/Vite supervisor, but keeps the important nonclaim: the
current `@snapback/vite`-dependent React scaffold is newer than those public
bytes and still needs an expanded versioned public closure and browser pass.

No browser evidence was gathered in this correction, so none is claimed.

## 2026-07-28 — one revision, one retained matrix

The earlier bakeoff checkpoints were useful but too hand-assembled: a summary
could say that all three backend suites, React, typecheck, and build passed
without mechanically proving that they ran from one clean revision. That
became especially weak once the comparator started carrying exact CLI/client
package identities and the React suites wrote their own package-bound
receipts.

Signal Desk now owns one aggregate runner. It refuses a dirty starting tree,
runs the closed eight-command matrix, and records each argv, bounded duration,
exit status, and redacted content-addressed stdout/stderr log. Convex and
Supabase are required, not opportunistic: an unavailable local deployment,
hosted project, or credential produces a failed aggregate instead of a skip.
After the commands, the runner reopens the comparator, React presence, and
generated query-group receipts. A green result requires the comparator's
runtime build stamp to equal the clean source revision, its executing
CLI/client package digests to validate, the React receipt to name the same
revision with zero skips, and the query-group source hashes to still match.

The final envelope has a closed JSON Schema and a digest-derived filename.
Its verifier re-hashes the envelope content, every retained log, and every
child receipt. Logs replace workspace, home, and temporary paths and redact
credential-shaped values before hashing. This does not make the run a scale
benchmark or a hosted/public-package proof; it makes the local functional
ranking input reproducible and independently reopenable.

## 2026-07-28 — the first official matrix corrected competitor fairness

The first content-addressed v2 matrix was honestly red: seven of eight commands
passed, all three Snapback child receipts validated, and Supabase alone timed
out waiting for a Postgres Changes event. Retaining the failed receipt was
useful because it let a fresh Fable 5 review inspect the actual logs and catch
an inverse fairness problem. Supabase used a strict single-shot shared
deadline, while Convex could accept a stale `Convex live witness` comment from
the reused local deployment as its initial subscription snapshot.

Both arms now prove a new event. Convex creates a nonce-named acceptance
incident with an actor client, waits for a distinct observer client's initial
query subscription, inserts a nonce-bearing comment, records the
subscribe/mutation/delivery timestamps, and deletes the complete incident
afterward. Cleanup is separately bounded and both transports close even if
deletion fails. Supabase creates the same isolated shape, starts the delivery
budget only after the RPC insert completes, and gives its remote hosted
transport one bounded retry with a fresh client, socket, channel, and witness.
The first manual proof of the revised Supabase arm passed in 779 ms; the
revised cross-client Convex arm passed against its local deployment in 74 ms.

This made the comparison more honest rather than easier. A stale row cannot
turn either native-live check green, a failed first Supabase attempt remains
visible in stdout, and neither arm silently substitutes a post-event query for
push delivery. The aggregate receipt also states directly that the local
matrix does not include the separate staged clean-install browser proof.

The same review window tightened package-publication evidence. Browser
inspection now traverses custom-class and function-owned properties, bounds
proof-owned transformations, and receipt-binds the exact host collection APIs
whose result arrays exist before JavaScript can apply a post-return count
ceiling. That is a more useful and defensible boundary than claiming the proof
controls allocations made inside Chromium or CDP.

## 2026-07-28 — final green matrix and ranking

The first green v2 receipt still had an evidence-language mismatch: Convex used
one client for both mutation and subscription while the comparison said a
second client observed the write. The final correction split actor and observer
transports and made cleanup independently bounded so a failed delete cannot
skip either close or hide the primary failure.

The final receipt, `43d6c570…d989`, passes all eight required commands from
clean runtime revision `f789a143`. Convex proves subscribe-before-mutate
cross-client delivery in 5 ms. Supabase's first hosted delivery attempt timed
out after the insert, then its single permitted fresh-transport retry passed;
both attempts remain visible. That outcome is more informative than a
single-shot green because it demonstrates the exact recovery policy the
comparison now describes.

After the improvement program, Snapback moves ahead of Supabase for this
application-authoring exercise but not for hosted operations. Convex remains
the fastest coherent path to a reactive app. Snapback now has the stronger
local presence semantics, evidence, precise results, React lifecycle, search,
and dev supervision; Supabase remains far ahead as a hosted database and
operations product. The comparison now publishes those two separate rankings
instead of pretending one ordering answers both questions.
