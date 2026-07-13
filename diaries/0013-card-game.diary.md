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
