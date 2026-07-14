# 0013 — Hidden-card auth slice

## 2026-07-13 — ENG-24605, authority descriptors and the two-axis store

I built a deliberately small card-game backend rather than a visual game: two
seeded hands, an authenticated `myHand(gameId)` query, and a `signalReady`
mutation that is safe to queue. The acceptance proof then uses those rows to
exercise the two-axis client store (format 5 in the composed item-6/item-7 train;
the isolated item-7 branch originally used the colliding format number 4).

### What felt good

The source-authored Snapback path was pleasantly compact. `auth:
'authenticated'` states the route requirement, while `authUserId()` puts the
server-derived principal directly into the query filter and mutation values.
The generated manifest made the privacy-relevant fact inspectable: the hand
query contains `AuthUserId`; no browser-supplied owner id is part of its API.

The authority descriptor also improved the shape of the offline code. It is a
dedicated queue field next to the mutation identity, not an answer inside the
ctx ledger. Capturing it once on enqueue and replaying the exact record was
easier to reason about than recomputing an auth fingerprint during reconnect.
The format-5 matrix became crisp:

- refresh of one opaque authority instance keeps the queue;
- a new session for the same user keeps principal-owned rows but strands the
  old session's queue;
- another user gets neither the rows nor the queue.

The distinction is useful even before authorized retained reads are enabled.
The store can implement the correct physical namespaces now without falsely
advertising the item-8 product capability.

### What felt bad or surprising

The integration spans three representations of nearby concepts:
AuthCoordinator's custody authority, the handshake's authority descriptor,
and the Contract store's retained/queue records. Keeping the descriptor out of
secret-bearing custody is correct, but it means the post-transition handshake
must re-establish the queue axis. The barrier ordering is load-bearing and is
not obvious from a surface implementation.

The worktree also started without JavaScript dependencies, so codegen could
not load `esbuild` until I reused the sibling checkout's installed dependency
tree. The repository's Rust bootstrap has a paved worktree path; demo codegen
does not yet have an equally explicit one.

The finite demo cannot honestly exercise revocation while a response or live
delivery is in flight. That is not a missing assertion to paper over: the
connection fence and invalidation protocol belong to item 6. Likewise, showing
a hidden hand from retained storage while offline would be an item-8 lease
claim. This diary and the demo keep both unavailable.

### Snapback compared with familiar stacks

With React plus Convex, I would expect the authenticated query identity and
reactive invalidation path to come as one hosted system. That is less plumbing
for the happy path, but it can blur which guarantee protects a cached result
and which protects an outbox entry. Snapback made those guarantees explicit;
the cost was more protocol and migration work before sessions can be called
complete.

With React plus Supabase, row-level security could express the hand filter
close to the database. Offline mutation identity and same-user/new-session
queue ownership would still need a client policy, and it would be easy to key
both cache and queue to one access-token/session notion. Snapback's two axes
prevent that shortcut, at the price of a stricter client-store format.

### Exact and Contract observations

Contract's derived mutation path was helpful because the queue already had one
durable record and one reconnect loop; adding `authorityDescriptor` did not
require app-local replay code. The important change was to capture the value at
enqueue and thread the record on both immediate delivery and reconnect.

Exact did not materially participate in this finite backend proof. There is no
`.contract` UI here, and I did not claim that a generated Exact surface proves
auth. That separation felt healthy: Snapback owns credential resolution,
descriptor enforcement, and storage namespaces; Contract consumes the
resulting transport/store contract. A future UI can be added after item 6/8
without changing the meaning of this proof.

### Workarounds and follow-ups

- The branch base predates item 5's HTTP session resolver and concrete
  `/auth/session` handler. Integration must populate the descriptor from the
  prepared server authority after bearer resolution.
- The worktree reused the sibling checkout's installed `node_modules` for
  codegen.
- A browser card table, auth-scoped live hand updates, revocation races, and
  offline hidden-hand presentation are intentionally deferred; the last two
  are owned by items 6 and 8.

## 2026-07-13 — ENG-24606, live and lease-authorized hidden hands

The same `myHand(gameId)` declaration now drives finite reads, an actual live
WebSocket surface, retained storage, and offline presentation. The acceptance
run mints two email-code sessions, deals rows through `acceptHandCard`, and
proves that Ada and Grace see disjoint hands. Ada's third card reaches only her
live Contract boundary. Logout then crosses the `AuthCoordinator` barrier and
blanks Ada before the transition returns, while Grace remains visible. After
the server stops, the test discards Grace's in-memory client and coordinator,
then reconstructs new custody and client-store adapters over only their durable
bytes. Her signed lease permits the cold process to render the retained hand
before its derived client deadline; at exact equality the store deletes both
lease and rows before any fallback can expose them.

### What felt good

The application declaration stayed small. `authUserId()` states ownership once
for the query and mutation, `.sync()` makes the backing table eligible for
retention, and `retainable: true` makes the offline intent explicit. Snapback
and Contract carried the harder parts: session identity, connection binding,
authorization invalidation, exact ACKs, lease issuance, durable storage, and
the equality-expiry rule. The final demo has no client-supplied owner id and no
test-only authorization shortcut.

The lease boundary is also refreshingly honest. It authorizes an honest client
to reuse one exact snapshot for a bounded interval; it does not pretend to
revoke bytes already controlled by a hostile client. Keeping that distinction
in the demo's `notClaiming` list made the acceptance proof easier to trust.

### What felt bad or surprising

Composition exposed several protocol seams that isolated tests had missed:

- Browsers cannot attach custom headers to a WebSocket upgrade, so the four
  exact auth protocol offers needed WebSocket subprotocol carriers.
- Codegen pinned the Contract manifest to `snapback.v0` even when the selected
  sessions artifact train was `snapback.v1`, and retainability validation
  accepted `Query` but accidentally rejected the correct `LiveQuery` kind.
- Rust enum-field serde defaults left `ScopeId` fields in snake_case while the
  JavaScript protocol required camelCase.
- Coalesced authenticated use can advance the in-memory session projection
  beyond a captured deadline. Lease issuance therefore has to clamp against
  durable session truth, not that older projection.
- A live-mutation drain held an admission effect guard while revalidation
  recursively validated the same managed lease. Narrowing the guard to the
  obligation/ticket publication cut fixed the deadlock without weakening the
  retirement fence.
- An outbox snapshot and its level-triggered projection can arrive in one
  turn. The client now coalesces the same exact resolution ticket into one
  custody/ACK task instead of racing itself into a false stale-resolution
  quarantine.
- Standalone invalidation ACKs also need the authority-descriptor protocol
  offer, and a failed forced handshake must preserve the last successful
  projection for offline lease validation while every online boundary still
  forces a fresh probe.
- Cold-process fallback originally tried to resume the `AuthCoordinator`
  transport before consulting the retained store, so it required the server
  that offline boot exists to survive. The coordinator now has a cold-only
  durable restore that exposes no online transport, and Contract validates the
  stored principal/query fence and unexpired lease before attempting renewal.
  The kit also keeps last-successful handshake state separate from an in-flight
  probe, so concurrent failures or an invalid response cannot cache a rejected
  promise or revive a stale projection.

Reset issuer rotation and session startup's blocking SQLite work were earlier
composition failures in the same train. Both reinforced the same lesson: auth
correctness lives in lifecycle edges, not only in the happy-path verifier.

### Snapback compared with familiar stacks

Convex would bundle auth, reactivity, and caching with less visible protocol
work, but the distinction between live revocation and offline authorization
would also be less explicit. Supabase RLS would keep the online hand filter
near the database, while the offline deadline, query-instance fence, and
same-user/new-session custody policy would still need a client design.
Snapback made those boundaries explicit, at the cost of substantial
composition debugging.

### Exact and Contract observations

Contract materially participates now: the proof uses its real surface,
two-axis store, auth barrier, invalidation queue, retained snapshot, and
offline fallback. The most useful behavior is fail-closed blanking while a
snapshot has no replacement lease; rendering resumes only after exact ACK and
full revalidation commit a successor lease.

Exact still does not participate. This is a headless Contract boundary proof,
not a `.contract` UI or compiler proof, and the diary keeps that distinction
explicit.

### Remaining boundary

This proves the local target and an honest client. ENG-24607 still owns hosted
TLS and trusted-proxy assumptions, distributed throttling/invalidation, and
the browser XSS/bearer-custody posture. The full permission-changing ACL and
protected-room kick trace from LLP 0053, plus complete game rules and UI, are
also outside this slice.

## 2026-07-14 — Restoring the composed two-axis proof

The item-8 composition had replaced the finite item-7 acceptance script with
the stronger real-session live and AuthorizedLease proof, but in doing so it
stopped executing the independent queue axis. I restored that coverage without
returning to synthetic principals: the test now clones Grace's real
post-handshake, lease-bearing store, enqueues `signalReady` with her exact
server-issued authority descriptor, refreshes the live credential, and mints
successor sessions through the email-code provider.

The composition is useful evidence in its own right. Refresh preserves the
queue because the opaque authority instance is stable. A separately minted
Grace session keeps her physical principal-owned hand rows but strands the old
queue as rerecordable, while a newly minted Ada session deletes Grace's rows.
Running those transitions on a durable clone leaves the original Contract
surface and store untouched, so the same acceptance still proves live logout
blanking and cold-process lease expiry rather than trading one guarantee for
another.

The awkward part remains the number of captures at the seam: coordinator
epoch, queue generation, artifact identity, principal scope, descriptor, and
query lease all have different jobs. The explicitness is valuable compared
with a single access-token cache in a typical React/Supabase client, but it is
also easy for a later demo rewrite to preserve the visible hand behavior while
silently dropping queue-ownership coverage. Keeping both assertions in one
runner makes that regression visible.

ENG-24607 has since assigned and enforced the hosted-security contract. The
local target is still honestly not hosted-ready: it reports bearer-v1 XSS
exposure and lacks target-owned external TLS, trusted effective-source
derivation, shared throttling, and multi-replica invalidation. The demo
metadata now names those missing implementations instead of claiming the
contracts themselves are unowned.
