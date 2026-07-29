## 2026-07-28 — Partiful × Convex calibration arm

I built the Partiful-shaped workload on Convex 1.42.3 using a fresh anonymous
local deployment. The arm used native schema/indexes, authenticated queries and
mutations, native reactive subscriptions, file storage, scheduled functions,
the scheduled-function system table, and actions for outbound effects. The
hosted arm is an explicit GAP because the supplied deploy key was empty; I did
not mutate the readable shared deployment.

### What felt good

The best part was how little backend scaffolding the actual product model
needed. A schema plus one functions file produced generated APIs and a running
backend. The initial function push compiled on the first try, including the
indexes, scheduler, storage IDs, and system-table lookup. The anonymous local
deployment required no account and kept its SQLite data and storage inside the
project, which is an excellent dogfooding loop.

Transactions and realtime were the standout product capabilities. Two
simultaneous actors competed for the final seat; ordinary Convex mutations plus
automatic optimistic-concurrency retry yielded exactly one success and one
capacity rejection without application locks. Two already-connected
`ConvexClient` subscribers then observed the frozen 20-post burst through native
WebSocket query subscriptions. This is the end result Snapback should meet:
the safe and live path is the default path.

Storage and scheduling were similarly cohesive. The upload-URL/storage-ID flow
round-tripped and hash-verified the exact 262,144-byte object, and authorized
query code could resolve a delivery URL. `runAfter` returned a durable ID whose
success was visible in `_scheduled_functions`; that made the scheduled reminder
far easier to prove than a log-only job.

### What felt bad or surprising

Parallel isolation exposed rough CLI edges. Convex accepted exact local backend
and site ports, but those flags were hidden from `convex dev --help`; I had to
inspect the installed CLI source. Non-interactive startup also failed when I
tried `--configure new`, then worked once I used
`CONVEX_AGENT_MODE=anonymous`. The backend listened on `0.0.0.0` even though the
application and browser were deliberately loopback-only.

Testing realistic authorization on the anonymous target was awkward. Both
clients implement a local-admin acting-identity method, but the method is
omitted from their public TypeScript declarations. I isolated a cast in the
harness and kept every application authorization check on `ctx.auth`, but a
typed, documented multi-persona testing helper would have made this much more
trustworthy. Configuring Convex Auth merely to obtain deterministic local test
personas would have added unrelated setup to this backend bakeoff.

Outbound effects still needed substantial application policy. Convex actions
made `fetch` easy, but known-success suppression, ambiguous settlement,
idempotency keys, and retry accounting all required a custom ledger. The
fault-injected receiver proved the key semantic truth: if the receiver accepts
the body and closes before the response, Convex can only retain an ambiguous
outcome; retrying is safe in state-machine terms but can duplicate the external
effect. That ambiguity must not be hidden.

The local backend downloaded a dashboard even though the arm did not need it,
and its executable came from a machine-global cache while state stayed
project-local. Neither broke isolation, but both make hermetic accounting less
obvious. Scheduled IDs also had to be stored as strings and cast back to the
system-table ID type for inspection.

### What Snapback should learn

Snapback should aim to match Convex's outcome, not its exact machinery:

- zero-account local startup with durable project-local state;
- one typed schema/function/client loop;
- serializable application mutations that make capacity invariants natural;
- reactive queries that turn ordinary reads into multi-client live state;
- native object storage with explicit identity, delivery, and deletion;
- scheduler receipts with stable IDs and inspectable terminal state.

Snapback can beat this experience by making isolation controls discoverable,
providing a typed first-class multi-persona test facility, making all cache/data
roots explicitly relocatable, and offering an effect-attempt primitive with
known-success suppression and honest ambiguous settlement built in. The
provider comparison also reinforces that good local ergonomics must include an
equally inspectable hosted path; this arm could not judge Convex's hosted
deployment because the credential was unavailable.

### Bottom line

For this workload Convex is a very strong default backend choice. Its native
transactions, subscriptions, storage, and scheduler all survived the frozen
acceptance facts with unusually little product code. The main deductions are
around CLI discoverability, test-auth ergonomics, hermetic isolation, and the
fact that exactly-once external effects remain an application concern.

### 2026-07-29 evidence erratum — PARTY-07

The original timed PARTY-07 receipt proved that two established native
WebSocket clients observed the exact 20-post wall burst, but it did not retain
an RSVP-total transition on those same live handles. I did not rewrite that
receipt or any timed performance evidence.

A separately named fresh local remediation target set the authoritative RSVP
baseline to zero, established Alice and Bob subscriptions before any burst
writes, and then committed 20 wall posts plus Bob and Casey RSVP changes.
Both established clients observed `yes/seats` move from `0/0` to `2/2` and
wall posts move from `1` to `21`; a separate authoritative query agreed.
The remediation namespace then probed zero across every table, the fresh target
and runtime state were retired, and ports 3356/3357 were closed. This improves
the evidence, not the original authoring-time or performance result.
