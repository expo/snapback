# Diary 0031: Research room backend bakeoff

**Type:** Diary
**Status:** Active
**Systems:** Backend bakeoff, AI workflows, Files, Search, Streaming, Effects
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Related:** LLP 0102

## 2026-07-28 — Stage 0, protocol freeze

No provider arm has started. The frozen Research Room workload uses
deterministic embeddings and streamed progress for comparable acceptance, with
an optional real-model hosted run reported separately. Cancellation, retry,
ambiguous effects, outsider isolation, source deletion, citations, secrets,
and scheduled refresh are explicit evidence boundaries.

## 2026-07-28 to 2026-07-29 — Snapback, deep round, product-blocked

### Environment and outcome

The arm used exact frozen Snapback source commit
`5f31cb6174daaefa04a1e05242acbbc22c725040`, a fresh intended sessions-mode
SQLite + Ibex target, and `SNAPBACK_OUTBOUND_ACTIONS=1` during generation and
runtime. Codegen and the production UI build passed. The full application was
then refused before listener readiness.

The final result is one pass (exact cleanup), two explicit product GAPs
(asset bytes/upload and semantic/vector retrieval), and 12 failures. Four
failures directly cover the core sessions-plus-streaming composition;
eight downstream checks could not execute because the target never admitted
the artifact. No downstream behavior is inferred from authored code.

Coordinator evidence confidence is 8/16. Target identity and artifact
reproducibility are direct. Transaction, transport, and settlement have
indirect evidence from generated artifacts and an exact-binary diagnostic
control. Actor authority and reconnect were never reached. Cleanup proves
exact final absence, but no separately timestamped pre-write baseline was
retained.

### What felt good

The intended authority and settlement model was legible in one backend.
Private resource membership, source/question/answer rows, idempotent question
starts, citations, durable progress sequence rows, cron slots, configuration
grants, and a host-owned streamed attempt could all be expressed coherently.
Codegen also removed stale output after failure rather than letting an old
manifest masquerade as current.

The existing streamed-action control is strong. On the exact same binary, the
canonical dev-auth witness passed 8/8 and directly proved durable intermediate
native push, cancellation fencing, timeout/ambiguity separation, and
host-derived effect certainty. This localized the failure instead of leaving
“streaming is broken” as a vague conclusion.

Admission failed before bind. That fail-closed behavior prevented half-created
data or secrets and made cleanup exact: runtime/public paths, startup carrier,
restore sidecars, and ports `3340/4340/20440/9340` are absent.

### What felt bad or frustrating

The application could not start. Sessions cold-start preflight evaluated a
conservative declared local capability set that did not include the
process-live outbound streaming grant. It therefore rejected
`bounded_response_stream_v1`, even though generation and runtime both had
egress enabled and the generated capability manifest included the capability.

This is a particularly damaging composition defect because the Guide presents
sessions and bounded streamed actions as shipped local surfaces. The diagnostic
looked like a missing flag until the exact-binary control passed and source
inspection exposed the preflight path.

A tempting workaround—start a narrow sessions carrier, then hot-publish the
full manifest—was correctly refused with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`. The arm did not weaken the authority
model by falling back to dev auth or adopt a carrier that violated the closed
startup pair.

Fresh-worktree setup also required a repository-root `bun install`; ordinary
`npm install` failed on the workspace protocol. Action egress again had to be
enabled during codegen, a requirement discovered only after a failed
generation. The UI needed the routine Vite CSS declaration.

### Modeling and evidence boundary

The authored app used membership-protected sources and questions, unique
room/idempotency and answer/question relations, durable ordered progress
events, citations, and a refresh ledger. Asset metadata rows were not mislabeled
as file upload. Stored deterministic 32-dimensional fixtures were not
mislabeled as semantic/vector retrieval.

Because the target never bound, seed, outsider denial, keyword search,
citations, retry, cron, secret configuration, and performance remained
failures—not code-review passes. Authenticated progress, collaborator
observation, cancellation, and the outcome matrix are direct product failures
of the composition that blocked deployment.

### Would I choose it?

Not for this application at the frozen commit. The underlying streaming
settlement model is attractive, but the ordinary authenticated deployment
cannot compose with it. That blocks the core Research Room loop before any
data exists.

This finding does not by itself imply a fundamental architectural dead end.
The evidence points to inconsistent capability resolution across admission
paths, while the exact runtime already proves the hard streaming semantics in
dev auth. It is a high-severity implementation/product-integration defect that
must be fixed generally and rerun before the architectural conclusion.

### Lessons for Snapback

Make capability composition a single invariant. Cold-start sessions preflight,
ordinary publication, generated manifests, and served inspection must resolve
the same process-live target facts without weakening complete-pair startup or
auth-mode fences.

Prove that outcome with a CI-verified sessions-plus-streamed-actions fixture:
mint two genuine sessions, stream authoritative progress, cancel, and prove no
late durable patch while preserving the full outcome distinction. Assets and
semantic retrieval remain separate table-stakes capability gaps.

## 2026-07-29 — SpacetimeDB, deep round, complete with two gaps

### Environment and outcome

The arm used the official SpacetimeDB 2.7.0 standalone and TypeScript client on
Apartment Air against the fresh database
`llp0102-research-spacetimedb-w1`. The 31m 32.6s timed run ended with 13 passes,
two explicit GAPs, and no failure or Stop-class defect. The gaps are ordinary
semantic/vector retrieval and native module secret management.

Coordinator evidence confidence is 15/16. Actor authority,
transaction/conflict, transport, settlement, target identity, cleanup, and
artifact reproducibility are direct. Reconnect has seven direct measurements,
but the application does not exercise a durable offline mutation queue.

### What felt good

Private tables plus caller-dependent public views are an unusually crisp way
to build authorization. Alice and Bob subscribe to the same named views, but
each view is evaluated with the caller identity. Mallory's caches remained
empty, and a direct subscription to the private source table was rejected.
Generated bindings omitted every private table and exposed only views and
reducers.

Inline byte arrays made the file scenario direct: the 64 KiB payload,
metadata, hash, delivery, and deletion all participated in database
transactions and subscriptions. Schedule tables were the standout feature.
They turned each answer step into a separate authoritative commit, so Bob
received four native WebSocket inserts before the answer's terminal update.
Cancellation could delete the remaining jobs, and a scheduled procedure could
perform the external refresh before opening its database transaction.

The local standalone was fast to start, module builds were consistently around
350–400 ms, and the generated SDK's confirmed-read and subscription barriers
made the acceptance harness reliable.

### What felt bad or frustrating

The CLI has several sharp edges. `--root-dir` worked reliably only in attached
form through the installed updater. `server add` rejected `-y`, and
optional-value flags could consume the positional database unless values were
attached. The installer put the updater at the CLI-root path rather than
`bin/spacetime`, while the generated TypeScript template chose no package
manager. Each issue was recoverable, but together they cost several failed
commands before the ordinary loop became smooth.

Procedure HTTP correctly rejected localhost and other private addresses. That
is a good security default, though it prevents a deterministic loopback fixture
from exercising scheduled effects. A first public fixed-response endpoint then
returned non-200 and was correctly refused. The successful run used stable
public RFC 2606 text; both preceding failures remain evidence.

Expected reducer authorization errors appear as `PANIC` in security logs,
which is much more alarming than an ordinary sender error. There is also no
native secret injection surface even though procedures are designed for API
calls.

### Modeling and correctness

The module used private rooms, memberships, sources, questions, answers,
progress events, search results, refresh runs, and schedule tables. Every
client-visible surface was a caller-dependent view backed by indexed identity
and room lookups. Reducers derived actor identity from the connection.

Question retry used a unique idempotency key. Progress used four scheduled
commits plus a terminal commit. Cancellation updated the terminal fence and
deleted outstanding jobs; a late-patch probe could not add progress. Complete,
failed, cancelled, timed-out, and ambiguous states remained distinct.

Keyword search is application-authored reducer glue over authoritative rows.
Embeddings were stored at the frozen 32 dimensions, but no vector search was
claimed because SpacetimeDB 2.7 has no ordinary vector index/query path.

### Realtime, auth, and operations

Realtime evidence came from generated-SDK WebSocket view subscriptions and row
callbacks, never a product poller. Three independently minted development
identities were hashed in receipts, and raw tokens were not persisted.

Closing the controlling SSH sessions did not terminate three orphaned,
arm-owned listeners. Exact command-line inspection identified the standalone,
Vite, and failed-first-run effect process before termination. The exact
database was deleted, SQL and HTTP returned `No such database`/404, four ports
were closed, and isolated runtime/tool/dependency/build state was moved to an
arm-specific recoverable Trash directory.

### Would I choose it?

Yes for a realtime, transaction-heavy collaboration backend when the team is
comfortable putting application logic in the database module. Reducers,
generated bindings, per-caller views, subscriptions, and schedules form a
coherent and powerful loop. I would hesitate for AI-heavy production work
until ordinary vector retrieval and a first-class secret store exist.

### Lessons for Snapback

Match the authorization outcome: private source tables that generated clients
cannot name, plus one caller-dependent live view that filters initial state and
keeps the cache correct as authority changes.

Schedule tables also set a useful bar. Durable jobs are ordinary typed rows,
progress steps are separate transactions, and cancellation can retire
remaining schedule entries. Snapback's streamed actions are stronger for
effect settlement, but SpacetimeDB's job observability and composability are
excellent.

Finally, generated SDK subscription barriers make the authoritative client
cache easy to inspect in acceptance tests. Snapback should keep transport
attribution and settled-cache inspection equally direct.

## 2026-07-29 — Firebase, deep round, complete

### Environment and outcome

The arm used Firebase Web SDK 12.16.0 and firebase-tools 15.24.0 on a fresh
official Local Emulator Suite project. Auth, Firestore, Functions, Storage,
Hosting, Pub/Sub, Eventarc, Tasks, Rules, and the Emulator UI shared one exact
project identity. All 15 frozen scenarios pass with no product GAP, failure, or
Stop-class defect. Hosted Firebase credentials were unavailable, so none of
the local evidence is promoted to a hosted deployment claim.

Coordinator evidence confidence is 15/16. Actor authority,
transaction/conflict, transport, settlement, target identity, cleanup, and
artifact reproducibility are direct. Reconnect has five direct measured paths,
but the application has no durable offline mutation queue or retained-offline
boot.

### What felt good

Firebase was very strong for this application shape. One local project made
email/password Auth tokens flow into Firestore and Storage Rules, callable
Functions receive validated auth context, and Firestore listeners deliver
server-backed progress to Bob while Alice's Function was still running.

Local vector search was a pleasant surprise. The Admin SDK's ordinary
`findNearest` path accepted the frozen 32-dimensional vectors in the Firestore
emulator and returned the deterministic nearest source. This is useful direct
local evidence, although production still requires index creation that this arm
did not exercise.

Transactions and durable documents worked well for hard effect semantics.
Cancellation marked the question terminal in a transaction; the running worker
checked that fence before every patch and again before its answer transaction.
An explicitly injected late patch was rejected after confirmed cancellation.
The same deterministic identity retained one question, one answer, and one
effect-attempt ledger across retry. Complete, failed, cancelled, timed-out, and
ambiguous states stayed easy to inspect.

Storage authorization was also credible. Storage Rules consulted room
membership in Firestore, enforced owner metadata and object constraints, and
denied Mallory. Alice uploaded and deleted while Bob downloaded exact bytes.
The tradeoff is two-resource consistency: object and metadata are separate
writes, so production UI code needs compensation if only one succeeds.

### What felt bad or frustrating

The installed dependency tree was about 337 MB before counting cached emulator
tools. The pinned UI tree retained 11 npm audit findings and Functions retained
12. The deployable Functions project declared Node 22, while the emulator used
host Node 24 after warning, which weakens runtime-parity confidence.

Unauthenticated local startup warns about failed Admin SDK config discovery and
services that could hit production if accidentally called. Those broad warnings
create anxiety even when every used service is explicitly emulated.

Scheduled Functions were the roughest path. The emulator's local topic name
differed from the hosted region-suffixed convention. Publishing to the corrected
topic was accepted but did not invoke the handler within ten seconds. The
Functions emulator's generated `scheduledRefresh-0` background endpoint did
invoke the real `onSchedule` definition. Both failed attempts remain evidence;
the scenario passes locally, but the testing route was not discoverable from
the schedule documentation.

Rules are authorization, not filters. Query structure must be designed
alongside policy and indexes; a natural client query can fail even when each
returned row would be authorized. Local secret handling also required
application-owned environment setup, exact canary scans, and runtime-file
retirement.

Cleanup crossed Firestore, Storage, Auth, emulator processes, the scheduled
trigger, browser state, CLI/XDG state, Java state, and diagnostics. A headless
Chrome screenshot process lingered after producing its image and required exact
PID termination. Vite also watched the worktree-local browser profile until the
arm added a non-obvious exclusion.

### Performance and cleanup

Each of read, write, native push, reconnect, and build retains two warmups plus
seven samples. Medians were 5.395 ms read, 2.647 ms write, 5.305 ms push,
4.659 ms reconnect, and 1,243.711 ms build. These are small local-emulator
measurements, not hosted latency or production-scale evidence.

Exact cleanup moved two rooms, twenty objects, and three principals to zero,
proved the deleted actor could not sign in, closed all twelve assigned ports,
terminated the lingering exact Chrome PID, and removed runtime, secret, export,
browser, Firebase, Java, and diagnostic state.

### Would I choose it?

Yes for this workload when the operational shape and document model fit.
Firebase combines a broad, credible local suite, native push, policy-aware
files, server Functions, vector retrieval, and integrated export. The main
reservations are large dependency/runtime surfaces, rules-and-index coupling,
two-resource file consistency, scheduler-test discoverability, and the gap
between emulator and hosted runtime/configuration evidence.

### Lessons for Snapback

Match the outcome of Firebase's cohesive local suite: one command, one target
identity, one inspectable service manifest, deterministic test principals,
policy-aware local files, auth-aware server functions, native push, scheduler
test controls, integrated export, and exact cleanup.

Snapback can differentiate by making settlement semantics far more coherent
than application-authored documents and transactions. A first-class durable
effect state machine should expose complete, failed, cancelled, timed-out,
ambiguous, retry, and late-write prevention without every app inventing its own
question, progress, answer, and attempt ledgers.

It can also be materially simpler operationally: one exact cleanup command
should retire data, principals, objects, schedules, secrets, browser/session
carriers, and local processes with a machine-readable receipt. Diagnostics
should distinguish intentionally absent services from calls that can reach
production and show the exact corrective action.

Firebase's ordinary local vector path raises the capability bar. Snapback does
not need to copy Firestore indexes, but semantic retrieval needs a deterministic
local story, authoritative source identity, an explicit deployment path, and
diagnostics that never let a client-side fake masquerade as native retrieval.

## 2026-07-29 — Supabase, deep round, local pass after remediated evidence incident

### Environment and outcome

The arm used Supabase CLI 2.110.0, supabase-js 2.57.4, and the official local
Docker stack under arm64 Colima. The frozen timed attempt stopped after a
builder redaction failure exposed disposable local credentials in tool
diagnostics. The exact original target was destroyed and its point-in-time
evidence retained. A fresh `llp0102-research-supabase-w2-r2` target then passed
all 15 scenarios as an explicitly untimed extension.

No shared/user/provider credential was exposed, and the event did not reveal a
Supabase authorization defect. It was nevertheless a genuine protocol Stop.
The raw credential-bearing logs were hashed and destroyed, the exact local
target was retired, and post-destruction scans were zero. The r2 run generated
new credentials and sent secret-bearing CLI output only to ignored mode-0600
files.

Hosted access was preflighted read-only. The shared keys did not include the
project-scoped CLI token needed for safe deployment, so no hosted mutation was
attempted.

Coordinator evidence confidence is 14/16. Actor authority,
transaction/conflict, transport, settlement, target identity, and artifact
reproducibility are direct. Reconnect has direct measurements but no persistent
offline-write evidence. Exact cleanup is direct for both targets, but r2 lacks
a separately timestamped empty pre-write baseline receipt.

### What felt good

Supabase covered almost every requirement with first-party, composable pieces.
Postgres full-text search and pgvector made keyword and semantic retrieval feel
like ordinary schema work rather than separate infrastructure.

RLS was the strongest part of the experience. The same room-membership rule
protected table and RPC reads, Storage objects, and private Realtime topics.
Mallory's negatives were concrete and easy to inspect.

Private Broadcast from an `AFTER INSERT` trigger was excellent once reached:
the durable progress row and live event share one database transition. Bob
received exactly four events while Mallory received none. Transactional SQL
functions also made cancellation and dedupe crisp. The active-state guard
rejected every injected late patch, and a uniqueness constraint made retries
converge on one question.

The local stack is impressively complete. Auth, Storage, Realtime, Edge
Runtime, vector search, Studio, and Cron all ran without a hosted account.

### What felt bad or frustrating

The local stack is heavy: roughly a dozen containers and multi-gigabyte images.
Startup and reset were much slower and more failure-prone than the app itself.

Colima could not mount `/private/tmp`, and the CLI's file binds failed in
confusing downstream ways: first pgsodium, then Kong certificates, then the
Edge entrypoint. Nothing in the health error pointed back to the host-path
boundary. A unique disposable `/Users` mirror fixed it, but that was
substantial incidental machinery.

Realtime had two sharp edges. The local image rejected a UUID server filter
because the WebSocket initially carried the wrong role, and `SUBSCRIBED`
preceded reliable CDC readiness after reset. Explicit `realtime.setAuth`
helped. Switching to the recommended private Broadcast path was both more
reliable and better aligned with authorization.

SQL migrations require explicit grants as well as RLS policies. The first
migration looked right but authenticated and service-role table access failed
until grants were added. The Edge manifest is also snapshotted at stack start,
so adding a Function later required an easy-to-miss scoped restart.

`db reset` did not make Auth actor creation deterministic. Setup had to delete
only the three exact actor emails before recreating them. A diagnostic retry
also briefly selected generic Compose identity `supabase`; the coordinator
confirmed no existing owner or resources, and it was retired before app
mutation.

CLI start/status output contains working local secrets. That is convenient at
a terminal but hazardous in automated evidence collection. The first
tail-based redaction failed on JSON and correctly triggered the Stop. The
lesson is to redirect sensitive output first and emit allowlisted summaries,
not to hope an ever-growing regex catches every representation.

The pinned Vite dependency retained one high npm audit aggregate. It does not
change the backend result, but it is real supply-chain friction.

### Performance and cleanup

Each of search, write, private Broadcast, authenticated reconnect, and
production build retains two warmups plus seven r2 samples. Medians were
2.333 ms search, 2.081 ms write, 2.252 ms Broadcast, 3.589 ms reconnect, and
252.798 ms build. These are local-stack measurements, not hosted latency or
production scale.

The original roughly 50-minute diagnostic window remains frozen at the Stop.
The r2 work is reported separately as an untimed extension rather than blended
into a false first-hour completion metric.

Original and r2 containers, volumes, networks, runtime mirrors, generated
secrets, and assigned ports are absent. Sixty retained artifact-manifest hashes
match; the two absent records are an ignored branch marker and the deliberately
destroyed generated database secret.

### Would I choose it?

Supabase is one of the strongest choices for this workload: powerful,
transparent, security-capable, and unusually complete. The tradeoff is
operational weight and many seams between otherwise excellent components.

Compared with Convex, it required much more schema, grants, and policy SQL, but
exposed more familiar and powerful database primitives. Compared with Snapback
at the frozen commit, it could compose auth, durable progress, files, semantic
search, scheduling, and cancellation in one runnable target.

### Lessons for Snapback

Match the end result of one authorization rule spanning records, assets,
functions, and live topics. Also provide a durable mutation-to-live-event
primitive so authors do not choose between database truth and push delivery.

Supabase's observability is broad, but failure explanations are indirect.
Snapback can win by making bind/config/capability failures causal and safe by
default. Diagnostic output should never print usable secrets unless explicitly
requested, and automated modes should emit structured allowlisted summaries.

Most importantly, Snapback needs an admission path where sessions, durable
progress, files, semantic retrieval, scheduling, and cancellation can coexist
before fine-grained ergonomics comparisons matter.

## 2026-07-29 — InstantDB, deep round, complete with four gaps

### Environment and outcome

A fresh official hosted temporary InstantDB app ran client, Admin SDK, and CLI
1.0.52. The arm completed in 17m 38.4s with 11 passes, four explicit GAPs, no
failure, and no Stop-class defect. The gaps are native vector similarity,
first-party scheduling, the associated hosted Function/secret boundary, and
immediate deletion of the otherwise empty anonymous target shell.

Coordinator evidence confidence is 13/16. Actor authority, transport,
settlement, target identity, and artifact reproducibility are direct.
Transaction/conflict, reconnect/offline, and cleanup isolation are indirect:
the app has no simultaneous native conflict, no durable offline queue, and no
immediate shell deletion even though every mutable resource is gone.

### What felt good

A temporary hosted app came up from one official CLI command with no shared
account state. Typed schema, unique/indexed keys, atomic linked writes, and the
Admin SDK's `asUser` made it practical to run the adversarial harness against
real principals.

Linked permission traversal is expressive. The strongest moment was
cancellation: after the question became `cancelled`, the provider rejected an
injected late progress transaction because the create rule read the linked
question status. Native live queries were compact and reliable; Bob's second
scoped client observed all four durable progress rows and completion through
EventSource-backed `subscribeQuery` without a separate realtime service.

Indexed `$ilike`, Storage, and stable-ID upserts covered the ordinary product
paths with little infrastructure.

### What felt bad or surprising

A noninteractive schema push can exit successfully while still sitting at a
confirmation UI unless global `--yes` is supplied. That was easy to misread as
deployment success.

Permission semantics have sharp edges: `data.ref` always yields a list,
`newData.ref` does not exist, and file linking creates a view-permission
bootstrap problem before the reverse link exists. The official common-mistakes
page was unusually useful, but these failures still cost several iterations.
Storage upload's nested `{data: {id}}` response was also easy to misread.

There was no ordinary native vector query, scheduler/cron, or hosted Function
plus secrets surface. InstantDB was excellent for the collaborative data plane
but incomplete for the AI/automation plane.

The anonymous app could be created with an Admin token but not immediately
listed/deleted through the same CLI identity. All data, files, users, tokens,
ports, and local state were retired, but the empty shell must await
provider-managed auto-expiry.

The installed dependency tree was about 163 MB and npm retained one high and
one low advisory.

### Realtime, correctness, and performance

Alice, Bob, and Mallory were separate native principals. Mallory's scoped
query and subscription returned zero protected rows. File upload, member
delivery, exact bytes, outsider denial, deletion, and post-delete absence
passed.

Bob's second client observed four durable progress rows and completion through
native EventSource push. Stable-ID retry retained one question and answer, and
complete, failed, cancelled, timed-out, and ambiguous outcomes remained
distinct.

Each of hosted read, write, realtime, reconnect, and local build retains two
warmups plus seven samples. Medians were 156.864 ms read, 185.479 ms write,
252.457 ms realtime, 146.026 ms reconnect, and 425.330 ms build. These are
small-workload hosted measurements, not production-scale claims.

### Would I choose it?

Yes for a lightweight collaborative data plane where linked authorization and
live queries dominate. Not as a complete backend for this AI research product:
vector retrieval, scheduling, and server Function secrets need separate
infrastructure, and target lifecycle control is incomplete for anonymous apps.

### Lessons for Snapback

InstantDB's linked-data permissions and `asUser` testing are excellent end-state
targets: authorization should compose across relationships, and tests should
switch identities without bespoke token plumbing.

Live query ergonomics are also a benchmark. A subscription declares desired
state, delivers an initial snapshot, and tracks authoritative transitions.

Snapback can differentiate by making durable workflow progress, cancellation
settlement, scheduling, server secrets, and semantic retrieval one coherent
native path. It should also make noninteractive deploy behavior unambiguous and
offer exact target deletion through the same credential that creates an
ephemeral target.

Assistance disclosure: the worker had provider-level experience from a prior
InstantDB arm and recorded that event. This implementation was derived from
official InstantDB documentation; no provider-arm code was copied.
