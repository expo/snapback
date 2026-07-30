# LLP 0125: Concurrency and conflict ergonomics

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Developer experience, Application data API, Client integration, Runtime, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0115, LLP 0116, LLP 0003, LLP 0043, LLP 0059, LLP 0066, LLP 0070, LLP 0094, LLP 0108, Diary 0027, Diary 0028, Diary 0030, Diary 0039

This document is part of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search |
| 0120 | relational-composition-and-aggregation |
| 0121 | transactional-one-off-scheduling |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges |
| 0124 | product-breadth-storage-and-vector-search |
| 0125 | concurrency-and-conflict-ergonomics (this document) |

## Summary

In the 2026-07-28 bakeoffs, Convex's concurrency story was "pleasantly
boring" (Diary 0028): ordinary serializable mutations plus automatic
conflict retry meant zero application code for two-actor appends and
capacity races. Snapback's original arms, by contrast, had to author a
bounded retry loop around `SNAPBACK_AUTH_RESERVATION_STALE` for an
ordinary two-actor append, had to understand two distinct 409 paths to
surface one user-visible conflict, and saw a capacity-race loser
degraded to a generic `SNAPBACK_HANDLER_FAILED`.

The load-bearing correction this document must open with: **the retry
half of that complaint was fixed on 2026-07-28 and the fix has held.**
The remediation reruns in Diaries 0027 and 0028 (Snapback commit
`5f31cb61`) moved the effect-free reservation retry into the standard
JavaScript and Swift clients, the arms deleted their application loops,
and the 2026-07-30 current-main rerun (Diary 0039) passed every
concurrency check on both backends without a single retry- or
conflict-shaped pain in its fifteen prioritized items. What remains
open is narrower and different in kind: two inconsistent failure
shapes, no channel for domain-typed rejections, a wide 409 code family
whose app-facing contract is taught rather than enforced, and a burst
path whose last honest measurements predate current main and have not
been re-taken.

## What Convex does

**General product background** (not diary evidence; consistent with the
pinned versions the bakeoffs used, `convex` 1.42.x): Convex executes
mutations as serializable transactions under optimistic concurrency
control. Mutations are deterministic and queued; when a commit-time
conflict is detected the server re-executes the mutation against fresh
state automatically, so application code never observes the conflict at
all. Application-level failures use a typed error mechanism
(`ConvexError` with a structured `data` payload) that crosses the wire
to clients as data, distinct from opaque internal errors.

**Diary evidence**, which is what the comparisons actually scored:

- "Concurrent sends were pleasantly boring. Two authenticated clients
  crossing one `Promise.all` barrier committed two rows with distinct
  server sequences" (Diary 0028, Convex arm). The two-client
  twenty-message burst measured **179.0 ms median, 250.5 ms p95**.
- Concurrent title mutations converged to the committed winner and
  simultaneous reorders preserved a unique `0..24` permutation, with no
  application concurrency code (Diary 0027).
- "The default mutation retry contract is unusually valuable: the warm
  offline create and update settled without application queue
  infrastructure and exactly one marker committed" (Diary 0027).
- "Server errors named the function, request id, classification, source
  file, and line, which materially shortened diagnosis" (Diary 0028).
- The lessons section asked directly for parity: "a mutation promise
  should embody retry and exactly-once settlement" (Diary 0027).

Two caveats keep this honest. Convex's retry is silent: the diaries
recorded no evidence artifact of how many attempts a settled mutation
consumed. And the neighboring arms show the failure mode Snapback must
not copy: SpacetimeDB delivered intentional reducer rejections as a
generic `InternalError` with the useful capacity diagnostic buried in
logs (Diary 0030), which the agent scored as a real defect.

## What Snapback does today

Everything in this section was verified against current main
(`ba752a14` era), not against the diaries' frozen commits.

### The two-lane conflict model

Snapback deliberately has two different conflict mechanisms, owned by
two different documents.

**Lane 1 — authorization reservation (LLP 0059, Accepted).** Every
authorization-protected write reserves a snapshot-bound authority pair
before its durable transaction. If the pair goes stale, the operation
fails *before any durable effect* with `SNAPBACK_AUTH_RESERVATION_STALE`
as HTTP 409 carrying the closed details `{retryable: true,
retryStrategy: "short-jitter", effectCommitted: false}`. LLP 0059 pins
that "a one-shot Ibex handler is never rerun merely because the
reservation became stale" — re-entry is the client's job.

**Lane 2 — commit-time read-set validation (LLP 0003, Draft).** JS
mutation reads are captured server-side; declarative host-plan
mutations that depend on an earlier client observation carry an
explicit `readSet` baseline (a deliberate version-match CAS, LLP 0003's
E3 decision — server-captured reads would be a no-op there because the
deciding read happened on the client). At commit, any invalidated
dependency rejects the whole mutation with
`SNAPBACK_MUTATION_CONFLICT`. The captured-read path
(`src/storage.rs`, `captured_conflict`) attaches machine-readable
details: the failing dependency (`table`/`id`/`expected`/`actual`), the
full captured read set, and `retryPolicy: "reject"`; the explicit
`readSet` path shares the code and dependency detail but not yet the
`retryPolicy` field (LLP 0066's earlier audit, still true).

A third, smaller lane matters for races: declared unique indexes. Two
racing inserts resolve at the constraint — exactly one wins and every
loser receives the typed `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`
(`guide/backend/mutations.md`).

### What the 2026-07-28 remediation fixed, and that it held

The original calibration arms are recorded honestly in the diaries:
Diary 0028's Snapback chat arm authored a bounded retry loop and wrote
"application code should not have to invent this retry loop for an
ordinary two-actor append"; Diary 0027's todo arm observed the
two-stage sequence — `SNAPBACK_AUTH_RESERVATION_STALE`, then, on replay
with the original baseline, `SNAPBACK_MUTATION_CONFLICT` — and
concluded "application code must understand two different 409 paths to
surface one user-visible conflict."

The remediation (SB-004,
`demos/backend-bakeoff/reports/remediation-1-report.md`) moved the
retry into the standard clients. On current main, verified in
`packages/snapback-client/index.mjs`:

- The mutation path retries **only** the exact closed refusal — code
  `SNAPBACK_AUTH_RESERVATION_STALE` with `retryable: true`,
  `retryStrategy: "short-jitter"`, and `effectCommitted: false` —
  never a missing fact, a different status, or anything that may have
  committed.
- The loop is bounded and configurable: default 40 attempts with
  20–80 ms uniform jitter (`reservationRetryMaxAttempts`,
  `reservationRetryJitterMilliseconds`; `1` disables).
- Every retry is pinned to the first attempt's authority/carrier
  generation; logout, user switch, or bearer replacement fails the
  operation stale rather than replaying predecessor intent as the
  successor. This rule exists because independent review of the
  remediation caught a cross-user replay hazard and a Swift
  action-replay hazard before freeze; Swift automatic replay is
  mutation-only (`guide/clients/swift.md`).
- Retries are observable: a bounded diagnostic ring records
  `SNAPBACK_AUTH_RESERVATION_RETRY_SCHEDULED` / `_SETTLED` /
  `_EXHAUSTED` entries, exposed via `reservationRetryDiagnostics()` and
  `onReservationRetryDiagnostic`
  (`packages/snapback-client/reservation-retry.test.mjs` covers the
  contract).

The guide now teaches this as the paved contract and explicitly forbids
application loops (`guide/backend/mutations.md`: "Do not add an
application retry loop"). The remediation reruns confirmed the outcome
— "ordinary concurrent calls settle without app loops" (Diary 0028),
"Direct `Promise.allSettled` barriers each expose a client-owned
effect-free retry and end with one committed result plus one ordinary
`SNAPBACK_MUTATION_CONFLICT`" (Diary 0027) — and Diary 0039's rerun is
the strongest evidence the fix held: all seven Snapback arms passed
their concurrency checks (Relay's invalid-move rollback and
commit-version proof, Campfire's pagination under a concurrent insert,
Split's atomic multi-row commits), and none of the rerun's fifteen
prioritized pain points concerns conflicts or retries.

So on current main, an application author handles:

**(a) Two-actor append: nothing.** The default client absorbs
reservation contention; both appends commit exactly once; the attempt
history is available as client-side evidence. An author who sees
`SNAPBACK_MUTATION_CONFLICT` sees it only if they opted into an
explicit CAS baseline, and then it is a real domain signal the guide
says to reconcile, never blind-retry.

**(b) A domain-constraint race such as capacity: real work, with a
shape problem.** Enforcement itself is natural — Diary 0030: "Capacity
enforcement fit naturally in one authoritative mutation. Two
simultaneous final-seat claims produced one success and one rejection."
The problem is the loser's surface. A handler that throws surfaces
`SNAPBACK_HANDLER_FAILED`: `handler_envelope_code` in `src/runtime.rs`
maps handler-envelope codes through a closed `SNAPBACK_*` allowlist and
collapses everything else — its own test uses a code literally named
`MADE_UP_BY_HANDLER` — to the generic code, keeping the thrown message
only as `details.message`. This is a deliberate boundary (apps must not
mint `SNAPBACK_*` codes), but it leaves exactly two paved alternatives:
declare a unique index when the invariant is key-shaped (typed loser),
or model the rejection as data in an LLP 0108 result-contract union
(`{status: "rejected", reason: "capacity_full"}`), which is what
Dispatch's typed completion union demonstrates. There is no declared
failure-variant channel; Diary 0030's complaint stands on current main.

**(c) Action failure vs mutation failure: two shapes.** Verified in
`src/server.rs` and `src/local.rs`: the mutation route returns
`Result<Json<MutationResponse>, ApiError>` — a failed mutation rejects
with an error envelope that still carries its terminal receipt — while
the action route returns HTTP 200 with
`FunctionResponse<FunctionRunResult>`, folding handler failure into
`{ok: false, diagnostic}` (a shape inherited from LLP 0017's admin
function-runner envelope). The standard client therefore throws for
mutation failures and resolves for action failures, and application
code must check `.ok` on one call class only. Diary 0030 recorded
exactly this at the *remediated* commit, so the 2026-07-28 fixes did
not touch it. LLP 0094's schema-closure audit already lists the action
output as an open envelope family — a named, unclosed gap.

### The 409 taxonomy as a whole

`status_for_established_diagnostic_code` (`src/server.rs`) maps a
large family — reservation staleness, mutation conflict, unique
violation, action generation conflict, migration and seed conflicts,
membership invariants, dozens of codes in all — to HTTP 409, with codes
authoritative and statuses advisory (LLP 0094's rule). The *taught*
app contract (`guide/backend/mutations.md`) reduces the concurrency
subset to three verbs: let the client absorb `RESERVATION_STALE`,
reconcile `MUTATION_CONFLICT`, treat `UNIQUE_CONSTRAINT_VIOLATION` as
the domain duplicate. That is coherent, but it lives in prose and in
two default clients; a raw-HTTP or third-party protocol client
(LLP 0093's audience) re-inherits the full taxonomy.

### Burst-path performance

The numbers that indicted the retry loop were: Snapback two-client
twenty-message burst **4,889.57 ms median / 7,465.152 ms p95**
("includes the bounded effect-free reservation retry, so it is both
performance and ergonomics evidence") versus Convex **179.0 ms /
250.5 ms** (Diary 0028). Two facts complicate the comfortable reading
that the remediation fixed this. First, the 2026-07-29 external Linux
package run — *after* the remediation, with no application loop —
still measured "a roughly 20.9-second median" for the same burst, and
the diary explicitly says "this needs profiling rather than being
hidden by the overall pass." Second, no current-main measurement
exists: the Diary 0032–0039 rerun measured correctness, not chat-burst
latency, and the frozen bakeoff performance receipts carry a known
machine-profile defect (`issues/20260729-bakeoff-performance-machine-
profile.md`). Current-main burst behavior is therefore **unknown**, and
the adjacent primitive gap is still recorded: Campfire's send derives
its sequence by scanning the room, and the rerun notes a production
chat "would need a contention-safe sequence allocation" (Diary 0034;
SB-008 deferred this in the remediation ledger).

## How they differ and what agents preferred

Convex makes contention invisible: one failure vocabulary, no
app-visible conflict for ordinary writes, fast bursts. Snapback makes
contention *visible and evidence-bearing*: closed refusal details,
receipts on rejected mutations, a client-side attempt ring, and a CAS
lane whose losses mean something.

The diaries' preference signal is more discriminating than "Convex
won." Agents disliked visibility exactly when it was mechanical — the
reservation loop, the two-409 sequence, the generic capacity failure —
and praised it when it was semantic: "The stale-read-set conflict test
was particularly crisp … easier to interpret than a provider-specific
last-write-wins convention" (Diary 0029). The remediation's design
followed that split precisely — it automated only the provably
effect-free mechanical refusal and kept every semantic outcome visible
— and the accepted result "matches the competitor outcome … while
keeping Snapback's stricter rule that only exact, effect-free
reservation refusals can replay" (Diary 0028). What is left of the
preference gap is the failure-shape inconsistency, the missing
domain-error channel, and the burst numbers.

## Option space

No final call is made here; these are the paths for what remains open.

**Option 1 — Unified app-visible conflict taxonomy.** Define one
app-facing conflict signal (one code, or one closed class) carrying a
machine-readable `cause` detail (`reservation-stale`, `read-set`,
`unique-key`, …) instead of asking apps to know N distinct 409 codes.
The distinct codes carry real evidence value — they distinguish
"no effect, safe to replay" from "effect refused for a reason you must
reconcile," and acceptance suites assert them exactly — so the
simplification must keep the precise code in the diagnostic/receipt
layer and change only the *contract apps are taught to branch on*.
Cheap because the default clients already implement the collapse de
facto; the work is specifying it for protocol clients (LLP 0093/0094
territory) rather than leaving it as guide prose.

**Option 2 — Domain-typed rejections as a first-class authoring
surface.** Let a handler declare failure variants
(`capacity_full`) beside its result contract, so a domain rejection
reaches every client as typed data instead of
`SNAPBACK_HANDLER_FAILED`. This is the direct fix for Diary 0030 and
the analog of Convex's `ConvexError`, but done declaration-first: the
variant set becomes part of the generated contract and the TypeScript
flow (LLP 0117's territory — a declared failure union is only useful
if it reaches client types), and the runtime allowlist stays closed
because declared variants travel in a distinct envelope member, not as
minted `SNAPBACK_*` codes. LLP 0108 is the natural owner; its
result-union machinery already proves the projection pipeline works.
The main design question is throw-shaped versus return-shaped authoring
and how a typed rejection interacts with the atomic no-commit rule.

**Option 3 — One failure shape across actions and mutations.** Pick
one contract — rejection with a structured diagnostic envelope is the
already-documented mutation semantics and the guide's stated intent for
actions ("the action error remains a structured diagnostic envelope") —
and migrate the action route off the 200-`{ok:false}` function-runner
envelope. LLP 0094 owns the wire change and already flags the action
output as an unclosed family; the cost is a breaking client change
(every `.ok` check in existing arms), so it likely needs a negotiated
envelope version rather than an in-place flip. Smallest option by
design surface, largest by migration blast radius relative to size.

**Option 4 — Automatic retry as a declared, evidenced contract.**
Snapback's answer to Convex's *silent* server-side retry: keep retries
out of app code but make them visible in evidence. Pieces that exist
today: the client ring (attempts, jitter, outcome), `clientMutationId`
exactly-once identity (LLP 0043), and LLP 0066's four-concern
decomposition (eligibility / schedule / evidence / idempotency). Pieces
that do not: any server-side receipt of how many attempts a settled
write consumed (the ring is client-custody only), a declared per-app or
per-function policy surface, and an answer to LLP 0003's still-open
Draft question — its own text contemplates "retry the deterministic
handler against fresh state" server-side, which LLP 0059 currently
forbids for reservation staleness and nothing implements for read-set
conflict. A deliberate contrast with Convex is available here: retries
visible in receipts, invisible in application code.

**Option 5 — Contention performance as a product surface.** Profile
the burst path before designing anything: the 0028 numbers are stale,
the post-remediation Linux number (20.9 s) is alarming but from one
uncontrolled host, and current main has no measurement — the reruns
dropped burst timing and the frozen receipts carry the machine-profile
defect. The work is a normalized-profile burst benchmark (the bakeoff
final report already lists "make the fast path actually fast" as
improvement 7), then the primitives the profile implicates: per-write
reservation cost under same-room contention, jitter tuning, and a
contention-safe sequence-allocation primitive so append-heavy apps stop
scanning to derive order (Diary 0034; deferred SB-008).

Options 1–3 are mostly independent; option 2 is the highest
product-value item and option 5 is the prerequisite for any performance
claim in a future rerun.

## Findings

1. The original two loudest complaints — the application-authored
   reservation retry loop (Diary 0028) and the two-409-paths-per-
   conflict experience (Diary 0027) — were fixed in the 2026-07-28
   remediation (client-owned effect-free retry, JS + Swift), and the
   fix held through the 2026-07-30 rerun: no conflict pain appears in
   Diary 0039's fifteen prioritized items.
2. The current-main retry contract is code-verified: default clients
   retry only the exact closed `SNAPBACK_AUTH_RESERVATION_STALE`
   refusal (`retryable`/`short-jitter`/`effectCommitted:false`), 40
   attempts, 20–80 ms jitter, authority-generation-pinned, with an
   observable diagnostic ring (`packages/snapback-client/index.mjs`,
   `guide/backend/mutations.md`).
3. `SNAPBACK_MUTATION_CONFLICT` on current main is a semantic signal,
   not noise: it reaches apps only via deliberate CAS baselines or
   captured-read invalidation, carries dependency details and (on the
   captured path) `retryPolicy: "reject"`, and agents rated its
   evidence above last-write-wins alternatives (Diary 0029).
4. Domain-typed rejections do not exist: `handler_envelope_code`
   (`src/runtime.rs`) collapses every non-allowlisted handler-thrown
   code to `SNAPBACK_HANDLER_FAILED`. The paved alternatives are unique
   indexes (typed) and result-union rejections-as-data (LLP 0108).
   Diary 0030's capacity-loser complaint stands.
5. The action/mutation failure-shape split is structural and current:
   actions settle HTTP 200 `{ok:false, diagnostic}`
   (`FunctionRunResult`, `src/local.rs`), mutations reject with a
   receipt-carrying error envelope (`src/server.rs`); LLP 0094 lists
   the action output as an open envelope family. Also observed at the
   remediated commit, so the remediation did not address it.
6. Burst performance is unmeasured on current main. Last data: 4,889.57
   ms median / 7,465 ms p95 (pre-remediation macOS, Diary 0028) and
   ~20.9 s median (post-remediation Linux external run, same diary,
   explicitly flagged "needs profiling"). The rerun measured no burst
   latency, and the frozen receipts have a machine-profile defect.
7. LLP 0115 sequences none of the remaining items: its retired-gaps
   list correctly excludes conflict ergonomics from the fixed set, but
   no CV item covers failure-shape unification, domain-typed
   rejections, or burst profiling. This research covers ground the
   parity plan does not currently schedule.

## Confidence

High confidence: the remediation history and its persistence (three
independent diary records plus the rerun's silence); the current-main
client retry contract, conflict emission details, handler-code
allowlist, and route shapes (all read directly from code this session);
the guide's taught contract. Medium confidence: the claim that
captured-read conflicts are rare in ordinary JS-handler operation
(inferred from the staging choreography and diary observations, not
from a measurement). Low confidence: anything about current burst
latency (finding 6 — deliberately marked unknown), and the Convex
general background beyond what the diaries recorded, which is stated at
my knowledge cutoff and against the pinned bakeoff versions rather than
re-verified upstream.

## Open questions

1. Should the app-visible conflict contract be one signal with cause
   detail (option 1), and if so, is it specified in LLP 0094's envelope
   or as a client-conformance rule in LLP 0095?
2. Throw-shaped or return-shaped domain rejections (option 2), and can
   a declared failure variant share the result contract's projection
   and hashing machinery without weakening the no-commit atomicity
   rule?
3. Which failure shape wins for option 3 — and does the action envelope
   migration ride LLP 0093's protocol negotiation or a versioned route?
4. Does LLP 0003's contemplated server-side deterministic re-execution
   ever become worth its determinism obligations, or is the settled
   division (client replays effect-free refusals; semantic conflicts
   always surface) the permanent answer? LLP 0003 is still Draft with
   this question open.
5. What does the normalized burst profile attribute the tail to —
   reservation acquisition, retry jitter, sequence-scan reads, or
   commit serialization — and does the answer change option 5's
   primitive list?

## Relationship to LLP 0115 and owning documents

LLP 0115 governs sequencing; this document feeds it evidence. The
conflict-ergonomics complaints are deliberately *absent* from 0115's
retired-gaps list (they were fixed before the rerun, so the rerun had
nothing to retire) and equally absent from its work items — the closest
neighbors are CV-6 (result contracts as paved default, the natural
carrier for option 2's authoring surface) and CV-9 (LLP 0070's attempt
policy, adjacent to option 4's retry-evidence design). If any option
here graduates to work, it should enter 0115's frame as a new item with
a named owner rather than being folded silently into an existing one.

Owning documents, confirmed this session: **LLP 0059** (Accepted) owns
reservation semantics and the effect-free retry contract, including the
2026-07-26 revision that made contention an explicit retryable 409;
**LLP 0003** (Draft) owns read-set validation, the E3 client-baseline
CAS decision, and the open automatic-retry question; **LLP 0094** owns
wire envelopes and already records the action-output gap; **LLP 0108**
owns result contracts, the base for rejections-as-data; **LLP 0043**
owns client mutation identity/idempotency; **LLP 0066** (research)
holds the retry-policy decomposition option 4 builds on; **LLP 0070**
(Draft) owns attempt policy for durable background work. Per 0115's
governing constraint 3, substantive design for any option lands in
those documents (or a new owned Spec), not here.
