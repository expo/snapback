# Snapback × Zero/Replicache local-sync bakeoff

**Program:** six provider-native React application pairs, plus one bounded
Replicache offline-write control  
**Authority:** LLP 0138  
**Targets:** repository Snapback on local Ibex/SQLite; Zero 1.8.0 on
`zero-cache-dev` and PostgreSQL 17.10; Replicache 15.3.0 for Field Notebook
only  
**Composite score:** none — capability, correctness, DX, performance, and
operations remain separate

## Executive answer

Zero is better today at the part of local sync a React developer touches most:
composable relational queries, query-driven partial replication, a useful
local row store, and one shared mutator that predicts locally and executes at
the server. Triage Graph and Fleet Observatory made that advantage obvious;
Latency Kanban and Contention Calendar showed how much code a shared optimistic
mutator removes.

Snapback is better at the authority boundary around that experience. Its
structural constraints, stable conflict diagnostics, explicit
prediction-versus-settlement state, durable ordered outbox, retained/current
freshness, active protected-result retirement, and much smaller local runtime
were easier to reason about and operate. Private Incident Room showed that this
is not theoretical: revocation, a write crossing revocation, user switching,
and outsider non-delivery all passed on both products, while Snapback made the
security lifecycle more explicit.

Replicache remains the stronger design reference for durable offline mutation
and rebase. The Field Notebook control exercised its real local mutation queue,
exactly-once server reconciliation, and concurrent rebase, but the headless
fake-IndexedDB carrier could not certify cold browser restart. Current Zero is
not a substitute for that behavior: it does not provide Replicache-class
durable disconnected mutation custody. Snapback preserves offline intent more
strongly than Zero, but its JS arm deliberately does not render a speculative
pending row after restart and does not expose a semantic three-way text-merge
UI.

The recommendation is therefore not to copy Zero wholesale. Snapback should
adopt Zero's authoring outcomes—relational query composition, query-scoped
local materialization, shared/generated optimistic transforms, and visible
query completeness—while preserving Snapback's server authority, explicit
conflicts, revocation, and settlement model. Evidence from this bakeoff appears
to satisfy LLP 0129's condition for reconsidering constrained
Replicache-class app-authored client mutators. LLP 0129 reserves admission to
the author, so this report requests that decision; it does not admit or
schedule the option itself.

## Why these six apps

| Application | Primary stress | What it prevents the bakeoff from hiding |
| --- | --- | --- |
| Triage Graph | relational query composition over 10,000 issues | fetching a whole table and filtering in React; missing relationship or completeness semantics |
| Latency Kanban | 500 cards under 1,000 ms authority latency | confusing immediate local paint with acknowledgement or observer convergence |
| Contention Calendar | two contenders for one invariant-protected slot | treating optimistic availability as authority; duplicate ambiguous retries |
| Private Incident Room | protected multiplayer data and revocation | UI-only authorization, stale protected rows, writes that escape revocation |
| Field Notebook | retained reads, disconnected intent, restart, and rebase | treating cached reads, refused writes, durable outbox, and semantic merge as one capability |
| Fleet Observatory | 25,000 devices, 250,000 events, query churn | full-dataset client custody disguised as partial sync; predecessor leakage and unbounded views |

The frozen protocol contains 51 primary checks. Field Notebook reuses its 11
checks for the separate Replicache control. Every PASS has a provider-native
runtime witness; unsupported or browser-carrier-only behavior is a GAP rather
than a synthetic pass.

## Results

`P/G/F` means pass/gap/fail. A GAP is an explicit unproved or unsupported
behavior, not a product failure.

| Application | Snapback | Zero | Replicache control | App-level judgment |
| --- | ---: | ---: | ---: | --- |
| Triage Graph | 9/0/0 | 9/0/0 | — | Zero clearly wins relational authoring and query-scoped local custody; both are correct |
| Latency Kanban | 8/0/0 | 8/0/0 | — | Zero wins optimistic authoring; behavior is tied under the headless fixture |
| Contention Calendar | 7/0/0 | 7/0/0 | — | Zero wins speculative-create ergonomics; Snapback wins invariant declaration and stable errors |
| Private Incident Room | 8/0/0 | 8/0/0 | — | Both enforce the security contract; Snapback exposes the retirement lifecycle more directly |
| Field Notebook | 9/2/0 | 7/4/0 | 8/3/0 | Snapback beats Zero on offline intent; Replicache remains the richer offline/rebase reference |
| Fleet Observatory | 6/1/1 | 7/1/0 | — | Zero wins partial-sync scale; Snapback's historical arm silently queried a partial prefix before application-side ordering |
| **Primary total** | **47/3/1** | **46/5/0** | — | Totals are completeness facts, not a score |

The retained Snapback Fleet failure is useful evidence, not a reason to call the
whole product incorrect. The historical receipt is accurate: the mutation
returned a result saying it patched all 1,000 events, but both a fresh query and
the active polling result returned zero of the expected 100 changed rows.
Follow-up inspection of the exact 250,000-row fixture proved that all 1,000
writes committed. The query had silently collected only its implicit first
1,024 matching rows, then sorted and sliced that incomplete prefix in
application JavaScript; the changed global-tail rows were never candidates for
the returned page. The correctness failure was therefore false query
completeness, not mutation durability or live invalidation. That outcome is
exactly the kind of scale seam this application was designed to find.
Snapback now refuses this ambiguous implicit prefix with
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`; the fix landed on `origin/main` as
`b52e3b9c`. After the Fleet handler moved every filter, descending `pageKey`
order, and `.take(100)` into indexed query builders, a new exact-fixture
receipt retained **7 PASS, 1 browser-carrier GAP, 0 FAIL**, including exactly
100 live matches after the 1,000-write burst. The frozen v1 receipt and primary
totals remain unchanged; the remediation witness is `snapback.v2.json`.

## Where Zero is better

### Relational queries and partial sync

Zero's schema relationships and ZQL let Triage Graph compose assignment,
membership, project, labels, comments, ordering, pagination, and optional
filters as one query shape. The client materialized the desired query graph
rather than fetching full tables and exposed whether it was complete. Snapback produced the right rows, but its JS
handler manually joined multiple collections, sorted, sliced, and projected
them. The code remained understandable, yet the database-shaped work was
application code and the headless client had no equivalent local relational
store.

Fleet Observatory sharpened the difference. Zero retained 100 rows for the
250,000-event route, handled twenty query changes without predecessor leakage,
and converged exactly the 100 active matches from a 1,000-update burst. Its
query inspector also gave the author a concrete view of custody and hydration.
Snapback bounded direct results to 100 rows, but its historical handler did so
only after an implicit partial collection and application-side ordering. It was
slower to author, did relationship lookups manually, and missed the frozen
burst-convergence bound because the query API did not refuse the incomplete
intermediate result.

### Optimistic mutation authoring

Zero's shared mutator is the best authoring primitive in the bakeoff. The same
operation runs against the local store for prediction and against PostgreSQL
for authority. Kanban move logic therefore existed once. A Calendar client
could choose an ID, insert the exact provisional reservation into the query
store, and naturally rebase after the unique constraint selected the winner.

Snapback's React optimistic hook is typed and its settlement matcher is
explicit, but Kanban duplicated the move transform in a projection reducer.
Calendar could not construct a typed provisional row because the authoritative
ID was server-minted, so the type system correctly forced an app-local pending
sidecar. Safe is good; ergonomic and composable is better.

### Completeness and client-store visibility

Zero makes unknown versus complete query state and the local materialization
model ordinary parts of the API. Snapback has richer retained/current and
connection concepts overall, but composing those axes into a simple React
query experience took more product knowledge. Zero's inspector was especially
useful in the scale apps.

## Where Snapback is better

### Authority, conflict, and settlement vocabulary

Snapback's constraint and conflict boundaries were easier to interpret. The
Calendar loser produced `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`; Zero returned a
fulfilled mutation result containing an application error whose message
included the PostgreSQL constraint name. Zero's closed result union is sound
once learned, but two first harnesses incorrectly equated promise fulfillment
with mutation success. Snapback more clearly separated call settlement from
live authoritative observation.

Snapback also keeps durable outbox state, explicit conflict outcomes, and live
authority convergence distinct. That is a stronger basis for ambiguous
delivery and offline recovery than Zero's connected-write model.

### Protected-state retirement

Both Incident Room arms passed outsider non-delivery, read-only roles,
cross-client delivery, revocation, a pending write crossing revocation, user
switch, and out-of-band permission change. Snapback's declaration-bound query
authority and explicit retained-result retirement made the intended lifecycle
easier to locate. Zero achieved the behavior through its query/mutate endpoints
and client lifecycle, but the application owned more of the policy and
reinstantiation choreography.

Neither local test establishes hostile-device byte erasure. Both results are
about future delivery and application-managed client custody after authority
changes.

### Offline intent versus current Zero

Field Notebook demonstrated the important product split. Snapback queued and
settled authority-bound work through disconnection and preserved retained reads
with freshness labels. Separate Incident Room and Calendar evidence proved
server-side revocation and conflict enforcement.
Zero served its connected contract cleanly and documents cached offline reads,
but the fake-IndexedDB headless carrier did not certify a cold cached restart.
Disconnected writes are unsupported in the frozen Zero profile; a direct call
could still paint a local prediction while its `.server` result stayed pending,
so the safe UI disabled save and preserved input in an application draft store
rather than treating that effect as a durable Zero mutation.

### Operational simplicity

Each Zero arm required PostgreSQL logical replication, a database, an app API,
`zero-cache-dev`, the native SQLite dependency, a replica file, unique app and
replication-slot identity, and careful teardown. That is reasonable for an
open relational sync service, but it was the most repeated source of setup and
cleanup friction. Snapback's local server plus generated artifacts was a much
smaller owned surface.

## What Replicache still teaches

Replicache is not scored as current Zero and should not be described as such.
The Field Notebook control required application-owned push, pull, cookies,
last-mutation IDs, idempotence, and poke/rebase behavior. That backend protocol
is substantial work. In exchange, the real mutation queue kept speculative
create/update intent and reconciled it exactly once; the concurrent remote edit
caused the local mutator to replay over new authority.

The local control did not prove standards-real browser IndexedDB restart or a
literal fifteen-minute outage, so those remain GAPs. Its successful open-client
queue/rebase behavior is still enough to show why Replicache's model remains a
valuable design reference. Replicache's public repository is archived, which
makes it a control and source of ideas rather than the default new-product
choice.

## Snapback improvement synthesis

| Priority | Snapback-native outcome | Bakeoff evidence | Preserve | Acceptance witness |
| ---: | --- | --- | --- | --- |
| 1 | Composable relational query graph with generated relationship projection, filters, stable keyset pagination, aggregates, and a query plan/inspector | Triage Graph and Fleet Observatory; Zero's largest clear win | server-authoritative query admission and protected non-delivery | express both apps without manual collection joins; client custody remains bounded to desired queries; outsider gets zero rows |
| 2 | Shared or generated optimistic transforms that can run over a local query projection and authoritatively on the server | Kanban duplicated move logic; Calendar needed a pending sidecar | explicit settlement, handler authority, conflict codes, deterministic rebase | one move/create transform paints locally, accepts or rolls back, survives concurrent authority, and converges an observer |
| 3 | First-class typed optimistic create with client intent identity and later authoritative-ID reconciliation | Calendar's branded server ID blocked a safe provisional row | server-minted canonical IDs and idempotent mutation identity | provisional typed row composes in queries without forging an authoritative ID; settle maps it once or removes it with an actionable error |
| 4 | Query completeness and custody as a small public state model, plus inspection of retained rows, query freshness, and hydration cost | Zero `unknown`/`complete` and inspector were easier to use | Snapback retained/current and connection semantics; revocation quarantine | React renders unknown/retained/current distinctly; inspector explains why every retained row is present and its authorization/freshness state |
| 5 | Fail-closed query completeness plus pushed-down ordered bounds | Fleet's 1,000 writes committed, but an implicit 1,024-row collection was presented to application code as if complete; JS ordering then returned the wrong global page | bounded transfer, server authority, explicit author intent, no false completion | a 1,025-row implicit collection fails with `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`; an explicit indexed descending `take(100)` returns the global page; the 250k Fleet witness converges exactly 100 active matches |
| 6 | Constrained app-authored client mutators with durable restart reconstruction and semantic conflict hooks | Snapback Field Notebook preserved intent but not speculative restart render or three-way text merge; Replicache control rebased | server authority, explicit conflicts, revocation, D3 safety, exact execution identity | offline create+update survives browser restart, rebases over remote edit, surfaces a closed conflict outcome, and settles exactly once |
| 7 | Stable actionable application-error payloads end to end | Kanban had to preserve `CARD_LOCKED` context because public failure collapsed to `SNAPBACK_HANDLER_FAILED` | secret-safe diagnostics and stable platform codes | handler declares a safe app code/details schema; React receives it after rollback without parsing internal text |
| 8 | Keep local operation small while making cleanup identity automatic | repeated Zero app-id/slot cleanup friction is a Snapback advantage worth protecting | exact target identity and scoped cleanup | six arms run in parallel with unique owned identity and leave no process, database, slot, replica, or secret residue |

Priorities 1–4 close the largest daily authoring gap. Priority 5 addresses the
root cause behind the only retained primary FAIL; the historical receipt stays
unchanged even after remediation. Priority 6 is a candidate strategic
local-first step only if the author admits it through LLP 0129; it must not be
imported as an unconstrained client-authority model.

## Method and limits

- Implementations are provider-native; there is no shared backend adapter.
- Immediate paint, server result, and independent-observer convergence are
  separate facts.
- Local measurements are useful within one app on one machine, not a
  production throughput league table or hosted-product comparison.
- React surfaces were typechecked and headless provider runtimes were tested.
  Browser-compositor paint and standards-real IndexedDB cold restart were not
  certified; receipts retain those nonclaims and GAPs.
- Zero and Replicache needed no account, API key, or license key for these
  self-hosted/local targets. Cloud Zero and hosted Snapback were not tested.
- The protocol, raw receipts, environment qualification, and six chronological
  diaries remain the source record. This report does not overwrite failed
  setup attempts or turn environment limits into product results.

## Current-product references

- [Zero status and release stage](https://zero.rocicorp.dev/docs/status)
- [Zero queries](https://zero.rocicorp.dev/docs/queries)
- [Zero mutators](https://zero.rocicorp.dev/docs/mutators)
- [Zero connection and offline behavior](https://zero.rocicorp.dev/docs/connection)
- [Zero self-hosting](https://zero.rocicorp.dev/docs/self-host)
- [Replicache public repository](https://github.com/rocicorp/replicache)
- [Replicache synchronization model](https://doc.replicache.dev/concepts/how-it-works)
